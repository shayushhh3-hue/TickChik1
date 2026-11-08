// 5.11: Financial Modeling Prep, with the owner's key (FMP_API_KEY; FPM_API_KEY and a few other spellings are read too):
// the company figures Yahoo no longer gives the server (its company data answers 429): the margins, the debt, the current
// ratio, the valuation, the dividend's yield, the beta and the sector, the analysts' target and their votes, and the next
// report with what is expected of it. Only what is still missing is asked and filled, the held shares first, US shares
// only, within a daily budget (the free plan allows 250 calls a day; the site keeps to 200). An endpoint the plan does not
// open (HTTP 402 or 403) is left for a week instead of asked again; a refused key (401) or the day's limit (429) stops
// the pass. The share says where its figures came from (fmpAt).
export const FMP_NAMES=['FMP_API_KEY','FPM_API_KEY','FMP_KEY','FPM_KEY','FMP_TOKEN','FMP','FPM','FINANCIAL_MODELING_PREP_API_KEY','FINANCIALMODELINGPREP_API_KEY'];
export const fmpKeyName=(env=process.env)=>FMP_NAMES.find(n=>String(env[n]||'').trim())||null;
export const fmpKey=(env=process.env)=>{const n=fmpKeyName(env); return n?String(env[n]).trim():''};
export const FMP_BASE='https://financialmodelingprep.com/stable';
export const FMP_DAY_CAP=200;

const num=v=>{if(v==null||v==='')return null; const n=+v; return Number.isFinite(n)?n:null};
const r2=x=>x==null?null:Math.round(x*100)/100;
const pc=x=>x==null?null:r2(x*100);
const pick=(o,...ks)=>{for(const k of ks){const v=num(o&&o[k]); if(v!=null)return v} return null};
const one=j=>Array.isArray(j)?(j[0]||null):(j&&typeof j==='object'?j:null);
const some=o=>Object.values(o).some(v=>v!=null);

// the trailing year's ratios (fractions in the answer; the site keeps percents, and the debt as a ratio)
export function fmpRatiosParse(j){const o=one(j); if(!o)return null;
  const fcfps=pick(o,'freeCashFlowPerShareTTM'), rps=pick(o,'revenuePerShareTTM');
  const out={gm:pc(pick(o,'grossProfitMarginTTM','grossProfitMargin')),om:pc(pick(o,'operatingProfitMarginTTM','operatingProfitMargin')),pm:pc(pick(o,'netProfitMarginTTM','netProfitMargin')),
    cr:r2(pick(o,'currentRatioTTM','currentRatio')),de:r2(pick(o,'debtToEquityRatioTTM','debtEquityRatioTTM','debtToEquityTTM','debtToEquity')),
    pe:r2(pick(o,'priceToEarningsRatioTTM','peRatioTTM','priceEarningsRatioTTM')),dy:pc(pick(o,'dividendYieldTTM','dividendYielTTM','dividendYield')),
    roe:pc(pick(o,'returnOnEquityTTM','returnOnEquity')),fcfm:fcfps!=null&&rps>0?r2(fcfps/rps*100):null};
  if(out.pe!=null&&out.pe<=0)out.pe=null;   // a loss gives no multiple
  return some(out)?out:null}
export function fmpProfileParse(j){const o=one(j); if(!o)return null;
  const out={beta:r2(pick(o,'beta')),sector:o.sector||null,industry:o.industry||null,name:o.companyName||o.name||null,cap:pick(o,'marketCap','mktCap')};
  return some(out)?out:null}
export function fmpTargetParse(j){const o=one(j); if(!o)return null; const t=pick(o,'targetConsensus','targetMedian'); return t>0?{target:r2(t),targetHi:r2(pick(o,'targetHigh')),targetLo:r2(pick(o,'targetLow')),targetMed:r2(pick(o,'targetMedian'))}:null}
const CONS={'strong buy':'Strong Buy','buy':'Buy','hold':'Hold','sell':'Sell','strong sell':'Strong Sell'};
export function fmpGradesParse(j){const o=one(j); if(!o)return null; const n=k=>pick(o,k)||0;
  const votes={buy:n('strongBuy')+n('buy'),hold:n('hold'),sell:n('sell')+n('strongSell')}, tot=votes.buy+votes.hold+votes.sell; if(!tot)return null;
  return {votes,votes5:{sb:n('strongBuy'),b:n('buy'),h:n('hold'),s:n('sell'),ss:n('strongSell')},analysts:tot,rating:CONS[String(o.consensus||'').toLowerCase()]||null}}
