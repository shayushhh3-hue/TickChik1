// The indices to compare the portfolio with: S&P 500 (in dollars, with the dollar rate to carry it to shekels) and
// Tel Aviv 125, daily for five years and weekly for the five before. Kept in research/bench (every user may read it: it
// is market data, nobody's holdings). The page puts each of the person's deposits, on its own day, into the index, and
// says what they would be worth today; nothing here knows anyone's portfolio.
import {timedFetch} from '../shared/quotes.js';

const UA='Mozilla/5.0 (compatible; tik-chik/1.0)';
const YH=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
export const BENCHES={spx:{t:'^GSPC',name:'S&P 500'},ta125:{t:'^TA125.TA',name:'ת״א 125'},fx:{t:'USDILS=X',name:'דולר/שקל'}};

export function chartParse(j){
  const res=j&&j.chart&&j.chart.result&&j.chart.result[0]; if(!res)return null;
  const off=+((res.meta||{}).gmtoffset)||0, ts=res.timestamp||[], cl=(((res.indicators||{}).quote||[{}])[0]||{}).close||[];
  const d=[],c=[]; ts.forEach((t,i)=>{const v=cl[i]; if(v!=null&&v>0){const day=new Date((t+off)*1000).toISOString().slice(0,10); if(d.length&&d[d.length-1]===day){c[c.length-1]=Math.round(v*1e4)/1e4}else{d.push(day);c.push(Math.round(v*1e4)/1e4)}}});
  return d.length?{d,c}:null;
}
async function chart(t,range,interval,f){
  let last=null;
  for(const h of YH){try{const r=await f(`${h}/v8/finance/chart/${encodeURIComponent(t)}?range=${range}&interval=${interval}&includePrePost=false`,{headers:{'user-agent':UA,accept:'application/json'}});
      if(!r.ok){last=new Error('HTTP '+r.status);continue} const s=chartParse(await r.json()); if(s)return s; last=new Error('no data')}catch(e){last=e}}
  throw last||new Error('no answer');
}
// weekly before the daily series starts, daily after
export const joinSeries=(w,d)=>{if(!w)return d; const i=w.d.findIndex(x=>x>=d.d[0]); const n=i<0?w.d.length:i; return {d:[...w.d.slice(0,n),...d.d],c:[...w.c.slice(0,n),...d.c]}};
export async function benchSeries({fetch:f=timedFetch}={}){
  const out={}, errors=[];
  for(const [k,b] of Object.entries(BENCHES)){
    try{const d=await chart(b.t,'5y','1d',f); let w=null; try{w=await chart(b.t,'10y','1wk',f)}catch(e){} out[k]=joinSeries(w,d)}
    catch(e){errors.push(k+': '+(e&&e.message||e))}
  }
  return {out,errors};
}
export async function benchTask(store,{fetch,log=()=>{}}={}){
  const {out,errors}=await benchSeries({fetch});
  if(!Object.keys(out).length){log('bench: no series'+(errors.length?' ('+errors.join(' | ')+')':''));return false}
  const old=store.getDoc('research/bench');
  store.setDoc('research/bench',{...(old.exists?old.data:{}),...out,names:{spx:BENCHES.spx.name,ta125:BENCHES.ta125.name},updatedAt:new Date().toISOString(),source:'Yahoo Finance',errors});
  log(`bench: ${Object.keys(out).map(k=>k+' '+out[k].d.length).join(', ')}${errors.length?'; failed: '+errors.join(' | '):''}`); return true;
}
// on a read: none yet, or older than a day, is fetched now (one run at a time)
let RUN=null;
export function benchFresh(store,{fetch,maxAgeH=20}={}){
  const d=store.getDoc('research/bench'), age=d.exists?(Date.now()-new Date(d.data.updatedAt||0))/36e5:1e9;
  if(age<maxAgeH)return Promise.resolve(false);
  if(!RUN)RUN=benchTask(store,{fetch}).catch(()=>false).finally(()=>{setTimeout(()=>{RUN=null},60000).unref?.()});
  return RUN;
}
