// 8.11: live US prices. During the regular New York session the server holds one connection to Finnhub's trade stream
// (wss://ws.finnhub.io) for every US security anybody here holds (the quotes document's symbols), and every thirty
// seconds writes the last trade of each into quotes/latest: the page shows it at once (it watches the document), the
// alerts and the gauge read it like any price. Outside the session the connection is closed. The scheduled price run
// (shared/pxjob.js, Yahoo and Stooq, delayed) keeps a price the stream set in the last three minutes rather than
// putting an older one over it (shared/quotes.js). A trade far from the current price (15%) is dropped as a bad tick.
// Nothing here changes the previous close, the splits or anything but the price and its time stamp.
import {usOpen, nyParts} from '../shared/market.js';

const FLUSH=30e3, MAX=45, OUTLIER=0.15;
const meta=(store,k)=>{try{return JSON.parse(store.getMeta(k)||'null')}catch(e){return null}};
export const nyDay=d=>{const p=nyParts(d); return p.iso};
// the US securities worth a live price: everybody's held symbols that the quotes already price in dollars
export function rtSymbols(Q){
  if(!Q||!Q.prices)return [];
  return Object.keys(Q.prices).filter(s=>/^[A-Z][A-Z.\-]{0,6}$/.test(s)&&!/^TA\d/.test(s)&&(!(Q.meta||{})[s]||!(Q.meta[s].ccy)||Q.meta[s].ccy==='USD')&&!/^(index|maya)$/.test(((Q.meta||{})[s]||{}).src||'')).sort().slice(0,MAX);
}
export const finnhubSym=s=>String(s).replace(/-/g,'.');
// the trades since the last flush written into the quotes: how many prices changed
export function rtApply(store,last,{now=new Date()}={}){
  const d=store.getDoc('quotes/latest'); if(!d.exists||!d.data||!d.data.prices)return 0;
  const Q=d.data, day=nyDay(now), at=now.toISOString(); let n=0;
  for(const [sym,t] of Object.entries(last)){if(!(t&&t.p>0))continue; const cur=+Q.prices[sym];
    if(cur>0&&Math.abs(t.p/cur-1)>OUTLIER)continue;   // a bad tick, or a split not yet seen by the daily run: the run decides
    const p=Math.round(t.p*1e4)/1e4; if(p===cur&&(Q.meta||{})[sym]&&Q.meta[sym].rt)continue;
    Q.prices[sym]=p; Q.meta=Q.meta||{}; Q.meta[sym]={...(Q.meta[sym]||{}),date:day,rt:at}; if(Q.stale&&Q.stale[sym])delete Q.stale[sym]; n++}
  if(!n)return 0;
  if(!Q.usDate||Q.usDate<day)Q.usDate=day;
  Q.updatedAt=at; Q.rt={at,n:Object.keys(last).length}; store.setDoc('quotes/latest',Q); return n;
}
// the stream: connected while the session is open, closed otherwise; reconnects with a growing pause
export function startRt(store,{key=process.env.FINNHUB_API_KEY,log=()=>{},WS=globalThis.WebSocket,now=()=>new Date(),every=30e3,flush=FLUSH,url='wss://ws.finnhub.io'}={}){
  const S={ws:null,subs:new Set(),last:{},trades:0,flushed:null,err:null,backoff:10e3,openedAt:null,stopped:false};
  const note=()=>{try{store.setMeta('rtStatus',JSON.stringify({at:now().toISOString(),on:!!(S.ws&&S.ws.readyState===1),n:S.subs.size,trades:S.trades,flushed:S.flushed,err:S.err,open:usOpen(now())}))}catch(e){}};
  const close=()=>{if(S.ws){try{S.ws.close()}catch(e){} S.ws=null} S.subs.clear()};
  const subscribe=()=>{if(!S.ws||S.ws.readyState!==1)return; const d=store.getDoc('quotes/latest'), want=new Set(rtSymbols(d.exists?d.data:null));
    for(const s of want)if(!S.subs.has(s)){try{S.ws.send(JSON.stringify({type:'subscribe',symbol:finnhubSym(s)}))}catch(e){} S.subs.add(s)}
    for(const s of [...S.subs])if(!want.has(s)){try{S.ws.send(JSON.stringify({type:'unsubscribe',symbol:finnhubSym(s)}))}catch(e){} S.subs.delete(s)}};
  const connect=()=>{if(S.ws||!key||!WS)return;
    let ws; try{ws=new WS(`${url}?token=${encodeURIComponent(key)}`)}catch(e){S.err=String(e&&e.message||e); return} S.ws=ws;
    ws.addEventListener('open',()=>{S.openedAt=now().toISOString(); S.err=null; S.backoff=10e3; log('rt: connected'); subscribe(); note()});
    ws.addEventListener('message',ev=>{let m=null; try{m=JSON.parse(typeof ev.data==='string'?ev.data:String(ev.data))}catch(e){return}
      if(m&&m.type==='trade'&&Array.isArray(m.data))for(const t of m.data){const sym=String(t.s||'').replace(/\./g,'-'), s2=S.subs.has(sym)?sym:S.subs.has(t.s)?t.s:null; if(!s2||!(+t.p>0))continue; S.trades++; S.last[s2]={p:+t.p,t:+t.t||Date.now()}}
      else if(m&&m.type==='error'){S.err=String(m.msg||'error'); log('rt: '+S.err)}});
    ws.addEventListener('close',()=>{const was=S.ws===ws; if(was){S.ws=null; S.subs.clear()} if(!S.stopped&&was&&usOpen(now())){log(`rt: closed; again in ${Math.round(S.backoff/1e3)}s`); setTimeout(()=>{if(!S.stopped&&usOpen(now()))connect()},S.backoff).unref?.(); S.backoff=Math.min(S.backoff*2,120e3)} note()});
    ws.addEventListener('error',e=>{S.err=String((e&&e.message)||'socket error')})};
  const tick=()=>{if(S.stopped)return; try{if(usOpen(now())){connect(); subscribe()} else if(S.ws){log('rt: the session is over; closed'); close()}}catch(e){S.err=String(e&&e.message||e)} note()};
  const doFlush=()=>{if(S.stopped)return; const L=S.last; if(!Object.keys(L).length)return; S.last={}; try{const n=rtApply(store,L,{now:now()}); if(n){S.flushed=now().toISOString()}}catch(e){S.err=String(e&&e.message||e); log('rt flush: '+S.err)}};
  if(!key){log('rt: no FINNHUB_API_KEY, the live stream is off'); return {stop(){},state:()=>({off:true})}}
  if(!WS){log('rt: no WebSocket in this runtime, the live stream is off'); return {stop(){},state:()=>({off:true})}}
  const t1=setInterval(tick,every), t2=setInterval(doFlush,flush); t1.unref?.(); t2.unref?.(); tick();
  return {stop(){S.stopped=true; clearInterval(t1); clearInterval(t2); close()},state:()=>({on:!!(S.ws&&S.ws.readyState===1),n:S.subs.size,trades:S.trades,flushed:S.flushed,err:S.err}),tick,flush:doFlush,_S:S};
}
export const rtStatus=store=>meta(store,'rtStatus');
