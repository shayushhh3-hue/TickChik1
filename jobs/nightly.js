// The nightly run (23:50 Israel time, Monday–Friday): the day's point in history/daily (the page's own code decides
// and writes it), the daily close series of every security someone holds or follows (quotes/c_<key>), and the
// US-wide price snapshot the search page uses (quotes/all and the quotes/h_<bucket> series), from the nightly
// GitHub mirror of the nasdaq.com screener, as the previous task did.
import {bot, log, opt, loadOwnerDocs} from './lib/env.js';
import {withPage, applyWrites} from './lib/headless.js';
import {yahooChart, tickerFor} from '../shared/quotes.js';
import {ilParts} from '../shared/market.js';

const now=new Date(), p=ilParts(now);
if(p.h!==23&&!opt('FORCE')){log(`not the nightly hour (Israel ${p.h}:${String(p.min).padStart(2,'0')}); nothing to do`);process.exit(0)}
const fs=await bot();
const docs=await loadOwnerDocs(fs);
const owner={uid:opt('OWNER_UID','owner'),email:opt('OWNER_EMAIL',''),owner:true};

// 1. the daily point, by the page
if(docs['portfolio/main']&&docs['quotes/latest']){
  const {writes,errs}=await withPage(docs,owner,async pg=>{await pg.evaluate(()=>document.getElementById('tab_history').click());await pg.waitForTimeout(2500);return true});
  if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
  const n=await applyWrites(fs,writes,pth=>pth==='history/daily');
  log(`daily point: ${n} write(s)`);
}else log('no portfolio or quotes yet; the daily point waits');

// 2. close series for held and followed securities
const held=new Set(((docs['portfolio/main']||{}).positions||[]).map(x=>x.sym));
const watch=await fs.listDocs('watch').catch(()=>[]);
const keys=new Set([...held].filter(s=>/^[A-Z][A-Z.\-]{0,5}$/.test(s)));
for(const w of watch)for(const k of ['syms','marks','held','seen'])for(const s of ((w.data||{})[k]||[]))if(/^[A-Z][A-Z.\-]{0,5}$|^TLV:[A-Z0-9]{1,7}$/.test(s))keys.add(s);
const map=((docs['settings/main']||{}).symMap)||{};
const list=[...keys].slice(0,+opt('MAX_SERIES','90'));
let okN=0; const errors=[];
for(const key of list){
  const t=key.startsWith('TLV:')?(map[key]||key.slice(4)+'.TA'):tickerFor(key,null,map);
  try{
    const d=await series(t,'1y','1d'); let w=null; try{w=await series(t,'5y','1wk')}catch(e){}
    const doc={d:d.d,c:d.c,updatedAt:now.toISOString(),src:'yahoo'}; if(w&&w.d.length>=3)doc.w=w;
    await fs.setDoc('quotes/c_'+key.replace(':','_'),doc); okN++;
  }catch(e){errors.push(key+': '+e.message)}
  await new Promise(r=>setTimeout(r,250));
}
log(`close series: ${okN}/${list.length} written${errors.length?'; failed: '+errors.slice(0,5).join(' | '):''}`);

