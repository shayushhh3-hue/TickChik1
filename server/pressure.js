// 8.11: "מד לחץ" (the pressure gauge), the owner's alone until it is calibrated (research/pressure, research/pressure_track;
// the access matrix in server/store.js gives them to the owner only). For every security the owner holds or follows, the
// facts the server already has are read as signals, each a measured number with its source and time: the price and its
// volume (the saved close series, the live quotes), the last report against the estimate, the analysts' votes and grades,
// the insiders' own reports of their sales, the readings of the news, the group that moves with it, the calendar ahead.
// The signals add up to one of four levels (רגוע, מוגבר, גבוה, חריג). No verdict is given: the card shows which signals
// are lit, with their numbers. Every rise to גבוה or חריג is written down with the price of the day, and 5 and 20 trading
// days later the prices are written next to it: hits, false alarms and the falls that came with no warning are counted,
// so the gauge is judged by its record and not by its wording. Nothing here is a forecast or advice.
import {ilDay} from '../shared/market.js';
import {holdingsOf} from './pulse.js';
import {pushTo} from './push.js';

export const PRESS_DOC='research/pressure', TRACK_DOC='research/pressure_track';
export const LEVEL_HE=['רגוע','מוגבר','גבוה','חריג'];
const DAY=864e5;
const r1=x=>Math.round(x*10)/10, r2=x=>Math.round(x*100)/100;
const pct=x=>`${x>=0?'+':'−'}${Math.abs(x).toFixed(1)}%`;
const dmy=iso=>{const s=String(iso||'').slice(0,10); return s?`${+s.slice(8)}.${+s.slice(5,7)}`:''};
const doc=(store,p)=>{try{const d=store.getDoc(p); return d.exists?d.data:null}catch(e){return null}};
const seriesOf=(store,sym)=>doc(store,'quotes/c_'+String(sym).replace(':','_'));
const sd=a=>{if(a.length<2)return 0; const m=a.reduce((t,x)=>t+x,0)/a.length; return Math.sqrt(a.reduce((t,x)=>t+(x-m)*(x-m),0)/(a.length-1))};

