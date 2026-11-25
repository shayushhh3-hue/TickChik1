// The Israeli securities for the search: the shares traded in Tel Aviv, the mutual and exchange-traded funds and the
// indices, with their Hebrew names, from the Tel Aviv Stock Exchange's own data service (TASE DataWise,
// https://datawise.tase.co.il, a free key from the exchange's DataHub: TASE_API_KEY). Kept in research/ilsyms, which
// every user may read (market data, nobody's holdings). Without the key the search still finds the Tel Aviv shares by
// their English names and symbols, the main indices, and a fund by its number (from Maya, the exchange's reports site).
import {timedFetch} from '../shared/quotes.js';
import {ilParts, setIlSched} from '../shared/market.js';

export const DW='https://datawise.tase.co.il/v1';
// 25.11: the exchange moved the indices to version 2 of the product (Indices - Basic 2.0.0): another address, and
// another shape of answer ({data:[{indexId,indexname}],meta}). A key registered to it is refused (403) at the old one.
export const DW2='https://datawise.tase.co.il/api/v2';
async function dw(path,{key,fetch:f,lang='he-IL',base=DW}){
  const r=await f(base+path,{headers:{accept:'application/json',apikey:key,'accept-language':lang}});
  if(!r.ok)throw new Error('HTTP '+r.status); const t=await r.text(); if(/Request Rejected/i.test(t))throw new Error('rejected');
  return JSON.parse(t);
}
const res=(j,k)=>((j&&j[k]&&j[k].result)||[]);
// the list of indices: version 2 first, and the older address for a key that was registered to version 1
async function ilIndices(o){
  let e2=null;
  try{const j=await dw('/basic-indices/indices-list',{...o,base:DW2}), a=(j&&j.data)||[]; if(a.length)return a.map(x=>({indexId:x.indexId,indexName:x.indexname||x.indexName||''}))}catch(e){e2=e}
  try{return res(await dw('/basic-indices/indices-list',o),'indicesList')}catch(e){throw new Error(e2?e2.message+' (v2), '+e.message+' (v1)':e.message)}
}
// a security's type from the exchange's own table of types: shares, funds, bonds, options...
const kindOf=d=>{d=String(d||''); return /מני|share|stock/i.test(d)&&!/אופצי|option|warrant|כתב/i.test(d)?'stock':/סל|etf|קרן/i.test(d)?'fund':/אג"?ח|bond|מלווה|תעוד/i.test(d)?'bond':'other'};
// 25.11: asked in Hebrew, the exchange gives a share's symbol in Hebrew too ("לאומי"), and the site keeps a share under
// its English one (LUMI: the search's list, a position "TLV:LUMI", the new listings). The same list asked in English
// (en) gives it, by the security's number; a share with no English symbol is left out (the search would offer a
// security nothing else on the site knows)
const LAT=/^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
export function ilBuild({sec=[],en=[],types=[],funds=[],indices=[]}){
  const T=new Map(types.map(t=>[String(t.securityFullTypeCode),t.securityTypeDesc||t.securityMainTypeDesc||'']));
  const EN=new Map(en.map(s=>[+s.securityId,String(s.symbol||'').trim().toUpperCase()]));
  const stocks=[], seen=new Set();
  for(const s of sec){const own=String(s.symbol||'').trim().toUpperCase(), e=EN.get(+s.securityId)||'', sym=LAT.test(e)?e:LAT.test(own)?own:''; if(!sym||seen.has(sym))continue; const k=kindOf(T.get(String(s.securityFullTypeCode)));
    if(k!=='stock')continue; seen.add(sym); stocks.push([sym,String(s.securityName||'').trim(),String(s.companyName||'').trim(),String(s.companySector||'').trim(),+s.securityId||0])}
  const F=funds.filter(f=>f&&f.fundId).map(f=>[String(f.fundId),String(f.fundName||f.fundLongName||'').trim(),String((f.classificationMajor||{}).value||''),String((f.classificationMain||{}).value||''),String(f.exposureProfile||'')]);
  const I=indices.filter(x=>x&&x.indexId).map(x=>[String(x.indexId),String(x.indexName||'').trim()]);
  return {stocks,funds:F,indices:I};
}
// ---- 25.11 (the owner): two more of the exchange's free lists, with the same key ----
// the shape of an answer, kept beside what was read from it: the exchange's documents were read, its answers were not
// seen before the key was saved, and a list that comes back empty must be told from a list the site misread
// the list in an answer: under the name the exchange's document gives it, or under the one name the answer does have.
// The answers do not carry the documents' names (seen on 25.11 with the real key: "tase-schedules" where the document
// says "taseSchedulesResponse", "illiquidMaintenanceAndSuspensionList" where it says "tradingListCode")
const resAny=(j,k)=>{if(j&&j[k]&&Array.isArray(j[k].result))return j[k].result; for(const v of Object.values(j&&typeof j==='object'&&!Array.isArray(j)?j:{})){if(v&&Array.isArray(v.result))return v.result; if(Array.isArray(v))return v} return Array.isArray(j)?j:[]};
const pick=(r,...ks)=>{for(const k of ks)if(r&&r[k]!=null&&r[k]!=='')return r[k]; return undefined};
const shapeOf=(j,k)=>{const a=resAny(j,k); return {keys:j&&typeof j==='object'?Object.keys(j).slice(0,6):[],n:a.length,row:a[0]&&typeof a[0]==='object'?Object.keys(a[0]).slice(0,12):[],first:a[0]&&typeof a[0]==='object'?JSON.stringify(a[0]).slice(0,300):''}};
const SRC='הבורסה לניירות ערך בתל אביב (TASE DataWise)';
// the exchange's lists for the next trading day: suspended from trading, the maintenance list (a company that does not
// meet the exchange's maintenance rules), low liquidity. The kind is read from the exchange's own name of each list
export const ilListKind=d=>{d=String(d||''); return /השעי|suspen/i.test(d)?'susp':/שימור|mainten|preserv/i.test(d)?'maint':/סחירות|liquid/i.test(d)?'illiq':'other'};
export async function ilListsTask(store,{fetch:f=timedFetch,key=process.env.TASE_API_KEY,now=new Date(),log=()=>{}}={}){
  if(!key)return false; const o={key,fetch:f}, errors=[], shape={}; let rows=null, codes=[];
  try{const j=await dw('/basic-securities/illiquid-maintenance-suspension-list',o); rows=resAny(j,'illiquidMaintenanceAndSuspensionList'); shape.lists=shapeOf(j,'illiquidMaintenanceAndSuspensionList')}catch(e){errors.push('lists: '+e.message)}
  try{const j=await dw('/basic-securities/trading-code-list',o); codes=resAny(j,'tradingListCode'); shape.codes=shapeOf(j,'tradingListCode')}catch(e){errors.push('list codes: '+e.message)}
  const old=store.getDoc('research/illists');
  if(rows===null){store.setDoc('research/illists',{...(old.exists?old.data:{}),errors,triedAt:now.toISOString()},{silent:true}); log('israeli lists: nothing came ('+errors.join(' | ')+')'); return false}
  const types={}; for(const c of codes)if(c&&c.listTypeId!=null)types[String(c.listTypeId)]={desc:String(c.listTypeDesc||'').trim(),kind:ilListKind(c.listTypeDesc)};
  // the names of the lists are kept from the last time they came (a day they are refused does not make every list "other")
  const T=Object.keys(types).length?types:(old.exists&&old.data&&old.data.types)||{};
  const items=rows.map(r=>[+pick(r,'securityID','securityId','securityid')||0,String(pick(r,'listTypeId','listTypeID','listType')??''),String(pick(r,'statusDate','StatusDate','date')||'').slice(0,10)]).filter(r=>r[0]>0).sort((a,b)=>a[0]-b[0]||(a[1]<b[1]?-1:1));
  store.setDoc('research/illists',{items,types:T,updatedAt:now.toISOString(),source:SRC,errors,shape});
  log(`israeli lists: ${items.length} securities on the exchange's suspension, maintenance and low-liquidity lists${errors.length?'; '+errors.join(' | '):''}`); return true;
}
// a held Tel Aviv security's number at the exchange: a position kept under the number itself ("1159094", a fund traded
// on the exchange), or under its symbol ("TLV:LUMI", or "LUMI" in shekels) through the exchange's list
export function ilIdOf(IL){
  const bySym=new Map(); for(const r of ((IL&&IL.stocks)||[]))if(Array.isArray(r)&&+r[4])bySym.set(String(r[0]).toUpperCase(),+r[4]);
  return (sym,ccy)=>{const s=String(sym||'').trim().toUpperCase(), m=/^(?:TLV:)?(\d{5,9})$/.exec(s); if(m)return +m[1];
    if(/^TLV:[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(s))return bySym.get(s.slice(4))||0; if(ccy==='ILS'&&LAT.test(s))return bySym.get(s)||0; return 0};
}
// the exchange's calendar of trading days and holidays, from two weeks back to about a year ahead: only the days that
// are not a regular trading day are kept ({iso:[the exchange's type of day, 1 when it trades]}), with the dates the
// calendar reaches (from, to) and the exchange's names of the types of day
const isoAdd=(now,k)=>ilParts(new Date(now.getTime()+k*864e5)).iso;
export async function ilSchedTask(store,{fetch:f=timedFetch,key=process.env.TASE_API_KEY,now=new Date(),log=()=>{}}={}){
  if(!key)return false; const o={key,fetch:f}, errors=[], shape={}; let rows=[], names=[];
  try{const j=await dw(`/tase-schedules?fromDate=${isoAdd(now,-14)}&toDate=${isoAdd(now,400)}`,o); rows=resAny(j,'tase-schedules'); shape.days=shapeOf(j,'tase-schedules')}catch(e){errors.push('schedule: '+e.message)}
  try{const j=await dw('/tase-schedules/day-types',o); names=resAny(j,'day-types'); shape.types=shapeOf(j,'day-types')}catch(e){errors.push('day types: '+e.message)}
  const old=store.getDoc('research/ilsched'), days={}; let from='', to='', n=0;
  for(const r of rows){const d=String(pick(r,'date','Date','tradeDate','scheduleDate')||'').slice(0,10); if(!/^\d{4}-\d\d-\d\d$/.test(d))continue; n++; if(!from||d<from)from=d; if(!to||d>to)to=d;
    const tr=pick(r,'isTradeDate','isTradeDay','isTradingDay','isTrade'), open=tr===true||tr===1||/^(true|1|y|yes)$/i.test(String(tr)), t=String(pick(r,'dayTypeId','dayTypeID','dayType','dayTypeCode')||''); if(!(open&&t==='T'))days[d]=[t,open?1:0]}
  if(!n){store.setDoc('research/ilsched',{...(old.exists?old.data:{}),errors,triedAt:now.toISOString(),shape},{silent:true}); log('israeli calendar: nothing came ('+errors.join(' | ')+')'); return false}
  const types={}; for(const t of names){const id=pick(t,'dayTypeId','dayTypeID','dayType','dayTypeCode'); if(id!=null)types[String(id)]=String(pick(t,'dayTypeName','dayTypeDesc','dayTypeDescription','name','desc')||'').trim()}
  const doc={days,types:Object.keys(types).length?types:(old.exists&&old.data&&old.data.types)||{},from,to,updatedAt:now.toISOString(),source:SRC,errors,shape};
  store.setDoc('research/ilsched',doc); setIlSched(doc);
  log(`israeli calendar: ${n} days from ${from} to ${to}, ${Object.values(days).filter(x=>!x[1]).length} without trading${errors.length?'; '+errors.join(' | '):''}`); return true;
}
// the calendar kept from the last run, for the server's own clock of the Tel Aviv market (at the start of the server)
export function ilSchedLoad(store){try{const d=store.getDoc('research/ilsched'); setIlSched(d.exists?d.data:null); return !!(d.exists&&d.data&&d.data.from)}catch(e){return false}}

export async function ilSymsTask(store,{fetch:f=timedFetch,key=process.env.TASE_API_KEY,now=new Date(),log=()=>{}}={}){
  if(!key){log('israeli securities: no TASE_API_KEY, skipped');return false}
  const o={key,fetch:f}, errors=[]; let sec=[], en=[], day='';
  // the traded list of the last trading day: today once it exists, else the days before (a week back at most)
  for(let k=0;k<8&&!sec.length;k++){const p=ilParts(new Date(now.getTime()-k*864e5)); if(p.wd===6)continue; const path=`/basic-securities/trade-securities-list/${p.y}/${p.m}/${p.d}`;
    try{sec=res(await dw(path,o),'tradeSecuritiesList'); if(sec.length){day=p.iso; try{en=res(await dw(path,{...o,lang:'en-US'}),'tradeSecuritiesList')}catch(e){errors.push('symbols: '+e.message)}}}catch(e){errors.push('securities '+p.iso+': '+e.message); if(/HTTP 40[13]/.test(e.message))break}}
  // the two lists beside the search's: each keeps its own document and says its own line; neither stops the other
  try{await ilListsTask(store,{fetch:f,key,now,log})}catch(e){log('israeli lists: '+(e&&e.message||e))}
  try{await ilSchedTask(store,{fetch:f,key,now,log})}catch(e){log('israeli calendar: '+(e&&e.message||e))}
  let types=[], funds=[], indices=[];
  try{types=res(await dw('/basic-securities/securities-types',o),'securitiesTypes')}catch(e){errors.push('types: '+e.message)}
  try{funds=res(await dw('/fund/fund-list?listingStatusId=1',o),'funds')}catch(e){errors.push('funds: '+e.message)}
  try{indices=await ilIndices(o)}catch(e){errors.push('indices: '+e.message)}
  const B=ilBuild({sec,en,types,funds,indices});
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
