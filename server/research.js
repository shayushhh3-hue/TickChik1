// Analysts' views and company figures from Yahoo Finance (quoteSummary), the same source the prices come from.
// It is not an official API: Yahoo can change or refuse it at any time. When an update fails the last values stay,
// with their date, and the page says how old they are. Numbers in, numbers out: nothing here is advice.
import {mailAllowedFor} from './mail.js';
import {tickerFor} from '../shared/quotes.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// the default universe for the ranking (shared/universe.json, written by the build from the page's list of securities)
let UNI=null; export function defaultUniverse(){if(UNI)return UNI; try{UNI=JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','shared','universe.json'),'utf8')).keys||[]}catch(e){UNI=[]} return UNI}
import {fillFundamentals,secCiks,secSubmissions,secRepDates} from './fundamentals.js';
import {fhKey,fhMetrics,fhRecs,fhEarnings,fhTarget,fhEarningsCal,fhEarningsCalSym,fhPastEarnings,fhCompanyNews} from './finnhub.js';
import {nasdaqDivs,yahooDivs,divPlan} from './divs.js';
import {findingsOf, factsOf, explainReport, reportsMail, repSum} from './explain.js';

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MODS='financialData,defaultKeyStatistics,summaryDetail,calendarEvents,recommendationTrend,price,earnings,earningsHistory,earningsTrend';
const timed=(f,ms)=>(u,o={})=>f(u,{...o,signal:o.signal||AbortSignal.timeout(ms)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const SOURCE='Yahoo Finance';

// a session: the cookies Yahoo sets on a first visit, and the "crumb" its data calls ask for with them
export async function yahooSession({fetch:f=globalThis.fetch}={}){
  const F=timed(f,15000); let cookie='';
  for(const u of ['https://fc.yahoo.com/','https://finance.yahoo.com/']){
    try{const r=await F(u,{headers:{'user-agent':UA},redirect:'manual'});
      const sc=typeof r.headers.getSetCookie==='function'?r.headers.getSetCookie():[r.headers.get('set-cookie')].filter(Boolean);
      cookie=sc.map(x=>String(x).split(';')[0].trim()).filter(x=>x.includes('=')).join('; '); if(cookie)break}catch(e){}
  }
  if(!cookie)throw Object.assign(new Error('no cookie from Yahoo'),{session:true});
  const r=await F('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{'user-agent':UA,cookie}});
  const crumb=(await r.text()).trim();
  if(!r.ok||!crumb||crumb.length>40||/[<{\s]/.test(crumb))throw Object.assign(new Error('no crumb from Yahoo (HTTP '+r.status+')'),{session:true});
  return {cookie,crumb};
}

// one security's summary; null when Yahoo does not cover it
export async function quoteSummary(ticker,sess,{fetch:f=globalThis.fetch}={}){
  const r=await timed(f,15000)(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${MODS}&crumb=${encodeURIComponent(sess.crumb)}`,
    {headers:{'user-agent':UA,cookie:sess.cookie,accept:'application/json'}});
  if(r.status===401||r.status===403)throw Object.assign(new Error('HTTP '+r.status),{auth:true});
  if(r.status===429)throw Object.assign(new Error('HTTP 429'),{slow:true});
  if(r.status===404)return null;
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json(), q=j&&j.quoteSummary; const res=q&&Array.isArray(q.result)?q.result[0]:null;
  if(!res){if(q&&q.error)return null; throw new Error('no result')}
  return res;
}

// Yahoo's numbers come as {raw, fmt}; the page keeps percentages as percents (35.3), debt to equity as a ratio (0.41)
const val=x=>x==null?null:typeof x==='object'?(x.raw!=null&&isFinite(x.raw)?+x.raw:null):(isFinite(+x)?+x:null);
const r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
const pc=x=>{const n=val(x);return n==null?null:r2(n*100)};
const RATING=m=>m==null?null:m<=1.5?'Strong Buy':m<=2.5?'Buy':m<=3.5?'Hold':m<=4.5?'Sell':'Strong Sell';
const BY_KEY={strong_buy:'Strong Buy',buy:'Buy',hold:'Hold',underperform:'Sell',sell:'Strong Sell'};
export function figures(res,now=new Date()){
  const fd=res.financialData||{}, ks=res.defaultKeyStatistics||{}, sd=res.summaryDetail||{}, pr=res.price||{}, ce=((res.calendarEvents||{}).earnings)||{}, tr=(((res.recommendationTrend||{}).trend)||[])[0]||null;
  const k=(pr.currency==='ILA'||sd.currency==='ILA')?0.01:1;   // Tel Aviv: prices and targets in agorot
  const rev=val(fd.totalRevenue), fcf=val(fd.freeCashflow), today=now.toISOString().slice(0,10);
  const dates=(ce.earningsDate||[]).map(val).filter(x=>x>0).map(s=>new Date(s*1000).toISOString().slice(0,10)).sort();
  const n=val(fd.numberOfAnalystOpinions)||null, tgt=val(fd.targetMeanPrice), de=val(fd.debtToEquity), px=val(fd.currentPrice)??val(pr.regularMarketPrice);
  const out={gm:pc(fd.grossMargins),om:pc(fd.operatingMargins),pm:pc(fd.profitMargins),fcfm:rev>0&&fcf!=null?r2(fcf/rev*100):null,
    roe:pc(fd.returnOnEquity),de:de!=null?r2(de/100):null,cr:r2(val(fd.currentRatio)),
    pe:r2(val(sd.trailingPE)),fpe:r2(val(sd.forwardPE)??val(ks.forwardPE)),dy:pc(sd.dividendYield)??pc(sd.trailingAnnualDividendYield),
    rating:n?(RATING(val(fd.recommendationMean))||BY_KEY[fd.recommendationKey]||null):null,target:n&&tgt?r2(tgt*k):null,analysts:n,
    next:dates.find(d=>d>=today)||null,revg:pc(fd.revenueGrowth),epsg:pc(fd.earningsGrowth),beta:r2(val(sd.beta)??val(ks.beta)),
    price:px!=null?r2(px*k):null,chg52:pc(ks['52WeekChange']),name:pr.longName||pr.shortName||null};
  if(tr)out.votes={buy:(val(tr.strongBuy)||0)+(val(tr.buy)||0),hold:val(tr.hold)||0,sell:(val(tr.sell)||0)+(val(tr.strongSell)||0)};
  // 22.10: what the analysts expect for the coming report (kept, so the report can be set against what was expected before
  // it), and the share's moves in and around the session (how it moved after a report: after hours, before the open, the day)
  {const T=(((res.earningsTrend||{}).trend)||[]), tq=p=>{const t=T.find(x=>x.period===p); return t?{end:t.endDate||null,eps:r2(val((t.earningsEstimate||{}).avg)),rev:val((t.revenueEstimate||{}).avg)}:null};
   const q0=tq('0q'), q1=tq('+1q'), d=dates.find(x=>x>=today)||dates.at(-1)||null, eE=r2(val(ce.earningsAverage)), eR=val(ce.revenueAverage);
   if(d||q0)out.est={date:d,eps:eE??(q0&&q0.eps)??null,rev:eR??(q0&&q0.rev)??null,q:q0,nq:q1,at:now.toISOString()}}
  // 22.10: the dividend's days (the ex-dividend day, the payment day) and the last dividend per share; whether the report
  // date is still an estimate (a range of days, or not confirmed by the company)
  {const ds=x=>{const v=val(x); return v>0?new Date(v*1000).toISOString().slice(0,10):null}, cv=res.calendarEvents||{};
   const ex=ds(cv.exDividendDate)||ds(sd.exDividendDate), pay=ds(cv.dividendDate), la=val(ks.lastDividendValue), rate=val(sd.dividendRate)??val(sd.trailingAnnualDividendRate);
   if(ex||pay||la!=null)out.div={ex,pay,rate:rate!=null?r2(rate*k):null,last:la!=null?{amt:Math.round(la*k*1e4)/1e4,date:ds(ks.lastDividendDate)}:null};
   const ie=ce.isEarningsDateEstimate; if(out.next)out.nextEst=ie===true||(ie&&ie.raw===true)||dates.filter(d=>d>=today).length>1}
  {const t=x=>{const v=val(x); return v>0?v:null};
   out.mk={st:pr.marketState||null,reg:pc(pr.regularMarketChangePercent),regT:t(pr.regularMarketTime),post:pc(pr.postMarketChangePercent),postT:t(pr.postMarketTime),pre:pc(pr.preMarketChangePercent),preT:t(pr.preMarketTime)}}
  const rp=reportOf(res); if(rp)out.rep=rp;
  return out;
}
// the latest quarterly report, as numbers: earnings per share against the analysts' estimate for the last four quarters,
// revenue and net income for the last four, and the analysts' estimates for the quarter now running and the year. Yahoo
// gives no company guidance and no text: what the company said is in the articles (newsFor), never invented here
const isoQ=x=>{const n=val(x); return n>0?new Date(n*1000).toISOString().slice(0,10):null};
const lblQ=d=>{const m=+d.slice(5,7); return `Q${Math.ceil(m/3)} ${d.slice(0,4)}`};
export function reportOf(res){
  const E=res.earnings||{}, ccy=E.financialCurrency||((res.financialData||{}).financialCurrency)||null;
  const eps=(((res.earningsHistory||{}).history)||[]).map(h=>({q:isoQ(h.quarter),a:r2(val(h.epsActual)),e:r2(val(h.epsEstimate)),s:pc(h.surprisePercent)})).filter(x=>x.q&&x.a!=null).sort((a,b)=>a.q<b.q?-1:1);
  const fin=((((E.financialsChart||{}).quarterly)||[]).map(x=>({d:String(x.date||''),rev:val(x.revenue),ni:val(x.earnings)})).filter(x=>x.d&&x.rev!=null));
  if(!eps.length&&!fin.length)return null;
  const T=(((res.earningsTrend||{}).trend)||[]), tp=k=>{const t=T.find(x=>x.period===k); if(!t)return null; const ee=t.earningsEstimate||{}, re=t.revenueEstimate||{};
    const o={end:t.endDate||null,eps:r2(val(ee.avg)),epsN:val(ee.numberOfAnalysts)||null,rev:val(re.avg),revG:pc(re.growth),g:pc(t.growth)}; return o.eps!=null||o.rev!=null?o:null};
  const last=eps.at(-1)||null, lf=fin.at(-1)||null, pf=fin.at(-2)||null;
  const ec=((((E.earningsChart||{}).quarterly)||[]).map(x=>String(x&&x.date||'')).filter(Boolean)), ecl=ec.at(-1)||null;
  return {q:last?last.q:null,label:last?lblQ(last.q):(lf?lf.d:null),ccy,finQ:lf&&ecl?lf.d===ecl:null,
    eps:last?{a:last.a,e:last.e,s:last.s}:null,
    rev:lf?lf.rev:null,ni:lf?lf.ni:null,revQoQ:lf&&pf&&pf.rev>0?r2((lf.rev/pf.rev-1)*100):null,finLabel:lf?lf.d:null,
    hist:eps.slice(-4),fin:fin.slice(-4),
    now:tp('0q'),next:tp('+1q'),year:tp('0y')};
}
// the articles about a security, newest first (Yahoo's search: title, publisher, link, time); data to show and to read,
// not instructions
export async function newsFor(ticker,{fetch:f=globalThis.fetch,n=8,now=new Date()}={}){
  // Finnhub's company news first for a US share (with a key); Yahoo's search otherwise, or when Finnhub has nothing
  if(fhKey()&&/^[A-Z][A-Z.\-]{0,6}$/.test(ticker)){try{const a=await fhCompanyNews(ticker,{fetch:f,now,n}); if(a.length)return a}catch(e){}}
  const r=await timed(f,12000)(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=0&newsCount=${n}&listsCount=0`,{headers:{'user-agent':UA,accept:'application/json'}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json();
  return ((j&&j.news)||[]).filter(x=>x&&x.title&&/^https:\/\//.test(x.link||'')).map(x=>({title:String(x.title).slice(0,200),pub:String(x.publisher||'').slice(0,60),link:String(x.link).slice(0,500),at:x.providerPublishTime?new Date(x.providerPublishTime*1000).toISOString():null,
    tickers:Array.isArray(x.relatedTickers)?x.relatedTickers.slice(0,6).map(String):[]}));
}
// new values over the old ones; a figure Yahoo does not give keeps its last value (F-score, Z-score, ROIC come only
// from the old source). The second source of the old data (Investing.com) is not updated any more, so it goes.
function merge(old,neu){const o={...(old||{})}; for(const [k,v] of Object.entries(neu))if(v!=null)o[k]=v; delete o.inv; return o}
const docKey=k=>'research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_');
export const tick=(k,map)=>k.startsWith('TLV:')?(map[k]||k.slice(4)+'.TA'):tickerFor(k,null,map);
// securities queued for a research run of their own (a portfolio just saved): taken by the 'research-new' job
let QUEUED=new Set(); export function queueResearch(keys){for(const k of keys||[])if(usable(k))QUEUED.add(k); return QUEUED.size}
export function takeQueued(){const a=[...QUEUED]; QUEUED=new Set(); return a}
export const usable=k=>typeof k==='string'&&(/^[A-Z][A-Z.\-]{0,6}$/.test(k)||/^TLV:[A-Z0-9.]{1,10}$/.test(k))&&!/^TA\d+$/.test(k);

// ---- 22.10: a report set against what was expected before it ----
// the estimates for this report: the latest snapshot taken for its date (on or after the quarter's end, not after today),
// or the one Yahoo still shows for this quarter; and the analysts' estimate for the quarter after it, as it was before
const KEEP=['at','atSrc','atEst','seen','ai','ev','revE','epsE','nxW','rx','mailed','finWas'];
// the day a report for the quarter that ended on `q` came out, from the days the calendar holds: the first one after the
// quarter's end and within 80 days of it
export function repDateOf(q,dates){if(!q||!Array.isArray(dates))return null; const lim=new Date(Date.parse(q+'T00:00:00Z')+80*864e5).toISOString().slice(0,10);
  const c=dates.map(x=>x&&x.date).filter(d=>d&&d>q&&d<=lim).sort(); return c[0]||null}
export function repEst(r,C,today){
  const qm=String(r.q).slice(0,7), byAt=(a,b)=>String(a.at||'')<String(b.at||'')?1:-1;
  const E=C.filter(e=>e&&e.date&&e.date>=r.q&&e.date<=today).sort(byAt)[0]||C.filter(e=>e&&e.q&&e.q.end&&String(e.q.end).slice(0,7)===qm).sort(byAt)[0]||null;
  if(E){if(!(r.eps&&r.eps.e!=null)&&E.eps!=null)r.epsE=E.eps; if(E.rev!=null)r.revE=E.rev; if(E.q&&E.q.end&&String(E.q.end).slice(0,7)===qm&&E.nq)r.nxW=E.nq}
  if(r.revE==null){const q=C.map(e=>e&&e.q).find(q=>q&&q.end&&String(q.end).slice(0,7)===qm&&q.rev!=null); if(q)r.revE=q.rev}
  return r;
}
// how the share moved after the report: the first regular session after it was seen; until then the move after hours (a
// report after the close) or before the open (a report before it), whichever is the latest. Unknown when the report was
// found days after it came out
export function rxOf(r,mk){
  const old=r.rx||null; if(!mk||!r.seen||!r.at)return old; if(old&&old.fin)return old;
  const seen=Date.parse(r.seen)/1000, day=x=>new Date(x*1000).toISOString().slice(0,10);
  if(!(seen>0)||seen-Date.parse(r.at+'T00:00:00Z')/1000>3*86400)return old;
  if(old&&old.k==='day'&&mk.regT&&day(mk.regT)>old.d)return {...old,fin:true};
  if(mk.reg!=null&&mk.regT&&mk.regT>seen)return {k:'day',pct:mk.reg,t:mk.regT,d:day(mk.regT),fin:!!mk.st&&mk.st!=='REGULAR'};
  const ext=[];
  if(mk.post!=null&&mk.postT&&mk.regT&&mk.postT>mk.regT&&day(mk.regT)>=r.at)ext.push({k:'post',pct:mk.post,t:mk.postT});
  if(mk.pre!=null&&mk.preT&&(!mk.regT||mk.preT>mk.regT)&&day(mk.preT)>=r.at)ext.push({k:'pre',pct:mk.pre,t:mk.preT});
  ext.sort((a,b)=>b.t-a.t); return ext[0]||old;
}
// an earlier report, as it is kept in the list of past reports
const repShort=o=>({q:o.q,label:o.label||null,at:o.at||null,atSrc:o.atSrc||null,atEst:!!o.atEst,ccy:o.ccy||null,sum:o.sum||repSum(o),ai:o.ai&&(o.ai.explain||o.ai.guidance)?{explain:o.ai.explain||'',guidance:o.ai.guidance||''}:null});

// the night's update: the holdings first (everybody's), then the watch lists and the research candidates, then the
// ranking list; at a calm pace, within a time budget, and stopping early when Yahoo refuses
export async function researchTask(store,{log=()=>{},fetch:f=globalThis.fetch,now=new Date(),budgetMs=20*60e3,pause=600,only=null,explain=explainReport,mail=reportsMail,fill=fillFundamentals,noFh=false,secDates=secDatesPass,divs=divsPass}={}){
  const srcOf=(k,v)=>[yh.has(k)?SOURCE:null,v&&v.fhAt?'Finnhub':null,v&&v.src2&&v.src2.includes('SEC')?'דוחות החברה (SEC)':null].filter(Boolean).join(' + ')||SOURCE;
  const t0=Date.now(), iso=now.toISOString(), map=((store.getDoc('settings/main').data)||{}).symMap||{};
  const held=new Set(((store.getDoc('portfolio/main').data||{}).positions||[]).map(p=>p.sym)), watched=new Set(), W=store.listDocs('watch');
  for(const w of W)for(const s of ((w.data||{}).held||[]))held.add(s);
  for(const w of W)for(const k of ['marks','seen','syms'])for(const s of ((w.data||{})[k]||[]))watched.add(s);
  const C=store.getDoc('research/candidates'); for(const it of ((C.data||{}).items||[]))if(it&&it.sym)watched.add(it.sym);
  const uni=((store.getDoc('research/universe').data||{}).keys)||defaultUniverse();
  const order=only?[...new Set(only.filter(usable))]:[...new Set([...held].filter(usable).concat([...watched].filter(usable),uni.filter(usable)))];
  const got={}; let sess=null, ok=0, none=0, fail=0, first=null, stopped=null;
  for(const k of order){
    if(Date.now()-t0>budgetMs){stopped='time';break}
    try{
      if(!sess)sess=await yahooSession({fetch:f});
      let res; try{res=await quoteSummary(tick(k,map),sess,{fetch:f})}
      catch(e){if(!e.auth)throw e; sess=await yahooSession({fetch:f}); res=await quoteSummary(tick(k,map),sess,{fetch:f})}
      if(res){got[k]=figures(res,now);ok++} else none++;
    }catch(e){fail++; first=first||`${k}: ${e.message}`;
      if(e.session){stopped='session';break} if(e.slow)await sleep(Math.min(30000,pause*50)); if(fail>=25&&!ok){stopped='errors';break}}
    if(pause)await sleep(pause);
  }
  // 25.10: Finnhub (with the owner's key): the figures, the analysts and the coming reports Yahoo did not give
  let fhs=null; if(fhKey()&&!noFh){try{fhs=await finnhubPass(store,order,got,{fetch:f,tick:k=>tick(k,map),log,now,held,watched,budgetMs:only?2*60e3:12*60e3,cal:!only})}catch(e){log('finnhub failed: '+(e&&e.message||e))}}
  // 28.10: the dividends ahead (declared, and the next ones by the company's rhythm, estimated) for the calendar
  let dvs=null; if(divs&&!only){try{dvs=await divs(store,order,got,{fetch:f,tick:k=>tick(k,map),log,now,held,watched})}catch(e){log('dividends ahead failed: '+(e&&e.message||e))}}
  // 28.10: the real days the reports came out, from the companies' filings at the SEC (no key needed)
  let sd=null; if(secDates){try{sd=await secDates(store,order,got,{fetch:f,tick:k=>tick(k,map),log,now,held,watched})}catch(e){log('report dates failed: '+(e&&e.message||e))}}
  // 25.10: what Yahoo did not give (all of it, when its company data refuses the server): the companies' own reports at the
  // SEC, Finnhub with a key, and the beta from the daily closes (server/fundamentals.js)
  const yh=new Set(Object.keys(got)); let fund=null;
  try{fund=await fill(store,order,got,{fetch:f,tick:k=>tick(k,map),log,now,budgetMs:only?3*60e3:Math.max(6*60e3,budgetMs-(Date.now()-t0))})}catch(e){log('fundamentals failed: '+(e&&e.message||e))}
  // write what arrived; whatever did not keeps its last values and date
  // a report newer than the one stored: its day is the report date the calendar had (when it has passed), and it is an event
  const fresh=[], words=[], posName={}, redated=new Map(); for(const x of ((store.getDoc('portfolio/main').data||{}).positions||[]))if(x&&x.sym&&x.name)posName[x.sym]=x.name;
  for(const [k,v] of Object.entries(got)){const p=docKey(k), old=store.getDoc(p).data||{}, today=iso.slice(0,10);
    // the estimates for the coming report: when its date moves on, the one before is kept (the report it was for may come later)
    if(v.est){if(old.est&&old.est.date&&v.est.date!==old.est.date)v.estPrev=old.est; else if(old.estPrev)v.estPrev=old.estPrev}
    // the dividends before this one: kept when Yahoo moves on to the next ex-dividend day (for the calendar)
    if(v.div&&old.div&&old.div.ex&&old.div.ex!==v.div.ex)v.divHist=[old.div].concat((old.divHist||[]).filter(x=>x&&x.ex!==old.div.ex)).slice(0,8);
    if(v.rep&&v.rep.q){const o=old.rep||null, was=o&&o.q;
      if(was===v.rep.q){for(const f of KEEP)if(o[f]!==undefined)v.rep[f]=o[f]}
      else{const cal=repDateOf(v.rep.q,v.repDates||old.repDates);
        // the day it came out: the calendar's day; else the day the page expected it; else the day it was seen (said so)
        if(cal){v.rep.at=cal; v.rep.atSrc='cal'} else if(old.next&&old.next<=today)v.rep.at=old.next; else{v.rep.at=today; v.rep.atEst=true}
        v.rep.seen=iso; v.rep.finWas=o?o.finLabel||null:null;
        repEst(v.rep,[old.est,old.estPrev,v.est,v.estPrev],today);
        if(o&&o.q)v.reps=[repShort(o)].concat((old.reps||[]).filter(x=>x&&x.q!==o.q)).slice(0,8);   // the earlier reports, kept
        if((was||old.next)&&!v.rep.init){v.rep.ev=true; fresh.push([k,v.rep])} delete v.rep.init}
      // the revenue Yahoo has is still the quarter before: its quarterly chart has not moved since the report before, and
      // it is behind the earnings chart
      v.rep.revPend=v.rep.finQ===false&&(v.rep.finWas==null||v.rep.finLabel===v.rep.finWas);
      v.rep.rx=rxOf(v.rep,v.mk);
      v.rep.find=findingsOf(v.rep);
      // the explanation: for a new report, and for a recent one (three weeks) that has none yet; a few per run. A report
      // whose revenue is not in yet waits for it a few hours
      const recent=v.rep.at&&(now-new Date(v.rep.at+'T12:00:00Z'))<21*864e5, wait=v.rep.revPend&&v.rep.seen&&(now-Date.parse(v.rep.seen))<8*36e5;
      if((!v.rep.ai||(v.rep.ai.v||1)<2)&&recent&&!wait&&(held.has(k)||watched.has(k))&&words.length<6)words.push([k,v]);
      v.rep.sum=repSum(v.rep)}
    const M={...merge(old,v),sym:k,source:srcOf(k,v),updatedAt:iso};
    if(M.rep&&M.rep.q&&!M.rep.atSrc&&M.repDates){const d=repDateOf(M.rep.q,M.repDates); if(d){M.rep={...M.rep,at:d,atSrc:'cal'}; delete M.rep.atEst; redated.set(k+'|'+M.rep.q,d); if(v.rep)v.rep.at=d}}
    // 28.10: the earlier reports too: each by the day it came out, when the filings or the calendar have it
    if(Array.isArray(M.reps)&&M.repDates)M.reps=M.reps.map(r=>{if(!r||!r.q||r.atSrc)return r; const d=repDateOf(r.q,M.repDates); if(!d)return r; redated.set(k+'|'+r.q,d); return {...r,at:d,atSrc:'cal',atEst:false}});
    // and the shared copy the page reads (research/latest) gets the corrected days with the rest of this run
    if(M.rep&&(redated.has(k+'|'+M.rep.q)||(M.reps||[]).some(r=>r&&redated.has(k+'|'+r.q)))){v.rep=v.rep||M.rep; v.reps=M.reps}
    store.setDoc(p,M,{silent:true})}
  for(const [k,v] of words){let H=[]; try{H=await newsFor(tick(k,map),{fetch:f})}catch(e){}
    const ai=await explain(factsOf(k,posName[k]||v.name||k,v.rep,H),{fetch:f,log}); if(!ai)continue; v.rep.ai={...ai,v:2}; v.rep.sum=repSum(v.rep);
    const p=docKey(k); store.setDoc(p,{...(store.getDoc(p).data||{}),rep:v.rep},{silent:true})}
  const heldGot=[...held].filter(k=>got[k]);
  const touched=Object.entries(got).filter(([k,v])=>v.rep&&v.rep.ev&&v.rep.seen&&(now-Date.parse(v.rep.seen))<21*864e5);
  if(heldGot.length||fresh.length||words.length||touched.length||redated.size){const L=store.getDoc('research/latest').data||{}, comp={...(L.companies||{})};
    for(const k of heldGot)comp[k]={...merge(comp[k],got[k]),source:srcOf(k,got[k]),updatedAt:iso};
    const evOf=([k,r])=>({sym:k,name:posName[k]||(got[k]&&got[k].name)||k,date:r.at,atEst:!!r.atEst,q:r.q,label:r.label||null,text:repLine(r),find:r.find||[],ai:r.ai?{findings:r.ai.findings,explain:r.ai.explain,guidance:r.ai.guidance||''}:null,sum:repSum(r),source:SOURCE});
    const upd=new Map(touched.map(([k,v])=>[k+'|'+v.rep.q,evOf([k,v.rep])]));
    const ev=(L.events||[]).filter(e=>!fresh.some(([k,r])=>e.sym===k&&e.q===r.q)).map(e=>upd.get(e.sym+'|'+e.q)||e).map(e=>redated.has(e.sym+'|'+e.q)?{...e,date:redated.get(e.sym+'|'+e.q)}:e)
      .concat(fresh.map(evOf)).sort((a,b)=>a.date<b.date?1:-1).slice(0,40);
    store.setDoc('research/latest',{...L,companies:comp,events:ev,source:SOURCE,updatedAt:iso})}
  // the owner's e-mail (with consent for "earnings"): the new reports of what the owner holds or follows, once each; a
  // report whose revenue is not in yet waits for it up to eight hours
  {const ou=(store.users?store.users():[]).find(u=>u.role==='owner'), mine=new Set(((store.getDoc('portfolio/main').data||{}).positions||[]).map(x=>x.sym));
    if(ou){const w=store.getDoc('watch/'+ou.id).data||{}; for(const kk of ['held','marks','syms'])for(const x of (w[kk]||[]))mine.add(x)}
    const items=[], due=[];
    for(const [k,v] of Object.entries(got)){const r=v.rep; if(!r||!r.ev||r.mailed||!r.seen)continue;
      if(r.revPend&&(now-Date.parse(r.seen))<8*36e5)continue;
      r.mailed=iso; const p=docKey(k); store.setDoc(p,{...(store.getDoc(p).data||{}),rep:r},{silent:true});
      const it={sym:k,name:posName[k]||v.name||k,rep:r}; due.push(it); if(mine.has(k))items.push(it)}
    if(items.length)try{await mail(store,items,log)}catch(e){log('report mail failed: '+(e&&e.message||e))}
    // 30.10: each partner who switched it on: the reports of what they hold or follow, to their own address
    if(due.length)for(const u of (store.users?store.users():[]).filter(u=>u.role==='friend')){if(!mailAllowedFor(store,u,'earnings'))continue;
      const w=store.getDoc('watch/'+u.id).data||{}, theirs=new Set(); for(const kk of ['held','marks','syms'])for(const x of (w[kk]||[]))theirs.add(x);
      for(const x of ((store.getDoc(`data/users/${u.id}/portfolio`).data||{}).positions||[]))theirs.add(x.sym);
      const L=due.filter(it=>theirs.has(it.sym)); if(L.length)try{await mail(store,L,log,u)}catch(e){log('report mail (partner) failed: '+(e&&e.message||e))}}}
  const uniGot=uni.filter(k=>got[k]);
  if(uniGot.length){const Fd=store.getDoc('research/fit').data||{rows:{}}, rows={...(Fd.rows||{})};
    for(const k of uniGot){const v=got[k], o=rows[k]||[], nw=[v.pm,v.roe,v.de,null,v.pe,v.fpe,v.dy,v.revg,v.rating,v.target,v.analysts,v.next,v.beta]; rows[k]=nw.map((x,i)=>x!=null?x:(o[i]??null))}
    // the date says when the list was refreshed; when only part of it arrived, the older rows keep the earlier date
    store.setDoc('research/fit',{...Fd,rows,n:Object.keys(rows).length,source:SOURCE+(fhs&&fhs.filled?', Finnhub':'')+(fund&&fund.filled?', דוחות החברות ב-SEC':''),refreshed:uniGot.length,updatedAt:uniGot.length>=uni.length*0.6?iso:(Fd.updatedAt||iso)})}
  const cand=(C.data||{}).items||[];
  if(cand.some(it=>it&&got[it.sym])){const items=cand.map(it=>{const v=it&&got[it.sym]; if(!v)return it; const o={...it}; for(const k of ['beta','de','dy','fpe','pe','pm','roe','price','chg52'])if(v[k]!=null)o[k]=v[k]; return o});
    store.setDoc('research/candidates',{...C.data,items,source:SOURCE,updatedAt:iso})}
  // 30.10: how far each held or followed share moved around its last earnings releases (for the card before the next one)
  let erxN=0; try{erxN=erxPass(store,[...new Set([...held,...watched])],{now})}catch(e){log('report moves failed: '+(e&&e.message||e))}
  const st={at:iso,ok,none,fail,of:order.length,fund,fh:fhs,dates:sd,divs:dvs,erx:erxN,held:heldGot.length,reports:fresh.length,stopped,first,seconds:Math.round((Date.now()-t0)/1000),only:!!only};
  store.setMeta('researchStatus',JSON.stringify(st));
  log(`research: ${ok}/${order.length} updated, ${none} not covered, ${fail} failed${stopped?', stopped: '+stopped:''}${first?' (first: '+first+')':''}`);
  return st;
}

// one line in Hebrew for a new report: the quarter, earnings per share against the estimate, revenue
const bigN=(x,c)=>{if(x==null)return null; const a=Math.abs(x), sy=c==='USD'||!c?'$':c==='ILS'?'₪':c+' '; return sy+(a>=1e9?(x/1e9).toFixed(2)+'B':a>=1e6?(x/1e6).toFixed(1)+'M':Math.round(x).toLocaleString('en-US'))};
export function repLine(r){
  const e=r.eps, parts=[`דוח ${r.label||''}`.trim()];
  if(e&&e.a!=null)parts.push(`רווח למניה ${e.a}${e.e!=null?` מול צפי ${e.e}`:''}${e.s!=null?` (${e.s>0?'+':''}${e.s}%, ${e.s>=0?'מעל':'מתחת'} לצפי)`:''}`);
  if(r.rev!=null&&!r.revPend)parts.push(`הכנסות ${bigN(r.rev,r.ccy)}${r.revQoQ!=null?` (${r.revQoQ>0?'+':''}${r.revQoQ}% מהרבעון הקודם)`:''}`);
  return parts.join(' · ');
}
// the days after a report: only the securities whose report date has come (held, followed, on the list), so a report is in
// the page within hours, not at the night's full run
export function dueReports(store,now=new Date()){
  const today=now.toISOString().slice(0,10), from=new Date(now.getTime()-5*864e5).toISOString().slice(0,10), out=[];
  for(const d of store.listDocs('research')){const x=d.data||{}, r=x.rep; if(!d.id.startsWith('s_')||!x.sym)continue;
    const age=r&&r.seen?now-Date.parse(r.seen):Infinity;
    if(r&&r.ev&&age<3*864e5&&(r.revPend||!r.mailed||(!(r.rx&&r.rx.fin)&&age<36*36e5))){out.push(x.sym);continue}
    if(!x.next)continue; if(x.next>today||x.next<from)continue; if(r&&r.at&&r.at>=x.next)continue; out.push(x.sym)}
  return out;
}
export async function earningsTask(store,o={}){const only=dueReports(store,o.now||new Date()); if(!only.length){(o.log||(()=>{}))('earnings: no report due');return {due:0}} return researchTask(store,{...o,only,budgetMs:6*60e3,pause:400})}

// ---- 28.10: the dividends ahead ----
// For the US securities held or followed, once in three days each: Nasdaq's dividend list (declared ones with their days),
// else Yahoo's past dividends; the plan (declared, and the next ones by rhythm, estimated) kept as divPlan
export async function divsPass(store,order,got,{fetch:f=globalThis.fetch,tick:tk=k=>k,log=()=>{},now=new Date(),held=new Set(),watched=new Set(),budgetMs=3*60e3,pause=250}={}){
  const t0=Date.now(), iso=now.toISOString(), st={planned:0,tried:0,nasdaq:0,yahoo:0,fail:0,first:null,stopped:null};
  const us=k=>!k.startsWith('TLV:')&&/^[A-Z][A-Z.\-]{0,6}$/.test(tk(k));
  for(const k of order){
    if(Date.now()-t0>budgetMs){st.stopped='time';break}
    const tlv=k.startsWith('TLV:'); if(!(us(k)||tlv)||!(held.has(k)||watched.has(k)))continue;
    const doc=(store.getDoc('research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_')).data)||{};
    if(doc.divPlanAt&&Date.parse(iso)-Date.parse(doc.divPlanAt)<3*864e5)continue;
    st.tried++; let H=null, src='Nasdaq';
    // a Tel Aviv share: Yahoo's past dividends only (Nasdaq lists US securities), the days without the amounts (Yahoo
    // gives them in agorot)
    if(!tlv){try{H=await nasdaqDivs(tk(k),{fetch:f}); if(H.length)st.nasdaq++}catch(e){st.first=st.first||`${k}: ${e.message}`}}
    if(!H||!H.length){src='Yahoo Finance'; let Y=null; try{Y=await yahooDivs(tk(k),{fetch:f})}catch(e){} if(Y&&Y.length){H=Y; st.yahoo++} else if(Y)H=H||Y}
    if(H==null){st.fail++; if(st.fail>=6&&!st.planned){st.stopped='errors';break} continue}   // neither answered: nothing is written, tried again next run
    if(tlv&&H)H=H.map(x=>({...x,amt:null}));
    const g=got[k]||(got[k]={}); g.divPlanAt=iso; g.divPlan=H.length?{...divPlan(H,{now}),src,at:iso}:{next:[],none:true,at:iso};
    if(H.length)st.planned++;
    if(pause)await sleep(pause)}
  log(`dividends ahead: ${st.planned}/${st.tried} (Nasdaq ${st.nasdaq}, Yahoo ${st.yahoo})${st.stopped?', stopped: '+st.stopped:''}${st.first?' (first: '+st.first+')':''}`);
  return st;
}

// ---- 28.10: the report days from the SEC ----
// For the US companies held or followed whose stored report (or an earlier one) has no confirmed day, or that got a new
// report this run: the days of their earnings releases and quarterly reports, merged into repDates (with the calendar's
// days, when Finnhub gave them). At most once in three days per company, about eight a second as the SEC allows
export async function secDatesPass(store,order,got,{fetch:f=globalThis.fetch,tick:tk=k=>k,log=()=>{},now=new Date(),held=new Set(),watched=new Set(),budgetMs=4*60e3,pause=150}={}){
  const t0=Date.now(), iso=now.toISOString(), st={dated:0,tried:0,fail:0,first:null,stopped:null};
  const us=k=>!k.startsWith('TLV:')&&/^[A-Z][A-Z.\-]{0,6}$/.test(tk(k)); let ciks=null;
  for(const k of order){
    if(Date.now()-t0>budgetMs){st.stopped='time';break}
    if(!us(k)||!(held.has(k)||watched.has(k)))continue;
    const doc=(store.getDoc('research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_')).data)||{}, g=got[k];
    const open=r=>r&&r.q&&!r.atSrc, need=(g&&g.rep&&g.rep.q)||open(doc.rep)||(doc.reps||[]).some(open);
    if(!need)continue; if(doc.secDatesAt&&Date.parse(iso)-Date.parse(doc.secDatesAt)<3*864e5&&!(g&&g.rep))continue;
    st.tried++;
    try{ciks=ciks||await secCiks(store,{fetch:f}); const t=tk(k).toUpperCase(), cik=ciks[t]||ciks[t.replace(/\./g,'-')]||ciks[k.toUpperCase()]; if(!cik)continue;
      const sub=await secSubmissions(cik,{fetch:f}); const L=secRepDates(sub); if(!L.length)continue;
      const x=got[k]||(got[k]={}), prev=x.repDates||doc.repDates||[], by=new Map(); for(const d of prev.concat(L))if(d&&d.date&&!by.has(d.date))by.set(d.date,d);
      x.repDates=[...by.values()].sort((a,b)=>a.date<b.date?1:-1).slice(0,20); x.secDatesAt=iso; st.dated++}
    catch(e){st.fail++; st.first=st.first||`${k}: ${e.message}`; if(st.fail>=6&&!st.dated){st.stopped='errors';break}}
    if(pause)await sleep(pause)}
  log(`report dates: ${st.dated}/${st.tried} from the SEC${st.stopped?', stopped: '+st.stopped:''}${st.first?' (first: '+st.first+')':''}`);
  return st;
}

// ---- 25.10: the Finnhub pass ----
// the coming reports of all US companies in one call (when Yahoo gave no date); then, per security, its figures and the
// analysts' counts when Yahoo left them out, and for what is held or followed the last quarters' earnings (a report the
// page had none of starts from them: not an event) and the price target. Refreshed every three days per security.
const FHN=['pm','roe','de','revg','pe','dy','beta','chg52'];
export async function finnhubPass(store,order,got,{fetch:f=globalThis.fetch,tick:tk=k=>k,log=()=>{},now=new Date(),held=new Set(),watched=new Set(),budgetMs=12*60e3,cal=true,gap}={}){
  const t0=Date.now(), iso=now.toISOString(), today=iso.slice(0,10), o={fetch:f}; if(gap!=null)o.gap=gap;
  const st={filled:0,figs:0,recs:0,eps:0,cal:0,target:0,fail:0,first:null,stopped:null}, had=new Set(Object.keys(got));   // the keys Yahoo answered this run
  const us=k=>!k.startsWith('TLV:')&&/^[A-Z][A-Z.\-]{0,6}$/.test(tk(k));
  if(cal){try{const C=await fhEarningsCal({...o,now}); for(const k of order){if(!us(k))continue; const c=C[tk(k).toUpperCase()]||C[tk(k).toUpperCase().replace(/-/g,'.')]; if(!c||c.date<today)continue;
      const g=got[k]||(got[k]={}); if(g.next==null){g.next=c.date; g.nextEst=false; if(!g.est)g.est={date:c.date,eps:c.eps,rev:c.rev,at:iso,hour:c.hour}; g.fhAt=g.fhAt||iso; st.cal++}}}
    catch(e){st.first=st.first||'calendar: '+e.message; if(e.auth){log('finnhub: '+e.message); return {...st,stopped:'key'}}}
    // 28.10: a security held or followed that the calendar of everyone left out: its own coming report (four months)
    for(const k of order){if(!us(k)||!(held.has(k)||watched.has(k)))continue; const g0=got[k]||{}, doc=(store.getDoc('research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_')).data)||{};
      if((g0.next&&g0.next>=today)||(doc.next&&doc.next>=today))continue; if(Date.now()-t0>budgetMs/3)break;
      try{const c=await fhEarningsCalSym(tk(k),{...o,now}); if(c&&c.date>=today){const g=got[k]||(got[k]={}); g.next=c.date; g.nextEst=false; if(!g.est)g.est={date:c.date,eps:c.eps,rev:c.rev,at:iso,hour:c.hour}; st.cal++}}
      catch(e){st.first=st.first||'calendar '+k+': '+e.message; if(e.plan)break}}
    // the days the last reports came out (120 days back): kept per security, so a report is dated by the day it was
    // published, not by the day the page first saw it; a stored report dated by a guess gets its real day
    try{const Pc=await fhPastEarnings({...o,now}); for(const k of order){if(!us(k))continue; const d=Pc[tk(k).toUpperCase()]||Pc[tk(k).toUpperCase().replace(/-/g,'.')]; if(!d||!d.length)continue;
      const doc=(store.getDoc('research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_')).data)||{}, need=!!(got[k]||(doc.rep&&doc.rep.q&&!doc.rep.atSrc));
      if(!need)continue; const g=got[k]||(got[k]={}); g.repDates=d.slice(0,6); st.dated=(st.dated||0)+1}}
    catch(e){st.first=st.first||'past calendar: '+e.message}}
  for(const k of order){
    if(Date.now()-t0>budgetMs){st.stopped='time';break}
    if(!us(k))continue; const g=got[k]||{}, mine=held.has(k)||watched.has(k), t=tk(k);
    const doc=(store.getDoc('research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_')).data)||{};
    const have=x=>had.has(k)&&g[x]!=null, needF=FHN.some(x=>!have(x)), needR=!have('rating'), needE=mine&&!g.rep&&!doc.rep, needT=mine&&g.target==null&&doc.target==null;
    if(!needF&&!needR&&!needE&&!needT)continue;
    if(!had.has(k)&&doc.fhAt&&Date.parse(iso)-Date.parse(doc.fhAt)<3*864e5&&!needE)continue;
    const x={}; let any=false;
    try{
      if(needF){const m=await fhMetrics(t,o); for(const n of [...FHN,'gm','om','cr','epsg'])if(g[n]==null&&m[n]!=null){x[n]=m[n]; any=true} if(any)st.figs++}
      if(needR){const r=await fhRecs(t,o); if(r){x.rating=r.rating; x.analysts=r.analysts; x.votes=r.votes; any=true; st.recs++}}
      if(needE){const h=await fhEarnings(t,o); const L=h.at(-1); if(L){x.rep={q:L.q,label:`Q${Math.ceil(+L.q.slice(5,7)/3)} ${L.q.slice(0,4)}`,ccy:'USD',eps:{a:L.a,e:L.e,s:L.s},hist:h,fin:[],init:true,src:'Finnhub'}; any=true; st.eps++}}
      if(needT){try{const tg=await fhTarget(t,o); if(tg){x.target=tg; any=true; st.target++}}catch(e){if(!e.plan)throw e}}
    }catch(e){st.fail++; st.first=st.first||`${k}: ${e.message}`; if(e.auth){st.stopped='key';break} if(st.fail>=12&&!st.filled){st.stopped='errors';break}}
    if(any){got[k]={...g,...x,fhAt:iso}; st.filled++}
  }
  log(`finnhub: ${st.filled} filled (figures ${st.figs}, analysts ${st.recs}, reports ${st.eps}, dates ${st.cal}, targets ${st.target})${st.stopped?', stopped: '+st.stopped:''}${st.first?' (first: '+st.first+')':''}`);
  return st;
}