// ---- the signals the close series alone gives, as of its day i (used live for the last day, and day by day in the
// backtest): volume against 20 days, the fall from the year's high, the long trend, a volatility spike, a losing streak.
// With move:true the day's own fall (close against the close before) is included, as the backtest has no live quote ----
export function seriesSignalsAt(C,V,D,i,{move=false}={}){
  const S=[], add=(k,w,v,t)=>S.push({k,w,v:v==null?null:r2(v),t}), n=i+1; if(!(n>=2)||!(C[i]>0))return S;
  const last=C[i], lastD=D?D[i]:null;
  if(move&&C[i-1]>0){const d=(last/C[i-1]-1)*100; if(d<=-5)add('move',d<=-10?3:2,d,`ירידה של ${pct(d)} ב-${dmy(lastD)} (מ-${C[i-1]} ל-${last})`); else if(d>=8)add('leap',0.5,d,`קפיצה של ${pct(d)} ביום אחד: תנודתיות גבוהה`)}
  if(n>=25&&V&&V.length>=n){const v=+V[i], base=V.slice(n-21,n-1).map(Number).filter(x=>x>0); const avg=base.length?base.reduce((t,x)=>t+x,0)/base.length:0;
    if(avg>0&&v>0){const r=v/avg; if(r>=2)add('volume',r>=3?1.5:1,r,`מחזור של פי ${r.toFixed(1)} מהממוצע של 20 הימים (${dmy(lastD)})`)}}
  if(n>=60){const hi=Math.max(...C.slice(Math.max(0,n-252),n)), dd=(last/hi-1)*100; if(dd<=-20)add('drawdown',dd<=-35?1.5:1,dd,`${pct(dd)} מהשיא של השנה (${hi})`)}
  if(n>=100){const L=n>=200?200:100, sma=C.slice(n-L,n).reduce((t,x)=>t+x,0)/L, gap=(last/sma-1)*100; if(gap<=-3)add('trend',1,gap,`${pct(gap)} מתחת לממוצע ${L} הימים (${r2(sma)})`)}
  if(n>=71){const R=[]; for(let j=n-70;j<n;j++)if(C[j]>0&&C[j-1]>0)R.push(Math.log(C[j]/C[j-1])); const s10=sd(R.slice(-10)), s60=Math.max(sd(R.slice(0,-10)),0.003); if(s10/s60>=2)add('vol',1.5,s10/s60,`התנודתיות של 10 הימים האחרונים פי ${(s10/s60).toFixed(1)} מזו של 60 הימים שלפניהם`)}
  if(n>=6){let k=0; for(let j=i;j>0&&C[j]<C[j-1];j--)k++; if(k>=4)add('streak',1,k,`${k} ימי ירידה ברצף (עד ${dmy(lastD)})`)}
  return S;
}
// ---- the signals of one security: facts with their numbers; w is the weight each adds to the score ----
export function signalsOf(sym,{Q,series,company,insiders,news,readings,comove,ecocal,now=new Date()}={}){
  const S=[], today=ilDay(now), add=(k,w,v,t,src,at)=>S.push({k,w,v:v==null?null:r2(v),t,src,at:at||null});
  const px=Q&&+(Q.prices||{})[sym], prev=Q&&+(Q.prev||{})[sym], meta=(Q&&Q.meta&&Q.meta[sym])||{}, fresh=!!(Q&&Q.usDate&&meta.date&&meta.date>=Q.usDate)&&!((Q.stale||{})[sym]);
  // the day's move, on its own trading day (a fall counts in full; a leap is noted as volatility)
  if(fresh&&px>0&&prev>0){const d=(px/prev-1)*100;
    if(d<=-5)add('move',d<=-10?3:2,d,`ירידה של ${pct(d)} ב${meta.date===today?'יום המסחר הזה':'-'+dmy(meta.date)} (מ-${prev} ל-${px})`,'המחירים העדכניים',Q.updatedAt);
    else if(d>=8)add('leap',0.5,d,`קפיצה של ${pct(d)} ביום אחד: תנודתיות גבוהה`,'המחירים העדכניים',Q.updatedAt)}
  // the saved close series: volume, the fall from the year's high, the long trend, the volatility, the streak
  const C=(series&&Array.isArray(series.c)?series.c:[]).map(Number), D=(series&&series.d)||[], V=(series&&Array.isArray(series.v)?series.v:null);
  for(const x of seriesSignalsAt(C,V,D,C.length-1))add(x.k,x.w,x.v,x.t,series.source||'סדרת המחירים',series.updatedAt);
  // the last report against the estimate, and the next one ahead
  const c=company||{};
  if(c.rep&&c.rep.eps&&c.rep.eps.s!=null&&c.rep.at){const age=(Date.parse(today)-Date.parse(c.rep.at))/DAY, s=+c.rep.eps.s;
    if(s<=-5&&age<=30)add('miss',age<=10?3:1,s,`הדוח של ${c.rep.label||c.rep.q} (${dmy(c.rep.at)}): רווח למניה ${c.rep.eps.a} מול צפי ${c.rep.eps.e}, החמצה של ${Math.abs(s).toFixed(0)}%`,c.rep.src||'Finnhub',c.rep.seen||null)}
  if(c.next&&c.next>=today){const days=Math.round((Date.parse(c.next)-Date.parse(today))/DAY); if(days<=5)add('earnings_soon',0.5,days,`דוח כספי ${days===0?'היום':days===1?'מחר':'בעוד '+days+' ימים'} (${dmy(c.next)})${c.nextEst?', מועד משוער':''}: תנודתיות צפויה`,'לוח הדוחות (Finnhub, SEC)',null)}
  // the analysts: the votes moving toward "sell" month over month, or a cluster of downgrades
  if(Array.isArray(c.recHist)&&c.recHist.length>=2){const a=c.recHist[c.recHist.length-2], b=c.recHist[c.recHist.length-1], tot=x=>x.sb+x.b+x.h+x.s+x.ss;
    if(tot(a)>=5&&tot(b)>=5){const sellA=(a.s+a.ss)/tot(a)*100, sellB=(b.s+b.ss)/tot(b)*100, buyA=(a.sb+a.b)/tot(a)*100, buyB=(b.sb+b.b)/tot(b)*100;
      if(sellB-sellA>=10||buyA-buyB>=15)add('analysts',1.5,sellB-sellA,`האנליסטים זזו: "מכירה" ${sellA.toFixed(0)}% → ${sellB.toFixed(0)}%, "קנייה" ${buyA.toFixed(0)}% → ${buyB.toFixed(0)}% (${a.p} → ${b.p}, ${tot(b)} אנליסטים)`,'Finnhub',c.recAt||null)}}
  if(Array.isArray(c.gradesL)){const from=new Date(now.getTime()-30*DAY).toISOString().slice(0,10), dn=c.gradesL.filter(g=>g&&g.d>=from&&/down/.test(g.act||'')); if(dn.length>=2)add('downgrades',2,dn.length,`${dn.length} הורדות דירוג ב-30 יום: ${dn.slice(0,3).map(g=>`${g.firm} (${dmy(g.d)})`).join(', ')}`,'FMP',dn[0].d)}
  // the insiders: their own sales, outside a plan, in the last 30 days
  if(Array.isArray(insiders)){const from=now.getTime()-30*DAY, sells=insiders.filter(f=>f&&f.kind==='sell'&&f.deliberate&&!f.plan&&Date.parse(f.txDate||f.filedAt)>=from), who=new Set(sells.map(f=>f.owner)), big=sells.filter(f=>f.top&&+f.value>=250e3);
    if(who.size>=2||big.length)add('insiders',2,sells.reduce((t,f)=>t+(+f.value||0),0),`${who.size===1?'בעל עניין אחד מכר':who.size+' בעלי עניין מכרו'} ב-30 יום${big.length?`, בהם נושא משרה בכיר ($${Math.round(big[0].value).toLocaleString('en-US')})`:''}: סך $${Math.round(sells.reduce((t,f)=>t+(+f.value||0),0)).toLocaleString('en-US')}, מחוץ לתוכנית מכירה קבועה`,'SEC EDGAR, טפסי 4',sells[0]&&sells[0].filedAt)}
  // the news: a critical negative reading in two days, or a run of negative ones against the security's own pace
  if(Array.isArray(news)&&readings){const t48=now.getTime()-2*DAY, t7=now.getTime()-7*DAY, mine=news.filter(a=>a&&Array.isArray(a.syms)&&a.syms.includes(sym)&&readings[a.id]);
    const neg=a=>{const x=readings[a.id]; return x&&x.dir==='neg'&&(x.level==='crit'||x.level==='imp')};
    const n48=mine.filter(a=>Date.parse(a.at)>=t48&&neg(a)), n7=mine.filter(a=>Date.parse(a.at)>=t7&&neg(a)), crit=n48.find(a=>readings[a.id].level==='crit');
    if(crit)add('newsCrit',3,1,`ידיעה קריטית שלילית ב-48 שעות: "${String(crit.title).slice(0,90)}" (${crit.pub||''})`,'קריאת הכתבות (צ׳יקו)',crit.at);
    const base=n7.length/3.5; if(n48.length>=3&&n48.length>=2*Math.max(base,0.5))add('news',2,n48.length,`${n48.length} ידיעות שליליות ב-48 שעות, מול ${base.toFixed(1)} בממוצע ל-48 שעות בשבוע האחרון`,'קריאת הכתבות (צ׳יקו)',n48[0].at)}
  // the group that moves with it, falling together on the day
  if(comove&&Array.isArray(comove.groups)&&Q&&fresh){const g=comove.groups.find(g=>Array.isArray(g.syms)&&g.syms.includes(sym)); if(g){const others=g.syms.filter(s=>s!==sym).map(s=>{const p=+(Q.prices||{})[s], v=+(Q.prev||{})[s]; const m=(Q.meta||{})[s]||{}; return p>0&&v>0&&m.date>=Q.usDate?(p/v-1)*100:null}).filter(x=>x!=null);
    if(others.length>=2){const avg=others.reduce((t,x)=>t+x,0)/others.length; if(avg<=-3)add('sector',2,avg,`הקבוצה שזזה איתו ("${g.name||'קבוצה'}", ${others.length} ניירות) יורדת ${pct(avg)} בממוצע ביום המסחר`,'המתאמים (research/comove) והמחירים',Q.updatedAt)}}}
  // the calendar: a rate decision or an inflation print within two days
  if(ecocal&&Array.isArray(ecocal.items)){const end=new Date(now.getTime()+2*DAY).toISOString().slice(0,10), il=/^TLV:|^\d{5,9}$|^TA(125|90)$/.test(sym);
    const ev=ecocal.items.find(e=>e&&(e.cat==='rates'||e.cat==='inflation')&&e.d>=today&&e.d<=end&&(il?e.region==='israel':e.region==='us')); if(ev)add('macro',0.5,0,`${ev.name} ב-${dmy(ev.d)}: יום של תנודתיות בשוק כולו`,ev.src||'לוח האירועים',null)}
  return S;
}
export const scoreOf=S=>r1(S.reduce((t,s)=>t+(+s.w||0),0));
export const levelOf=score=>score>6?3:score>=4?2:score>=2?1:0;

