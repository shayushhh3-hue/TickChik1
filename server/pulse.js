// 30.10: TikChik Pulse, the personal alerts of "חיבור למציאות". The readings of the news (research/newsx, shared by
// everybody) are matched here, on the server, to one person's own holdings: what they hold, how much of the portfolio
// each is (when every price is known, otherwise no weights are used), the sectors they are in, the dollar part. An alert
// is made only when there is a link to the portfolio that can be explained; an interesting article is not enough.
//
// Three measures are kept apart and never folded into one score:
//  - importance: how big the event is in itself (the reading's level);
//  - relevance: how much it touches this portfolio (the holding named and its weight; a supplier, a customer or a
//    competitor held; the share of the portfolio in the sectors it touches; the dollar part);
//  - confidence: how well the link and its explanation are founded (Claude's reading or a plain rule; a reported fact,
//    the source's reading, or an estimate; a direct link or a path through a sector).
// The level comes from written rules on the three (LEVEL_RULES below), never from a label alone.
//
// One alert per event (the reading's event key joins the articles about one thing). An alert comes again only on a
// material development: a higher level, the direction turning, another holding touched, an estimate confirmed as a
// reported fact. Another article about the same thing updates the alert's sources quietly. Every alert keeps its own
// history (when it was made, each development and why), and the list is kept for 30 days.
//
// Each person's alerts are their own document: the owner's in alerts/pulse, a partner's or
// an admin's in data/users/<id>/pulse, which only that person can read. Facts and links, never advice
// and never a forecast; a possible effect is said to be possible.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newsId} from './newsx.js';
import {symsOfUser} from './store.js';

const H=36e5, DAY=864e5;
export const pathsOf=u=>!u||u.role==='owner'
  ?{portfolio:'portfolio/main',settings:'settings/main',pulse:'alerts/pulse',newsst:'news/state'}
  :{portfolio:`data/users/${u.id}/portfolio`,settings:`data/users/${u.id}/settings`,pulse:`data/users/${u.id}/pulse`,newsst:`data/users/${u.id}/newsst`};

// ---- the preferences (settings → "חדשות והתראות"), with their defaults ----
const LVS=['crit','imp','upd'], SENS=['low','mid','high'], FREQ=['live','hour','day'];
const hhmm=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?v:null;
export function pulsePrefs(S){
  const a=(S&&typeof S.pulse==='object'&&S.pulse)||{}, lv=a.lv||{}, q=a.quiet||{}, pu=a.push||{};
  return {on:a.on!==false,lv:{crit:lv.crit!==false,imp:lv.imp!==false,upd:lv.upd!==false},sens:SENS.includes(a.sens)?a.sens:'mid',
    themes:Array.isArray(a.themes)?a.themes.filter(x=>typeof x==='string').slice(0,30):[],syms:Array.isArray(a.syms)?a.syms.filter(x=>typeof x==='string').map(x=>x.toUpperCase()).slice(0,40):[],
    freq:FREQ.includes(a.freq)?a.freq:'live',quiet:{on:q.on!==false,from:hhmm(q.from)||'00:00',to:hhmm(q.to)||'09:00'},critQuiet:a.critQuiet===true,icons:a.icons!==false,
    push:{crit:pu.crit!==false,imp:pu.imp===true},types:(S&&S.newsAl&&S.newsAl.types)||{}};
}
const ilHM=now=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hour12:false}).format(now); return p.replace(/^24/,'00')};
// in the quiet hours: from "from" to "to", over midnight when "to" is earlier
export function inQuiet(pr,now=new Date()){if(!pr||!pr.quiet||!pr.quiet.on)return false; const t=ilHM(now), {from,to}=pr.quiet; if(from===to)return false; return from<to?t>=from&&t<to:t>=from||t<to}

