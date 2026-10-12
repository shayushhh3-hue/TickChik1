// The morning message (07:50 Israel time, every day): the page's own alert engine runs on the stored documents;
// only what is new since the last message (and not marked "בדקתי") goes out, as a short e-mail. Writes alerts/state.
import {bot, log, opt, loadOwnerDocs} from './lib/env.js';
import {withPage} from './lib/headless.js';
import {sendMail, wrapHtml, esc} from './lib/mail.js';
import {ilParts} from '../shared/market.js';

const now=new Date(), p=ilParts(now);
if(p.h!==7&&!opt('FORCE')){log(`not the morning hour (Israel ${p.h}:${String(p.min).padStart(2,'0')}); nothing to do`);process.exit(0)}
const fs=await bot();
const docs=await loadOwnerDocs(fs);
if(!docs['portfolio/main']||!docs['quotes/latest']){log('no portfolio or quotes yet');process.exit(0)}
const owner={uid:opt('OWNER_UID','owner'),email:opt('OWNER_EMAIL',''),owner:true};
const {out:A,errs}=await withPage(docs,owner,pg=>pg.evaluate(()=>window.__model.alerts()));
if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
if(!A||!A.ready){log('the alert engine was not ready');process.exit(1)}
const state=docs['alerts/state']||{keys:[]};
const seen=new Set(state.keys||[]);
const items=(A.items||[]).filter(i=>i&&i.key);
const fresh=items.filter(i=>!seen.has(i.key)&&!i.acked);
log(`alerts: ${items.length} now, ${fresh.length} new, ${items.filter(i=>i.acked).length} acknowledged`);
const SEV={crit:'חריגה',warn:'לבדיקה',info:'מידע',ok:'תקין'}, ORDER={crit:0,warn:1,info:2,ok:3};
if(fresh.length){
  fresh.sort((a,b)=>(ORDER[a.sev]??9)-(ORDER[b.sev]??9));
  const crit=fresh.filter(i=>i.sev==='crit').length, warn=fresh.filter(i=>i.sev==='warn').length;
  const head=crit?`${crit===1?'חריגה אחת חדשה':crit+' חריגות חדשות'}${warn?' ו-'+(warn===1?'נושא אחד לבדיקה':warn+' נושאים לבדיקה'):''}`:warn?(warn===1?'נושא אחד חדש לבדיקה':warn+' נושאים חדשים לבדיקה'):'עדכון חדש';
  const lines=fresh.map(i=>`[${SEV[i.sev]||i.sev}] ${i.cat?i.cat+': ':''}${i.text}`);
  const url=opt('SITE_URL',''); const when=`מחירים נכון ל-${A.pricesAt?new Date(A.pricesAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'?'}`;
  const text=`בוקר טוב. ${head}.\n\n${lines.join('\n')}\n\n${when}${url?'\nלפתיחת הדף: '+url:''}\n\nעובדות מהתיק שלך בלבד; לא המלצה לקנות או למכור.`;
  const color={crit:'#b42318',warn:'#b7791f',info:'#2464a8',ok:'#2f9e5b'};
  const html=wrapHtml('הודעת הבוקר',`<p>בוקר טוב. <b>${esc(head)}.</b></p><ul style="padding-inline-start:18px;margin:8px 0">${fresh.map(i=>`<li style="margin:6px 0"><span style="display:inline-block;min-width:56px;color:${color[i.sev]||'#1e293b'};font-weight:700">${esc(SEV[i.sev]||i.sev)}</span> ${i.cat?'<b>'+esc(i.cat)+':</b> ':''}${esc(i.text)}</li>`).join('')}</ul><p style="color:#64748b;font-size:13px">${esc(when)}</p>${url?`<p><a href="${esc(url)}" style="color:#1e344e;font-weight:700">לפתיחת הדף ›</a></p>`:''}`);
  await sendMail({subject:`תיק צ׳יק – הודעת הבוקר: ${head}`,text,html});
}else log('nothing new this morning; no message');
await fs.setDoc('alerts/state',{date:p.iso,keys:items.map(i=>i.key),moveDate:fresh.length?p.iso:(state.moveDate||null),sent:fresh.length,updatedAt:now.toISOString()});
log('alerts/state written');