// the base rate of a security: how often, in the saved year, a day was followed within 20 trading days by a close 10% or
// more below it (the number the gauge's record is judged against)
export function baseRate(series,{drop=-10,days=20}={}){
  const C=(series&&Array.isArray(series.c)?series.c:[]).map(Number); if(C.length<days+30)return null; let n=0, hit=0;
  for(let i=0;i<C.length-days;i++){if(!(C[i]>0))continue; n++; const mn=Math.min(...C.slice(i+1,i+1+days)); if((mn/C[i]-1)*100<=drop)hit++}
  return n?{n,hit,rate:r1(hit/n*100)}:null;
}

// the backtest of the series signals alone, day by day over the saved year: for every level the gauge would have shown
// from the price and its volume (the news, the analysts and the insiders have no history here), how often a close 10% or
// more below followed within 20 trading days; and the same for each signal on its own. The thresholds were chosen by
// hand and the test runs on the same year they were chosen on, so these are the numbers the live record must beat,
// not proof of anything.
export function backtest(series,{drop=-10,days=20,from=100}={}){
  const C=(series&&Array.isArray(series.c)?series.c:[]).map(Number), V=(series&&Array.isArray(series.v)?series.v:null), D=(series&&series.d)||[];
  if(C.length<from+days+10)return null;
  const byLevel=[0,1,2,3].map(()=>({n:0,hit:0})), bySignal={}; let n=0, hit=0;
  for(let i=from;i<C.length-days;i++){if(!(C[i]>0))continue; const S=seriesSignalsAt(C,V,D,i,{move:true}), lv=levelOf(scoreOf(S)), fell=(Math.min(...C.slice(i+1,i+1+days))/C[i]-1)*100<=drop;
    n++; if(fell)hit++; byLevel[lv].n++; if(fell)byLevel[lv].hit++;
    for(const k of new Set(S.map(x=>x.k))){const b=bySignal[k]||(bySignal[k]={n:0,hit:0}); b.n++; if(fell)b.hit++}}
  const rate=b=>b.n?r1(b.hit/b.n*100):null;
  return {n,base:r1(hit/n*100),byLevel:byLevel.map(b=>({...b,rate:rate(b)})),bySignal:Object.fromEntries(Object.entries(bySignal).map(([k,b])=>[k,{...b,rate:rate(b)}])),from:D[from]||null,to:D[C.length-days-1]||null};
}
// the backtests of several securities pooled: the same counts added up
export function poolBacktests(list){
  const L=list.filter(Boolean); if(!L.length)return null; const byLevel=[0,1,2,3].map(()=>({n:0,hit:0})), bySignal={}; let n=0, hit=0;
  for(const b of L){n+=b.n; hit+=Math.round(b.base*b.n/100); b.byLevel.forEach((x,i)=>{byLevel[i].n+=x.n; byLevel[i].hit+=x.hit}); for(const [k,x] of Object.entries(b.bySignal||{})){const y=bySignal[k]||(bySignal[k]={n:0,hit:0}); y.n+=x.n; y.hit+=x.hit}}
  const rate=b=>b.n?r1(b.hit/b.n*100):null;
  return {n,syms:L.length,base:r1(hit/n*100),byLevel:byLevel.map(b=>({...b,rate:rate(b)})),bySignal:Object.fromEntries(Object.entries(bySignal).map(([k,b])=>[k,{...b,rate:rate(b)}]))};
}
// "in similar cases": the rate for the security's own series level when it rests on enough days (20), else the pooled one
export function similarOf(level,own,pool){
  const o=own&&own.byLevel&&own.byLevel[level], p=pool&&pool.byLevel&&pool.byLevel[level];
  if(o&&o.n>=20)return {rate:o.rate,n:o.n,base:own.base,scope:'own'}; if(p&&p.n>=20)return {rate:p.rate,n:p.n,base:pool.base,scope:'pool'}; return null;
}