// 5.11: the analysts' latest changes (the last 90 days, newest first, six at most): the day, the firm, the grade before and after
export function fmpGradesListParse(j,now=new Date()){if(!Array.isArray(j))return null; const from=new Date(now.getTime()-90*864e5).toISOString().slice(0,10);
  const L=j.filter(x=>x&&/^\d{4}-\d\d-\d\d/.test(String(x.date||''))&&String(x.date).slice(0,10)>=from&&(x.gradingCompany||x.firm)).sort((a,b)=>a.date<b.date?1:-1).slice(0,6)
    .map(x=>({d:String(x.date).slice(0,10),firm:String(x.gradingCompany||x.firm).slice(0,40),from:String(x.previousGrade||'').slice(0,24),to:String(x.newGrade||'').slice(0,24),act:String(x.action||'').toLowerCase().slice(0,12)}));
  return L}
// the next report on or after today, with what the analysts expect of it
export function fmpEarningsParse(j,now=new Date()){if(!Array.isArray(j))return null; const today=now.toISOString().slice(0,10);
  const L=j.filter(x=>x&&/^\d{4}-\d\d-\d\d/.test(String(x.date||''))&&String(x.date).slice(0,10)>=today).sort((a,b)=>a.date<b.date?-1:1); const x=L[0]; if(!x)return null;
  const d=String(x.date).slice(0,10); return {next:d,est:{date:d,eps:r2(pick(x,'epsEstimated','estimatedEarning','epsEstimate')),rev:pick(x,'revenueEstimated','revenueEstimate'),at:now.toISOString(),src:'FMP'}}}