// ---- 30.10: the share's move around each earnings release: from the close before the release's day to the close of the
// day after it (two sessions, so a release before the open and one after the close are both inside), from the days the
// SEC has (8-K item 2.02) and the share's daily closes (quotes/c_<key>, a year). The last eight; the average of their size.
// A fact about the past, said as one, never a forecast of the next one.
export function erxOf(repDates,ser,{today=new Date().toISOString().slice(0,10),max=8}={}){
  const D=ser&&Array.isArray(ser.d)?ser.d:[], C=ser&&Array.isArray(ser.c)?ser.c:[]; if(D.length<10)return null;
  const days=[...new Set((repDates||[]).filter(x=>x&&x.src==='8-K'&&/^\d{4}-\d\d-\d\d$/.test(x.date)&&x.date<today).map(x=>x.date))].sort().reverse();
  const moves=[];
  for(const r of days){let i0=-1, i1=-1; for(let i=0;i<D.length;i++){if(D[i]<r)i0=i; else if(D[i]>r){i1=i;break}}
    if(i0<0||i1<0||!(C[i0]>0)||!(C[i1]>0))continue; if((Date.parse(D[i1])-Date.parse(D[i0]))/864e5>6)continue;
    moves.push({d:r,pct:Math.round((C[i1]/C[i0]-1)*10000)/100}); if(moves.length>=max)break}
  if(moves.length<2)return null;
  const abs=moves.map(m=>Math.abs(m.pct));
  return {n:moves.length,avgAbs:Math.round(abs.reduce((a,b)=>a+b,0)/abs.length*100)/100,maxAbs:Math.max(...abs),up:moves.filter(m=>m.pct>0).length,moves,at:today};
}
export function erxPass(store,keys,{now=new Date()}={}){
  const today=now.toISOString().slice(0,10), L=store.getDoc('research/latest'), comp=L.exists&&L.data&&L.data.companies?{...L.data.companies}:null; let n=0, touched=false;
  for(const k of keys){const p=docKey(k), d=store.getDoc(p), doc=d.exists?d.data:null, c=comp&&comp[k];
    const dates=(c&&c.repDates)||(doc&&doc.repDates)||[]; if(!dates.length)continue;
    const ser=store.getDoc('quotes/c_'+String(k).replace(':','_')); const e=erxOf(dates,ser.exists?ser.data:null,{today}); if(!e)continue; n++;
    if(doc)store.setDoc(p,{...doc,erx:e},{silent:true});
    if(c){comp[k]={...c,erx:e}; touched=true}}
  if(touched)store.setDoc('research/latest',{...L.data,companies:comp});
  return n;
}