// ---- the holdings: weights only when they can be computed reliably ----
let SECMAP=null;
// the sector of each security, from the page's list of securities (site/lib/symdb.txt, written by the build)
export function sectorMap(){
  if(SECMAP)return SECMAP; SECMAP=new Map();
  try{const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','site','lib','symdb.txt');
    for(const l of fs.readFileSync(f,'utf8').split('\n')){const p=l.split('\t'); if(p.length<5||!p[4])continue; SECMAP.set(p[3]==='TLV'?'TLV:'+p[0]:p[0],p[4])}}catch(e){}
  return SECMAP;
}
export const _setSectors=m=>{SECMAP=m instanceof Map?m:new Map(Object.entries(m||{}))};
// the page's sector names onto the readings' (the same as the page's NX_SEC_MAP)
const SEC_ALIAS={'Information Technology':'Technology',Financials:'Finance',Materials:'Basic Materials',REITs:'Real Estate','Consumer Services':'Consumer Discretionary',Healthcare:'Health Care'};
const secOf=k=>{const g=sectorMap().get(k)||''; return SEC_ALIAS[g]||g};
export function holdingsOf(P,Q){
  const fx=+(Q&&Q.usdIls)||0, prices=(Q&&Q.prices)||{}, by=new Map(); let total=0, miss=0, usd=0;
  const rate=p=>{const c=(Q&&Q.meta&&Q.meta[p.sym]&&Q.meta[p.sym].ccy)||(p.ccy==='ILS'?'ILS':p.ccy||'USD'); if(c==='ILS')return 1; if(c==='USD')return fx||null; const r=Q&&Q.rates&&Q.rates[c]; return r&&r.rate>0?r.rate:null};
  for(const p of ((P&&P.positions)||[])){if(!p||!p.sym)continue; const h=by.get(p.sym)||{sym:p.sym,val:0,sec:secOf(p.sym),usd:false,known:true}; by.set(p.sym,h);
    const px=+prices[p.sym], rt=rate(p), q=+p.qty; if(!(px>0)||!rt||!(q>0)){h.known=false; miss++; continue}
    const v=q*px*rt; h.val+=v; total+=v; if(rt!==1){h.usd=true; usd+=v}}
  for(const c of ((P&&P.cash)||[])){const v=(+c.amount||0)*(c.ccy==='USD'?fx:1); if(v>0){total+=v; if(c.ccy==='USD')usd+=v}}
  const pos=[...by.values()], wOk=pos.length>0&&miss===0&&total>0;
  for(const h of pos)h.w=wOk?Math.round(h.val/total*1e3)/10:null;
  return {pos,wOk,total:wOk?total:null,usdPct:wOk?Math.round(usd/total*1000)/10:null};
}

// ---- the events: the readings of the last days, joined by their event key ----
const LV_RANK={crit:3,imp:2,watch:1,info:0};
export function eventsOf(store,{now=new Date(),days=3,visible=null}={}){
  const X=store.getDoc('research/newsx').data||{}, N=store.getDoc('research/news').data||{}, by=X.by||{}, from=new Date(now.getTime()-days*DAY).toISOString(), arts=new Map();
  for(const it of (N.items||[]))if(it&&it.link)arts.set(newsId(it.link),{...it,id:newsId(it.link),src:'co'});
  for(const it of (X.gen||[]))if(it&&it.id&&!arts.has(it.id))arts.set(it.id,it);
  const E=new Map();
  for(const a of arts.values()){const x=by[a.id]; if(!x||(a.at||a.seen||'')<from||(visible&&!visible(a)))continue;   // posts on X are not a source for an alert: they are not in these two lists
    const k=x.ev?'ev:'+x.ev:'id:'+a.id, e=E.get(k)||{k,arts:[]}; e.arts.push({a,x}); E.set(k,e)}
  for(const e of E.values()){
    // the reading that stands for the event: Claude's before the rules', the higher level, then the newest
    e.arts.sort((p,q)=>((p.x.rules?1:0)-(q.x.rules?1:0))||(LV_RANK[q.x.level]-LV_RANK[p.x.level])||(String(q.a.at||q.a.seen)<String(p.a.at||p.a.seen)?-1:1));
    e.x=e.arts[0].x; e.lead=e.arts[0].a; e.ai=e.arts.some(z=>!z.x.rules)}
  return [...E.values()];
}

