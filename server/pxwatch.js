// When something breaks, the owner hears about it, by e-mail (with the owner's consent for "pxalert"), not from a
// screenshot: prices that stopped coming while a market trades, a market whose last session has not arrived for hours,
// and a gap the page found between two of its own views (the page's self-check). One message per problem: the same
// problem again within 12 hours is not sent again, and when it is gone the next one is a new problem.
import {anyOpen, ilParts} from '../shared/market.js';
import {sendAllowed, wrapHtml, esc} from './mail.js';

const H=36e5;
const hmIl=iso=>{const p=ilParts(new Date(iso)); return `${p.d}.${p.m} ${String(p.h).padStart(2,'0')}:${String(p.min).padStart(2,'0')}`};
// the problems in the price document now: [{key, text}]
export function pxProblems(q,now=new Date()){
  const out=[]; if(!q||!q.updatedAt)return out;
  const age=(now-new Date(q.updatedAt))/H;
  if(anyOpen(now)&&age>=2)out.push({key:'late',text:`המחירים לא התעדכנו מאז ${hmIl(q.updatedAt)}, בזמן שבורסה פתוחה (${Math.floor(age)} שעות).`});
  for(const [k,g] of Object.entries(q.lag||{})){if(!g||!g.want)continue; const nm=k==='il'?'תל אביב':'ארה״ב';
    out.push({key:'lag:'+k+':'+g.want,lagSince:g.want,text:`${nm}: חסר המחיר של ${g.want.split('-').reverse().slice(0,2).map(Number).join('.')} ל-${g.n||'?'} ניירות (יש רק את ${String(g.have||'').split('-').reverse().slice(0,2).map(Number).join('.')}).`})}
  const err=(q.errors||[]).length; if(err>=3&&(q.errors||[]).length>=Math.max(3,Object.keys(q.prices||{}).length*0.3))out.push({key:'errors',text:`${err} ניירות לא קיבלו מחיר מאף מקור בעדכון האחרון.`});
  return out;
}
// what to send now: problems not sent in the last 12 hours; a lag only after it has lasted 3 hours (a close that comes a
// little late is normal)
export function pxAlertsDue(problems,state,now=new Date()){
  const st={seen:{...(state&&state.seen||{})},sent:{...(state&&state.sent||{})}}, send=[], keys=new Set(problems.map(p=>p.key));
  for(const k of Object.keys(st.seen))if(!keys.has(k)){delete st.seen[k]; delete st.sent[k]}
  for(const p of problems){if(!st.seen[p.key])st.seen[p.key]=now.toISOString();
    const lasted=(now-new Date(st.seen[p.key]))/H, last=st.sent[p.key]?(now-new Date(st.sent[p.key]))/H:1e9;
    if((p.key.startsWith('lag:')?lasted>=3:true)&&last>=12){send.push(p); st.sent[p.key]=now.toISOString()}}
  return {send,state:st};
}
export async function pxWatchTask(store,{now=new Date(),log=()=>{}}={}){
  const q=store.getDoc('quotes/latest'), sc=store.getDoc('system/selfcheck'), w=store.getDoc('system/pxwatch');
  const probs=pxProblems(q.exists?q.data:null,now);
  if(sc.exists&&sc.data&&Array.isArray(sc.data.bad)&&sc.data.bad.length&&(now-new Date(sc.data.at||0))/H<24)
    probs.push({key:'sum:'+sc.data.sig,text:'הדף מצא פער בין שני מסכים: '+sc.data.bad.map(x=>String(x.t||'')).join(' ')});
  const {send,state}=pxAlertsDue(probs,w.exists?w.data:null,now);
  store.setDoc('system/pxwatch',{...state,checkedAt:now.toISOString(),open:probs.map(p=>p.key)},{silent:true});
  if(!send.length){log(`price watch: ${probs.length?probs.length+' open, already told':'all fine'}`);return {sent:0,open:probs.length}}
  const url=process.env.SITE_URL||'', text=send.map(p=>'• '+p.text).join('\n')+`\n\n${url?'באתר: '+url+' (סקירה ← "המחירים עדכניים?"; הגדרות ← מקורות המחירים)\n':''}הודעה אוטומטית מתיק צ׳יק. אפשר לכבות אותה בהגדרות ← מיילים.`;
  const html=wrapHtml('משהו לא מתעדכן',`<ul style="padding-inline-start:18px;margin:6px 0">${send.map(p=>`<li style="margin:6px 0">${esc(p.text)}</li>`).join('')}</ul>${url?`<p><a href="${esc(url)}">לאתר</a> · בסקירה: "המחירים עדכניים?", ובהגדרות: מקורות המחירים.</p>`:''}<p style="color:#64748b;font-size:13px">הודעה אוטומטית. אפשר לכבות אותה בהגדרות ← מיילים.</p>`);
  const ok=await sendAllowed(store,'pxalert',{subject:`תיק צ׳יק – ${send.length===1?'משהו לא מתעדכן':send.length+' דברים לא מתעדכנים'}`,text,html},log);
  log(`price watch: ${send.length} to tell, ${ok?'sent':'not sent'}`); return {sent:ok?send.length:0,open:probs.length};
}
// the page's self-check, as the owner's page reports it: the names of the views and the amounts, kept for the watch
export function selfCheckNote(store,body,now=new Date()){
  const bad=(Array.isArray(body&&body.bad)?body.bad:[]).slice(0,8).map(x=>({name:String(x&&x.name||'').slice(0,60),t:String(x&&x.t||'').slice(0,200)})).filter(x=>x.name);
  const sig=bad.map(x=>x.name).sort().join('|');
  store.setDoc('system/selfcheck',{bad,sig,at:now.toISOString()},{silent:true}); return {bad:bad.length};
}