const US=k=>/^[A-Z]{1,5}([.\-][A-Z])?$/.test(k);   // a US share, a class share (BRK.B) too; not Tel Aviv's .TA or another exchange's suffix
const day=now=>now.toISOString().slice(0,10);
export async function fmpPass(store,order,got,{key=fmpKey(),fetch:f=globalThis.fetch,tick=k=>k,log=()=>{},now=new Date(),held=new Set(),watched=new Set(),max=60,cap=FMP_DAY_CAP,pause=250,budgetMs=8*60e3}={}){
  const st={tried:0,filled:0,calls:0,fail:0,stopped:null,first:null,off:[]}; if(!key){st.stopped='nokey';return st}
  const t0=Date.now(), today=day(now);
  let C={day:today,n:0}; try{const x=JSON.parse(store.getMeta('fmpCalls')||'null'); if(x&&x.day===today)C=x}catch(e){}
  let OFF={}; try{OFF=JSON.parse(store.getMeta('fmpOff')||'{}')||{}}catch(e){} for(const [ep,d] of Object.entries(OFF))if(!(Date.parse(d)>now.getTime()-7*864e5))delete OFF[ep];
  const save=()=>{try{store.setMeta('fmpCalls',JSON.stringify(C)); store.setMeta('fmpOff',JSON.stringify(OFF))}catch(e){}};
  const ask=async(ep,q)=>{if(OFF[ep])return null; if(C.n>=cap){st.stopped='budget';return null}
    C.n++; st.calls++; const r=await f(`${FMP_BASE}/${ep}?${q}&apikey=${encodeURIComponent(key)}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(r.status===402||r.status===403){OFF[ep]=now.toISOString(); if(!st.off.includes(ep))st.off.push(ep); return null}
    if(r.status===401){st.stopped='key'; return null} if(r.status===429){st.stopped='limit'; return null}
    if(!r.ok)throw new Error('HTTP '+r.status); return r.json()};
  const miss=(v,ks)=>!v||ks.some(k=>v[k]==null);
  const want=k=>{const v=got[k]; return held.has(k)||miss(v,['pm','pe','de','beta','target','next'])||!(v&&v.votes)};   // 5.11: a held share every night (its analysts' latest changes)
  const list=[...new Set([...order.filter(k=>held.has(k)),...order.filter(k=>watched.has(k)),...order])].filter(k=>US(k)&&want(k)).slice(0,max);
  try{
    for(const k of list){if(st.stopped)break; if(Date.now()-t0>budgetMs){st.stopped='time';break}
      const t=encodeURIComponent(String(tick(k)).replace(/\./g,'-')), v=got[k]||{}, add={}; st.tried++;
      try{
        if(miss(v,['gm','om','pm','cr','de','pe','dy'])){const x=fmpRatiosParse(await ask('ratios-ttm','symbol='+t)); if(x)Object.assign(add,x)}
        if(!st.stopped&&miss(v,['beta','sector'])){const x=fmpProfileParse(await ask('profile','symbol='+t)); if(x)Object.assign(add,x)}
        if(!st.stopped&&(v.target==null||(held.has(k)&&v.targetHi==null))){const x=fmpTargetParse(await ask('price-target-consensus','symbol='+t)); if(x)Object.assign(add,x)}
        if(!st.stopped&&!(v.votes&&v.votes5)){const x=fmpGradesParse(await ask('grades-consensus','symbol='+t)); if(x)Object.assign(add,x)}
        if(!st.stopped&&held.has(k)){const x=fmpGradesListParse(await ask('grades','symbol='+t),now); if(x)add.gradesL=x}
        if(!st.stopped&&!v.next){const x=fmpEarningsParse(await ask('earnings','symbol='+t+'&limit=8'),now); if(x)Object.assign(add,x)}
      }catch(e){st.fail++; st.first=st.first||`${k}: ${e.message}`; if(st.fail>=8&&!st.filled){st.stopped='errors'}}
      // only what is missing: a figure Yahoo, Finnhub or the reports already gave is never replaced
      const g=got[k]||(got[k]={}); let n=0; for(const [a,b] of Object.entries(add))if(b!=null&&(g[a]==null||(a==='votes'&&!g.votes)||a==='gradesL')){g[a]=b; n++}
      if(n){g.fmpAt=now.toISOString(); st.filled++}
      if(pause)await new Promise(r=>setTimeout(r,pause))}
  }finally{save()}
  if(st.tried||st.stopped)log(`fmp: ${st.filled} filled with ${st.calls} calls (${C.n} today)${st.off.length?', not in the plan: '+st.off.join(', '):''}${st.stopped?', stopped: '+st.stopped:''}`);
  st.today=C.n; return st}

// 8.11: a split found by the prices is checked against FMP's list of the security's splits (one call per split, within the
// day's budget): confirmed (the same ratio within five days), not found there, not in the plan, or not checked yet. The
// answer is kept with the split in the quotes (Q.splits[sym].conf) and shown in the Management Center; the split itself is
// applied either way (the prices are the evidence; FMP's list can lag).
export function fmpSplitsParse(j,sp){if(!Array.isArray(j))return null;
  const t=Date.parse(sp.d); for(const x of j){const d=Date.parse(String(x&&(x.date||x.label)||'').slice(0,10)); const n=+(x&&x.numerator), m=+(x&&x.denominator); if(!isFinite(d)||!(n>0)||!(m>0))continue;
    if(Math.abs(d-t)<=5*864e5&&Math.abs((n/m)/(+sp.r)-1)<0.03)return 'fmp'} return 'nofmp'}
export async function confirmSplits(store,{key=fmpKey(),fetch:f=globalThis.fetch,now=new Date(),log=()=>{},cap=FMP_DAY_CAP}={}){
  const Qd=store.getDoc('quotes/latest'); if(!Qd.exists||!Qd.data||!Qd.data.splits)return 0;
  const todo=Object.entries(Qd.data.splits).filter(([s,v])=>v&&v.d&&(!v.conf||(v.conf==='err'&&!(Date.parse(v.confAt)>now.getTime()-864e5)))); if(!todo.length)return 0;
  const out={}; if(!key){for(const [s] of todo)out[s]='nokey'}
  else{const today=now.toISOString().slice(0,10); let C={day:today,n:0}; try{const x=JSON.parse(store.getMeta('fmpCalls')||'null'); if(x&&x.day===today)C=x}catch(e){}
    for(const [s,v] of todo){if(C.n>=cap)break; C.n++;
      try{const r=await f(`${FMP_BASE}/splits?symbol=${encodeURIComponent(s.replace(/\./g,'-'))}&apikey=${encodeURIComponent(key)}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
        out[s]=r.status===402||r.status===403?'plan':r.status===401?'nokey':!r.ok?'err':fmpSplitsParse(await r.json(),v)||'err'}catch(e){out[s]='err'}}
    try{store.setMeta('fmpCalls',JSON.stringify(C))}catch(e){}}
  // written onto the current quotes (a price run may have written meanwhile)
  const cur=store.getDoc('quotes/latest'); if(!cur.exists)return 0; const S={...(cur.data.splits||{})};
  for(const [s,c] of Object.entries(out))if(S[s])S[s]={...S[s],conf:c,confAt:now.toISOString()};
  store.setDoc('quotes/latest',{...cur.data,splits:S}); log(`splits checked with FMP: ${Object.entries(out).map(([s,c])=>s+' '+c).join(', ')}`); return Object.keys(out).length}