// ---- the portfolio as a whole: how much of it stands in the high levels, how much hangs on the reports of the coming
// days, the heaviest holding; and the calendar ahead (reports of the holdings, the rate and inflation dates) ----
export function portfolioView(press,{P,Q,R,ECO,now=new Date()}={}){
  const H=holdingsOf(P,Q), W=new Map((H.pos||[]).map(r=>[r.sym,r.w])), today=ilDay(now), in10=new Date(now.getTime()+10*DAY).toISOString().slice(0,10), in5=new Date(now.getTime()+5*DAY).toISOString().slice(0,10);
  const high=Object.entries(press.syms||{}).filter(([,x])=>x.level>=2&&x.held).map(([sym,x])=>({sym,level:x.level,w:W.get(sym)??null})).sort((a,b)=>(b.w||0)-(a.w||0));
  const cal=[]; for(const [sym,x] of Object.entries(press.syms||{})){const c=R&&R.companies&&R.companies[sym]; if(c&&c.next&&c.next>=today&&c.next<=in10)cal.push({d:c.next,kind:'earnings',sym,name:`דוח כספי של ${sym}`,est:!!c.nextEst,w:x.held?(W.get(sym)??null):null})}
  for(const e of (ECO&&ECO.items)||[])if(e&&e.d>=today&&e.d<=in10&&(e.cat==='rates'||e.cat==='inflation'||e.cat==='jobs'))cal.push({d:e.d,kind:'macro',name:e.name,region:e.region||null});
  cal.sort((a,b)=>a.d.localeCompare(b.d)||(a.kind==='macro'?-1:1));
  const earn5=cal.filter(e=>e.kind==='earnings'&&e.d<=in5&&e.w!=null), top=(H.pos||[]).slice().sort((a,b)=>b.w-a.w)[0]||null;
  return {wOk:!!H.wOk,wHigh:H.wOk?r1(high.reduce((t,x)=>t+(x.w||0),0)):null,high,wEarn5:H.wOk?r1(earn5.reduce((t,x)=>t+(x.w||0),0)):null,earn5:earn5.map(e=>({sym:e.sym,d:e.d,w:r1(e.w)})),top:top&&top.w>=25?{sym:top.sym,w:r1(top.w)}:null,cal:cal.slice(0,14)};
}

