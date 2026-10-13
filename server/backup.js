// Daily backups. Two kinds:
// 1. A full copy of the database file (all users, all data) on the same disk, the last 14 days. It protects against a bad
//    write, a mistaken delete or a broken update. It does NOT protect against losing the disk itself, and nobody can
//    download it through the site (it holds the partners' private data).
// 2. When e-mail is set up (Resend) and the owner switched the copy on in the settings (מיילים), the owner's own data (the
//    same file as "גיבוי הנתונים שלי") is mailed to the owner, compressed. That copy lives outside Railway. Partners' data
//    is never in it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {sendAllowed, mailReady, mailAllowed} from './mail.js';

const NAME=/^tikchik-(\d{4}-\d\d-\d\d)\.sqlite$/;
const dirOf=dataDir=>path.join(dataDir,'backups');

export function backupNow(store,{dataDir,keep=14,now=new Date()}={}){
  const dir=dirOf(dataDir); fs.mkdirSync(dir,{recursive:true});
  const day=now.toISOString().slice(0,10), file=path.join(dir,`tikchik-${day}.sqlite`), tmp=file+'.tmp';
  try{fs.rmSync(tmp,{force:true})}catch(e){}
  store.db.exec(`VACUUM INTO '${tmp.replace(/'/g,"''")}'`); // a consistent copy, even while the site is in use
  fs.renameSync(tmp,file);
  const all=fs.readdirSync(dir).filter(f=>NAME.test(f)).sort(), gone=all.slice(0,Math.max(0,all.length-keep));
  for(const f of gone)fs.rmSync(path.join(dir,f),{force:true});
  const size=fs.statSync(file).size;
  store.setMeta('lastBackup',JSON.stringify({at:now.toISOString(),file:path.basename(file),size}));
  return {file,size,removed:gone.length};
}

export function ownerExport(store){
  // the owner's data only: not the partners' areas, and not their lists of symbols
  const own=(store.users().find(u=>u.role==='owner')||{}).id;
  const docs={}; for(const [p,d] of store.allDocs()){if(p.startsWith('data/users/')||(p.startsWith('watch/')&&p!=='watch/'+own))continue; docs[p]=d}
  return {exportedAt:new Date().toISOString(),source:'tik-chik site, daily backup',docs};
}

export async function backupTask(store,{log=()=>{},dataDir,now=new Date()}={}){
  const r=backupNow(store,{dataDir,now}); log(`backup: ${path.basename(r.file)} ${(r.size/1e6).toFixed(1)}MB, ${r.removed} old removed`);
  // the copy by e-mail, only when the owner switched it on in the settings (sendAllowed notes "off" or "not set up" otherwise)
  if(!mailReady()||!mailAllowed(store,'backup')){await sendAllowed(store,'backup',{},log); return {...r,mailed:false}}
  const gz=zlib.gzipSync(Buffer.from(JSON.stringify(ownerExport(store))));
  const day=now.toISOString().slice(0,10);
  const ok=await sendAllowed(store,'backup',{subject:`תיק צ׳יק – גיבוי יומי ${day}`,text:'מצורף גיבוי של הנתונים שלך מהאתר (קובץ JSON דחוס). לשחזור: 👤 ← שחזור מגיבוי, אחרי פתיחת הקובץ (gunzip).',
    html:'<p dir="rtl">מצורף גיבוי של הנתונים שלך מהאתר (קובץ JSON דחוס).</p><p dir="rtl">לשחזור: 👤 ← שחזור מגיבוי, אחרי פתיחת הקובץ.</p>',
    attachments:[{filename:`tikchik-backup-${day}.json.gz`,content:gz}]},log);
  if(ok)store.setMeta('lastBackupMail',new Date().toISOString());
  return {...r,mailed:!!ok};
}

export function backupStatus(store,{dataDir}={}){
  const dir=dirOf(dataDir); let files=[];
  try{files=fs.readdirSync(dir).filter(f=>NAME.test(f)).sort().reverse().map(f=>({name:f,size:fs.statSync(path.join(dir,f)).size}))}catch(e){}
  let last=null; try{last=JSON.parse(store.getMeta('lastBackup')||'null')}catch(e){}
  return {last,files,mail:mailReady(),mailOn:mailAllowed(store,'backup'),lastMail:store.getMeta('lastBackupMail')};
}
