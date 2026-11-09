// 4.11 TikChik Management Center: Yahoo, the site's main market source, and the market data it brings.
// The meter wraps the server's fetch once: every request to Yahoo (prices and closes, the companies' figures, the symbol
// search, the news) is counted by its kind and outcome, with its time. Never the address itself: a ticker in it could tell
// whose portfolio asked. The screen shows the counts, the last success and failure, how the prices of the day were found
// (counted by source, never security by security), and the market itself: the indices, the commodities, the dollar and
// the other currencies, all public data.
import {bump, countersSince} from './counter.js';
import {BENCH, MKTS} from '../../shared/quotes.js';
import {ilParts} from '../../shared/market.js';

export const YH_KIND={chart:'מחירים וסגירות',summary:'נתוני החברות',search:'חיפוש ניירות',news:'כתבות',options:'נתוני אופציות',session:'פתיחת חיבור (עוגייה ו-crumb)',other:'אחר'};
const kindOf=u=>{const {p,h}=(()=>{try{const x=new URL(u); return {p:x.pathname,h:x.hostname}}catch(e){return {p:'',h:''}}})();
  return /\/finance\/chart\//.test(p)?'chart':/quoteSummary|\/v7\/finance\/quote/.test(p)?'summary':/\/finance\/search/.test(p)?'search':/news|rss/.test(p)?'news':/options/.test(p)?'options':/getcrumb/.test(p)||h==='fc.yahoo.com'||(h==='finance.yahoo.com'&&(p==='/'||p===''))?'session':'other'};
const isYahoo=u=>{try{return /(^|\.)yahoo\.com$|(^|\.)yahooapis\.com$|(^|\.)yimg\.com$/.test(new URL(u).hostname)}catch(e){return false}};

// 9.11: the gate. Yahoo answered 429 to one request in six (116 times a week): the server asked in bursts (the indices, the
// markets and the currencies all at once, six securities in parallel, each failure tried again on the second host).
// Now at most three requests at a time, a short gap between them, and after a 429 a pause for every Yahoo call (a minute,
// doubling up to a quarter of an hour, back to a minute after an answer): a call in the pause fails at once, counted as
// "skipped", and the price run falls back to its other sources (Nasdaq, Stooq) as it does on any failure
export const GATE={active:0,max:3,last:0,gap:150,pausedUntil:0,pauseMs:60e3,skipped:0,pauses:0};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function slot(now=Date.now){while(GATE.active>=GATE.max)await sleep(40); const wait=GATE.last+GATE.gap-now(); if(wait>0)await sleep(wait); GATE.last=now(); GATE.active++}
export const gateState=(now=Date.now())=>({paused:GATE.pausedUntil>now,until:GATE.pausedUntil>now?new Date(GATE.pausedUntil).toISOString():null,pauseMs:GATE.pauseMs,max:GATE.max,gap:GATE.gap,skipped:GATE.skipped,pauses:GATE.pauses});
export function gateReset(){Object.assign(GATE,{active:0,last:0,pausedUntil:0,pauseMs:60e3,skipped:0,pauses:0})}

export function meterYahoo(store,{target=globalThis,now=Date.now,gate=true}={}){
  if(!target||typeof target.fetch!=='function'||target.fetch.__yh)return;
  const real=target.fetch;
  const note=(k,ok,code,ms)=>{bump('yh',`${k}|${ok?'ok':'err:'+String(code).slice(0,24)}`,1,{store}); if(ms>0)bump('yh_ms',k,Math.round(ms),{store});
    try{const L=JSON.parse(store.getMeta('yhLast')||'{}'); L[ok?'ok':'fail']={at:new Date(now()).toISOString(),kind:k,code:ok?null:String(code).slice(0,40)}; store.setMeta('yhLast',JSON.stringify(L))}catch(e){}};
  const wrapped=async(u,o)=>{const url=typeof u==='string'?u:u&&u.url||String(u); if(!isYahoo(url))return real(u,o);
    const k=kindOf(url);
    if(gate&&now()<GATE.pausedUntil){GATE.skipped++; bump('yh',`${k}|skip:paused`,1,{store}); throw Object.assign(new Error('Yahoo paused after 429 (until '+new Date(GATE.pausedUntil).toISOString().slice(11,16)+'Z)'),{paused:true,slow:true})}
    if(gate)await slot(now); const t0=now();
    try{const r=await real(u,o); const ok=r.ok||(k==='session'&&r.status>=300&&r.status<400);   // a redirect is the cookie step's answer
      if(r.status===429&&gate){GATE.pausedUntil=now()+GATE.pauseMs; GATE.pauses++; GATE.pauseMs=Math.min(GATE.pauseMs*2,15*60e3)} else if(ok&&gate)GATE.pauseMs=Math.max(60e3,Math.round(GATE.pauseMs/2));
      note(k,ok,r.status,now()-t0); return r}
    catch(e){note(k,false,e&&e.name==='TimeoutError'?'timeout':'network',now()-t0); throw e}
    finally{if(gate)GATE.active=Math.max(0,GATE.active-1)}};
  wrapped.__yh=true; target.fetch=wrapped}

const day=t=>ilParts(t).iso;
export function yahooStatus(store,{days=7}={}){
  const to=day(new Date()), from=day(new Date(Date.now()-(days-1)*864e5)), C=countersSince(store,'yh',from,to), T=countersSince(store,'yh_ms',from,to);
  const by={}, daysL=[]; for(let i=days-1;i>=0;i--)daysL.push(day(new Date(Date.now()-i*864e5)));
  const series=Object.fromEntries(daysL.map(d=>[d,{ok:0,err:0}]));
  let skipped=0;
  for(const r of C){const [k,res]=r.key.split('|'); if(res==='skip:paused'){skipped+=r.n; continue}   // not a request: nothing was asked of Yahoo
    const o=by[k]||(by[k]={kind:k,name:YH_KIND[k]||k,calls:0,ok:0,err:0,codes:{},ms:0});
    o.calls+=r.n; if(res==='ok')o.ok+=r.n; else{o.err+=r.n; const c=res.replace(/^err:/,''); o.codes[c]=(o.codes[c]||0)+r.n}
    const s=series[r.day]; if(s){if(res==='ok')s.ok+=r.n; else s.err+=r.n}}
  for(const r of T){const o=by[r.key]; if(o)o.ms+=r.n}
  const kinds=Object.values(by).map(o=>({...o,rate:o.calls?Math.round(o.ok/o.calls*1000)/10:null,avgMs:o.calls?Math.round(o.ms/o.calls):null,codes:Object.entries(o.codes).map(([c,n])=>({c,n})).sort((a,b)=>b.n-a.n)})).sort((a,b)=>b.calls-a.calls);
  const tot=kinds.reduce((t,o)=>t+o.calls,0), ok=kinds.reduce((t,o)=>t+o.ok,0), limited=kinds.reduce((t,o)=>t+(o.codes.find(x=>x.c==='429')||{n:0}).n,0);
  let last={}; try{last=JSON.parse(store.getMeta('yhLast')||'{}')}catch(e){}
  // how today's prices were found: counted by source, never named one by one
  const Q=store.getDoc('quotes/latest').data||{}, meta=Q.meta||{}, stale=Q.stale||{}, src={};
  for(const k of Object.keys(Q.prices||{})){const s=(meta[k]||{}).src||'לא ידוע'; src[s]=(src[s]||0)+1}
  const SRC={yahoo:'Yahoo',nasdaq:'Nasdaq (גיבוי)',stooq:'Stooq (גיבוי, מפגר)',finnhub:'Finnhub',maya:'מאיה (קרנות)',index:'לפי מדד'};
  const prices={total:Object.keys(Q.prices||{}).length,bySource:Object.entries(src).map(([s,n])=>({s,name:SRC[s]||s,n})).sort((a,b)=>b.n-a.n),
    stale:Object.values(stale).filter(v=>/^(מחיר קודם|מחיר מהדוח)/.test(v)).length,estimated:Object.values(stale).filter(v=>/^(הערכה|לפי מדד)/.test(v)).length,
    usDate:Q.usDate||null,ilDate:Q.ilDate||null,label:Q.priceLabel||'',updatedAt:Q.updatedAt||null,errors:Array.isArray(Q.errors)?Q.errors.length:null};
  let research=null; try{const R=JSON.parse(store.getMeta('researchStatus')||'null'); if(R)research={at:R.at||null,ok:R.ok||0,of:R.of||0,fail:R.fail||0}}catch(e){}
  const state=!tot?'none':ok/tot<0.5?'bad':ok/tot<0.9||limited>0?'warn':'ok';
  return {days,from,to,state,total:tot,ok,rate:tot?Math.round(ok/tot*1000)/10:null,limited,skipped,gate:gateState(),kinds,series:daysL.map(d=>({d,...series[d]})),last,prices,research,
    note:'נספר מ-4.11.2026, כשהמונה נוסף. כתובת הבקשה לא נשמרת (סימול בתוכה יכול לגלות של מי התיק). מ-9.11 השער: עד 3 בקשות במקביל, ואחרי 429 הפסקה לכל הבקשות (דקה, ומכפילה את עצמה עד רבע שעה); בקשה בזמן ההפסקה נספרת כדילוג, לא כבקשה.'}}

const pc=(a,b)=>a>0&&b>0?Math.round((a/b-1)*10000)/100:null;
export function marketData(store){
  const Q=store.getDoc('quotes/latest').data||{};
  const bench=Object.entries(BENCH).map(([k,b])=>{const o=(Q.bench||{})[k]; return o?{k,name:b.name,px:o.px,chg:pc(o.px,o.prev),date:o.date||null,prevDate:o.prevDate||null,fut:o.fut&&o.fut.px?{px:o.fut.px,chg:pc(o.fut.px,o.fut.prev),date:o.fut.date||null}:null}:{k,name:b.name,px:null}});
  const mkts=Object.entries(MKTS).map(([k,b])=>{const o=(Q.mkts||{})[k]; return o?{k,name:b.name,px:o.px,chg:pc(o.px,o.prev),date:o.date||null}:{k,name:b.name,px:null}});
  const fx={usdIls:Q.usdIls||null,label:Q.fxLabel||'',prev:Q.fxPrev?Q.fxPrev.rate:null,chg:Q.fxPrev?pc(Q.usdIls,Q.fxPrev.rate):null,boi:Q.boiUsd||null};
  const rates=Object.entries(Q.rates||{}).map(([c,v])=>({c,rate:v.rate,chg:pc(v.rate,v.prev),date:v.date||null})).sort((a,b)=>a.c<b.c?-1:1);
  return {updatedAt:Q.updatedAt||null,label:Q.priceLabel||'',bench,mkts,fx,rates}}

// 8.11: the splits applied: the fact (the security, the day, the ratio), how it was found and whether FMP confirms it, and in
// how many portfolios it was applied, kept or undone. Counts only: no one's units or securities beyond the split's own.
export function splitsAdmin(store){
  const Q=(store.getDoc('quotes/latest').data)||{}, S=Q.splits||{}; if(!Object.keys(S).length)return [];
  const ports=[store.getDoc('portfolio/main')]; try{for(const p of store.pathsUnder('data/users'))if(/^data\/users\/[^/]+\/portfolio$/.test(p))ports.push(store.getDoc(p))}catch(e){}
  const near=(a,b)=>Math.abs(Date.parse(a)-Date.parse(b))<=7*864e5;
  return Object.entries(S).map(([sym,v])=>{const c={applied:0,kept:0,undone:0};
    for(const P of ports){if(!P.exists||!P.data)continue; for(const r of Object.values(P.data.splits||{})){if(!r||r.sym!==sym||!r.d||!near(r.d,v.d))continue;
      if(r.undone)c.undone++; else if((r.rows||[]).some(x=>!x.kept))c.applied++; else c.kept++}}
    return {sym,d:v.d,r:+v.r,src:v.src||'prices',conf:v.conf||null,confAt:v.confAt||null,at:v.at||null,...c}}).sort((a,b)=>a.d<b.d?1:-1)}
