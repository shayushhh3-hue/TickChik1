// 8.11: control that speaks before anyone asks (stage 4 of the plan). Two checks that run on their own and write their
// result where the management center and the health check read it:
// - the smoke test after a deploy (smokeTask): the site answers, the version is the one just built, the prices are not
//   stale, the owner's page computes a portfolio and its alerts without a screen, and the management API is locked to
//   strangers. It runs 45 seconds after a server starts with a new build (server/index.js) and from the management center.
// - the restore test (restoreTest): once a week the newest backup copy is opened the way a restore would open it: SQLite's
//   own integrity check, the documents and users counted against the live database, every key document of every person
//   looked for in the copy, and the encrypted mail copy sealed and opened again. A backup that was never opened is a hope.
// Facts about the site only; nothing about any portfolio's contents.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {withPage} from './headless.js';
import {ownerDocs} from './tasks.js';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {backupStatus, sealBackup, openBackup} from './backup.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// the site's version, as /api/version gives it: the hash of the built page
export function siteVersion(root=ROOT){try{return createHash('sha1').update(fs.readFileSync(path.join(root,'site','index.html'))).digest('hex').slice(0,12)}catch(e){return ''}}

const H=36e5;
const meta=(store,k)=>{try{return JSON.parse(store.getMeta(k)||'null')}catch(e){return null}};
const doc=(store,k)=>{try{const d=store.getDoc(k); return d.exists?d.data:null}catch(e){return null}};

// ---- the smoke test ----
export async function smokeTask(store,{port=process.env.PORT||3000,version='',log=()=>{},now=new Date(),fetch:f=globalThis.fetch,page=null}={}){
  version=version||siteVersion(); const base=`http://127.0.0.1:${port}`, checks=[], t0=Date.now();
  const run=async(k,name,fn)=>{const t=Date.now(); try{const r=await fn(); checks.push({k,name,ok:r.ok!==false,ms:Date.now()-t,note:r.note||''})}catch(e){checks.push({k,name,ok:false,ms:Date.now()-t,note:String(e&&e.message||e).slice(0,160)})}};
  const get=async(p,o={})=>{const c=new AbortController(), to=setTimeout(()=>c.abort(),15e3); try{return await f(base+p,{...o,signal:c.signal})}finally{clearTimeout(to)}};
  await run('site','הדף נטען',async()=>{const r=await get('/'); const body=await r.text(); if(r.status!==200)return {ok:false,note:`סטטוס ${r.status}`}; if(!/<title/.test(body)||body.length<50000)return {ok:false,note:`הגוף חסר (${body.length} תווים)`}; return {note:`${Math.round(body.length/1024)}KB`}});
  await run('version','הגרסה היא זו שנבנתה',async()=>{const r=await get('/api/version'); const j=await r.json(); if(!j.v)return {ok:false,note:'אין גרסה'}; if(version&&j.v!==version)return {ok:false,note:`השרת עונה ${j.v}, הבנייה ${version}`}; return {note:j.v}});
  await run('locked','ממשק הניהול נעול לזרים',async()=>{const r=await get('/api/admin/health'); return r.status===401||r.status===403?{note:`סטטוס ${r.status}`}:{ok:false,note:`נפתח בלי כניסה: סטטוס ${r.status}`}});
  await run('quotes','המחירים לא ישנים',async()=>{const Q=doc(store,'quotes/latest'); if(!Q||!Q.updatedAt)return {ok:false,note:'אין מחירים'}; const h=(now-new Date(Q.updatedAt))/H; return h<=80?{note:`${Object.keys(Q.prices||{}).length} ניירות, לפני ${Math.round(h)} שעות`}:{ok:false,note:`עודכנו לפני ${Math.round(h/24)} ימים`}});
  await run('page','הדף מחשב תיק והתראות בלי מסך',async()=>{const docs=ownerDocs(store); if(!docs['portfolio/main']||!docs['quotes/latest'])return {note:'אין תיק עדיין: לא נבדק'};
    const o=store.users().find(u=>u.role==='owner'), user={uid:o?o.id:'owner',email:o?o.email:'',owner:true};
    const r=page?await page(docs,user):await withPage(docs,user,pg=>pg.evaluate(()=>({d:window.__model.digest?window.__model.digest():null,a:window.__model.alerts?window.__model.alerts():null})));
    const out=r.out||{}; if(!out.d||!out.d.ready||!(out.d.total>0))return {ok:false,note:'השווי לא חושב'+(r.errs&&r.errs.length?': '+r.errs[0].slice(0,100):'')}; if(!out.a||!out.a.ready)return {ok:false,note:'מנוע ההתראות לא מוכן'};
    return {note:`שווי חושב, ${(out.a.items||[]).length} התראות${r.errs&&r.errs.length?`, ${r.errs.length} שגיאות בדף`:''}`}});
  const res={at:now.toISOString(),version,ok:checks.every(c=>c.ok),checks,ms:Date.now()-t0};
  try{store.setMeta('smoke',JSON.stringify(res))}catch(e){}
  log(`smoke: ${res.ok?'ok':'FAILED'} ${checks.map(c=>`${c.k}${c.ok?'✓':'✗'}`).join(' ')} (${res.ms}ms)`);
  return res;
}
// after a server start: the smoke test once per build (the version is the site's hash), 45 seconds in
export function smokeOnStart(store,{port,version,log=()=>{},delay=45e3}={}){
  const last=meta(store,'smoke'); if(last&&last.version&&last.version===version&&last.ok)return null;
  const t=setTimeout(()=>{smokeTask(store,{port,version,log}).catch(e=>log('smoke failed: '+(e&&e.message||e)))},delay); if(t.unref)t.unref(); return t;
}

