// 30.10: the owner hears at once, by e-mail (with consent for "live"), when something moves while the markets trade:
//  - a price the owner set on a security (S.pxAlerts: above / below) is crossed;
//  - a holding moves more than the chosen share in a day (S.liveAl.move, 5% unless set);
//  - the dollar crosses a rate the owner set (S.liveAl.usdAbove / usdBelow);
//  - a critical reading of the news about a holding arrives (research/newsx, not one made by the plain rules).
// Each one at most once a day (alerts/live), at most one e-mail every 20 minutes, and nothing at night. Facts from the
// prices and the readings; never advice.
import {sendAllowed, esc, wrapHtml} from './mail.js';
import {createHash} from 'node:crypto';
const newsId=link=>createHash('sha1').update(String(link||'')).digest('hex').slice(0,12);
const ilDay=d=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
const pct=x=>(x>=0?'+':'−')+Math.abs(x).toFixed(1)+'%';

export function liveHits(store,{now=new Date()}={}){
  const Q=store.getDoc('quotes/latest').data, P=store.getDoc('portfolio/main').data, S=store.getDoc('settings/main').data||{};
  if(!Q||!Q.prices)return [];
  const out=[], px=k=>{const v=+(Q.prices||{})[k]; return v>0?v:null}, A=S.liveAl||{}, move=+A.move>0?+A.move:5;
  // the prices set by the owner
  for(const [k,t] of Object.entries(S.pxAlerts||{})){if(!t)continue; const p=px(k)||px(k.replace(/^TLV:/,'')); if(!p)continue; const s=k.replace(/^TLV:/,'');
    if(+t.above>0&&p>=+t.above)out.push({key:`px:${k}:up:${t.above}`,sev:'warn',text:`${s} עבר את המחיר שקבעת: ${p} (מעל ${t.above}).`});
    if(+t.below>0&&p<=+t.below)out.push({key:`px:${k}:down:${t.below}`,sev:'warn',text:`${s} ירד אל המחיר שקבעת: ${p} (מתחת ל-${t.below}).`})}
  // a big day for a holding (not a stale price, not an estimate of a fund)
  const held=[...new Set(((P&&P.positions)||[]).map(p=>p.sym))];
  for(const k of held){const p=px(k), b=+(Q.prev||{})[k]; if(!p||!(b>0)||(Q.stale||{})[k])continue; const d=(p/b-1)*100;
    if(Math.abs(d)>=move)out.push({key:`move:${k}:${d>0?'up':'down'}`,sev:Math.abs(d)>=move*2?'crit':'warn',text:`${k} ${d>0?'עלתה':'ירדה'} היום ${pct(d)} (מ-${b} ל-${p}), יותר מ-${move}% שקבעת.`})}
  // the dollar
  const fx=+Q.usdIls; if(fx>0){if(+A.usdAbove>0&&fx>=+A.usdAbove)out.push({key:`usd:up:${A.usdAbove}`,sev:'warn',text:`הדולר עבר את ${A.usdAbove}: ${fx.toFixed(3)} ₪.`});
    if(+A.usdBelow>0&&fx<=+A.usdBelow)out.push({key:`usd:down:${A.usdBelow}`,sev:'warn',text:`הדולר ירד אל ${A.usdBelow}: ${fx.toFixed(3)} ₪.`})}
  // a critical reading about a holding, of the last six hours
  if(A.news!==false){const X=store.getDoc('research/newsx').data, N=store.getDoc('research/news').data, from=new Date(now.getTime()-6*36e5).toISOString(), hs=new Set(held);
    const arts=new Map(); for(const it of ((N&&N.items)||[]))if(it&&it.link)arts.set(newsId(it.link),it);
    for(const [id,x] of Object.entries((X&&X.by)||{})){if(!x||x.rules||x.level!=='crit')continue; const a=arts.get(id); if(!a||(a.at||a.seen)<from)continue;
      const who=(x.aff||[]).filter(z=>z.how==='direct'&&hs.has(z.sym)).map(z=>z.sym); if(!who.length)continue;
      out.push({key:`news:${x.ev||id}`,sev:'crit',text:`${who.join(', ')}: ${x.he}. ${x.what||''}`.trim(),link:a.link})}}
  return out;
}
export async function liveTask(store,{log=()=>{},now=new Date(),send=sendAllowed}={}){
  const day=ilDay(now), h=+now.toLocaleString('en-US',{timeZone:'Asia/Jerusalem',hour:'numeric',hour12:false});
  const st=store.getDoc('alerts/live'), D=st.exists&&st.data&&st.data.date===day?st.data:{date:day,sent:[],lastAt:null};
  if(h<9||h>23){return {quiet:true}}
  const hits=liveHits(store,{now}), fresh=hits.filter(x=>!D.sent.includes(x.key));
  if(!fresh.length){store.setDoc('alerts/live',{...D,checkedAt:now.toISOString()},{silent:true}); return {hits:hits.length,fresh:0}}
  if(D.lastAt&&now-new Date(D.lastAt)<20*60e3){log(`live: ${fresh.length} waiting for the next 20 minutes`); return {hits:hits.length,fresh:fresh.length,waiting:true}}
  fresh.sort((a,b)=>(a.sev==='crit'?0:1)-(b.sev==='crit'?0:1));
  const url=process.env.SITE_URL||'', head=fresh.length===1?fresh[0].text.slice(0,70):`${fresh.length} התראות: ${fresh.map(x=>x.text.split(' ')[0]).slice(0,4).join(', ')}`;
  const text=fresh.map(x=>`• ${x.text}${x.link?'\n  '+x.link:''}`).join('\n')+`\n\n${url?'לאתר: '+url+'\n':''}עובדות מהמחירים ומהידיעות; לא המלצה לקנות או למכור.`;
  const html=wrapHtml('התראה',`<ul style="padding-inline-start:18px">${fresh.map(x=>`<li style="margin:6px 0;${x.sev==='crit'?'color:#b42318;font-weight:700':''}">${esc(x.text)}${x.link?` <a href="${esc(x.link)}">לכתבה</a>`:''}</li>`).join('')}</ul>${url?`<p><a href="${esc(url)}">לאתר</a></p>`:''}<p style="color:#64748b;font-size:13px">עובדות מהמחירים ומהידיעות; לא המלצה לקנות או למכור.</p>`);
  const ok=await send(store,'live',{subject:`תיק צ׳יק – ${head}`,text,html},log);
  // marked as sent even when the e-mail is off, so that switching it on does not send the whole day at once
  store.setDoc('alerts/live',{date:day,sent:[...D.sent,...fresh.map(x=>x.key)],lastAt:now.toISOString(),checkedAt:now.toISOString(),last:fresh.map(x=>({key:x.key,text:x.text,sev:x.sev})).slice(0,10),mailed:!!ok},{silent:true});
  log(`live: ${fresh.length} new (${ok?'e-mailed':'not e-mailed'})`); return {hits:hits.length,fresh:fresh.length,sent:ok};
}
