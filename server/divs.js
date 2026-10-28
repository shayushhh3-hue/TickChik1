// 28.10: the dividends ahead, for the calendar ("מתי אני מקבל דיבידנד"): for each US security held or followed,
//  - the dividends a company has declared, with their ex-dividend and payment days and amounts, from Nasdaq's dividend
//    history (the same service the second price source is: api.nasdaq.com), which lists a declared one before it is paid;
//  - its past dividends from Yahoo's chart service (the one the prices come from), when Nasdaq does not answer;
//  - and from the rhythm of the past ones (every three months, every month, twice a year, once a year), the next ones
//    in the coming year, said to be estimated, with the usual gap between the ex-dividend day and the payment.
// Facts from the exchanges' services and a plain estimate from them; nothing here is advice.
const DAY=864e5;
const NQ_H={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',accept:'application/json, text/plain, */*',origin:'https://www.nasdaq.com',referer:'https://www.nasdaq.com/','accept-language':'en-US,en;q=0.9'};
const YH=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
const timed=(f,ms)=>(u,o={})=>f(u,{...o,signal:o.signal||AbortSignal.timeout(ms)});
const iso=t=>new Date(t).toISOString().slice(0,10);
const add=(d,k)=>iso(Date.parse(d+'T12:00:00Z')+k*DAY);
const gap=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/DAY);
const usDay=s=>{const m=String(s||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:null};
const num=v=>{const n=parseFloat(String(v==null?'':v).replace(/[$,\s]/g,'')); return isFinite(n)?n:null};

// Nasdaq's dividend history: newest first, {ex, pay, amt, decl}
export function nasdaqDivParse(j){
  const rows=(j&&j.data&&j.data.dividends&&j.data.dividends.rows)||[];
  return rows.map(r=>({ex:usDay(r.exOrEffDate),pay:usDay(r.paymentDate),amt:num(r.amount),decl:usDay(r.declarationDate),type:r.type||null}))
    .filter(r=>r.ex&&!(r.type&&!/cash/i.test(r.type))).sort((a,b)=>a.ex<b.ex?1:-1);
}
export async function nasdaqDivs(t,{fetch:f=globalThis.fetch}={}){
  const r=await timed(f,12000)(`https://api.nasdaq.com/api/quote/${encodeURIComponent(String(t).replace(/-/g,'.'))}/dividends?assetclass=stocks`,{headers:NQ_H});
  if(!r.ok)throw new Error('Nasdaq dividends HTTP '+r.status);
  return nasdaqDivParse(await r.json());
}
// Yahoo's chart with its dividend events: {ex, amt}, newest first
export function yahooDivParse(j){
  const res=j&&j.chart&&j.chart.result&&j.chart.result[0], ev=res&&res.events&&res.events.dividends; if(!ev)return [];
  return Object.values(ev).filter(x=>x&&x.date&&x.amount>0).map(x=>({ex:iso(x.date*1000),pay:null,amt:+x.amount})).sort((a,b)=>a.ex<b.ex?1:-1);
}
export async function yahooDivs(t,{fetch:f=globalThis.fetch}={}){
  for(const h of YH){try{const r=await timed(f,12000)(`${h}/v8/finance/chart/${encodeURIComponent(t)}?range=3y&interval=1mo&events=div`,{headers:{'user-agent':'Mozilla/5.0 (compatible; tik-chik/1.0)',accept:'application/json'}});
    if(!r.ok)continue; return yahooDivParse(await r.json())}catch(e){}}
  return null;   // no answer at all (not "no dividends")
}
// the rhythm of the past dividends and the next ones in the coming year (estimated); the declared ones as they are
export function divPlan(hist,{now=new Date(),months=12}={}){
  const today=iso(now), H=(hist||[]).filter(x=>x&&x.ex).sort((a,b)=>a.ex<b.ex?1:-1);
  if(!H.length)return null;
  const declared=H.filter(x=>x.ex>=today||(x.pay&&x.pay>=today)).map(x=>({ex:x.ex,pay:x.pay||null,amt:x.amt,est:false}));
  const past=H.filter(x=>x.ex<today);
  // the usual gap between the dividends (median of the last few), named
  const G=[]; for(let i=0;i+1<Math.min(past.length,9);i++)G.push(gap(past[i+1].ex,past[i].ex)); G.sort((a,b)=>a-b);
  const med=G.length?G[Math.floor(G.length/2)]:null;
  const freq=med==null?null:med<=45?'monthly':med<=120?'quarterly':med<=240?'semi':med<=420?'yearly':null;
  const step={monthly:med,quarterly:med,semi:med,yearly:med}[freq]||null;
  const PG=H.filter(x=>x.pay).map(x=>gap(x.ex,x.pay)).filter(x=>x>=0&&x<=60).sort((a,b)=>a-b), payGap=PG.length?PG[Math.floor(PG.length/2)]:null;
  const last=H[0], out=[...declared], end=add(today,Math.round(months*30.4));
  // a company that stopped (nothing for well over its rhythm) is not projected
  if(step&&last&&gap(last.ex,today)<=step*1.6){let d=last.ex, guard=0;
    while(guard++<40){d=add(d,step); if(d>end)break; if(d<today)continue; if(out.some(x=>Math.abs(gap(x.ex,d))<step*0.5))continue;
      out.push({ex:d,pay:payGap!=null?add(d,payGap):null,amt:last.amt||null,est:true})}}
  return {next:out.sort((a,b)=>a.ex<b.ex?-1:1),freq,last:last?{ex:last.ex,pay:last.pay||null,amt:last.amt}:null};
}
