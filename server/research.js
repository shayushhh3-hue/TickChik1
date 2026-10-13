// Analysts' views and company figures from Yahoo Finance (quoteSummary), the same source the prices come from.
// It is not an official API: Yahoo can change or refuse it at any time. When an update fails the last values stay,
// with their date, and the page says how old they are. Numbers in, numbers out: nothing here is advice.
import {tickerFor} from '../shared/quotes.js';

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MODS='financialData,defaultKeyStatistics,summaryDetail,calendarEvents,recommendationTrend,price';
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
    price:px!=null?r2(px*k):null,chg52:pc(ks['52WeekChange'])};
  if(tr)out.votes={buy:(val(tr.strongBuy)||0)+(val(tr.buy)||0),hold:val(tr.hold)||0,sell:(val(tr.sell)||0)+(val(tr.strongSell)||0)};
  return out;
}
// new values over the old ones; a figure Yahoo does not give keeps its last value (F-score, Z-score, ROIC come only
// from the old source). The second source of the old data (Investing.com) is not updated any more, so it goes.
function merge(old,neu){const o={...(old||{})}; for(const [k,v] of Object.entries(neu))if(v!=null)o[k]=v; delete o.inv; return o}
const docKey=k=>'research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_');
const tick=(k,map)=>k.startsWith('TLV:')?(map[k]||k.slice(4)+'.TA'):tickerFor(k,null,map);
const usable=k=>typeof k==='string'&&(/^[A-Z][A-Z.\-]{0,6}$/.test(k)||/^TLV:[A-Z0-9.]{1,10}$/.test(k))&&!/^TA\d+$/.test(k);

// the night's update: the holdings first (everybody's), then the watch lists and the research candidates, then the
// ranking list; at a calm pace, within a time budget, and stopping early when Yahoo refuses
export async function researchTask(store,{log=()=>{},fetch:f=globalThis.fetch,now=new Date(),budgetMs=20*60e3,pause=600}={}){
  const t0=Date.now(), iso=now.toISOString(), map=((store.getDoc('settings/main').data)||{}).symMap||{};
  const held=new Set(((store.getDoc('portfolio/main').data||{}).positions||[]).map(p=>p.sym)), watched=new Set(), W=store.listDocs('watch');
  for(const w of W)for(const s of ((w.data||{}).held||[]))held.add(s);
  for(const w of W)for(const k of ['marks','seen','syms'])for(const s of ((w.data||{})[k]||[]))watched.add(s);
  const C=store.getDoc('research/candidates'); for(const it of ((C.data||{}).items||[]))if(it&&it.sym)watched.add(it.sym);
  const uni=((store.getDoc('research/universe').data||{}).keys)||[];
  const order=[...new Set([...held].filter(usable).concat([...watched].filter(usable),uni.filter(usable)))];
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
  // write what arrived; whatever did not keeps its last values and date
  for(const [k,v] of Object.entries(got)){const p=docKey(k), old=store.getDoc(p).data; store.setDoc(p,{...merge(old,v),sym:k,source:SOURCE,updatedAt:iso},{silent:true})}
  const heldGot=[...held].filter(k=>got[k]);
  if(heldGot.length){const L=store.getDoc('research/latest').data||{}, comp={...(L.companies||{})};
    for(const k of heldGot)comp[k]={...merge(comp[k],got[k]),source:SOURCE,updatedAt:iso};
    store.setDoc('research/latest',{...L,companies:comp,source:SOURCE,updatedAt:iso})}
  const uniGot=uni.filter(k=>got[k]);
  if(uniGot.length){const Fd=store.getDoc('research/fit').data||{rows:{}}, rows={...(Fd.rows||{})};
    for(const k of uniGot){const v=got[k], o=rows[k]||[], nw=[v.pm,v.roe,v.de,null,v.pe,v.fpe,v.dy,v.revg,v.rating,v.target,v.analysts,v.next,v.beta]; rows[k]=nw.map((x,i)=>x!=null?x:(o[i]??null))}
    // the date says when the list was refreshed; when only part of it arrived, the older rows keep the earlier date
    store.setDoc('research/fit',{...Fd,rows,n:Object.keys(rows).length,source:SOURCE,refreshed:uniGot.length,updatedAt:uniGot.length>=uni.length*0.6?iso:(Fd.updatedAt||iso)})}
  const cand=(C.data||{}).items||[];
  if(cand.some(it=>it&&got[it.sym])){const items=cand.map(it=>{const v=it&&got[it.sym]; if(!v)return it; const o={...it}; for(const k of ['beta','de','dy','fpe','pe','pm','roe','price','chg52'])if(v[k]!=null)o[k]=v[k]; return o});
    store.setDoc('research/candidates',{...C.data,items,source:SOURCE,updatedAt:iso})}
  const st={at:iso,ok,none,fail,of:order.length,held:heldGot.length,stopped,first,seconds:Math.round((Date.now()-t0)/1000)};
  store.setMeta('researchStatus',JSON.stringify(st));
  log(`research: ${ok}/${order.length} updated, ${none} not covered, ${fail} failed${stopped?', stopped: '+stopped:''}${first?' (first: '+first+')':''}`);
  return st;
}
