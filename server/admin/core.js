// 1.11 TikChik Management Center, the foundation: the management permissions, the audit log, the sign-in log, and each
// person's days of activity. Everything here is enforced on the server; the page only shows what the server allows.
//
// Permissions (per user; the role gives the defaults, the owner can change them):
//   view       the management center itself: the dashboards, the totals, the health, the log of management actions
//   edit       settings of the management center (prices of the AI models for the cost) and, later, content
//   users      the users: suspend and restore, roles, other people's permissions (never the owner's, never one's own)
//   system     the system: run a job now, the health's actions
//   sensitive  per-person detail: the sign-in log (with the network prefix), each person's AI use and account history.
//              The contents of a partner's portfolio are not here at all: the site promises partners that nobody sees it
//              (PORTFOLIO_ACCESS below stays off until that promise is changed and the users are told).
// owner: all; admin: view, edit, users, system; a partner: nothing, unless the owner gives them view.
//
// The audit log is append-only: SQLite triggers refuse any update or delete of its rows, whoever asks, and each row
// carries the hash of the one before it, so a row taken out by hand at the file level shows as a broken chain.
import {createHash} from 'node:crypto';
import {ilParts} from '../../shared/market.js';
import {ensureCounters} from './counter.js';

export const PERMS=['view','edit','users','system','sensitive'];
export const PERM_HE={view:'צפייה במרכז הניהול',edit:'עריכת הגדרות ותוכן',users:'ניהול משתמשים',system:'ניהול מערכת',sensitive:'מידע אישי רגיש'};
const ROLE_DEF={owner:PERMS,admin:['view','edit','users','system'],friend:[]};
// only the owner gives or takes these two: a chain of admins cannot raise itself
const OWNER_ONLY=new Set(['users','sensitive']);
export const PORTFOLIO_ACCESS=false;

export function adminSchema(store){
  const db=store.db;
  for(const [c,t] of [['status',"text not null default 'active'"],['last_seen','text'],['perms','text'],['status_note','text']])
    if(!db.prepare("select 1 from pragma_table_info('users') where name=?").get(c))db.exec(`alter table users add column ${c} ${t}`);
  db.exec(`create table if not exists audit(id integer primary key autoincrement, at text not null, uid text, actor text, action text not null, target text, detail text, ip text, prev text, hash text not null);
    create index if not exists audit_at on audit(at);
    create index if not exists audit_target on audit(target);
    create trigger if not exists audit_no_update before update on audit begin select raise(abort,'audit is append-only'); end;
    create trigger if not exists audit_no_delete before delete on audit begin select raise(abort,'audit is append-only'); end;
    create table if not exists auth_events(id integer primary key autoincrement, at text not null, uid text, email text, ok integer not null, reason text, ip text, ua text);
    create index if not exists auth_at on auth_events(at);
    create table if not exists active_days(uid text not null, day text not null, hits integer not null default 0, src text not null default 'req', primary key(uid,day));
    create index if not exists active_day on active_days(day);`);
  ensureCounters(store);
}

// ---- permissions ----
export function permsOf(u){
  if(!u)return new Set(); if(u.role==='owner')return new Set(PERMS);
  if(u.status&&u.status!=='active')return new Set();
  let L=null; try{L=u.perms?JSON.parse(u.perms):null}catch(e){L=null}
  return new Set((Array.isArray(L)?L:(ROLE_DEF[u.role]||[])).filter(p=>PERMS.includes(p)));
}
export const can=(u,p)=>permsOf(u).has(p);
export const need=p=>(req,res,next)=>can(req.user,p)?next():res.status(403).json({error:{code:'permission_denied',message:`אין הרשאה: ${PERM_HE[p]||p}`}});
// who may set whose permissions: needs "users", never the owner's, never one's own, and the owner-only ones by the owner
export function setPerms(store,actor,targetId,list){
  const t=store.userById(targetId); if(!t)throw new Error('not_found');
  if(t.role==='owner')throw new Error('owner'); if(t.id===actor.id)throw new Error('self');
  if(!can(actor,'users'))throw new Error('permission_denied');
  const next=[...new Set((list||[]).filter(p=>PERMS.includes(p)))], cur=permsOf(t);
  if(actor.role!=='owner')for(const p of PERMS)if(OWNER_ONLY.has(p)&&cur.has(p)!==next.includes(p))throw new Error('owner_only');
  store.db.prepare('update users set perms=? where id=?').run(JSON.stringify(next),t.id);
  return {before:[...cur],after:next};
}
export function resetPerms(store,targetId){store.db.prepare('update users set perms=null where id=?').run(targetId)}