// ---- the run: every security the owner holds or follows, the gauge, and the record kept forward ----
export function pressureBuild(store,{now=new Date(),syms=null}={}){
  const Q=doc(store,'quotes/latest'), R=doc(store,'research/latest'), INS=doc(store,'research/insiders'), N=doc(store,'research/news'), NX=doc(store,'research/newsx'), CM=doc(store,'research/comove'), ECO=doc(store,'research/ecocal');
  const P=doc(store,'portfolio/main'), prevDoc=doc(store,PRESS_DOC)||{}, held=new Set(((P&&P.positions)||[]).filter(p=>p&&p.sym&&+p.qty>0).map(p=>p.sym));
  const list=syms||[...new Set([...held,...(()=>{const o=store.users().find(u=>u.role==='owner'); const w=o?doc(store,'watch/'+o.id):null; return ((w&&w.syms)||[]).filter(s=>/^[A-Z][A-Z.\-]{0,5}$/.test(s))})()])];
  const out={}, today=ilDay(now), tests={};
  for(const sym of list){const ser=seriesOf(store,sym), S=signalsOf(sym,{Q,series:ser,company:R&&R.companies&&R.companies[sym],insiders:INS&&INS.by&&INS.by[sym],news:N&&N.items,readings:NX&&NX.by,comove:CM,ecocal:ECO,now});
    const score=scoreOf(S), level=levelOf(score), prev=(prevDoc.syms||{})[sym]||null, px=Q&&+(Q.prices||{})[sym]||null;
    // the level the price and its volume alone give (what the backtest can judge), and the backtest itself
    const SS=S.filter(x=>['move','leap','volume','drawdown','trend','vol','streak'].includes(x.k)), seriesLevel=levelOf(scoreOf(SS)); tests[sym]=backtest(ser);
    out[sym]={level,score,signals:S,held:held.has(sym),px,prevLevel:prev?prev.level:null,changedAt:prev&&prev.level===level?(prev.changedAt||today):today,base:baseRate(ser),seriesLevel,test:tests[sym]}}
  const pool=poolBacktests(Object.values(tests));
  for(const [sym,x] of Object.entries(out))x.similar=similarOf(x.seriesLevel,x.test,pool);
  const press={at:now.toISOString(),day:today,syms:out,levels:LEVEL_HE,n:list.length,high:Object.values(out).filter(x=>x.level>=2).length,pool,pushed:prevDoc.pushed||{}};
  try{press.portfolio=portfolioView(press,{P,Q,R,ECO,now})}catch(e){press.portfolio=null}
  return press;
}
// a rise to גבוה or חריג is written down once (not again within five trading days for the same security); the prices
// 5 and 20 trading days on are filled in as the series grow; a fall of 10% in 20 days with no warning in the five days
// before it is a miss. Counts from the first day of keeping the record.
export function trackUpdate(store,press,{now=new Date()}={}){
  const T=doc(store,TRACK_DOC)||{since:ilDay(now),items:[],misses:[]}, items=[...(T.items||[])], today=ilDay(now);
  for(const [sym,x] of Object.entries(press.syms||{})){if(x.level<2||!(x.px>0))continue;
    const recent=items.find(i=>i.sym===sym&&(Date.parse(today)-Date.parse(i.date))/DAY<=7); if(recent)continue;
    items.push({id:`${sym}:${today}`,sym,date:today,at:now.toISOString(),level:x.level,score:x.score,px0:x.px,signals:x.signals.map(s=>s.k)})}
  // the outcomes, from the saved closes after the day of the warning
  for(const it of items){if(it.out)continue; const ser=seriesOf(store,it.sym); if(!ser||!Array.isArray(ser.d))continue;
    const i=ser.d.findIndex(d=>d>it.date); if(i<0)continue; const C=ser.c.map(Number), after=C.slice(i);
    if(after.length>=5&&it.px5==null){it.px5=after[4]; it.d5=r1((after[4]/it.px0-1)*100)}
    if(after.length>=20){it.px20=after[19]; it.d20=r1((after[19]/it.px0-1)*100); it.min20=r1((Math.min(...after.slice(0,20))/it.px0-1)*100);
      it.out=it.min20<=-10?'fell10':it.d20<=-5?'fell5':it.d20>=5?'rose':'flat'}}
  // the falls that came with no warning: every held security, every day since the record began that has 20 days after it
  const P=doc(store,'portfolio/main'), held=[...new Set(((P&&P.positions)||[]).filter(p=>p&&p.sym&&+p.qty>0).map(p=>p.sym))], misses=[...(T.misses||[])], seen=new Set(misses.map(m=>m.id));
  for(const sym of held){const ser=seriesOf(store,sym); if(!ser||!Array.isArray(ser.d)||!Array.isArray(ser.c))continue; const C=ser.c.map(Number);
    for(let i=0;i<ser.d.length-20;i++){const d=ser.d[i]; if(d<T.since||!(C[i]>0))continue; const mn=Math.min(...C.slice(i+1,i+21)), drop=r1((mn/C[i]-1)*100); if(drop>-10)continue;
      const id=`${sym}:${d}`; if(seen.has(id))continue; const warned=items.some(w=>w.sym===sym&&w.date<=d&&(Date.parse(d)-Date.parse(w.date))/DAY<=7); if(warned)continue;
      // one miss per fall: a day already inside an earlier miss's 20 days is the same fall
      if(misses.some(m=>m.sym===sym&&(Date.parse(d)-Date.parse(m.date))/DAY<=28))continue;
      misses.push({id,sym,date:d,drop}); seen.add(id)}}
  const decided=items.filter(i=>i.out), stats={warned:items.length,pending:items.length-decided.length,hits:decided.filter(i=>i.out==='fell10').length,partial:decided.filter(i=>i.out==='fell5').length,false:decided.filter(i=>i.out==='flat'||i.out==='rose').length,misses:misses.length};
  const T2={since:T.since,at:now.toISOString(),items:items.slice(-400),misses:misses.slice(-200),stats}; store.setDoc(TRACK_DOC,T2); return T2;
}
export async function pressureTask(store,{log=()=>{},now=new Date(),push=pushTo}={}){
  const t0=Date.now(), press=pressureBuild(store,{now}), today=press.day;
  // a rise to גבוה or חריג: one notification to the owner's devices, once a day per security, the two heaviest signals in it
  const o=store.users().find(u=>u.role==='owner'); let pushed=0;
  if(o)for(const [sym,x] of Object.entries(press.syms)){if(x.level<2||(x.prevLevel!=null&&x.prevLevel>=2)||press.pushed[sym]===today)continue;
    const top=x.signals.slice().sort((a,b)=>b.w-a.w).slice(0,2).map(s=>s.t).join(' · ');
    try{const n=await push(store,o.id,{title:`מד לחץ: ${sym} עלה ל"${LEVEL_HE[x.level]}"`,body:`${top}${x.similar?` · במקרים דומים: ${x.similar.rate}% (בסיס ${x.similar.base}%)`:''}\nסימנים, לא תחזית. הפרטים בבקרה.`,url:'./#risk',tag:'press:'+sym},{log}); if(n){press.pushed[sym]=today; pushed++}}catch(e){log('push: '+(e&&e.message||e))}}
  for(const k of Object.keys(press.pushed))if(press.pushed[k]<today)delete press.pushed[k];
  store.setDoc(PRESS_DOC,press);
  let T=null; try{T=trackUpdate(store,press,{now})}catch(e){log('track: '+(e&&e.message||e))}
  const hi=Object.entries(press.syms).filter(([,x])=>x.level>=2).map(([s,x])=>`${s} ${LEVEL_HE[x.level]} (${x.score})`);
  log(`pressure: ${press.n} securities, ${press.high} high${hi.length?': '+hi.slice(0,6).join(', '):''}${pushed?`, ${pushed} pushed`:''}${press.pool?`; backtest: ${press.pool.n} days of ${press.pool.syms}, base ${press.pool.base}%, high ${press.pool.byLevel[2].rate}%/${press.pool.byLevel[3].rate}%`:''}${T?`; record: ${T.stats.warned} warnings, ${T.stats.hits} hits, ${T.stats.false} false, ${T.stats.misses} misses`:''} (${Date.now()-t0}ms)`);
  return press;
}
// the morning e-mail's section (the owner's alone): the securities in the high levels today, and on Sundays the record
export function pressureSection(store,{now=new Date(),esc=x=>String(x)}={}){
  const P=doc(store,PRESS_DOC), T=doc(store,TRACK_DOC); if(!P||!P.syms)return null;
  const high=Object.entries(P.syms).filter(([,x])=>x.level>=2).sort((a,b)=>b[1].level-a[1].level||b[1].score-a[1].score), sunday=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Jerusalem'})).getDay()===0;
  if(!high.length&&!(sunday&&T&&T.stats&&(T.stats.warned||T.stats.misses)))return null;
  const lines=high.map(([sym,x])=>`${sym} — ${LEVEL_HE[x.level]} (ציון ${x.score}): ${x.signals.slice().sort((a,b)=>b.w-a.w).slice(0,2).map(s=>s.t).join('; ')}${x.similar?`. במקרים דומים בשנה האחרונה: ${x.similar.rate}% ירדו 10%+ תוך 20 ימי מסחר (בסיס ${x.similar.base}%)`:''}`);
  const S=T&&T.stats, rec=S?`לוח הציונים מאז ${dmy(T.since)}: ${S.warned} אזהרות, ${S.hits} פגיעות, ${S.partial} חלקיות, ${S.false} שווא, ${S.misses} ירידות בלי אזהרה, ${S.pending} ממתינות.`:'';
  const text=[high.length?lines.join('\n'):'אף נייר לא ב"גבוה" או "חריג".',sunday&&rec?rec:'','סימנים מדודים, לא תחזית ולא המלצה.'].filter(Boolean).join('\n');
  const html=`${high.length?`<ul style="margin:0;padding-inline-start:18px">${lines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:'<p>אף נייר לא ב"גבוה" או "חריג".</p>'}${sunday&&rec?`<p>${esc(rec)}</p>`:''}<p style="color:#64748b;font-size:13px">סימנים מדודים, לא תחזית ולא המלצה.</p>`;
  return {t:'מד לחץ',text,html};
}
