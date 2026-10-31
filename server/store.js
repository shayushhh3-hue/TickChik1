// The database: one SQLite file (node:sqlite, no native build). Documents are JSON at a path, exactly as the page
// keeps them ("portfolio/main", "reports/archive/items/<id>", "data/users/<uid>/settings/main"); users and sessions
// live beside them. The access matrix below mirrors the rules the page had as a claude.ai artifact.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, randomUUID, createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function deepMerge(a,b){const o={...(isMap(a)?a:{})};for(const [k,v] of Object.entries(b||{})){if(v===undefined)continue;o[k]=isMap(v)&&isMap(o[k])?deepMerge(o[k],v):v}return o}

export class Store{
  constructor(file){
    if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);
    this.db.exec(`pragma journal_mode=wal; pragma synchronous=normal;
      create table if not exists docs(path text primary key, coll text not null, id text not null, data text not null, updated_at text not null);
      create index if not exists docs_coll on docs(coll);
      create table if not exists users(id text primary key, email text unique not null, name text, hash text not null, salt text not null, role text not null, created_at text not null, must_change integer default 0);
      create table if not exists sessions(sid text primary key, uid text not null, created_at text not null, expires_at text not null, ua text);
      create table if not exists meta(k text primary key, v text not null);
      create table if not exists ai_usage(uid text not null, day text not null, calls integer not null default 0, input integer not null default 0, output integer not null default 0, primary key(uid,day));
      create table if not exists ai_models(day text not null, model text not null, calls integer not null default 0, input integer not null default 0, output integer not null default 0, primary key(day,model));`);
    // the quick reads of statements, counted apart from the daily quota (14.10.2026): a database from before gets the column
    if(!this.db.prepare("select 1 from pragma_table_info('ai_usage') where name='quick'").get())this.db.exec('alter table ai_usage add column quick integer not null default 0');
    // two-step sign-in (21.10.2026): the authenticator's secret, whether it is on, the last code's counter (a code is good
    // once), and the hashes of the backup codes
    for(const [c,t] of [['totp_secret','text'],['totp_on','integer not null default 0'],['totp_last','integer not null default -1'],['totp_backup','text']])
      if(!this.db.prepare("select 1 from pragma_table_info('users') where name=?").get(c))this.db.exec(`alter table users add column ${c} ${t}`);
    this.listeners=new Set();
  }
  // ---- documents ----
  getDoc(p){const r=this.db.prepare('select data, updated_at from docs where path=?').get(p); return r?{exists:true,data:JSON.parse(r.data),updatedAt:r.updated_at,id:p.slice(p.lastIndexOf('/')+1)}:{exists:false,data:null,id:p.slice(p.lastIndexOf('/')+1)}}
  setDoc(p,data,{silent=false}={}){const i=p.lastIndexOf('/'); const now=new Date().toISOString();
    this.db.prepare('insert into docs(path,coll,id,data,updated_at) values(?,?,?,?,?) on conflict(path) do update set data=excluded.data, updated_at=excluded.updated_at').run(p,p.slice(0,i),p.slice(i+1),JSON.stringify(data===undefined?null:data),now);
    if(!silent)this.emit({op:'set',path:p,at:now})}
  updateDoc(p,data){const cur=this.getDoc(p); this.setDoc(p,deepMerge(cur.exists?cur.data:{},data))}
  deleteDoc(p){const r=this.db.prepare('delete from docs where path=?').run(p); if(r.changes)this.emit({op:'delete',path:p,at:new Date().toISOString()})}
  // the documents of one collection (direct children only), optionally sorted by a top-level field
  listDocs(coll,{orderBy=null,dir='asc',limit=0,where=null}={}){
    let rows=this.db.prepare('select id, data, updated_at from docs where coll=?').all(coll).map(r=>({id:r.id,data:JSON.parse(r.data),updatedAt:r.updated_at}));
    if(where)rows=rows.filter(r=>{const v=(r.data||{})[where.f];return where.op==='=='?v===where.v:where.op==='!='?v!==where.v:where.op==='>'?v>where.v:where.op==='>='?v>=where.v:where.op==='<'?v<where.v:where.op==='<='?v<=where.v:true});
    if(orderBy)rows.sort((a,b)=>{const x=(a.data||{})[orderBy],y=(b.data||{})[orderBy];const c=x==null&&y==null?0:x==null?1:y==null?-1:x>y?1:x<y?-1:0;return dir==='desc'?-c:c});
    if(limit>0)rows=rows.slice(0,limit);
    return rows;
  }
  // every document under a prefix (for wiping and exporting)
  pathsUnder(prefix){return this.db.prepare("select path from docs where path like ? escape '\\'").all(prefix.replace(/[%_\\]/g,'\\$&')+'/%').map(r=>r.path)}
  allDocs(){return this.db.prepare('select path, data from docs').all().map(r=>[r.path,JSON.parse(r.data)])}
  batch(writes){this.db.exec('begin'); try{for(const w of writes){if(w.delete)this.deleteDoc(w.path); else this.setDoc(w.path,w.data)} this.db.exec('commit')}catch(e){this.db.exec('rollback');throw e}}
  // ---- change notifications (one process, so an in-memory list is enough) ----
  onChange(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  emit(ev){for(const fn of this.listeners){try{fn(ev)}catch(e){}}}
  // ---- meta ----
  getMeta(k){const r=this.db.prepare('select v from meta where k=?').get(k);return r?r.v:null}
  setMeta(k,v){this.db.prepare('insert into meta(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run(k,String(v))}
  // ---- Claude usage per user per day (Israel date) ----
  // calls: what counts in the daily quota (a question to צ׳יקו, a statement read by the strongest model); quick: the quick
  // read of a statement that runs next to that read, with a cap of its own
  aiUsage(uid,day){return this.db.prepare('select calls, input, output, quick from ai_usage where uid=? and day=?').get(uid,day)||{calls:0,input:0,output:0,quick:0}}
  aiAdd(uid,day,{calls=0,input=0,output=0,quick=0}={}){this.db.prepare('insert into ai_usage(uid,day,calls,input,output,quick) values(?,?,?,?,?,?) on conflict(uid,day) do update set calls=calls+excluded.calls, input=input+excluded.input, output=output+excluded.output, quick=quick+excluded.quick').run(uid,day,calls|0,input|0,output|0,quick|0)}
  // per model and day, for the cost: the models differ a lot in price
  aiModelAdd(day,model,{calls=0,input=0,output=0}={}){this.db.prepare('insert into ai_models(day,model,calls,input,output) values(?,?,?,?,?) on conflict(day,model) do update set calls=calls+excluded.calls, input=input+excluded.input, output=output+excluded.output').run(day,String(model||'?').slice(0,60),calls,input,output)}
  aiModelsSince(day){return this.db.prepare('select model, sum(calls) calls, sum(input) input, sum(output) output from ai_models where day>=? group by model order by model').all(day)}
  aiSince(day){return this.db.prepare('select uid, sum(calls) calls, sum(input) input, sum(output) output, sum(quick) quick from ai_usage where day>=? group by uid').all(day)}
  // ---- users ----
  static hash(pw,salt){return scryptSync(String(pw),salt,64).toString('hex')}
  userByEmail(email){return this.db.prepare('select * from users where email=?').get(String(email||'').trim().toLowerCase())||null}
  userById(id){return this.db.prepare('select * from users where id=?').get(id)||null}
  users(){return this.db.prepare('select id, email, name, role, created_at, must_change from users order by created_at').all()}
  setRole(id,role){if(!['admin','friend'].includes(role))throw new Error('bad_role'); const u=this.userById(id); if(!u)throw new Error('not_found'); if(u.role==='owner')throw new Error('owner'); this.db.prepare('update users set role=? where id=?').run(role,id); return this.userById(id)}
  addUser({email,name='',password,role='friend',mustChange=false}){
    email=String(email||'').trim().toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('bad_email');
    if(String(password||'').length<8)throw new Error('short_password');
    if(this.userByEmail(email))throw new Error('exists');
    const salt=randomBytes(16).toString('hex'), id='u_'+randomUUID().replace(/-/g,'').slice(0,20);
    this.db.prepare('insert into users(id,email,name,hash,salt,role,created_at,must_change) values(?,?,?,?,?,?,?,?)').run(id,email,String(name||''),Store.hash(password,salt),salt,role,new Date().toISOString(),mustChange?1:0);
    return this.userById(id);
  }
  setPassword(id,password,{mustChange=false}={}){if(String(password||'').length<8)throw new Error('short_password'); const salt=randomBytes(16).toString('hex'); this.db.prepare('update users set hash=?, salt=?, must_change=? where id=?').run(Store.hash(password,salt),salt,mustChange?1:0,id)}
  checkPassword(user,password){if(!user)return false; const h=Buffer.from(Store.hash(password,user.salt),'hex'), g=Buffer.from(user.hash,'hex'); return h.length===g.length&&timingSafeEqual(h,g)}
  // ---- two-step sign-in ----
  totpOf(id){const u=this.userById(id); if(!u)return null; let b=[]; try{b=JSON.parse(u.totp_backup||'[]')}catch(e){} return {secret:u.totp_secret||null,on:!!u.totp_on,last:u.totp_last==null?-1:+u.totp_last,backup:Array.isArray(b)?b:[]}}
  totpPending(id,secret){this.db.prepare('update users set totp_secret=?, totp_on=0, totp_last=-1, totp_backup=null where id=?').run(secret,id)}
  totpEnable(id,hashes,counter){this.db.prepare('update users set totp_on=1, totp_last=?, totp_backup=? where id=?').run(counter,JSON.stringify(hashes),id)}
  totpOff(id){this.db.prepare('update users set totp_secret=null, totp_on=0, totp_last=-1, totp_backup=null where id=?').run(id)}
  totpUsed(id,counter){this.db.prepare('update users set totp_last=? where id=?').run(counter,id)}
  totpBackupUse(id,hash){const t=this.totpOf(id); if(!t||!t.backup.includes(hash))return false; this.db.prepare('update users set totp_backup=? where id=?').run(JSON.stringify(t.backup.filter(h=>h!==hash)),id); return true}
  endSessionsBut(uid,sid){this.db.prepare('delete from sessions where uid=? and sid<>?').run(uid,sid||'')}
  removeUser(id){this.db.prepare('delete from sessions where uid=?').run(id); this.db.prepare('delete from users where id=?').run(id)}
  // ---- sessions ----
  newSession(uid,ua=''){const sid=randomBytes(32).toString('base64url'); const now=Date.now(); this.db.prepare('insert into sessions(sid,uid,created_at,expires_at,ua) values(?,?,?,?,?)').run(sid,uid,new Date(now).toISOString(),new Date(now+30*864e5).toISOString(),String(ua||'').slice(0,200)); return sid}
  session(sid){if(!sid)return null; const s=this.db.prepare('select * from sessions where sid=?').get(sid); if(!s)return null; if(s.expires_at<new Date().toISOString()){this.db.prepare('delete from sessions where sid=?').run(sid);return null} return this.userById(s.uid)}
  endSession(sid){this.db.prepare('delete from sessions where sid=?').run(sid)}
  endSessions(uid){this.db.prepare('delete from sessions where uid=?').run(uid)}
  close(){this.db.close()}
}

// 30.10: an admin (role 'admin', set by the owner) manages the site with the owner: the users, the system's health, the
// research and the jobs. 31.10: but an admin is an investor of their own, with their own portfolio, plan, history and
// settings under data/users/<id>/, like a partner; the owner's own documents (portfolio/main, settings/main and the
// rest) are the owner's alone. ownerLike is for managing the site, isOwner for the owner's own documents.
export const ownerLike=u=>!!u&&(u.role==='owner'||u.role==='admin');
export const isOwner=u=>!!u&&u.role==='owner';
// the owner's own documents: the portfolio, the plan, the settings, the history (not history/prices), the reports, the
// alerts, the usage and the news' state
export const OWN_DOCS=new Set(['portfolio','plan','settings','history','reports','alerts','usage','news']);
// ---- who may read and write a path: the same matrix as the artifact's rules ----
// user: {id, role:'owner'|'friend'} or null; returns 'rw' | 'r' | ''
const newsIdOf=link=>createHash('sha1').update(String(link||'')).digest('hex').slice(0,12);
export function access(user,p){
  if(!user)return '';
  const seg=p.split('/'), owner=ownerLike(user);
  if(seg[0]==='data'&&seg[1]==='users')return seg[2]===user.id?'rw':'';
  // each person's list of symbols is theirs alone; the price job reads them on the server, not through this matrix
  if(seg[0]==='watch')return seg[1]===user.id?'rw':'';
  if(seg[0]==='research'&&seg[1]==='newsarc')return owner?'rw':'';   // the archive of the readings about everybody's securities: the owner's alone
  if(seg[0]==='quotes'||seg[0]==='research')return owner?'rw':'r';
  if(seg[0]==='history'&&seg[1]==='prices')return owner?'rw':'r';
  if(OWN_DOCS.has(seg[0]))return isOwner(user)?'rw':'';
  return owner?'rw':'';
}
export const canRead=(u,p)=>access(u,p)!=='';
export const canWrite=(u,p)=>access(u,p)==='rw';

// ---- the shared documents as a partner sees them: only the securities of their own portfolio, history, settings and
// watch list. The prices, the monthly closes and the research all cover everybody's securities (the owner's and the
// other partners'), and a list of what someone holds is private even without the quantities.
const SHARED_BY_SYM=new Set(['quotes/latest','history/prices','research/latest','research/comove','research/longterm','research/news','research/newsx','research/x']);
export function symsOfUser(store,uid){
  const out=new Set(), walk=v=>{if(Array.isArray(v)){for(const x of v)walk(x)}else if(isMap(v)){for(const [k,x] of Object.entries(v)){if(k==='sym'&&typeof x==='string')out.add(x); else walk(x)}}};
  for(const d of ['portfolio','history','settings']){const r=store.getDoc(`data/users/${uid}/${d}`); if(r.exists)walk(r.data)}
  const st=store.getDoc(`data/users/${uid}/settings`); if(st.exists&&isMap(st.data.pxAlerts))for(const k of Object.keys(st.data.pxAlerts))out.add(k.replace(/^TLV:/,''));
  const w=store.getDoc('watch/'+uid); if(w.exists)for(const k of ['syms','marks','held','seen','pots'])for(const s of ((w.data||{})[k]||[]))if(typeof s==='string')out.add(s.replace(/^TLV:/,''));
  return out;
}
export function partnerView(store,user,p,data){
  if(!user||isOwner(user)||!SHARED_BY_SYM.has(p)||!isMap(data))return data;
  const ok=symsOfUser(store,user.id), has=s=>ok.has(s), pick=m=>isMap(m)?Object.fromEntries(Object.entries(m).filter(([k])=>has(k))):m;
  const both=a=>Array.isArray(a)?a.filter(o=>o&&has(o.a)&&has(o.b)):a, only=a=>Array.isArray(a)?a.filter(has):a;
  if(p==='quotes/latest'){const {errors,...rest}=data; return {...rest,prices:pick(data.prices),prev:pick(data.prev),stale:pick(data.stale),meta:pick(data.meta)}}
  if(p==='history/prices')return {...data,px:pick(data.px)};
  if(p==='research/latest')return {...data,companies:pick(data.companies),events:Array.isArray(data.events)?data.events.filter(e=>!e||!e.sym||has(e.sym)):data.events};
  if(p==='research/longterm')return {...data,pairs:both(data.pairs)};
  if(p==='research/news')return {...data,items:Array.isArray(data.items)?data.items.filter(it=>it&&Array.isArray(it.syms)&&it.syms.some(has)).map(it=>({...it,syms:it.syms.filter(has)})):data.items};
  // 29.10: the readings of the articles: a partner gets the readings of the articles they may see (their own securities')
  // and all of the general news, which is nobody's holding
  if(p==='research/x')return {...data,askedAt:undefined,items:Array.isArray(data.items)?data.items.filter(it=>it&&has(it.sym)):data.items};
  if(p==='research/newsx'){const N=store.getDoc('research/news').data, Xd=store.getDoc('research/x').data, ok2=new Set(); for(const it of ((N&&N.items)||[]))if(it&&it.link&&Array.isArray(it.syms)&&it.syms.some(has))ok2.add(newsIdOf(it.link));
    for(const it of ((Xd&&Xd.items)||[]))if(it&&it.link&&has(it.sym))ok2.add(newsIdOf(it.link));
    for(const it of (Array.isArray(data.gen)?data.gen:[]))if(it&&it.id)ok2.add(it.id);
    return {...data,by:isMap(data.by)?Object.fromEntries(Object.entries(data.by).filter(([k])=>ok2.has(k))):data.by}}
  // research/comove
  return {...data,groups:Array.isArray(data.groups)?data.groups.map(g=>({...g,syms:only(g&&g.syms)})).filter(g=>g.syms&&g.syms.length>1):data.groups,
    pairs:both(data.pairs),opposite:both(data.opposite),solo:only(data.solo),nodata:only(data.nodata),
    whyPairs:isMap(data.whyPairs)?Object.fromEntries(Object.entries(data.whyPairs).filter(([k])=>k.split('|').every(has))):data.whyPairs};
}
