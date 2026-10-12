// The morning message and the reports go out by e-mail, through Gmail with an app password (SETUP.md explains).
// Without MAIL_USER / MAIL_PASS the text is only printed to the log.
import nodemailer from 'nodemailer';
import {opt, log} from './env.js';

export async function sendMail({subject,text,html,attachments=[]}){
  const user=opt('MAIL_USER'), pass=opt('MAIL_PASS'), to=opt('MAIL_TO',user);
  if(!user||!pass){log('mail (not sent, no MAIL_USER/MAIL_PASS):',subject,'\n'+text);return false}
  const tr=nodemailer.createTransport({host:opt('MAIL_HOST','smtp.gmail.com'),port:+opt('MAIL_PORT','465'),secure:opt('MAIL_PORT','465')==='465',auth:{user,pass}});
  await tr.sendMail({from:`"תיק צ׳יק" <${user}>`,to,subject,text,html,attachments});
  log('mail sent:',subject,'→',to);
  return true;
}
export const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function wrapHtml(title,bodyHtml){
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f3f5f8;font-family:Heebo,Arial,sans-serif;color:#1e293b"><div style="max-width:640px;margin:0 auto;padding:20px"><div style="background:#1e344e;color:#fff;border-radius:12px 12px 0 0;padding:14px 18px;font-size:18px;font-weight:700">תיק צ׳יק · ${esc(title)}</div><div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px;font-size:15px;line-height:1.7">${bodyHtml}</div><p style="color:#64748b;font-size:12px;margin:12px 4px">עובדות ומספרים מהתיק שלך בלבד. זו לא המלצה לקנות או למכור.</p></div></body></html>`;
}
