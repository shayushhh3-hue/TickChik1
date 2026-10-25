// A second source for the company figures the ranking uses, for when Yahoo's company data (quoteSummary) does not answer
// or leaves a figure out:
//  - Finnhub's basic financials, when the owner sets FINNHUB_API_KEY;
//  - the companies' own reports, as the SEC publishes them (EDGAR "company facts": free, no key, US companies that file
//    10-K/10-Q): net margin, return on equity, debt to equity, revenue growth, earnings and dividends per share over the
//    last twelve months, and from them the price-to-earnings ratio and the dividend yield at the last close;
//  - the beta (how much the share moves with the market) from two years of daily closes against the index (Yahoo's
//    chart service, the one the prices already come from; the S&P 500 for a US share, TA-125 for Tel Aviv).
// Numbers in, numbers out: nothing here is advice. Every figure says where it came from (src) and when (secAt).
import {yahooBars} from '../shared/quotes.js';

const DAY=864e5;
const r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
const days=(a,b)=>(Date.parse(b)-Date.parse(a))/DAY;
const byEnd=(a,b)=>a.end<b.end?-1:a.end>b.end?1:(a.filed||'')<(b.filed||'')?-1:1;
const timed=(f,ms)=>(u,o={})=>f(u,{...o,signal:o.signal||AbortSignal.timeout(ms)});
// the SEC asks every caller to say who it is, with a way to reach them
export const secUA=()=>process.env.SEC_USER_AGENT||`TickChik research ${process.env.OWNER_EMAIL||'owner@tickchik.app'}`;

// ---- the reported facts ----
// one concept's values in one unit, from the annual and quarterly reports, the latest filing of each period
export function factRows(facts,names,unit='USD'){
  const G=(facts&&facts.facts&&facts.facts['us-gaap'])||{};
  let best=[];
  for(const n of names){const u=G[n]&&G[n].units&&G[n].units[unit]; if(!u)continue; const m=new Map();
    for(const x of u){if(x==null||x.val==null||!x.end||!/^10-[KQ]/.test(x.form||''))continue; const k=(x.start||'')+'|'+x.end, o=m.get(k); if(!o||(x.filed||'')>(o.filed||''))m.set(k,x)}
    const rows=[...m.values()].sort(byEnd);
    // the concept reported most recently wins (a company moves from "Revenues" to another name, and back)
    if(rows.length&&(!best.length||rows.at(-1).end>best.at(-1).end))best=rows}
  return best;
}
// the last twelve months of a flow (revenue, profit, per-share amounts): the last full year, plus this year so far, minus
// the same part of the year before; and the change against the year before (the same months)
export function ttmOf(rows){
  const F=rows.filter(x=>x.start), ann=F.filter(x=>{const d=days(x.start,x.end);return d>=350&&d<=380}).sort(byEnd), A=ann.at(-1);
  if(!A)return null;
  const A0=ann.filter(x=>Math.abs(days(x.end,A.end)-365)<=15).at(-1)||null;
  const ytd=F.filter(x=>x.start>A.end&&days(A.end,x.start)<=12&&x.end>x.start).sort(byEnd).at(-1)||null;
  if(ytd){const pd=days(ytd.start,ytd.end), prior=F.filter(x=>Math.abs(days(x.end,ytd.end)-365)<=15&&Math.abs(days(x.start,x.end)-pd)<=15).at(-1);
    if(prior)return {v:A.val+ytd.val-prior.val,end:ytd.end,g:prior.val>0?ytd.val/prior.val-1:null}}
  return {v:A.val,end:A.end,g:A0&&A0.val>0?A.val/A0.val-1:null};
}
// a balance-sheet value (equity, debt) at a date, or the latest
const at=(rows,end)=>{const I=rows.filter(x=>!x.start); if(!I.length)return null; if(!end)return I.at(-1); return I.filter(x=>Math.abs(days(x.end,end))<=7).at(-1)||null};