// 3. the US snapshot and the bucket series (the mirror lags the session by a day or two; its date is matched to a stored close)
try{
  const US={}; const base='https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/';
  for(const ex of ['nasdaq','nyse','amex']){
    const r=await fetch(base+ex+'/'+ex+'_full_tickers.json'); if(!r.ok){log('mirror',ex,r.status);continue}
    for(const x of await r.json()){const s=String(x.symbol||'').trim().replace(/\//g,'.').replace(/\^/g,'-'); if(!/^[A-Z][A-Z.\-]{0,5}$/.test(s))continue;
      const px=parseFloat(String(x.lastsale||'').replace(/[$,]/g,'')), pc=String(x.pctchange||''); const pct=/^-?[\d.]+%?$/.test(pc.replace(/,/g,''))?parseFloat(pc.replace(/[%,]/g,'')):0;
      if(px>0)US[s]=[Math.round(px*1e4)/1e4,Math.round(pct*100)/100]}
  }
  if(Object.keys(US).length){
    // the snapshot's date: the stored close that matches these prices
    let snapDate=null; const cand={};
    for(const k of ['NVDA','MSFT','AAPL','AMZN','JPM','KO','META','GOOGL']){if(!US[k])continue; const c=await fs.getDoc('quotes/c_'+k).catch(()=>null); if(!c||!c.exists)continue;
      c.data.d.forEach((dt,i)=>{const v=c.data.c[i]; if(v!=null&&Math.abs(v-US[k][0])<0.011)cand[dt]=(cand[dt]||0)+1})}
    const best=Object.entries(cand).sort((a,b)=>b[1]-a[1]||(b[0]<a[0]?-1:1))[0]; if(best)snapDate=best[0];
    if(!snapDate){const t=new Date(now); t.setUTCDate(t.getUTCDate()-1); while(t.getUTCDay()===0||t.getUTCDay()===6)t.setUTCDate(t.getUTCDate()-1); snapDate=t.toISOString().slice(0,10)}
    const old=await fs.getDoc('quotes/all').catch(()=>null);
    await fs.setDoc('quotes/all',{date:snapDate,tlvDate:old&&old.exists?old.data.tlvDate||null:null,updatedAt:now.toISOString(),us:US,tlv:old&&old.exists?(old.data.tlv||{}):{},source:'nasdaq.com via GitHub rreichel3/US-Stock-Symbols'});
    // the bucket series: one document per two-letter prefix, 250 points, dates shared
    const BK={A:14,B:10,C:13,D:5,E:6,F:6,G:7,H:5,I:6,J:2,K:4,L:5,M:8,N:7,O:5,P:9,Q:1,R:6,S:11,T:7,U:3,V:4,W:4,X:2,Y:1,Z:1};
    const prefix=k=>{const L=k[0],n=BK[L]||1,s=k[1]||'A',idx=s>='A'&&s<='Z'?s.charCodeAt(0)-65:0;return L+String(Math.floor(idx*n/26)).padStart(2,'0')};
    const by={}; for(const [k,v] of Object.entries(US))(by[prefix(k)]=by[prefix(k)]||{})[k]=v[0];
    let changed=0;
    for(const [pre,items] of Object.entries(by)){
      const name='quotes/h_'+pre; const cur=await fs.getDoc(name).catch(()=>null); const d=cur&&cur.exists?cur.data:{d:[],c:{}};
      let dates=[...(d.d||[])], series=Object.fromEntries(Object.entries(d.c||{}).map(([k,v])=>[k,[...v]])), dirty=false;
      if(!dates.includes(snapDate)){dates.push(snapDate);dates.sort();const i=dates.indexOf(snapDate);for(const s of Object.values(series))s.splice(i,0,null);dirty=true}
      const i=dates.indexOf(snapDate);
      for(const [k,px] of Object.entries(items)){const s=series[k]||(series[k]=new Array(dates.length).fill(null)); while(s.length<dates.length)s.push(null); if(s[i]!==px){s[i]=px;dirty=true}}
      if(dates.length>250){const cut=dates.length-250;dates=dates.slice(cut);for(const k in series)series[k]=series[k].slice(cut);dirty=true}
      if(dirty){await fs.setDoc(name,{d:dates,c:series,updatedAt:now.toISOString()});changed++}
    }
    log(`US snapshot ${Object.keys(US).length} symbols (date ${snapDate}), ${changed} bucket documents changed`);
  }
}catch(e){log('US snapshot failed:',e.message)}

async function series(t,range,interval){
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=${range}&interval=${interval}&includePrePost=false`,{headers:{'user-agent':'Mozilla/5.0 (compatible; tik-chik/1.0)'}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json(); const res=j&&j.chart&&j.chart.result&&j.chart.result[0]; if(!res)throw new Error('no result');
  const off=+res.meta.gmtoffset||0, k=res.meta.currency==='ILA'?0.01:1, cl=((res.indicators||{}).quote||[{}])[0].close||[];
  const d=[],c=[]; (res.timestamp||[]).forEach((ts,i)=>{if(cl[i]!=null&&cl[i]>0){d.push(new Date((ts+off)*1000).toISOString().slice(0,10));c.push(Math.round(cl[i]*k*1e4)/1e4)}});
  if(!d.length)throw new Error('empty'); return {d,c};
}
