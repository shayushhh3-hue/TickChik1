// The database: one SQLite file (node:sqlite, no native build). Documents are JSON at a path, exactly as the page
// keeps them ("portfolio/main", "reports/archive/items/<id>", "data/users/<uid>/settings/main"); users and sessions
// live beside them. The access matrix below mirrors the rules the page had as a claude.ai artifact.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, randomUUID} from 'node:crypto';
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
      create table if not exists ai_usage(uid text not null, day text not null, calls integer not null default 0, input integer not null default 0, output integer not null default 0, primary key(uid,day));`);
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
  aiUsage(uid,day){return this.db.prepare('select calls, input, output from ai_usage where uid=? and day=?').get(uid,day)||{calls:0,input:0,output:0}}
  aiAdd(uid,day,{calls=0,input=0,output=0}={}){this.db.prepare('insert into ai_usage(uid,day,calls,input,output) values(?,?,?,?,?) on conflict(uid,day) do update set calls=calls+excluded.calls, input=input+excluded.input, output=output+excluded.output').run(uid,day,calls|0,input|0,output|0)}
  aiSince(day){return this.db.prepare('select uid, sum(calls) calls, sum(input) input, sum(output) output from ai_usage where day>=? group by uid').all(day)}
  // ---- users ----
  static hash(pw,salt){return scryptSync(String(pw),salt,64).toString('hex')}
  userByEmail(email){return this.db.prepare('select * from users where email=?').get(String(email||'').trim().toLowerCase())||null}
  userById(id){return this.db.prepare('select * from users where id=?').get(id)||null}
  users(){return this.db.prepare('select id, email, name, role, created_at, must_change from users order by created_at').all()}
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
  removeUser(id){this.db.prepare('delete from sessions where uid=?').run(id); this.db.prepare('delete from users where id=?').run(id)}
  // ---- sessions ----
  newSession(uid,ua=''){const sid=randomBytes(32).toString('base64url'); const now=Date.now(); this.db.prepare('insert into sessions(sid,uid,created_at,expires_at,ua) values(?,?,?,?,?)').run(sid,uid,new Date(now).toISOString(),new Date(now+30*864e5).toISOString(),String(ua||'').slice(0,200)); return sid}
  session(sid){if(!sid)return null; const s=this.db.prepare('select * from sessions where sid=?').get(sid); if(!s)return null; if(s.expires_at<new Date().toISOString()){this.db.prepare('delete from sessions where sid=?').run(sid);return null} return this.userById(s.uid)}
  endSession(sid){this.db.prepare('delete from sessions where sid=?').run(sid)}
  endSessions(uid){this.db.prepare('delete from sessions where uid=?').run(uid)}
  close(){this.db.close()}
}

// ---- who may read and write a path: the same matrix as the artifact's rules ----
// user: {id, role:'owner'|'friend'} or null; returns 'rw' | 'r' | ''
export function access(user,p){
  if(!user)return '';
  const seg=p.split('/'), owner=user.role==='owner';
  if(seg[0]==='data'&&seg[1]==='users')return seg[2]===user.id?'rw':'';
  if(seg[0]==='watch')return seg[1]===user.id?'rw':owner?'r':'';
  if(seg[0]==='quotes'||seg[0]==='research')return owner?'rw':'r';
  if(seg[0]==='history'&&seg[1]==='prices')return owner?'rw':'r';
  if(['portfolio','plan','settings','history','reports','alerts'].includes(seg[0]))return owner?'rw':'';
  return owner?'rw':'';
}
export const canRead=(u,p)=>access(u,p)!=='';
export const canWrite=(u,p)=>access(u,p)==='rw';