// ---- the restore test ----
export function restoreTest(store,{dataDir,now=new Date(),log=()=>{},pass=process.env.BACKUP_KEY||'',maxSeal=60e6}={}){
  const t0=Date.now(), st=backupStatus(store,{dataDir}), f=st.files&&st.files[0], out={at:now.toISOString(),file:f?f.name:null,size:f?f.size:null,ok:false,integrity:null,docs:null,users:null,missing:[],sealed:null,note:''};
  if(!f){out.note='אין קובץ גיבוי'; store.setMeta('restoreTest',JSON.stringify(out)); log('restore test: no backup file'); return out}
  const p=path.join(dataDir||'.','backups',f.name); let db=null;
  try{db=new DatabaseSync(p,{readOnly:true});
    out.integrity=String((db.prepare('pragma integrity_check').get()||{}).integrity_check||'');
    out.docs=db.prepare('select count(*) n from docs').get().n; out.users=db.prepare('select count(*) n from users').get().n;
    // every person's key documents, as the live database has them, looked for in the copy
    const live=store.users(), keys=['portfolio/main','settings/main','quotes/latest','history/daily'];
    for(const u of live.filter(u=>u.role!=='owner'))for(const n of ['portfolio','settings','daily'])keys.push(`data/users/${u.id}/${n}`);
    const has=db.prepare('select 1 from docs where path=?');
    for(const k of keys){const l=store.getDoc(k); if(!l.exists)continue; if(!has.get(k))out.missing.push(k.startsWith('data/users/')?'מסמך של שותף: '+k.split('/').pop():k)}
    out.liveUsers=live.length;
    // the encrypted copy: sealed and opened again, when there is a passphrase and the file is not too big
    if(pass){if(f.size<=maxSeal){try{const buf=fs.readFileSync(p); const back=openBackup(sealBackup(buf,pass),pass); out.sealed=back.length===buf.length&&back.equals(buf)}catch(e){out.sealed=false; out.note='ההצפנה: '+e.message}} else out.sealed='skip'}
    out.ok=out.integrity==='ok'&&out.docs>0&&out.users>=Math.max(1,live.length-1)&&!out.missing.length&&out.sealed!==false;
    if(!out.ok&&!out.note)out.note=out.integrity!=='ok'?'בדיקת השלמות: '+out.integrity.slice(0,80):out.missing.length?`${out.missing.length} מסמכים חסרים בעותק`:out.users<live.length-1?`${out.users} משתמשים בעותק מול ${live.length} באתר`:'';
  }catch(e){out.note='העותק לא נפתח: '+(e&&e.message||e)}
  finally{try{db&&db.close()}catch(e){}}
  out.ms=Date.now()-t0; try{store.setMeta('restoreTest',JSON.stringify(out))}catch(e){}
  log(`restore test: ${out.ok?'ok':'FAILED'} ${out.file} integrity=${out.integrity} docs=${out.docs} users=${out.users}/${out.liveUsers} missing=${out.missing.length} sealed=${out.sealed} (${out.ms}ms)${out.note?' '+out.note:''}`);
  return out;
}
