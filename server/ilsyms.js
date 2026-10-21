// The Israeli securities for the search: the shares traded in Tel Aviv, the mutual and exchange-traded funds and the
// indices, with their Hebrew names, from the Tel Aviv Stock Exchange's own data service (TASE DataWise,
// https://datawise.tase.co.il, a free key from the exchange's DataHub: TASE_API_KEY). Kept in research/ilsyms, which
// every user may read (market data, nobody's holdings). Without the key the search still finds the Tel Aviv shares by
// their English names and symbols, the main indices, and a fund by its number (from Maya, the exchange's reports site).
import {timedFetch} from '../shared/quotes.js';
import {ilParts} from '../shared/market.js';

export const DW='https://datawise.tase.co.il/v1';
async function dw(path,{key,fetch:f,lang='he-IL'}){
  const r=await f(DW+path,{headers:{accept:'application/json',apikey:key,'accept-language':lang}});
  if(!r.ok)throw new Error('HTTP '+r.status); const t=await r.text(); if(/Request Rejected/i.test(t))throw new Error('rejected');
  return JSON.parse(t);
}
const res=(j,k)=>((j&&j[k]&&j[k].result)||[]);
// a security's type from the exchange's own table of types: shares, funds, bonds, options...
const kindOf=d=>{d=String(d||''); return /מני|share|stock/i.test(d)&&!/אופצי|option|warrant|כתב/i.test(d)?'stock':/סל|etf|קרן/i.test(d)?'fund':/אג"?ח|bond|מלווה|תעוד/i.test(d)?'bond':'other'};
export function ilBuild({sec=[],types=[],funds=[],indices=[]}){
  const T=new Map(types.map(t=>[String(t.securityFullTypeCode),t.securityTypeDesc||t.securityMainTypeDesc||'']));
  const stocks=[], seen=new Set();
  for(const s of sec){const sym=String(s.symbol||'').trim().toUpperCase(); if(!sym||seen.has(sym))continue; const k=kindOf(T.get(String(s.securityFullTypeCode)));
    if(k!=='stock')continue; seen.add(sym); stocks.push([sym,String(s.securityName||'').trim(),String(s.companyName||'').trim(),String(s.companySector||'').trim(),+s.securityId||0])}
  const F=funds.filter(f=>f&&f.fundId).map(f=>[String(f.fundId),String(f.fundName||f.fundLongName||'').trim(),String((f.classificationMajor||{}).value||''),String((f.classificationMain||{}).value||''),String(f.exposureProfile||'')]);
  const I=indices.filter(x=>x&&x.indexId).map(x=>[String(x.indexId),String(x.indexName||'').trim()]);
  return {stocks,funds:F,indices:I};
}
export async function ilSymsTask(store,{fetch:f=timedFetch,key=process.env.TASE_API_KEY,now=new Date(),log=()=>{}}={}){
  if(!key){log('israeli securities: no TASE_API_KEY, skipped');return false}
  const o={key,fetch:f}, errors=[]; let sec=[], day='';
  // the traded list of the last trading day: today once it exists, else the days before (a week back at most)
  for(let k=0;k<8&&!sec.length;k++){const p=ilParts(new Date(now.getTime()-k*864e5)); if(p.wd===6)continue;
    try{sec=res(await dw(`/basic-securities/trade-securities-list/${p.y}/${p.m}/${p.d}`,o),'tradeSecuritiesList'); if(sec.length)day=p.iso}catch(e){errors.push('securities '+p.iso+': '+e.message); if(/HTTP 40[13]/.test(e.message))break}}
  let types=[], funds=[], indices=[];
  try{types=res(await dw('/basic-securities/securities-types',o),'securitiesTypes')}catch(e){errors.push('types: '+e.message)}
  try{funds=res(await dw('/fund/fund-list?listingStatusId=1',o),'funds')}catch(e){errors.push('funds: '+e.message)}
  try{indices=res(await dw('/basic-indices/indices-list',o),'indicesList')}catch(e){errors.push('indices: '+e.message)}
  const B=ilBuild({sec,types,funds,indices});
  if(!B.stocks.length&&!B.funds.length){log('israeli securities: nothing came ('+errors.join(' | ')+')');
    const old=store.getDoc('research/ilsyms'); store.setDoc('research/ilsyms',{...(old.exists?old.data:{}),errors,triedAt:now.toISOString()},{silent:true}); return false}
  store.setDoc('research/ilsyms',{...B,day,updatedAt:now.toISOString(),source:'הבורסה לניירות ערך בתל אביב (TASE DataWise)',errors});
  log(`israeli securities: ${B.stocks.length} shares, ${B.funds.length} funds, ${B.indices.length} indices${errors.length?'; '+errors.join(' | '):''}`); return true;
}
let RUN=null;
export function ilSymsFresh(store,{fetch,maxAgeH=20}={}){
  if(!process.env.TASE_API_KEY)return Promise.resolve(false);
  const d=store.getDoc('research/ilsyms'), at=d.exists?(d.data.updatedAt||d.data.triedAt):null, age=at?(Date.now()-new Date(at))/36e5:1e9;
  if(age<maxAgeH)return Promise.resolve(false);
  if(!RUN)RUN=ilSymsTask(store,{fetch}).catch(()=>false).finally(()=>{setTimeout(()=>{RUN=null},60000).unref?.()});
  return RUN;
}