const REV=['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet','RevenueFromContractWithCustomerIncludingAssessedTax','RevenuesNetOfInterestExpense'];
// the figures from a company's facts, at a price (the last close); the same names the Yahoo figures use: percents for
// margins, returns, growth and yield, a plain ratio for debt to equity
export function secFigures(facts,price){
  const rev=ttmOf(factRows(facts,REV)), ni=ttmOf(factRows(facts,['NetIncomeLoss','ProfitLoss','NetIncomeLossAvailableToCommonStockholdersBasic']));
  const eps=ttmOf(factRows(facts,['EarningsPerShareDiluted','EarningsPerShareBasic'],'USD/shares'));
  const dps=ttmOf(factRows(facts,['CommonStockDividendsPerShareDeclared','CommonStockDividendsPerShareCashPaid'],'USD/shares'));
  const eqR=factRows(facts,['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']), eq=at(eqR);
  const out={pm:null,roe:null,de:null,revg:null,pe:null,dy:null,eps:null,asOf:null};
  if(rev&&ni&&rev.v>0)out.pm=r2(ni.v/rev.v*100);
  if(ni&&eq&&eq.val>0)out.roe=r2(ni.v/eq.val*100);
  if(rev&&rev.g!=null)out.revg=r2(rev.g*100);
  if(eq&&eq.val>0){const d=eq.end, v=n=>{const x=at(factRows(facts,[n]),d); return x?x.val:null};
    const lt=v('LongTermDebt')??((v('LongTermDebtNoncurrent')!=null||v('LongTermDebtCurrent')!=null)?(v('LongTermDebtNoncurrent')||0)+(v('LongTermDebtCurrent')||0):null);
    const st=[v('ShortTermBorrowings'),v('CommercialPaper'),lt==null?v('DebtCurrent'):null].filter(x=>x!=null);
    if(lt!=null||st.length)out.de=r2(((lt||0)+st.reduce((t,x)=>t+x,0))/eq.val)}
  if(eps){out.eps=r2(eps.v); if(price>0&&eps.v)out.pe=r2(price/eps.v)}
  if(dps&&price>0&&dps.v>=0)out.dy=r2(dps.v/price*100);
  out.asOf=[rev&&rev.end,ni&&ni.end,eq&&eq.end].filter(Boolean).sort().at(-1)||null;
  return out;
}

// ---- the beta: weekly returns (every fifth close) of the share against the index, over their common days ----
export function betaOf(bars,idx){
  const I=new Map(idx.map(b=>[b.d,b.c])), C=bars.filter(b=>I.has(b.d));
  const w=[]; for(let i=C.length-1;i>=5;i-=5)w.push([C[i].c/C[i-5].c-1,I.get(C[i].d)/I.get(C[i-5].d)-1]);
  if(w.length<26)return null;
  const n=w.length, ma=w.reduce((t,x)=>t+x[0],0)/n, mb=w.reduce((t,x)=>t+x[1],0)/n; let cv=0,vb=0;
  for(const [a,b] of w){cv+=(a-ma)*(b-mb); vb+=(b-mb)**2}
  return vb>0?r2(cv/vb):null;
}

// ---- Finnhub's basic financials (with a key) ----
export function finnhubFigures(j){
  const m=(j&&j.metric)||{}, n=x=>x!=null&&isFinite(+x)?r2(+x):null;
  return {pm:n(m.netProfitMarginTTM),roe:n(m.roeTTM),de:n(m['totalDebt/totalEquityQuarterly']??m['totalDebt/totalEquityAnnual']),
    revg:n(m.revenueGrowthQuarterlyYoy??m.revenueGrowthTTMYoy),pe:n(m.peTTM??m.peBasicExclExtraTTM),dy:n(m.dividendYieldIndicatedAnnual??m.currentDividendYieldTTM),beta:n(m.beta)};
}

