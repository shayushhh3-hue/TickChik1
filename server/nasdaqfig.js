// 5.11: when Yahoo refuses the server (its company data answers 429, "no crumb"), the basic figures of a US share come
// from Nasdaq's own quote service (the same one that is the second price source and the dividends' history): the price
// to earnings, the forward one, the dividend's yield, the analysts' one-year target and the next report's date. Only
// what is still missing is filled, and the share says where it came from (nqAt). Held shares first, then the followed.
const NQ_H={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',accept:'application/json, text/plain, */*',origin:'https://www.nasdaq.com',referer:'https://www.nasdaq.com/'};
const num=v=>{if(v==null)return null; const s=String(typeof v==='object'?v.value:v).replace(/[$,%\s]/g,''); if(!s||/^(N\/A|NA|--|-)$/i.test(s))return null; const n=+s; return Number.isFinite(n)?n:null};
const r2=x=>x==null?null:Math.round(x*100)/100;
export function nasdaqSummaryParse(j){const d=j&&j.data&&j.data.summaryData; if(!d)return null;
  const out={pe:r2(num(d.PERatio)),fpe:r2(num(d.ForwardPE1Yr)),dy:r2(num(d.Yield)),target:r2(num(d.OneYrTarget))};
  return Object.values(out).some(v=>v!=null)?out:null}
const MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
export function nasdaqEarnParse(j,now=new Date()){const t=String(j&&j.data&&j.data.announcement||''); const m=t.match(/([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/); if(!m||MON[m[1].toLowerCase()]==null)return null;
  const d=new Date(Date.UTC(+m[3],MON[m[1].toLowerCase()],+m[2])).toISOString().slice(0,10); return d>=now.toISOString().slice(0,10)?d:null}
const get=async(f,u)=>{const r=await f(u,{headers:NQ_H,signal:AbortSignal.timeout(12000)}); if(!r.ok)throw new Error('HTTP '+r.status); return r.json()};
export async function nasdaqPass(store,order,got,{fetch:f=globalThis.fetch,tick=k=>k,log=()=>{},now=new Date(),held=new Set(),watched=new Set(),max=80,budgetMs=6*60e3,pause=300}={}){
  const t0=Date.now(), st={tried:0,filled:0,dates:0,fail:0,first:null,stopped:null};
  const want=k=>{const v=got[k]; return !v||v.pe==null||v.dy==null||!v.next};
  const us=k=>/^[A-Z][A-Z.\-]{0,6}$/.test(k);
  const list=[...new Set([...order.filter(k=>held.has(k)),...order.filter(k=>watched.has(k)),...order])].filter(k=>us(k)&&want(k)).slice(0,max);
  for(const k of list){if(Date.now()-t0>budgetMs){st.stopped='time';break}
    const t=String(tick(k)).replace(/-/g,'.'); st.tried++;
    try{const S=nasdaqSummaryParse(await get(f,`https://api.nasdaq.com/api/quote/${encodeURIComponent(t)}/summary?assetclass=stocks`));
      let nx=null; try{nx=nasdaqEarnParse(await get(f,`https://api.nasdaq.com/api/analyst/${encodeURIComponent(t)}/earnings-date`),now)}catch(e){}
      if(!S&&!nx)continue; const v=got[k]=got[k]||{}; let n=0;
      for(const [a,b] of Object.entries(S||{}))if(v[a]==null&&b!=null){v[a]=b; n++}
      if(nx&&!v.next){v.next=nx; st.dates++; n++}
      if(n){v.nqAt=now.toISOString(); st.filled++}}
    catch(e){st.fail++; st.first=st.first||`${k}: ${e.message}`; if(st.fail>=8&&!st.filled){st.stopped='errors';break}}
    if(pause)await new Promise(r=>setTimeout(r,pause))}
  if(st.tried)log(`nasdaq figures: ${st.filled} filled, ${st.dates} report dates, ${st.fail} failed`); return st}
