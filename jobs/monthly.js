// Month end (the 1st, 08:50 Israel time): one row for the month that just ended in history/main.monthly
// (value per account, total, deposits, the dollar rate) and the month's closing prices in history/prices
// (months[] and px{SYM:[...]}), from the last daily point of the month and the stored quotes. Idempotent.
import {bot, log, opt} from './lib/env.js';
import {ilParts} from '../shared/market.js';

const now=new Date(), p=ilParts(now);
if(!(p.d===1&&p.h===8)&&!opt('FORCE')){log(`not the monthly moment (Israel ${p.iso} ${p.h}:00); nothing to do`);process.exit(0)}
const ym=opt('YM')||(()=>{const d=new Date(Date.UTC(p.y,p.m-1,1));d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)})();
const fs=await bot();
const [H,PX,DY,Q,P,S]=await Promise.all(['history/main','history/prices','history/daily','quotes/latest','portfolio/main','settings/main'].map(x=>fs.getDoc(x)));
const points=(DY.exists&&DY.data.points)||{};
const days=Object.keys(points).filter(k=>k.startsWith(ym)&&points[k]&&points[k].v>0).sort();
const last=days.length?points[days[days.length-1]]:null;
const fx=Q.exists?(+Q.data.usdIls||null):null;
const positions=(P.exists&&P.data.positions)||[];
const prices=Q.exists?(Q.data.prices||{}):{};
// value per account from the last point; when there is none, from the positions and the stored prices
let by=last&&last.by?{...last.by}:null, tot=last?last.v:null, dep=last?last.dep:null;
if(!by){by={};tot=0;for(const x of positions){const px=prices[x.sym];if(!(px>0))continue;const v=(+x.qty||0)*px*(x.ccy==='USD'?(fx||0):1);by[x.acct]=(by[x.acct]||0)+v;tot+=v}
  for(const c of ((P.exists&&P.data.cash)||[])){const v=(+c.amount||0)*(c.ccy==='USD'?(fx||0):1);by[c.acct]=(by[c.acct]||0)+v;tot+=v}
  for(const k in by)by[k]=Math.round(by[k]*100)/100; tot=Math.round(tot*100)/100; if(H.exists)dep=H.data.depIlsNow||null}
const row={ym,exc:by.exc!=null?by.exc:null,blink:by.blink!=null?by.blink:null,tot,by,dep,fx,excEst:!last,at:now.toISOString()};
// history/main.monthly
const h=H.exists?H.data:{};
const monthly=(h.monthly||[]).filter(r=>r.ym!==ym).concat([row]).sort((a,b)=>a.ym<b.ym?-1:1);
await fs.setDoc('history/main',{...h,monthly,updatedAt:now.toISOString()});
log(`history/main: month ${ym} → total ${tot} ₪, deposits ${dep}, fx ${fx}, accounts ${JSON.stringify(by)}${last?'':' (estimated from the positions)'}`);
// history/prices: the closing prices of the month for every symbol the series know, plus the held ones
const px=PX.exists?PX.data:{months:[],px:{}};
const months=[...(px.months||[])]; const series=Object.fromEntries(Object.entries(px.px||{}).map(([k,v])=>[k,[...v]]));
const src=last&&last.px?last.px:prices;
let idx=months.indexOf(ym); if(idx<0){months.push(ym);months.sort();idx=months.indexOf(ym);for(const s of Object.values(series))s.splice(idx,0,null)}
const syms=new Set([...Object.keys(series),...positions.map(x=>x.sym)]);
for(const s of syms){const arr=series[s]||(series[s]=new Array(months.length).fill(null)); while(arr.length<months.length)arr.push(null); const v=src[s]; if(v>0)arr[idx]=Math.round(v*1e4)/1e4}
await fs.setDoc('history/prices',{...px,months,px:series,updatedAt:now.toISOString()});
log(`history/prices: ${months.length} months, ${Object.keys(series).length} symbols`);
