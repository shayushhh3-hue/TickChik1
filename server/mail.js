// The morning message and the reports go out by e-mail, through Gmail with an app password (SETUP.md explains).
// Without MAIL_USER / MAIL_PASS the text is only printed to the log.
import nodemailer from 'nodemailer';
const opt=(n,d='')=>process.env[n]||d, log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

export async function sendMail({subject,text,html,attachments=[]}){
  // Railway blocks outgoing SMTP on most plans, so the first choice is Resend's HTTPS API (RESEND_API_KEY, MAIL_TO)
  if(opt('RESEND_API_KEY')){
    const to=opt('MAIL_TO').split(',').map(s=>s.trim()).filter(Boolean); if(!to.length){log('mail: MAIL_TO is empty');return false}
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+opt('RESEND_API_KEY'),'content-type':'application/json'},
      body:JSON.stringify({from:opt('MAIL_FROM','תיק צ׳יק <onboarding@resend.dev>'),to,subject,text,html,attachments:attachments.map(a=>({filename:a.filename,content:Buffer.from(a.content).toString('base64')}))})});
    if(!r.ok){log('mail failed:',r.status,(await r.text()).slice(0,200));return false}
    log('mail sent:',subject,'→',to.join(', ')); return true;
  }
  const user=opt('MAIL_USER'), pass=opt('MAIL_PASS'), to=opt('MAIL_TO',user);
  if(!user||!pass){log('mail (not sent, no RESEND_API_KEY or MAIL_USER/MAIL_PASS):',subject,'\n'+text);return false}
  const tr=nodemailer.createTransport({host:opt('MAIL_HOST','smtp.gmail.com'),port:+opt('MAIL_PORT','465'),secure:opt('MAIL_PORT','465')==='465',auth:{user,pass}});
  await tr.sendMail({from:`"תיק צ׳יק" <${user}>`,to,subject,text,html,attachments});
  log('mail sent:',subject,'→',to);
  return true;
}
export const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function wrapHtml(title,bodyHtml){
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f3f5f8;font-family:Heebo,Arial,sans-serif;color:#1e293b"><div style="max-width:640px;margin:0 auto;padding:20px"><div style="background:#1e344e;color:#fff;border-radius:12px 12px 0 0;padding:14px 18px;font-size:18px;font-weight:700">תיק צ׳יק · ${esc(title)}</div><div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px;font-size:15px;line-height:1.7">${bodyHtml}</div><p style="color:#64748b;font-size:12px;margin:12px 4px">עובדות ומספרים מהתיק שלך בלבד. זו לא המלצה לקנות או למכור.</p></div></body></html>`;
}