// ---- the links of one event to one portfolio ----
const INDIRECT=new Set(['supplier','customer','competitor','sector']);
const HOW_HE={supplier:'ספקית',customer:'לקוחה',competitor:'מתחרה',sector:'חברה באותו ענף'};
export function linksFor(e,HD,{followed=[]}={}){
  const H=new Map(HD.pos.map(h=>[h.sym,h])), direct=[], indirect=[], seen=new Set(), F=new Set(followed), fol=[];
  for(const {a,x} of e.arts){if(e.ai&&x.rules)continue;   // when Claude has read the event, the rules' guesses are not used
    for(const z of (x.aff||[])){if(!z||seen.has(z.sym))continue; const h=H.get(z.sym);
      if(h){seen.add(z.sym); const L={sym:z.sym,w:h.w,how:z.how,dir:z.dir||x.dir,why:z.why||'',via:z.via||null,rules:!!x.rules,cert:x.cert||'interp'};
        if(z.how==='direct')direct.push(L); else if(INDIRECT.has(z.how))indirect.push(L); else seen.delete(z.sym)}
      else if(F.has(z.sym)&&z.how==='direct'&&!fol.some(f=>f.sym===z.sym))fol.push({sym:z.sym,dir:z.dir||x.dir,why:z.why||''})}
    // the securities the article was gathered for are the companies it is about
    for(const k of (a.syms||[])){if(seen.has(k))continue; const h=H.get(k); if(h){seen.add(k); direct.push({sym:k,w:h.w,how:'direct',dir:x.dir,why:'',via:null,rules:!!x.rules,cert:x.cert||'interp',listed:true})}
      else if(F.has(k)&&!fol.some(f=>f.sym===k))fol.push({sym:k,dir:x.dir,why:''})}}
  // the sectors: the share of the portfolio in the sectors the event touches, apart from the holdings already linked
  const x=e.x, secs=[];
  if(HD.wOk)for(const g of (x.sectors||[])){const hs=HD.pos.filter(h=>h.sec===g&&!seen.has(h.sym)); const w=hs.reduce((t,h)=>t+(h.w||0),0); if(w>0)secs.push({g,w:Math.round(w*10)/10,syms:hs.map(h=>h.sym),why:((x.secx||[]).find(s=>s.g===g)||{}).why||''})}
  const usd=(x.themes||[]).some(t=>t==='usd'||t==='boi')&&HD.usdPct!=null&&HD.usdPct>=20?HD.usdPct:null;
  return {direct,indirect,secs,usd,macro:!!x.macro,followed:fol};
}

