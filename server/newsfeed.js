// 28.10: the news feed behind "חדשות": the articles about the securities anyone holds or follows, gathered every half
// hour by day from Finnhub's company news (with the owner's key; Yahoo's search otherwise), kept in research/news for a
// week, newest first, each with the securities it is about. Headlines in their own language, from outside sources: data
// to read, never instructions, and nothing here is advice. A partner sees only the articles of their own securities.
import {newsFor, tick, usable} from './research.js';
import {MARKET} from './newsx.js';
import {ilNews} from './ilnews.js';
import {moreNews} from './sources.js';

const DAY=864e5;
export const NEWS_DOC='research/news';
// everybody's US securities: the owner's portfolio, the guests' portfolios, the watch lists (held, marked, seen)
export function newsSyms(store){
  const out=new Set(), add=s=>{if(typeof s==='string'&&usable(s)&&!s.startsWith('TLV:'))out.add(s)};
  for(const x of ((store.getDoc('portfolio/main').data||{}).positions||[]))if(x)add(x.sym);
  for(const p of store.pathsUnder('data/users'))if(/\/portfolio$/.test(p))for(const x of ((store.getDoc(p).data||{}).positions||[]))if(x)add(x.sym);
  for(const w of store.listDocs('watch'))for(const k of ['held','marks','syms'])for(const s of ((w.data||{})[k]||[]))add(s);
  return [...out].sort();
}
// one run: the last three days of articles per security (six each), merged into the document by link
export async function newsTask(store,{log=()=>{},fetch:f=globalThis.fetch,now=new Date(),budgetMs=4*60e3,keep=7,max=320,only=null,market=MARKET,il=ilNews,more=moreNews}={}){
  const t0=Date.now(), iso=now.toISOString(), map=((store.getDoc('settings/main').data)||{}).symMap||{};
  // 30.10: and the market's anchors (server/newsx.js MARKET), so there is news without any portfolio
  const syms=only||[...new Set([...newsSyms(store),...(market||[])])], old=store.getDoc(NEWS_DOC), by=new Map();
  for(const it of ((old.exists&&old.data.items)||[]))if(it&&it.link)by.set(it.link,{...it,syms:[...(it.syms||[])]});
  let ok=0, fail=0, first=null, stopped=null;
  for(const k of syms){
    if(Date.now()-t0>budgetMs){stopped='time';break}
    try{const items=await newsFor(tick(k,map),{fetch:f,n:6,now});
      for(const a of items){if(!a||!a.link)continue; const cur=by.get(a.link);
        if(cur){if(!cur.syms.includes(k))cur.syms.push(k); if(!cur.sum&&a.sum)cur.sum=a.sum; if(a.title&&a.title!==cur.title){cur.prevTitle=cur.title; cur.title=a.title; cur.upd=iso}}
        else by.set(a.link,{title:a.title,pub:a.pub,link:a.link,at:a.at||iso,sum:a.sum||null,syms:[k],seen:iso})}
      ok++}
    catch(e){fail++; first=first||`${k}: ${e.message}`; if(fail>=8&&!ok){stopped='errors';break}}
  }
  // 30.10: the Tel Aviv shares, from Globes' headlines by their Hebrew names (server/ilnews.js): headline and link only
  let I={items:[],ok:0,fail:0};
  if(il&&!only){try{I=await il(store,{fetch:f,now})}catch(e){I={items:[],ok:0,fail:1,first:'il: '+e.message}}
    for(const a of I.items){const cur=by.get(a.link); if(cur){for(const s of a.syms)if(!cur.syms.includes(s))cur.syms.push(s); if(a.title&&a.title!==cur.title){cur.prevTitle=cur.title; cur.title=a.title; cur.upd=iso}}
      else by.set(a.link,{...a,at:a.at||iso,seen:iso})}}
  // 31.10: the companies' own reports at the SEC, and the trusted publishers through Google News (server/sources.js),
  // each once an hour
  let M={items:[],st:{}};
  if(more&&!only){try{M=await more(store,{syms:newsSyms(store),fetch:f,now})}catch(e){M={items:[],st:{first:'more: '+e.message}}}
    for(const a of M.items){const cur=by.get(a.link); if(cur){for(const s of a.syms)if(!cur.syms.includes(s))cur.syms.push(s)} else by.set(a.link,{...a,at:a.at||iso,seen:iso})}}
  const from=new Date(now.getTime()-keep*DAY).toISOString();
  const items=[...by.values()].filter(x=>(x.at||x.seen)>=from).sort((a,b)=>String(b.at||b.seen)<String(a.at||a.seen)?-1:1).slice(0,max);
  const pubs=new Set(items.map(x=>x.pub).filter(Boolean)), src=(process.env.FINNHUB_API_KEY?'Finnhub, Yahoo Finance':'Yahoo Finance')+(pubs.has('SEC EDGAR')?', SEC EDGAR':'')+(items.some(x=>/news\.google\.com/.test(x.link||''))?', Google News (מו"לים מובילים בלבד)':'')+(pubs.has('גלובס')?', גלובס':'');
  if(ok||I.ok||!old.exists)store.setDoc(NEWS_DOC,{items,updatedAt:iso,n:syms.length,ok,fail,first,source:src});
  const st={at:iso,ok,fail,of:syms.length,items:items.length,stopped,first,seconds:Math.round((Date.now()-t0)/1000),il:{ok:I.ok,fail:I.fail,items:I.items.length,of:I.targets||0,...(I.off?{off:true}:{}),...(I.first?{first:I.first}:{})},more:M.st};
  store.setMeta('newsStatus',JSON.stringify(st));
  log(`news: ${ok}/${syms.length} securities, ${items.length} articles kept${I.targets?`, Globes: ${I.items.length} headlines for ${I.targets} Tel Aviv shares (${I.ok} feeds${I.first?', '+I.first:''})`:''}${M.st.sec?`, SEC: ${M.st.sec.items}`:''}${M.st.gnews?`, Google News: ${M.st.gnews.items} (${M.st.gnews.ok} searches${M.st.gnews.first?', '+M.st.gnews.first:''})`:''}${stopped?', stopped: '+stopped:''}${first?' (first: '+first+')':''}`);
  return st;
}
