// The morning message and the reports go out by e-mail, through Gmail with an app password (SETUP.md explains).
// Without a way to send, nothing goes out, and the log says only that a message was not sent: its text holds the
// portfolio's numbers, and Railway's log is not the place for them.
import nodemailer from 'nodemailer';
const opt=(n,d='')=>process.env[n]||d, log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

export async function sendMail({subject,text,html,attachments=[],to:toOver=null}){
  // Railway blocks outgoing SMTP on most plans, so the first choice is Resend's HTTPS API (RESEND_API_KEY, MAIL_TO)
  if(opt('RESEND_API_KEY')){
    const to=(toOver?[].concat(toOver):opt('MAIL_TO').split(',')).map(s=>String(s).trim()).filter(Boolean); if(!to.length){log('mail: MAIL_TO is empty');return false}
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+opt('RESEND_API_KEY'),'content-type':'application/json'},
      body:JSON.stringify({from:opt('MAIL_FROM','תיק צ׳יק <onboarding@resend.dev>'),to,subject,text,html,attachments:attachments.map(a=>({filename:a.filename,content:Buffer.from(a.content).toString('base64')}))})});
    if(!r.ok){log('mail failed:',r.status,(await r.text()).slice(0,200));return false}
    log(`mail sent to ${to.length} recipient(s)`); return true;
  }
  const user=opt('MAIL_USER'), pass=opt('MAIL_PASS'), to=toOver?[].concat(toOver).join(','):opt('MAIL_TO',user);
  if(!user||!pass){log(`mail not sent (${String(text||'').length} characters): no RESEND_API_KEY or MAIL_USER/MAIL_PASS`);return false}
  const tr=nodemailer.createTransport({host:opt('MAIL_HOST','smtp.gmail.com'),port:+opt('MAIL_PORT','465'),secure:opt('MAIL_PORT','465')==='465',auth:{user,pass}});
  await tr.sendMail({from:`"תיק צ׳יק" <${user}>`,to,subject,text,html,attachments});
  log('mail sent');
  return true;
}
export const mailReady=()=>!!(opt('RESEND_API_KEY')||(opt('MAIL_USER')&&opt('MAIL_PASS')));
// Automatic e-mails need the owner's consent, per kind, in the page's settings (S.mail: morning, reports, backup). Each
// kind is off until switched on there (stage 7: no automatic summaries without consent and settings).
export const MAIL_KINDS=['morning','earnings','reports','backup','pxalert','live'];
export function mailAllowed(store,kind){try{const s=store.getDoc('settings/main'); return !!(s.exists&&s.data&&s.data.mail&&s.data.mail[kind]===true)}catch(e){return false}}
// system/mail (the owner only): whether sending is set up, and per kind the last attempt: sent, off, not_ready or failed.
// No content, no address: the page shows the owner what happened.
export function mailNote(store,kind,result){
  try{const d=store.getDoc('system/mail'), cur=d.exists?d.data:{}, now=new Date().toISOString();
    store.setDoc('system/mail',{...cur,ready:mailReady(),...(kind?{last:{...(cur.last||{}),[kind]:{at:now,result}}}:{}),updatedAt:now})}catch(e){}
}
// 30.10: a partner's own e-mails (and, from 31.10, an admin's): what they switched on in their own settings, to their
// own address, about their own portfolio. The kinds a partner can have; the result noted in meta mail:<id> (read by their page through /api/mail/me)
export const PARTNER_KINDS=['morning','earnings','live'];
// 31.10: an admin chooses from every kind the owner has, each about their own: their morning, their reports, their own
// documents in the backup; and "משהו לא מתעדכן", the site's, which an admin runs with the owner
export const kindsOf=u=>!u||u.role==='owner'||u.role==='admin'?MAIL_KINDS:PARTNER_KINDS;
export function mailAllowedFor(store,user,kind){
  if(!user||user.role==='owner')return mailAllowed(store,kind); if(!kindsOf(user).includes(kind))return false;
  try{const s=store.getDoc(`data/users/${user.id}/settings`); return !!(s.exists&&s.data&&s.data.mail&&s.data.mail[kind]===true)}catch(e){return false}}