// ---- the three measures, and the level by rules ----
// the thresholds by the sensitivity the person chose (in % of the portfolio)
export const SENS_T={low:{dHigh:5,iMid:5,sMid:35,sLow:15},mid:{dHigh:3,iMid:2,sMid:20,sLow:8},high:{dHigh:1.5,iMid:1,sMid:10,sLow:4}};
export const IMP_OF={crit:'crit',imp:'high',watch:'mid',info:'low'};
export function measuresOf(e,L,sens='mid'){
  const T=SENS_T[sens]||SENS_T.mid, x=e.x, imp=IMP_OF[x.level]||'low';
  // relevance: the strongest link, said in words
  let rel='none', why='';
  const dW=L.direct.filter(d=>d.w!=null).sort((a,b)=>b.w-a.w)[0], iW=L.indirect.filter(d=>d.w!=null).sort((a,b)=>b.w-a.w)[0], sW=L.secs.reduce((t,s)=>t+s.w,0);
  if(L.direct.length){const big=!dW||dW.w>=T.dHigh; rel=big?'high':'mid'; why=dW?`ההחזקה עצמה מוזכרת: ${dW.sym}, ${dW.w}% מהתיק`:`ההחזקה עצמה מוזכרת: ${L.direct[0].sym} (המשקל בתיק לא ידוע כרגע)`}
  else if(L.indirect.length){const big=!iW||iW.w>=T.iMid; rel=big?'mid':'low'; const z=iW||L.indirect[0]; why=`קשר עקיף: ${z.sym}${z.w!=null?` (${z.w}% מהתיק)`:''}, ${HOW_HE[z.how]||'קשורה'}${z.how==='sector'?' לזו':''} של החברה שבידיעה`}
  else if(sW>=T.sMid){rel='mid'; why=`${Math.round(sW)}% מהתיק בענפים שהאירוע נוגע להם`}
  else if(sW>=T.sLow){rel='low'; why=`${Math.round(sW)}% מהתיק בענפים שהאירוע נוגע להם`}
  else if(L.usd!=null&&L.usd>=30&&x.macro){rel='low'; why=`${L.usd}% מהתיק בדולרים, והאירוע נוגע לשער`}
  // confidence: how founded the link and its explanation are
  let conf='low', cwhy='';
  const strong=L.direct[0]||L.indirect[0];
  if(!e.ai){conf='low'; cwhy='קריאה אוטומטית לפי מילים בכותרת; צ׳יקו עוד לא קרא את הכתבה'}
  else if(L.direct.length&&x.cert==='fact'){conf='high'; cwhy='דיווח על דבר שקרה, והחברה שבתיק היא נושא הידיעה'}
  else if(L.direct.length||(L.indirect.length&&strong&&strong.why)){conf='mid'; cwhy=x.cert==='fact'?(L.direct.length?'דיווח על דבר שקרה; החברה שבתיק מוזכרת בו':'דיווח על דבר שקרה; הקשר לחברה שבתיק עקיף, והסיבה שלו כתובה'):x.cert==='interp'?'פרשנות של המקור, לא עובדה שנבדקה':'הערכה של צ׳יקו מהקשר כללי'}
  else{conf='low'; cwhy='קשר דרך ענף או השפעה רחבה, לא דרך החברה עצמה'}
  if(x.cert==='est'&&conf==='high'){conf='mid'; cwhy='הערכה של צ׳יקו, לא דיווח'}
  return {imp,rel,relWhy:why,conf,confWhy:cwhy};
}
// the rules, in order; each says why (shown in the alert)
export const LEVEL_RULES=[
  {lv:'crit',why:'אירוע קריטי בפני עצמו, נוגע ישירות לאחזקה משמעותית בתיק, והקשר מבוסס',test:(m,k)=>m.imp==='crit'&&m.rel==='high'&&m.conf!=='low'&&(k==='news'||k==='pr')},
  {lv:'imp',why:'אירוע חשוב עם קשר מוסבר לאחזקות שלך',test:(m,k)=>['crit','high'].includes(m.imp)&&['high','mid'].includes(m.rel)&&m.conf!=='low'&&k!=='opinion'},
  {lv:'upd',why:'נוגע לתיק, אבל פחות דחוף או פחות ודאי',test:(m,k)=>(['high','mid'].includes(m.rel)&&m.imp!=='low')||(m.rel==='low'&&['crit','high'].includes(m.imp)&&m.conf!=='low')}];
export function levelOf(m,kind='news'){const r=LEVEL_RULES.find(r=>r.test(m,kind)); return r?{lv:r.lv,why:r.why}:null}

