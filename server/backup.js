// Daily backups. Two kinds:
// 1. A full copy of the database file (all users, all data) on the same disk, the last 14 days. It protects against a bad
//    write, a mistaken delete or a broken update. It does NOT protect against losing the disk itself, and nobody can
//    download it through the site (it holds the partners' private data).
// 2. When e-mail is set up (Resend) and the owner switched the copy on in the settings (מיילים), the owner's own data (the
//    same file as "גיבוי הנתונים שלי") is mailed to the owner, compressed. That copy lives outside Railway. Partners' data
//    is never in it.
// 3. 30.10: with BACKUP_KEY (a passphrase only the owner knows, in Railway's variables), the same mail also carries the
//    full copy of the database (everybody's data), compressed and encrypted (AES-256-GCM, the key from the passphrase by
//    scrypt), so that losing the disk loses nothing. Only the passphrase opens it: tools/restore.js. And every copy on the
//    disk is opened once after it is written and its documents counted, so a copy that cannot be read is known at once.
import fs from 'node:fs';
import {randomBytes, scryptSync, createCipheriv, createDecipheriv} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import zlib from 'node:zlib';
import {sendAllowed, mailReady, mailAllowed, mailAllowedFor} from './mail.js';
import {canWrite} from './store.js';

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
  const size=fs.statSync(file).size, docs=verifyCopy(file);
  store.setMeta('lastBackup',JSON.stringify({at:now.toISOString(),file:path.basename(file),size,docs}));
  return {file,size,docs,removed:gone.length};
}

// the copy is opened, read only, and its documents and users counted: null when it cannot be read
export function verifyCopy(file){
  let db=null; try{db=new DatabaseSync(file,{readOnly:true}); const d=db.prepare('select count(*) n from docs').get().n, u=db.prepare('select count(*) n from users').get().n; return d>0?{docs:d,users:u}:null}
  catch(e){return null} finally{try{db&&db.close()}catch(e){}}
}
// the encrypted file: "TCB1", the salt (16), the nonce (12), the tag (16), then the gzip of the database, encrypted
const MAGIC=Buffer.from('TCB1'), keyOf=(pass,salt)=>scryptSync(String(pass),salt,32,{N:1<<15,r:8,p:1,maxmem:64*1024*1024});
export function sealBackup(buf,pass){
  const salt=randomBytes(16), iv=randomBytes(12), c=createCipheriv('aes-256-gcm',keyOf(pass,salt),iv);
  const body=Buffer.concat([c.update(zlib.gzipSync(buf)),c.final()]);
  return Buffer.concat([MAGIC,salt,iv,c.getAuthTag(),body]);
}
export function openBackup(sealed,pass){
  const b=Buffer.from(sealed); if(!b.subarray(0,4).equals(MAGIC))throw new Error('not a tik-chik encrypted backup');
  const salt=b.subarray(4,20), iv=b.subarray(20,32), tag=b.subarray(32,48), d=createDecipheriv('aes-256-gcm',keyOf(pass,salt),iv); d.setAuthTag(tag);
  try{return zlib.gunzipSync(Buffer.concat([d.update(b.subarray(48)),d.final()]))}catch(e){throw new Error('wrong passphrase, or the file is damaged')}
}
// the most a mail may carry (Resend takes up to 40MB in all, and base64 adds a third)
const FULL_MAX=22e6;

export function ownerExport(store){
  // the owner's data only: not the partners' areas, and not their lists of symbols
  const own=(store.users().find(u=>u.role==='owner')||{}).id;
  const docs={}; for(const [p,d] of store.allDocs()){if(p.startsWith('data/users/')||(p.startsWith('watch/')&&p!=='watch/'+own))continue; docs[p]=d}
  return {exportedAt:new Date().toISOString(),source:'tik-chik site, daily backup',docs};
}

