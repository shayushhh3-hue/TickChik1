// 30.10: each person hears at once, by e-mail (the owner, and a partner with consent for "live") and on the phone, when
// something happens:
//  - a price they set on a security (S.pxAlerts: above / below) is crossed;
//  - a holding moves more than the chosen share in a day (S.liveAl.move, 5% unless set);
//  - the dollar crosses a rate they set (S.liveAl.usdAbove / usdBelow);
//  - a personal alert of "חיבור למציאות" (server/pulse.js): a critical one, and an important one when they chose so; a
//    material development of an alert is sent again, another article about the same event is not.
// Each one at most once a day (alerts/live, or meta live:<id>), at most one message every 20 minutes (or an hour, as
// chosen), and nothing in the person's quiet hours (midnight to 09:00 unless set otherwise; a critical one only if they
// allowed it). Facts from the prices and the readings; never advice.
import {sendAllowed, esc, wrapHtml, mailAllowedFor} from './mail.js';
import {pushTo, pushUsers} from './push.js';
import {pathsOf as pathsOfP, pulseUpdate, pulsePrefs, inQuiet} from './pulse.js';
const ilDay=d=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
const pct=x=>(x>=0?'+':'−')+Math.abs(x).toFixed(1)+'%';

// 30.10: for any person: the owner's documents, or a partner's own (data/users/<id>/...)
export const pathsOf=pathsOfP;
export function liveHits(store,{now=new Date(),paths=pathsOf(null),user=null}={}){
  const Q=store.getDoc('quotes/latest').data, P=store.getDoc(paths.portfolio).data, S=store.getDoc(paths.settings).data||{};
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
  // 30.10: the personal alerts (server/pulse.js) of the last six hours that may reach the phone: the critical ones, and
  // the important ones when the person chose so; a material development of one (a new version) is sent again
  if(A.news!==false){try{const pr=pulsePrefs(S), from=new Date(now.getTime()-6*36e5).toISOString(), r=pulseUpdate(store,user,{now});
    for(const a of r.doc.items){if(a.kind==='mkt'||(a.up||a.at)<from)continue; if(!(a.lv==='crit'&&pr.push.crit)&&!(a.lv==='imp'&&pr.push.imp))continue;
      const who=(a.holds||[]).filter(h=>h.link==='direct').map(h=>h.sym), base=`news:${a.ev||a.k.replace(/^(ev|id):/,'')}`;
      out.push({key:a.ver>1?`${base}:v${a.ver}`:base,sev:a.lv==='crit'?'crit':'warn',lv:a.lv,text:`${who.length?who.join(', ')+': ':''}${a.title}. ${a.what||''}`.trim()+(a.ver>1?` (עדכון: ${(a.hist[a.hist.length-1]||{}).t||'התפתחות'})`:''),link:(a.arts[0]||{}).link||null})}}catch(e){}}
  return out;
}
// 30.10: quiet hours are each person's (settings → "חדשות והתראות"; nothing from midnight to 09:00 unless set otherwise),
// and so are how often a message may come and whether a critical one may come in the quiet hours
export async function liveTask(store,{log=()=>{},now=new Date(),send=sendAllowed,push=null}={}){
  const day=ilDay(now);
  const owner=store.users().find(u=>u.role==='owner'), withDev=new Set(pushUsers(store).map(u=>u.id)), who=[...(owner?[owner]:[{id:'owner',role:'owner'}]),...store.users().filter(u=>u.role!=='owner'&&(withDev.has(u.id)||(u.role==='friend'&&mailAllowedFor(store,u,'live'))))];
  let out=null;
  for(const u of who){const r=await liveFor(store,u,{log,now,day,send,push}); if(u.role==='owner')out=r}
  return out||{hits:0,fresh:0};
}
// one person: the owner (an e-mail with consent, and the phone) or a partner (the phone only); each item once a day, at most
// one message in 20 minutes
async function liveFor(store,u,{log,now,day,send,push}){
  const own=u.role==='owner', stKey=own?null:'live:'+u.id;
  const st=own?store.getDoc('alerts/live'):{exists:!!store.getMeta(stKey),data:(()=>{try{return JSON.parse(store.getMeta(stKey)||'null')}catch(e){return null}})()};
  const D=st.exists&&st.data&&st.data.date===day?st.data:{date:day,sent:[],lastAt:null};
  const save=x=>own?store.setDoc('alerts/live',x,{silent:true}):store.setMeta(stKey,JSON.stringify(x));
  const pr=pulsePrefs(store.getDoc(pathsOf(u).settings).data||{});
  if(!pr.on)return {off:true,hits:0,fresh:0};
  let hits=liveHits(store,{now,paths:pathsOf(u),user:own?null:u});
  // the quiet hours: nothing, or only the critical ones when the person allowed them; once a day only critical ones
  const quiet=inQuiet(pr,now); if(quiet)hits=hits.filter(x=>x.sev==='crit'&&pr.critQuiet); if(pr.freq==='day')hits=hits.filter(x=>x.sev==='crit');
  const fresh=hits.filter(x=>!D.sent.includes(x.key));
  if(!fresh.length){save({...D,checkedAt:now.toISOString()}); return quiet?{quiet:true,hits:hits.length,fresh:0}:{hits:hits.length,fresh:0}}
  const gap=(pr.freq==='hour'?60:20)*60e3;
  if(D.lastAt&&now-new Date(D.lastAt)<gap){log(`live${own?'':' ('+u.id+')'}: ${fresh.length} waiting for the next ${gap/60e3} minutes`); return {hits:hits.length,fresh:fresh.length,waiting:true}}
  fresh.sort((a,b)=>(a.sev==='crit'?0:1)-(b.sev==='crit'?0:1));
  const url=process.env.SITE_URL||'', head=fresh.length===1?fresh[0].text.slice(0,70):`${fresh.length} התראות: ${fresh.map(x=>x.text.split(' ')[0]).slice(0,4).join(', ')}`;
  let ok=false;
  {const text=fresh.map(x=>`• ${x.text}${x.link?'\n  '+x.link:''}`).join('\n')+`\n\n${url?'לאתר: '+url+'\n':''}עובדות מהמחירים ומהידיעות; לא המלצה לקנות או למכור.`;
    const html=wrapHtml('התראה',`<ul style="padding-inline-start:18px">${fresh.map(x=>`<li style="margin:6px 0;${x.sev==='crit'?'color:#b42318;font-weight:700':''}">${esc(x.text)}${x.link?` <a href="${esc(x.link)}">לכתבה</a>`:''}</li>`).join('')}</ul>${url?`<p><a href="${esc(url)}">לאתר</a></p>`:''}<p style="color:#64748b;font-size:13px">עובדות מהמחירים ומהידיעות; לא המלצה לקנות או למכור.</p>`);
    if(own||(u.role==='friend'&&mailAllowedFor(store,u,'live')))ok=await send(store,'live',{subject:`תיק צ׳יק – ${head}`,text,html},log,own?undefined:u)}
  // the phone: the same items, short (a tap opens the site on the stories)
  let pushed=0; try{pushed=await (push||pushTo)(store,u.id,{title:fresh.length===1?'תיק צ׳יק':`תיק צ׳יק · ${fresh.length} התראות`,body:fresh.map(x=>x.text).join('\n').slice(0,300),url:'./?st=1',tag:'live'},{log})}catch(e){log('push failed: '+(e&&e.message||e))}
  // marked as sent even when nothing went out, so that switching on does not send the whole day at once
  save({date:day,sent:[...D.sent,...fresh.map(x=>x.key)],lastAt:now.toISOString(),checkedAt:now.toISOString(),last:fresh.map(x=>({key:x.key,text:x.text,sev:x.sev})).slice(0,10),mailed:!!ok,pushed});
  log(`live${own?'':' ('+u.id+')'}: ${fresh.length} new (${ok?'e-mailed':'not e-mailed'}, ${pushed} device(s))`); return {hits:hits.length,fresh:fresh.length,sent:ok,pushed};
}
