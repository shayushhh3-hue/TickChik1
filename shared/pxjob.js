// The price refresh: which symbols, fetch, write quotes/latest. Shared by the hourly job and the on-demand function.
import {fetchAll, buildQuotesDoc, timedFetch} from './quotes.js';
import {usOpen, ilOpen} from './market.js';

export async function refreshQuotes(fs,{fetch:f=timedFetch,now=new Date(),log=()=>{},reason=''}={}){
  const [P,S,Q,W]=await Promise.all([fs.getDoc('portfolio/main'),fs.getDoc('settings/main'),fs.getDoc('quotes/latest'),Promise.resolve().then(()=>fs.listDocs('watch')).catch(()=>[])]);
  const positions=(P.exists&&P.data.positions)||[];
  const syms=new Set(positions.map(p=>p.sym).filter(Boolean));
  for(const w of W)for(const k of ['syms','marks','held'])for(const s of ((w.data||{})[k]||[]))if(typeof s==='string'&&/^[A-Z0-9.\-^]{1,12}$/.test(s))syms.add(s);
  const map=(S.exists&&S.data.symMap)||{};
  const symbols=[...syms].slice(0,120);
  log(`fetching ${symbols.length} symbols${reason?' ('+reason+')':''}`);
  const fetched=await fetchAll(symbols,{positions,map,fetch:f,log});
  const doc=buildQuotesDoc({prev:Q.exists?Q.data:{},fetched,symbols,positions,now,usOpen:usOpen(now),ilOpen:ilOpen(now)});
  if(reason)doc.lastReason=reason;
  await fs.setDoc('quotes/latest',doc);
  const got=Object.keys(fetched.quotes).length+Object.keys(fetched.index).length;
  log(`wrote quotes/latest: ${got}/${symbols.length} fetched, ${fetched.errors.length} errors, usdIls ${doc.usdIls}, ${doc.priceLabel}`);
  return {symbols:symbols.length,fetched:got,errors:fetched.errors,updatedAt:doc.updatedAt,usdIls:doc.usdIls,priceLabel:doc.priceLabel};
}
