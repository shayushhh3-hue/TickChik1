// The price refresh: which symbols, fetch, write quotes/latest. Shared by the hourly job and the on-demand function.
import {fetchAll, buildQuotesDoc, timedFetch} from './quotes.js';
import {applySplits} from './splits.js';
import {usOpen, ilOpen} from './market.js';

export async function refreshQuotes(fs,{fetch:f=timedFetch,now=new Date(),log=()=>{},reason=''}={}){
  const [P,S,Q,W]=await Promise.all([fs.getDoc('portfolio/main'),fs.getDoc('settings/main'),fs.getDoc('quotes/latest'),Promise.resolve().then(()=>fs.listDocs('watch')).catch(()=>[])]);
  const positions=(P.exists&&P.data.positions)||[];
  const syms=new Set(positions.map(p=>p.sym).filter(Boolean));
  // under the cap, holdings come first (the owner's, then the partners'), then bookmarks, the rest of the watch lists, and
  // the securities of the savings goals (kept apart from the portfolio, priced all the same)
  for(const k of ['held','marks','syms','pots'])for(const w of W)for(const s of ((w.data||{})[k]||[]))if(typeof s==='string'&&/^[A-Z0-9.\-^]{1,12}$/.test(s))syms.add(s);
  const map=(S.exists&&S.data.symMap)||{};
  const symbols=[...syms].slice(0,120);
  log(`fetching ${symbols.length} symbols${reason?' ('+reason+')':''}`);
  // 5.11: the background (indices, futures, markets) once in a quarter of an hour; the holdings every run
  const old=Q.exists?Q.data:{}, ctx=!old.mktsAt||now.getTime()-Date.parse(old.mktsAt)>=14*60e3;
  const fetched=await fetchAll(symbols,{positions,map,fetch:f,log,ctx});
  const doc=buildQuotesDoc({prev:Q.exists?Q.data:{},fetched,symbols,positions,now,usOpen:usOpen(now),ilOpen:ilOpen(now)});
  if(reason)doc.lastReason=reason;
  // 6.11: a split written to the quotes while this run fetched (the catch-up check) is kept, not overwritten by the older copy
  try{const cur=await fs.getDoc('quotes/latest'); const cs=(cur&&cur.exists&&cur.data&&cur.data.splits)||{}; doc.splits={...cs,...(doc.splits||{})}}catch(e){}
  await fs.setDoc('quotes/latest',doc);
  // 6.11: a split found in this run is applied once to the units, the saved prices and the price alerts of everyone holding it
  try{const nw=Object.fromEntries(Object.entries(doc.splits||{}).filter(([k,v])=>!((old.splits||{})[k]&&old.splits[k].d===v.d)));
    if(Object.keys(nw).length){log(`split found: ${Object.entries(nw).map(([k,v])=>`${k} ${v.r} (${v.d})`).join(', ')}`); if(fs.pathsUnder||fs.getDoc)applySplits(fs,nw,{now,log})}}catch(e){log('split: '+(e&&e.message||e))}
  const got=Object.keys(fetched.quotes).length+Object.keys(fetched.index).length;
  log(`wrote quotes/latest: ${got}/${symbols.length} fetched, ${fetched.errors.length} errors, usdIls ${doc.usdIls}, ${doc.priceLabel}`);
  return {symbols:symbols.length,fetched:got,errors:fetched.errors,updatedAt:doc.updatedAt,usdIls:doc.usdIls,priceLabel:doc.priceLabel};
}
