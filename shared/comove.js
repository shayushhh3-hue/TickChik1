// Co-movement, long-term correlation and month-end closes, from the close series the night fetches (quotes/c_<key>):
// numbers in, numbers out. The page shows them as "האם הפיזור אמיתי?", "צמדים שזזים יחד", "צמדים שמאזנים" and
// "אילו ניירות מטלטלים את התיק". Nothing here is advice.

// daily (or weekly) returns of one series, keyed by date
const rets=s=>{const o={}; for(let i=1;i<s.d.length;i++)if(s.c[i]>0&&s.c[i-1]>0)o[s.d[i]]=s.c[i]/s.c[i-1]-1; return o};
export const corr=(a,b)=>{const n=a.length; if(n<3)return 0; const ma=a.reduce((t,x)=>t+x,0)/n, mb=b.reduce((t,x)=>t+x,0)/n; let c=0,va=0,vb=0; for(let i=0;i<n;i++){c+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2} return va&&vb?c/Math.sqrt(va*vb):0};
const r3=x=>Math.round(x*1000)/1000;

// the common trading days of a set of series, the latest `days` of them
function aligned(R,keys,days){
  const common=keys.reduce((set,k)=>set?set.filter(d=>d in R[k]):Object.keys(R[k]),null)||[];
  return common.sort().slice(-days);
}

// groups of securities whose daily moves point the same way (correlation of daily returns >= min over the last `days`
// trading days), the pairs that move together and the pairs that move opposite, the independent ones, and the ones
// without data. `names` maps a key to its portfolio group (tech, fin, ...) for the group's name.
export function comoveOf(series,{days=60,min=0.7,sameDays=21,names={},groupNames={}}={}){
  const R={}; for(const k of Object.keys(series)){const s=series[k]; if(s&&s.d&&s.d.length>=days*0.6)R[k]=rets(s)}
  const keys=Object.keys(R).sort(), nodata=Object.keys(series).filter(k=>!R[k]).sort();
  const dates=aligned(R,keys,days);
  if(keys.length<2||dates.length<20)return {days:dates.length,from:dates[0]||null,to:dates[dates.length-1]||null,groups:[],pairs:[],opposite:[],solo:keys,nodata,whyPairs:{},pairRule:{min,n:dates.length,sig:0.28,pairs:0},n:keys.length};
  const V=Object.fromEntries(keys.map(k=>[k,dates.map(d=>R[k][d])]));
  const last=dates.slice(-sameDays), sameOf=ks=>{let s=0; for(const d of last){const sg=ks.map(k=>Math.sign(R[k][d])); if(sg.every(x=>x>0)||sg.every(x=>x<0))s++} return last.length?s/last.length:0};
  const sig=Math.round(2/Math.sqrt(dates.length)*100)/100;   // roughly the 5% line for a correlation of n returns
  const C={}, pairs=[], opposite=[];
  for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){const a=keys[i],b=keys[j],r=corr(V[a],V[b]); C[a+'|'+b]=r; C[b+'|'+a]=r;
    if(r>=min)pairs.push({a,b,r:r3(r),same:r3(sameOf([a,b]))}); else if(r<=-sig)opposite.push({a,b,r:r3(r),same:r3(sameOf([a,b]))})}
  pairs.sort((x,y)=>y.r-x.r); opposite.sort((x,y)=>x.r-y.r);
  // groups: greedy, from the strongest pair; a security joins a group when its correlation with every member is at least min
  const inG=new Set(), groups=[];
  for(const p of pairs){if(inG.has(p.a)||inG.has(p.b))continue; const g=[p.a,p.b]; inG.add(p.a); inG.add(p.b);
    for(const k of keys){if(inG.has(k))continue; if(g.every(m=>C[k+'|'+m]>=min)){g.push(k); inG.add(k)}}
    const gs=[...new Set(g.map(k=>names[k]).filter(Boolean))], nm=gs.length===1&&groupNames[gs[0]]?groupNames[gs[0]]:g.slice(0,3).join(', ')+(g.length>3?' ועוד':'');
    groups.push({name:nm,syms:g.sort(),same:r3(sameOf(g)),r:r3(Math.min(...g.flatMap((x,i)=>g.slice(i+1).map(y=>C[x+'|'+y]))))})}
  groups.sort((x,y)=>y.syms.length-x.syms.length||y.r-x.r);
  // independent: in no group, and no strong tie to anything
  const solo=keys.filter(k=>!inG.has(k)&&keys.every(o=>o===k||Math.abs(C[k+'|'+o])<0.5));
  return {days:dates.length,from:dates[0],to:dates[dates.length-1],groups,pairs,opposite,solo,nodata,whyPairs:{},pairRule:{min,n:dates.length,sig,pairs:pairs.length},n:keys.length};
}

// the last close in each month of a series, as {ym: close}
export function monthEnds(s){const o={}; if(!s||!s.d)return o; for(let i=0;i<s.d.length;i++)if(s.c[i]>0)o[s.d[i].slice(0,7)]=s.c[i]; return o}

// long-term: monthly returns from the weekly (five-year) series, the correlation of every pair over their common months
export function longtermOf(weekly,{minMonths=24}={}){
  const M={}; for(const k of Object.keys(weekly)){const me=monthEnds(weekly[k]); const ms=Object.keys(me).sort(); if(ms.length<minMonths+1)continue; const r={}; for(let i=1;i<ms.length;i++)r[ms[i]]=me[ms[i]]/me[ms[i-1]]-1; M[k]=r}
  const keys=Object.keys(M).sort(), pairs=[]; let from=null,to=null;
  for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){const a=keys[i],b=keys[j], ms=Object.keys(M[a]).filter(m=>m in M[b]).sort(); if(ms.length<minMonths)continue;
    if(!from||ms[0]<from)from=ms[0]; if(!to||ms[ms.length-1]>to)to=ms[ms.length-1];
    pairs.push({a,b,r:r3(corr(ms.map(m=>M[a][m]),ms.map(m=>M[b][m]))),n:ms.length})}
  pairs.sort((x,y)=>y.r-x.r);
  return {count:pairs.length,pairs,from:from?from+'-01':null,to:to?to+'-28':null,n:keys.length};
}

// month-end closes for the page's history/prices: the daily series for the last year, the weekly one before it (its last
// close inside each month), kept beside what the document already holds (a month saved from the day's prices, a
// security without a series)
export function monthlyCloses(series,prev={},{months=60,until=null}={}){
  const have={...(prev.px||{})}, allM=new Set(prev.months||[]);
  const cur=(until||new Date().toISOString()).slice(0,7);
  for(const k of Object.keys(series)){const s=series[k]; if(!s)continue; const me={...monthEnds(s.w||{d:[],c:[]}),...monthEnds(s)}; for(const m of Object.keys(me))if(m<cur)allM.add(m)}
  const list=[...allM].filter(m=>m<cur).sort().slice(-months), idx=Object.fromEntries(list.map((m,i)=>[m,i]));
  const px={}; for(const k of new Set([...Object.keys(have),...Object.keys(series)])){
    const arr=new Array(list.length).fill(null), old=have[k]||[], oldM=prev.months||[];
    oldM.forEach((m,i)=>{if(m in idx&&old[i]!=null)arr[idx[m]]=old[i]});
    const s=series[k]; if(s){const me={...monthEnds(s.w||{d:[],c:[]}),...monthEnds(s)}; for(const m of Object.keys(me))if(m in idx)arr[idx[m]]=Math.round(me[m]*1e4)/1e4}
    if(arr.some(x=>x!=null))px[k]=arr}
  return {months:list,px};
}