export const ADMIN_KINDS=['pxalert'];
export const adminsOf=store=>{try{return store.users().filter(u=>u.role==='admin'&&u.email)}catch(e){return []}};
export function mailNoteFor(store,user,kind,result){if(!user||user.role==='owner')return mailNote(store,kind,result);
  try{const k='mail:'+user.id, cur=JSON.parse(store.getMeta(k)||'{}'); cur.last={...(cur.last||{}),[kind]:{at:new Date().toISOString(),result}}; store.setMeta(k,JSON.stringify(cur))}catch(e){}}
// the house's test address of Resend sends only to the Resend account's own address: a partner's mail needs a domain of one's own
export const mailFromOwnDomain=()=>!opt('RESEND_API_KEY')||!/resend\.dev/i.test(opt('MAIL_FROM','onboarding@resend.dev'));
// send only what the owner allowed; the result is noted either way
export async function sendAllowed(store,kind,msg,log=()=>{},user=null){
  if(user&&user.role!=='owner'){
    if(!mailAllowedFor(store,user,kind)){mailNoteFor(store,user,kind,'off'); return false}
    if(!mailReady()||!user.email){mailNoteFor(store,user,kind,'not_ready'); return false}
    let ok=false; try{ok=await sendMail({...msg,to:[user.email]})}catch(e){log(`mail (${kind}, partner) failed:`,e.message)}
    mailNoteFor(store,user,kind,ok?'sent':mailFromOwnDomain()?'failed':'domain'); return ok}
  let ok=false;
  if(!mailAllowed(store,kind)){log(`mail (${kind}): off in the settings, not sent`); mailNote(store,kind,'off')}
  else if(!mailReady()){log(`mail (${kind}): sending is not set up`); mailNote(store,kind,'not_ready')}
  else{try{ok=await sendMail(msg)}catch(e){log(`mail (${kind}) failed:`,e.message)} mailNote(store,kind,ok?'sent':'failed')}
  // the admins manage the site with the owner: the mail that says something on the site stopped updating (pxalert) goes
  // to each admin who switched it on in their own settings, whatever the owner chose, a message of their own, so that one
  // address that fails never stops the owner's; only from a sending domain of one's own (Resend's test address sends to
  // the owner alone). 31.10: never the mails about the owner's own portfolio, nor the owner's backup: an admin has their
  // own portfolio, and their own of each kind about it
  if(ADMIN_KINDS.includes(kind)){const A=adminsOf(store); for(const u of A){
    if(!mailAllowedFor(store,u,kind)){mailNoteFor(store,u,kind,'off'); continue}
    if(!mailReady()){mailNoteFor(store,u,kind,'not_ready'); continue}
    if(!mailFromOwnDomain()){mailNoteFor(store,u,kind,'domain'); continue}
    let ok2=false; try{ok2=await sendMail({...msg,to:[u.email]})}catch(e){log(`mail (${kind}, admin) failed:`,e.message)} mailNoteFor(store,u,kind,ok2?'sent':'failed')}}
  return ok;
}
export const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function wrapHtml(title,bodyHtml){
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f3f5f8;font-family:Heebo,Arial,sans-serif;color:#1e293b"><div style="max-width:640px;margin:0 auto;padding:20px"><div style="background:#1e344e;color:#fff;border-radius:12px 12px 0 0;padding:14px 18px;font-size:18px;font-weight:700">תיק צ׳יק · ${esc(title)}</div><div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px;font-size:15px;line-height:1.7">${bodyHtml}</div><p style="color:#64748b;font-size:12px;margin:12px 4px">עובדות ומספרים מהתיק שלך בלבד. זו לא המלצה לקנות או למכור.</p></div></body></html>`;
}