// ---- one person: the alerts now, merged into what was kept ----
const LV3={crit:3,imp:2,upd:1};
const DIRS2=new Set(['pos','neg']);
function artOut(a,x){return {id:a.id,title:a.title||'',pub:a.pub||'',link:a.link,at:a.at||a.seen||null,seen:a.seen||null,upd:a.upd||null,kind:x.kind||'news',he:x.he,rules:!!x.rules}}
export function pulseCompute(store,u,{now=new Date()}={}){
  const pa=pathsOf(u), P=store.getDoc(pa.portfolio).data, S=store.getDoc(pa.settings).data||{}, Q=store.getDoc('quotes/latest').data||{}, pr=pulsePrefs(S);
  const HD=holdingsOf(P,Q), out=[];
  if(!pr.on)return {pr,HD,alerts:out,off:true};
  const hasPf=HD.pos.length>0;
  // a partner's (or an admin's) alerts come only from what they may read: the general news and the articles about their own securities
  const vis=u&&u.role!=='owner'?(()=>{const ok=symsOfUser(store,u.id); return a=>a.src==='gen'||(a.syms||[]).some(k=>ok.has(k))})():null;
  for(const e of eventsOf(store,{now,visible:vis})){
    const x=e.x; if(pr.types[x.type]===false)continue;
    const L=hasPf?linksFor(e,HD,{followed:pr.syms}):{direct:[],indirect:[],secs:[],usd:null,macro:!!x.macro,followed:linksFor(e,{pos:[],wOk:false,usdPct:null},{followed:pr.syms}).followed};
    const m=measuresOf(e,L,pr.sens); let r=hasPf?levelOf(m,x.kind||'news'):null;
    // the topics the person chose: an event reached only through a sector or the dollar must be one of them
    if(r&&!L.direct.length&&!L.indirect.length&&pr.themes.length&&!(x.themes||[]).some(t=>pr.themes.includes(t)))r=null;
    let followed=false;
    // a security the person follows without holding it: a portfolio update at most, and said to be so
    if(!r&&L.followed.length&&['crit','high'].includes(m.imp)&&e.ai){r={lv:'upd',why:'ידיעה על מניה שבחרת לעקוב אחריה (לא מהתיק)'}; followed=true}
    if(!r||!pr.lv[r.lv])continue;
    // 30.10: an event Claude has not read yet: its title is the article's own headline (the rules' "JPM: אחר" says nothing)
    out.push({k:e.k,lv:r.lv,lvWhy:r.why,ev:x.ev||null,title:e.ai?x.he:((e.lead&&e.lead.title)||x.he),what:x.what,kind:x.kind||'news',type:x.type,level:x.level,dir:x.dir,cert:x.cert||'interp',rules:!e.ai,
      imp:m.imp,rel:m.rel,relWhy:m.relWhy,conf:m.conf,confWhy:m.confWhy,followed,
      holds:L.direct.map(d=>({...d,link:'direct'})).concat(L.indirect.map(d=>({...d,link:'indirect'}))),secs:L.secs,usd:L.usd,fol:L.followed,
      sectors:x.sectors||[],themes:x.themes||[],regions:x.regions||[],fac:x.fac||[],secx:x.secx||[],occ:x.occ||null,unknown:x.unknown||'',
      arts:e.arts.slice(0,8).map(z=>artOut(z.a,z.x)),n:e.arts.length,first:e.arts.map(z=>z.a.at||z.a.seen).filter(Boolean).sort()[0]||null})}
  if(hasPf)for(const a of mktAlerts(store,P,S,Q,HD,now))if(pr.lv[a.lv])out.push(a);
  return {pr,HD,alerts:out};
}
// 30.10: the measured facts of the portfolio itself, as the stories had them: a holding's day beyond the share the person
// set (5% unless set), a price they set crossed, the dollar's rates they set, a holding's report in the coming three days.
// Each is a measurement or a date, said to be so; none says why the price moved
const ilDay=d=>d.toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
export function mktAlerts(store,P,S,Q,HD,now=new Date()){
  const out=[], today=ilDay(now), A=(S&&S.liveAl)||{}, mv=+A.move>0?+A.move:5, H=new Map(HD.pos.map(h=>[h.sym,h])), fresh=Q&&Q.updatedAt&&ilDay(new Date(Q.updatedAt))===today, at=Q&&Q.updatedAt||null;
  const base={kind:'mkt',type:'market',cert:'fact',rules:false,conf:'high',confWhy:'נתון מדוד מהמחירים העדכניים',sectors:[],themes:[],regions:[],fac:[],secx:[],secs:[],usd:null,fol:[],followed:false,occ:today,unknown:'',arts:[],n:0};
  const relOf=h=>h&&h.w!=null?(h.w>=SENS_T.mid.dHigh?'high':'mid'):'high', relW=h=>h&&h.w!=null?`${h.sym}, ${h.w}% מהתיק`:`${h?h.sym:''} שבתיק`;
  if(fresh)for(const h of HD.pos){const px=+(Q.prices||{})[h.sym], pv=+(Q.prev||{})[h.sym]; if(!(px>0)||!(pv>0)||(Q.stale||{})[h.sym])continue; const d=(px/pv-1)*100; if(Math.abs(d)<mv)continue;
    const big=Math.abs(d)>=mv*2&&relOf(h)==='high';
    out.push({...base,k:`mv:${h.sym}:${today}:${d>0?'u':'d'}`,lv:big?'crit':'imp',lvWhy:big?`תנועה חריגה במיוחד (פי שניים מהסף שקבעת) באחזקה משמעותית`:`תנועה של יותר מ-${mv}% ביום, הסף שקבעת`,
      title:`${h.sym} ${d>0?'עלתה':'ירדה'} היום ${d>0?'+':'−'}${Math.abs(d).toFixed(1)}%`,what:`מ-${pv} ל-${px}. תנועת מחיר מדודה; היא לא אומרת למה.`,dir:d>0?'pos':'neg',imp:'high',rel:relOf(h),relWhy:relW(h),
      holds:[{sym:h.sym,w:h.w,how:'direct',dir:d>0?'pos':'neg',why:'תנועת המחיר היום',link:'direct',measured:Math.round(d*100)/100}],first:at,mk:{t:'move',pct:Math.round(d*100)/100,from:pv,to:px,mv}})}
  for(const [k,t] of Object.entries((S&&S.pxAlerts)||{})){if(!t)continue; const px=+(Q.prices||{})[k]||+(Q.prices||{})[k.replace(/^TLV:/,'')]; if(!(px>0))continue; const sym=k.replace(/^TLV:/,''), h=H.get(k)||H.get(sym);
    for(const [dk,lim] of [['up',+t.above],['down',+t.below]]){if(!(lim>0)||(dk==='up'?px<lim:px>lim))continue;
      out.push({...base,k:`px:${k}:${dk}:${lim}:${today}`,lv:'imp',lvWhy:'מחיר שקבעת בהתראות נחצה',title:`${sym} ${dk==='up'?'עברה את':'ירדה אל'} המחיר שקבעת`,what:`עכשיו ${px}; הסף ${dk==='up'?'למעלה':'למטה'}: ${lim}.`,dir:dk==='up'?'pos':'neg',imp:'high',
        rel:h?relOf(h):'mid',relWhy:h?relW(h):`${sym} ברשימה שלך`,holds:h?[{sym:h.sym,w:h.w,how:'direct',dir:dk==='up'?'pos':'neg',why:'המחיר שקבעת',link:'direct'}]:[],first:at,mk:{t:'px',px,lim,dk,sym}})}}
  {const fx=+(Q&&Q.usdIls); if(fx>0&&HD.pos.some(h=>h.usd))for(const [dk,lim] of [['up',+A.usdAbove],['down',+A.usdBelow]]){if(!(lim>0)||(dk==='up'?fx<lim:fx>lim))continue;
    out.push({...base,k:`usd:${dk}:${lim}:${today}`,lv:'imp',lvWhy:'שער שקבעת בהתראות נחצה',title:`הדולר ${dk==='up'?'עבר את':'ירד אל'} ${lim}`,what:`השער עכשיו ${fx.toFixed(3)} ₪.`,dir:'unclear',imp:'high',rel:HD.usdPct!=null&&HD.usdPct>=30?'high':'mid',
      relWhy:HD.usdPct!=null?`${HD.usdPct}% מהתיק בדולרים`:'חלק מהתיק בדולרים',holds:[],usd:HD.usdPct,first:at,mk:{t:'usd',fx,lim,dk}})}}
  {const C=((store.getDoc('research/latest').data)||{}).companies||{}, end=ilDay(new Date(now.getTime()+3*DAY));
    for(const h of HD.pos){const c=C[h.sym]; if(!c||!c.next||c.next<today||c.next>end||(c.rep&&c.rep.at&&c.rep.at>=c.next))continue;
      out.push({...base,k:`rep:${h.sym}:${c.next}`,lv:'upd',lvWhy:'מועד ידוע בלוח הדוחות; עדכון, לא אירוע',title:`${h.sym} מפרסמת דוח ${c.next===today?'היום':'ב-'+c.next.split('-').reverse().slice(0,2).join('.')}`,what:c.nextEst?'המועד משוער עד שהחברה תאשר.':'המועד אושר.',
        dir:'unclear',imp:'mid',rel:relOf(h),relWhy:relW(h),occ:c.next,holds:[{sym:h.sym,w:h.w,how:'direct',dir:'unclear',why:'הדוח של החברה עצמה',link:'direct'}],first:null,mk:{t:'rep',date:c.next,est:!!c.nextEst}})}}
  return out;
}
// what makes a development material, against the alert that was kept
export function material(old,c){
  const why=[];
  if(LV3[c.lv]>LV3[old.lv])why.push('level');
  if(c.dir!==old.dir&&DIRS2.has(c.dir)&&(DIRS2.has(old.dir)||old.dir==='unclear'||old.dir==='mixed'))why.push('dir');
  const had=new Set((old.holds||[]).map(h=>h.sym)); if((c.holds||[]).some(h=>!had.has(h.sym)))why.push('hold');
  if(c.cert==='fact'&&old.cert!=='fact'&&!c.rules)why.push('fact');
  return why;
}
const WHY_HE={new:'התראה חדשה',level:'הרמה עלתה',dir:'כיוון ההשפעה האפשרי השתנה',hold:'אחזקה נוספת שלך נוגעת לאירוע',fact:'מה שהיה הערכה או פרשנות דווח כעובדה'};
export function pulseUpdate(store,u,{now=new Date(),save=true}={}){
  const pa=pathsOf(u), iso=now.toISOString(), old=store.getDoc(pa.pulse), D=old.exists&&old.data?old.data:{items:[]};
  const C=pulseCompute(store,u,{now}), byK=new Map((D.items||[]).map(a=>[a.k,a])), fresh=[];
  // 30.10: an alert made from the rules' reading whose article צ׳יקו has read since, under the event's own key: the read
  // one takes its place (not two alerts on the same article)
  {const artK=new Map(); for(const c of C.alerts)if(!c.rules)for(const z of (c.arts||[]))artK.set(z.id,c.k);
    for(const o of (D.items||[]))if(o&&o.rules&&(o.arts||[]).some(z=>artK.has(z.id)&&artK.get(z.id)!==o.k))byK.delete(o.k)}
  for(const c of C.alerts){const o=byK.get(c.k);
    if(!o){const a={...c,at:iso,up:iso,ver:1,hist:[{at:iso,lv:c.lv,dir:c.dir,why:'new',t:WHY_HE.new}]}; byK.set(c.k,a); fresh.push(a); continue}
    const why=material(o,c), a={...o,...c,lv:LV3[c.lv]>=LV3[o.lv]?c.lv:o.lv,lvWhy:LV3[c.lv]>=LV3[o.lv]?c.lvWhy:o.lvWhy,at:o.at,up:o.up,ver:o.ver||1,hist:o.hist||[]};
    // the holdings once named stay named (an alert does not forget whom it touched)
    {const seen=new Set(a.holds.map(h=>h.sym)); for(const h of (o.holds||[]))if(!seen.has(h.sym))a.holds.push(h)}
    if(why.length){a.ver++; a.up=iso; a.hist=[...a.hist,{at:iso,lv:a.lv,dir:c.dir,why:why[0],t:why.map(w=>WHY_HE[w]).join('; ')}].slice(-12); fresh.push(a)}
    byK.set(c.k,a)}
  // kept for 30 days from the last development; at most 150
  const from=new Date(now.getTime()-30*DAY).toISOString();
  const items=[...byK.values()].filter(a=>(a.up||a.at)>=from).sort((a,b)=>(b.up||b.at)<(a.up||a.at)?-1:1).slice(0,150);
  const doc={items,updatedAt:iso,on:C.pr.on,hasPf:C.HD.pos.length>0,wOk:C.HD.wOk,prefs:{lv:C.pr.lv,sens:C.pr.sens,icons:C.pr.icons},rules:LEVEL_RULES.map(r=>({lv:r.lv,why:r.why}))};
  // written (and the open pages told) only when something in it changed
  if(save){const strip=d=>JSON.stringify({...d,updatedAt:null}); if(!old.exists||strip(old.data||{})!==strip(doc))store.setDoc(pa.pulse,doc)}
  return {doc,fresh,pr:C.pr,HD:C.HD};
}
// every person: the owner, then each partner and admin, each from their own documents
export function pulseTask(store,{now=new Date(),log=()=>{}}={}){
  const us=(()=>{try{return store.users()}catch(e){return []}})(), owner=us.find(u=>u.role==='owner')||{id:'owner',role:'owner'};
  const who=[owner,...us.filter(u=>u.role!=='owner')]; let n=0, f=0;
  for(const u of who){try{const r=pulseUpdate(store,u,{now}); n+=r.doc.items.length; f+=r.fresh.length}catch(e){log('pulse: '+(e&&e.message||e))}}
  log(`pulse: ${who.length} people, ${f} new or developed, ${n} kept`);
  return {people:who.length,fresh:f,kept:n};
}