// ---- fetching ----
let CIKS=null, CIKS_AT=0;
export async function secCiks(store,{fetch:f=globalThis.fetch,now=Date.now()}={}){
  if(CIKS&&now-CIKS_AT<7*DAY)return CIKS;
  const d=store&&store.getDoc('research/secmap').data;
  if(d&&d.map&&now-Date.parse(d.updatedAt||0)<7*DAY){CIKS=d.map; CIKS_AT=now; return CIKS}
  const r=await timed(f,20000)('https://www.sec.gov/files/company_tickers.json',{headers:{'user-agent':secUA(),accept:'application/json'}});
  if(!r.ok)throw new Error('SEC tickers HTTP '+r.status);
  const j=await r.json(), map={}; for(const x of Object.values(j||{}))if(x&&x.ticker&&x.cik_str)map[String(x.ticker).toUpperCase()]=+x.cik_str;
  if(!Object.keys(map).length)throw new Error('SEC tickers: empty');
  CIKS=map; CIKS_AT=now; if(store)store.setDoc('research/secmap',{map,updatedAt:new Date(now).toISOString()},{silent:true});
  return map;
}
export async function secFacts(cik,{fetch:f=globalThis.fetch}={}){
  const r=await timed(f,20000)(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10,'0')}.json`,{headers:{'user-agent':secUA(),accept:'application/json'}});
  if(r.status===404)return null; if(!r.ok)throw new Error('SEC facts HTTP '+r.status);
  return r.json();
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const NEED=['pm','roe','de','revg','pe','dy','beta'];
// fill what is missing in `got` (the night's Yahoo figures, by key) for the keys given; returns how many were filled
export async function fillFundamentals(store,keys,got,{fetch:f=globalThis.fetch,tick=k=>k,log=()=>{},budgetMs=10*60e3,pause=150,now=new Date()}={}){
  const t0=Date.now(), iso=now.toISOString(), key=process.env.FINNHUB_API_KEY;
  const st={tried:0,filled:0,sec:0,finnhub:0,beta:0,fail:0,first:null,stopped:null};
  let ciks=null, idx={};
  const index=async t=>idx[t]=idx[t]||await yahooBars(t,{fetch:f,range:'2y'}).catch(()=>[]);
  for(const k of keys){
    if(Date.now()-t0>budgetMs){st.stopped='time';break}
    const g=got[k]||{}, miss=NEED.filter(x=>g[x]==null); if(!miss.length)continue;
    const doc=(store.getDoc('research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_')).data)||{};
    if(!got[k]&&doc.secAt&&Date.parse(iso)-Date.parse(doc.secAt)<6*DAY)continue;   // filled this week; the reports change each quarter
    st.tried++; const tl=k.startsWith('TLV:'), t=tick(k), o={}; let src=[];
    try{
      const bars=await yahooBars(t,{fetch:f,range:'2y'}).catch(()=>[]), px=bars.length?bars.at(-1).c:(g.price||null);
      if(miss.includes('beta')&&bars.length){const b=betaOf(bars,await index(tl?'^TA125.TA':'^GSPC')); if(b!=null){o.beta=b; st.beta++; src.push('beta')}}
      if(!tl&&key){try{const r=await timed(f,12000)(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(t.replace(/-/g,'.'))}&metric=all&token=${encodeURIComponent(key)}`,{headers:{accept:'application/json'}});
        if(r.ok){const x=finnhubFigures(await r.json()); let any=false; for(const n of NEED)if(g[n]==null&&o[n]==null&&x[n]!=null){o[n]=x[n]; any=true} if(any){st.finnhub++; src.push('Finnhub')}}}catch(e){}}
      if(!tl&&['pm','roe','de','revg','pe','dy'].some(n=>g[n]==null&&o[n]==null)){
        ciks=ciks||await secCiks(store,{fetch:f});
        const cik=ciks[t.toUpperCase()]||ciks[t.toUpperCase().replace(/\./g,'-')]||ciks[k.toUpperCase()];
        if(cik){const facts=await secFacts(cik,{fetch:f}); if(facts){const x=secFigures(facts,px); let any=false;
          for(const n of ['pm','roe','de','revg','pe','dy'])if(g[n]==null&&o[n]==null&&x[n]!=null){o[n]=x[n]; any=true}
          if(any){st.sec++; src.push('SEC'); o.secAsOf=x.asOf}}}
        await sleep(pause)}
      if(Object.keys(o).length){if(px>0&&g.price==null)o.price=r2(px); got[k]={...g,...o,src2:src.join(', '),secAt:iso}; st.filled++}
    }catch(e){st.fail++; st.first=st.first||`${k}: ${e.message}`; if(st.fail>=15&&!st.filled){st.stopped='errors';break}}
  }
  log(`fundamentals: ${st.filled}/${st.tried} filled (SEC ${st.sec}, Finnhub ${st.finnhub}, beta ${st.beta})${st.stopped?', stopped: '+st.stopped:''}${st.first?' (first: '+st.first+')':''}`);
  return st;
}