// ---- the audit log ----
const H=s=>createHash('sha256').update(s).digest('hex');
export function ipPrefix(ip){ip=String(ip||'').replace(/^::ffff:/,''); if(/^\d+\.\d+\.\d+\.\d+$/.test(ip))return ip.replace(/\.\d+$/,'.0'); if(ip.includes(':'))return ip.split(':').slice(0,3).join(':')+'::'; return ip?'?':''}
export function audit(store,{user=null,action,target='',detail=null,ip=''}){
  const db=store.db, last=db.prepare('select hash from audit order by id desc limit 1').get(), prev=last?last.hash:'';
  const row={at:new Date().toISOString(),uid:user?user.id:null,actor:user?user.email:'system',action:String(action).slice(0,60),target:String(target||'').slice(0,120),detail:detail==null?null:JSON.stringify(detail).slice(0,4000),ip:ipPrefix(ip)};
  const hash=H(prev+'|'+JSON.stringify(row));
  db.prepare('insert into audit(at,uid,actor,action,target,detail,ip,prev,hash) values(?,?,?,?,?,?,?,?,?)').run(row.at,row.uid,row.actor,row.action,row.target,row.detail,row.ip,prev,hash);
}
export function auditList(store,{limit=200,before=null,target=null,action=null}={}){
  let q='select id,at,uid,actor,action,target,detail,ip from audit where 1=1', a=[];
  if(before){q+=' and id<?';a.push(+before)} if(target){q+=' and target=?';a.push(target)} if(action){q+=' and action like ?';a.push(action+'%')}
  q+=' order by id desc limit ?'; a.push(Math.min(1000,Math.max(1,+limit||200)));
  return store.db.prepare(q).all(...a).map(r=>({...r,detail:r.detail?JSON.parse(r.detail):null}))}
// the chain checked from the first row: where it breaks, if it does
export function auditVerify(store){let prev='', n=0;
  for(const r of store.db.prepare('select * from audit order by id').iterate()){
    const row={at:r.at,uid:r.uid,actor:r.actor,action:r.action,target:r.target,detail:r.detail,ip:r.ip};
    if(r.prev!==prev||H(prev+'|'+JSON.stringify(row))!==r.hash)return {ok:false,n,brokenAt:r.id}; prev=r.hash; n++}
  return {ok:true,n}}

// ---- the sign-in log ----
export function authEvent(store,{user=null,email='',ok,reason='',ip='',ua=''}){
  try{store.db.prepare('insert into auth_events(at,uid,email,ok,reason,ip,ua) values(?,?,?,?,?,?,?)').run(new Date().toISOString(),user?user.id:null,String(email||'').trim().toLowerCase().slice(0,120),ok?1:0,String(reason).slice(0,40),ipPrefix(ip),String(ua||'').slice(0,160))}catch(e){}
}
export function authSince(store,iso){return store.db.prepare('select * from auth_events where at>=? order by id desc limit 2000').all(iso)}

// ---- each person's days of activity: one row a day, written at most once a minute per person ----
const SEEN=new Map();
export function touch(store,u,{now=Date.now()}={}){
  if(!u)return; const last=SEEN.get(u.id)||0; if(now-last<60e3)return; SEEN.set(u.id,now);
  const iso=new Date(now).toISOString(), day=ilParts(new Date(now)).iso;
  try{store.db.prepare('update users set last_seen=? where id=?').run(iso,u.id);
    store.db.prepare("insert into active_days(uid,day,hits,src) values(?,?,1,'req') on conflict(uid,day) do update set hits=hits+1").run(u.id,day)}catch(e){}
}
// before this collection began, the days each person used the site are in their own usage document (the screens seen per
// day, kept 90 days), in the AI use per day, and in the sessions' start: those days are taken once, marked as such
export function backfillActive(store){
  if(store.getMeta('activeBackfill'))return 0; let n=0;
  const add=(uid,day,src)=>{if(!uid||!/^\d{4}-\d{2}-\d{2}$/.test(day))return; const r=store.db.prepare('insert or ignore into active_days(uid,day,hits,src) values(?,?,0,?)').run(uid,day,src); n+=r.changes};
  const users=store.users(), owner=users.find(u=>u.role==='owner');
  for(const u of users){const d=store.getDoc(u.role==='owner'?'usage/main':`data/users/${u.id}/usage`); if(d.exists&&d.data&&d.data.days)for(const day of Object.keys(d.data.days))add(u.id,day,'usage')}
  for(const r of store.db.prepare('select uid, day from ai_usage where calls>0 or quick>0').all())add(r.uid,r.day,'ai');
  for(const r of store.db.prepare('select uid, created_at from sessions').all())add(r.uid,ilParts(new Date(r.created_at)).iso,'login');
  store.setMeta('activeBackfill',JSON.stringify({at:new Date().toISOString(),rows:n,owner:!!owner}));
  return n;
}

// ---- suspension ----
export function setStatus(store,actor,targetId,status,note=''){
  const t=store.userById(targetId); if(!t)throw new Error('not_found'); if(t.role==='owner')throw new Error('owner'); if(t.id===actor.id)throw new Error('self');
  if(!['active','suspended'].includes(status))throw new Error('bad_status');
  store.db.prepare('update users set status=?, status_note=? where id=?').run(status,String(note||'').slice(0,200),t.id);
  if(status==='suspended')store.endSessions(t.id);
  return {before:t.status||'active',after:status};
}
