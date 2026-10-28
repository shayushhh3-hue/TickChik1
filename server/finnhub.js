// Finnhub (finnhub.io), when the owner sets FINNHUB_API_KEY in the server's environment (Railway → Variables). One paced
// client for everything the site asks of it, within the free plan's limit (60 calls a minute):
//  - the company figures: margins, returns, debt, growth, P/E, dividend yield, beta, the 52-week move (basic financials);
//  - the analysts: buy / hold / sell counts, month by month (recommendation trends), and the price target where the plan
//    allows it;
//  - the reports: the last quarters' earnings per share against the estimate, and the coming report dates with their
//    estimates for every US company at once (earnings calendar);
//  - the company's news (company news), the articles beside each security and the explanation of a new report;
//  - the price itself: shared/quotes.js asks Finnhub's quote first for a plain US ticker (real time while New York trades).
// Numbers and articles in, numbers and articles out: data, never instructions, and nothing here is advice.
const BASE='https://finnhub.io/api/v1';
const r2=x=>x==null||!isFinite(+x)?null:Math.round(+x*100)/100;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const fhKey=()=>process.env.FINNHUB_API_KEY||'';
export const fhSym=t=>String(t||'').replace(/-/g,'.');   // BRK-B (Yahoo) is BRK.B at Finnhub

