// The morning message and the reports go out by e-mail, through Gmail with an app password (SETUP.md explains).
// Without a way to send, nothing goes out, and the log says only that a message was not sent: its text holds the
// portfolio's numbers, and Railway's log is not the place for them.
import nodemailer from 'nodemailer';
const opt=(n,d='')=>process.env[n]||d, log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

export async function sendMail({subject,text,html,attachments=[]}){
  // Railway blocks outgoing SMTP on most plans, so the first choice is Resend's HTTPS API (RESEND_API_KEY, MAIL_TO)
  if(opt('RESEND_API_KEY')){
    const to=opt('MAIL_TO').split(',').map(s=>s.trim()).filter(Boolean); if(!to.length){log('mail: MAIL_TO is empty');return false}
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+opt('RESEND_API_KEY'),'content-type':'application/json'},
      body:JSON.stringify({from:opt('MAIL_FROM','תיק צ׳יק <onboarding@resend.dev>'),to,subject,text,html,attachments:attachments.map(a=>({filename:a.filename,content:Buffer.from(a.content).toString('base64')}))})});
    if(!r.ok){log('mail failed:',r.status,(await r.text()).slice(0,200));return false}
    log(`mail sent to ${to.length} recipient(s)`); return true;
  }
  const user=opt('MAIL_USER'), pass=opt('MAIL_PASS'), to=opt('MAIL_TO',user);
  if(!user||!pass){log(`mail not sent (${String(text||'').length} characters): no RESEND_API_KEY or MAIL_USER/MAIL_PASS`);return false}
  const tr=nodemailer.createTransport({host:opt('MAIL_HOST','smtp.gmail.com'),port:+opt('MAIL_PORT','465'),secure:opt('MAIL_PORT','465')==='465',auth:{user,pass}});
  await tr.sendMail({from:`"תיק צ׳יק" <${user}>`,to,subject,text,html,attachments});
  log('mail sent');
  return true;
}
export const mailReady=()=>!!(opt('RESEND_API_KEY')||(opt('MAIL_USER')&&opt('MAIL_PASS')));
// Automatic e-mails need the owner's consent, per kind, in the page's settings (S.mail: morning, reports, backup). Each
// kind is off until switched on there (stage 7: no automatic summaries without consent and settings).
export const MAIL_KINDS=['morning','earnings','reports','backup','pxalert'];
export function mailAllowed(store,kind){try{const s=store.getDoc('settings/main'); return !!(s.exists&&s.data&&s.data.mail&&s.data.mail[kind]===true)}catch(e){return false}}
// system/mail (the owner only): whether sending is set up, and per kind the last attempt: sent, off, not_ready or failed.
// No content, no address: the page shows the owner what happened.
export function mailNote(store,kind,result){
  try{const d=store.getDoc('system/mail'), cur=d.exists?d.data:{}, now=new Date().toISOString();
    store.setDoc('system/mail',{...cur,ready:mailReady(),...(kind?{last:{...(cur.last||{}),[kind]:{at:now,result}}}:{}),updatedAt:now})}catch(e){}
}
// send only what the owner allowed; the result is noted either way
export async function sendAllowed(store,kind,msg,log=()=>{}){
  if(!mailAllowed(store,kind)){log(`mail (${kind}): off in the settings, not sent`); mailNote(store,kind,'off'); return false}
  if(!mailReady()){log(`mail (${kind}): sending is not set up`); mailNote(store,kind,'not_ready'); return false}
  let ok=false; try{ok=await sendMail(msg)}catch(e){log(`mail (${kind}) failed:`,e.message)}
  mailNote(store,kind,ok?'sent':'failed'); return ok;
}
export const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function wrapHtml(title,bodyHtml){
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f3f5f8;font-family:Heebo,Arial,sans-serif;color:#1e293b"><div style="max-width:640px;margin:0 auto;padding:20px"><div style="background:#1e344e;color:#fff;border-radius:12px 12px 0 0;padding:14px 18px;font-size:18px;font-weight:700">תיק צ׳יק · ${esc(title)}</div><div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px;font-size:15px;line-height:1.7">${bodyHtml}</div><p style="color:#64748b;font-size:12px;margin:12px 4px">עובדות ומספרים מהתיק שלך בלבד. זו לא המלצה לקנות או למכור.</p></div></body></html>`;
}