// 31.10: an admin's own copy: what an admin may write, that is their own documents and the site's (the prices, the
// research, the system), never the owner's portfolio or another user's
export function adminExport(store,u){
  const docs={}; for(const [p,d] of store.allDocs())if(canWrite(u,p))docs[p]=d;
  return {exportedAt:new Date().toISOString(),source:'tik-chik site, daily backup',docs};
}
async function adminBackups(store,{log,now}){
  for(const u of store.users().filter(u=>u.role==='admin')){
    try{if(!mailReady()||!mailAllowedFor(store,u,'backup')){await sendAllowed(store,'backup',{},log,u); continue}
      const day=now.toISOString().slice(0,10), gz=zlib.gzipSync(Buffer.from(JSON.stringify(adminExport(store,u))));
      await sendAllowed(store,'backup',{subject:`תיק צ׳יק – גיבוי יומי ${day}`,text:'מצורף גיבוי של הנתונים שלך מהאתר, ושל הנתונים המשותפים של האתר (קובץ JSON דחוס). לשחזור: 👤 ← שחזור מגיבוי, אחרי פתיחת הקובץ.',
        html:'<p dir="rtl">מצורף גיבוי של הנתונים שלך מהאתר, ושל הנתונים המשותפים של האתר (קובץ JSON דחוס).</p><p dir="rtl">לשחזור: 👤 ← שחזור מגיבוי, אחרי פתיחת הקובץ.</p>',
        attachments:[{filename:`tikchik-backup-${day}.json.gz`,content:gz}]},log,u)}
    catch(e){log(`backup (${u.id}) failed: ${e&&e.message||e}`)}}
}
export async function backupTask(store,{log=()=>{},dataDir,now=new Date()}={}){
  const r=backupNow(store,{dataDir,now}); log(`backup: ${path.basename(r.file)} ${(r.size/1e6).toFixed(1)}MB, ${r.removed} old removed`);
  await adminBackups(store,{log,now});
  // the copy by e-mail, only when the owner switched it on in the settings (sendAllowed notes "off" or "not set up" otherwise)
  if(!mailReady()||!mailAllowed(store,'backup')){await sendAllowed(store,'backup',{},log); return {...r,mailed:false}}
  const gz=zlib.gzipSync(Buffer.from(JSON.stringify(ownerExport(store))));
  const day=now.toISOString().slice(0,10), att=[{filename:`tikchik-backup-${day}.json.gz`,content:gz}];
  // the full copy, encrypted, when there is a passphrase (and it is not too big for a mail)
  let full=null; const pass=process.env.BACKUP_KEY||'';
  if(pass){try{const sealed=sealBackup(fs.readFileSync(r.file),pass); full={size:sealed.length,fits:sealed.length<=FULL_MAX}; if(full.fits)att.push({filename:`tikchik-full-${day}.sqlite.gz.enc`,content:sealed})}
    catch(e){full={err:e.message}; log('backup: the encrypted copy failed: '+e.message)}}
  const fullTxt=full&&full.fits?'\n\nמצורף גם עותק מלא של בסיס הנתונים (כל המשתמשים), מוצפן. רק הסיסמה BACKUP_KEY פותחת אותו: node tools/restore.js <הקובץ> tikchik.sqlite':
    full&&full.size?`\n\nהעותק המלא המוצפן גדול מדי למייל (${(full.size/1e6).toFixed(1)}MB), ולא צורף.`:'';
  const ok=await sendAllowed(store,'backup',{subject:`תיק צ׳יק – גיבוי יומי ${day}`,text:'מצורף גיבוי של הנתונים שלך מהאתר (קובץ JSON דחוס). לשחזור: 👤 ← שחזור מגיבוי, אחרי פתיחת הקובץ (gunzip).'+fullTxt,
    html:'<p dir="rtl">מצורף גיבוי של הנתונים שלך מהאתר (קובץ JSON דחוס).</p><p dir="rtl">לשחזור: 👤 ← שחזור מגיבוי, אחרי פתיחת הקובץ.</p>'+(fullTxt?`<p dir="rtl">${fullTxt.trim().replace(/</g,'&lt;')}</p>`:''),
    attachments:att},log);
  const what=full&&full.fits?`הנתונים שלך + עותק מלא מוצפן (${(full.size/1e6).toFixed(1)}MB)`:full&&full.size?`הנתונים שלך בלבד: העותק המלא גדול מדי (${(full.size/1e6).toFixed(1)}MB)`:pass?'הנתונים שלך בלבד: העותק המלא נכשל':'הנתונים שלך בלבד (בלי BACKUP_KEY אין עותק מלא מוצפן)';
  if(ok){store.setMeta('lastBackupMail',new Date().toISOString()); store.setMeta('lastBackupMailInfo',JSON.stringify({what,full:!!(full&&full.fits)}))}
  return {...r,mailed:!!ok,full};
}

export function backupStatus(store,{dataDir}={}){
  const dir=dirOf(dataDir); let files=[];
  try{files=fs.readdirSync(dir).filter(f=>NAME.test(f)).sort().reverse().map(f=>({name:f,size:fs.statSync(path.join(dir,f)).size}))}catch(e){}
  let last=null; try{last=JSON.parse(store.getMeta('lastBackup')||'null')}catch(e){}
  let info=null; try{info=JSON.parse(store.getMeta('lastBackupMailInfo')||'null')}catch(e){}
  return {last,files,mail:mailReady(),mailOn:mailAllowed(store,'backup'),lastMail:store.getMeta('lastBackupMail'),lastMailInfo:info,fullKey:!!process.env.BACKUP_KEY};
}