// one call at a time, about one a second; a refusal for pace (429) waits and tries once more; a call the plan does not
// include (403) says so, and that endpoint is not asked again in this process
let NEXT=0; const OFF=new Set();
export async function fh(path,params={},{fetch:f=globalThis.fetch,key=fhKey(),gap=1050}={}){
  if(!key)throw Object.assign(new Error('no FINNHUB_API_KEY'),{nokey:true});
  const ep=path.split('?')[0]; if(OFF.has(ep))throw Object.assign(new Error('not in the plan: '+ep),{plan:true});
  const q=new URLSearchParams({...params,token:key}).toString();
  for(let i=0;i<2;i++){
    const w=NEXT-Date.now(); NEXT=Math.max(Date.now(),NEXT)+gap; if(w>0)await sleep(w);
    const r=await f(`${BASE}${path}?${q}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(r.status===429){await sleep(gap?5000:0);continue}
    if(r.status===401)throw Object.assign(new Error('Finnhub: the key was refused (401)'),{auth:true});
    if(r.status===403){OFF.add(ep); throw Object.assign(new Error('Finnhub: not in the plan ('+ep+')'),{plan:true})}
    if(!r.ok)throw new Error('Finnhub HTTP '+r.status);
    return r.json();
  }
  throw Object.assign(new Error('Finnhub: too many calls (429)'),{slow:true});
}
export const _resetFh=()=>{NEXT=0;OFF.clear()};

// ---- the figures (the same names the Yahoo figures use: percents for margins, returns, growth and yield) ----
export function fhFigures(j){
  const m=(j&&j.metric)||{}, n=x=>x!=null&&isFinite(+x)?r2(+x):null;
  return {pm:n(m.netProfitMarginTTM),roe:n(m.roeTTM),de:n(m['totalDebt/totalEquityQuarterly']??m['totalDebt/totalEquityAnnual']),
    revg:n(m.revenueGrowthQuarterlyYoy??m.revenueGrowthTTMYoy),epsg:n(m.epsGrowthQuarterlyYoy??m.epsGrowthTTMYoy),
    pe:n(m.peTTM??m.peBasicExclExtraTTM),dy:n(m.dividendYieldIndicatedAnnual??m.currentDividendYieldTTM),beta:n(m.beta),
    chg52:n(m['52WeekPriceReturnDaily']),gm:n(m.grossMarginTTM),om:n(m.operatingMarginTTM),cr:n(m.currentRatioQuarterly)};
}
// the analysts' latest month: the counts, the mean on Yahoo's 1 (strong buy) to 5 (strong sell) scale, and its name
const RATING=m=>m==null?null:m<=1.5?'Strong Buy':m<=2.5?'Buy':m<=3.5?'Hold':m<=4.5?'Sell':'Strong Sell';
export function fhRating(arr){
  const t=(Array.isArray(arr)?arr:[]).filter(x=>x&&x.period).sort((a,b)=>a.period<b.period?1:-1)[0]; if(!t)return null;
  const sb=+t.strongBuy||0,b=+t.buy||0,h=+t.hold||0,s=+t.sell||0,ss=+t.strongSell||0, n=sb+b+h+s+ss; if(!n)return null;
  const mean=(sb+2*b+3*h+4*s+5*ss)/n;
  return {rating:RATING(mean),analysts:n,votes:{buy:sb+b,hold:h,sell:s+ss},recAt:t.period};
}
// the last quarters: earnings per share against the estimate, oldest first (the shape research.js keeps as rep.hist)
export function fhEps(arr){
  return (Array.isArray(arr)?arr:[]).filter(x=>x&&x.period&&x.actual!=null).map(x=>({q:String(x.period).slice(0,10),a:r2(x.actual),e:r2(x.estimate),s:r2(x.surprisePercent)}))
    .sort((a,b)=>a.q<b.q?-1:1).slice(-4);
}
// the coming reports of every company in a range: {SYM:{date,eps,rev,hour}} (the first date per company)
export function fhCalendar(j){
  const o={}; for(const x of ((j&&j.earningsCalendar)||[])){if(!x||!x.symbol||!x.date)continue; const k=String(x.symbol).toUpperCase();
    if(!o[k]||x.date<o[k].date)o[k]={date:x.date,eps:r2(x.epsEstimate),rev:x.revenueEstimate!=null?+x.revenueEstimate:null,hour:x.hour||null}}
  return o;
}
// articles: the shape newsFor returns (title, publisher, link, time, related tickers)
export function fhNews(arr,n=8){
  return (Array.isArray(arr)?arr:[]).filter(x=>x&&x.headline&&/^https:\/\//.test(x.url||'')).sort((a,b)=>(b.datetime||0)-(a.datetime||0)).slice(0,n)
    .map(x=>({title:String(x.headline).slice(0,200),pub:String(x.source||'').slice(0,60),link:String(x.url).slice(0,500),at:x.datetime?new Date(x.datetime*1000).toISOString():null,
      tickers:String(x.related||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,6),sum:x.summary?String(x.summary).slice(0,400):null}));
}

// ---- calls ----
const day=d=>d.toISOString().slice(0,10);
export const fhMetrics=(t,o)=>fh('/stock/metric',{symbol:fhSym(t),metric:'all'},o).then(fhFigures);
export const fhRecs=(t,o)=>fh('/stock/recommendation',{symbol:fhSym(t)},o).then(fhRating);
export const fhEarnings=(t,o)=>fh('/stock/earnings',{symbol:fhSym(t)},o).then(fhEps);
export async function fhTarget(t,o){const j=await fh('/stock/price-target',{symbol:fhSym(t)},o); return j&&j.targetMean>0?r2(j.targetMean):null}
export async function fhCompanyNews(t,{now=new Date(),days=14,n=8,...o}={}){
  const j=await fh('/company-news',{symbol:fhSym(t),from:day(new Date(now.getTime()-days*864e5)),to:day(now)},o); return fhNews(j,n)}
export async function fhEarningsCal({now=new Date(),days=75,...o}={}){
  const j=await fh('/calendar/earnings',{from:day(now),to:day(new Date(now.getTime()+days*864e5))},o); return fhCalendar(j)}
// the reports that came out in the last `days`: {SYM:[{date,eps,est}]}, newest first (the real day a report was published,
// for a report the page first saw later than that)
export function fhPastCal(j){
  const o={}; for(const x of ((j&&j.earningsCalendar)||[])){if(!x||!x.symbol||!x.date||x.epsActual==null)continue; const k=String(x.symbol).toUpperCase();
    (o[k]=o[k]||[]).push({date:x.date,eps:r2(x.epsActual),est:r2(x.epsEstimate)})}
  for(const k in o)o[k].sort((a,b)=>a.date<b.date?1:-1);
  return o;
}
export async function fhPastEarnings({now=new Date(),days=120,...o}={}){
  const j=await fh('/calendar/earnings',{from:day(new Date(now.getTime()-days*864e5)),to:day(now)},o); return fhPastCal(j)}
