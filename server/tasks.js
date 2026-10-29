// The scheduled work, as functions over the store. The page itself (run headless) computes the daily point, the
// alerts and the reports, so their numbers are the same as in the browser.
import {withPage, applyWrites} from './headless.js';
import {sendAllowed, mailAllowed, wrapHtml, esc} from './mail.js';
import {refreshQuotes} from '../shared/pxjob.js';
import {tickerFor, BENCH, PROXY, isIlFund, mayaFundSeries, stooqSeries} from '../shared/quotes.js';
import {ilParts} from '../shared/market.js';
import {comoveOf, longtermOf, monthlyCloses} from '../shared/comove.js';

const UA='Mozilla/5.0 (compatible; tik-chik/1.0)';
// every call out has a time limit, so one site that hangs cannot hold up the whole night (and every job queued after it)
const fetchFor=(ms)=>(u,o={})=>globalThis.fetch(u,{...o,signal:o.signal||AbortSignal.timeout(ms)});
// the owner's documents the page needs to run headless (nothing of the partners is read)
export const OWNER_DOCS=['portfolio/main','plan/main','settings/main','history/main','history/prices','history/daily','quotes/latest','research/latest','research/candidates','research/longterm','research/comove','research/news','research/newsx','alerts/ack','alerts/state'];
export function ownerDocs(store){const out={}; for(const p of OWNER_DOCS){const d=store.getDoc(p); if(d.exists)out[p]=d.data} return out}
const ownerUser=store=>{const o=store.users().find(u=>u.role==='owner'); return {uid:o?o.id:'owner',email:o?o.email:'',owner:true}};

export async function pricesTask(store,{log,reason='שעתי'}={}){return refreshQuotes(store,{log,reason})}

// 23:50: the day's point (by the page), the close series of held and followed securities, the US snapshot for search
export async function nightlyTask(store,{log,maxSeries=160}={}){
  const docs=ownerDocs(store), now=new Date();
  if(docs['portfolio/main']&&docs['quotes/latest']){
    const {writes,errs}=await withPage(docs,ownerUser(store),async pg=>{await pg.evaluate(()=>document.getElementById('tab_history').click());await pg.waitForTimeout(2500);return true});
    if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
    log(`daily point: ${await applyWrites(store,writes,p=>p==='history/daily')} write(s)`);
  }else log('no portfolio or quotes yet; the daily point waits');
  // 25.10: everybody's holdings (the owner's and the guests'), funds and index trackers too: the control tab's "moves
  // together" and "shakes the portfolio" need a series for every one of them
  const held=((docs['portfolio/main']||{}).positions||[]).map(x=>x.sym);
  for(const p of store.pathsUnder('data/users'))if(/\/portfolio$/.test(p))for(const x of ((store.getDoc(p).data||{}).positions||[]))if(x&&x.sym)held.push(x.sym);
  const keys=new Set(held.filter(s=>/^[A-Z][A-Z.\-]{0,5}$/.test(s)||isIlFund(s)||PROXY[s]||/^TLV:[A-Z0-9]{1,7}$/.test(s)));
  for(const w of store.listDocs('watch'))for(const k of ['syms','marks','held','seen'])for(const s of ((w.data||{})[k]||[]))if(/^[A-Z][A-Z.\-]{0,5}$|^TLV:[A-Z0-9]{1,7}$/.test(s))keys.add(s);
  const map=((docs['settings/main']||{}).symMap)||{};
  let ok=0; const fails=[], until=Date.now()+12*60e3;
  for(const key of [...keys].slice(0,maxSeries)){
    if(Date.now()>until){fails.push('stopped after 12 minutes');break}
    const t=PROXY[key]?PROXY[key].index:key.startsWith('TLV:')?(map[key]||key.slice(4)+'.TA'):tickerFor(key,null,map);
    try{let d, w=null, src='Yahoo Finance';
      // a mutual fund: its official prices from Maya (a year of days); a share or a tracker: Yahoo, then Stooq for a US share
      if(isIlFund(key)){d=await mayaFundSeries(key,{pageSize:300}); src='מאיה (הבורסה)'; if(!d.d.length)throw new Error('Maya: no prices')}
      else{try{d=await series(t,'1y','1d'); try{w=await series(t,'5y','1wk')}catch(e){}}
        catch(e){if(!/^[A-Z][A-Z.\-]{0,5}$/.test(key))throw e; d=await stooqSeries(t); src='Stooq'}}
      const old=store.getDoc('quotes/c_'+key.replace(':','_'));
      const doc={...(old.exists?old.data:{}),key,d:d.d,c:d.c,updatedAt:now.toISOString(),source:src}; if(w&&w.d.length>=3)doc.w=w;
      store.setDoc('quotes/c_'+key.replace(':','_'),doc); ok++}
    catch(e){fails.push(key+': '+e.message)}
    await new Promise(r=>setTimeout(r,250));
  }
  log(`close series: ${ok}/${Math.min(keys.size,maxSeries)}${fails.length?'; failed: '+fails.slice(0,5).join(' | '):''}`);
  try{await usSnapshot(store,now,log)}catch(e){log('US snapshot failed:',e.message)}
  try{comoveTask(store,{log})}catch(e){log('comove failed:',e.message)}
}
// From the close series the night holds: the groups that move together (research/comove), the long-term ties
// (research/longterm) and the month-end closes (history/prices), for every security anyone holds. The Hebrew group
// names mirror the page's GROUPS; a group of mixed kinds is named by its members.
const GROUP_HE={tech:'טכנולוגיה',fin:'פיננסים',ind:'תעשייה וביטחון',health:'בריאות',cons:'צריכה ונדל״ן',space:'חלל',il:'ישראל (קרנות ומדדים)'};
export function comoveTask(store,{log=console.log}={}){
  const now=new Date(), held=new Set(), names={};
  const P=store.getDoc('portfolio/main'); for(const x of ((P.exists&&P.data.positions)||[]))if(x&&x.sym){held.add(x.sym); if(x.group)names[x.sym]=x.group}
  for(const p of store.pathsUnder('data/users'))if(/\/portfolio$/.test(p))for(const x of ((store.getDoc(p).data||{}).positions||[]))if(x&&x.sym){held.add(x.sym); if(x.group&&!names[x.sym])names[x.sym]=x.group}
  const series={}; for(const k of held){const d=store.getDoc('quotes/c_'+k.replace(':','_')); series[k]=d.exists&&d.data&&d.data.d&&d.data.d.length>=10?d.data:null}
  const withData=Object.keys(series).filter(k=>series[k]);
  const cm=comoveOf(series,{names,groupNames:GROUP_HE}); store.setDoc('research/comove',{...cm,source:'Yahoo Finance',updatedAt:now.toISOString()});
  const weekly=Object.fromEntries(withData.filter(k=>series[k].w&&series[k].w.d&&series[k].w.d.length>=100).map(k=>[k,series[k].w]));
  const lt=longtermOf(weekly); store.setDoc('research/longterm',{...lt,source:'Yahoo Finance',updatedAt:now.toISOString()});
  const PX=store.getDoc('history/prices'), px=monthlyCloses(Object.fromEntries(withData.map(k=>[k,series[k]])),PX.exists?PX.data:{},{until:now.toISOString()});
  store.setDoc('history/prices',{...(PX.exists?PX.data:{}),...px,updatedAt:now.toISOString(),source:'Yahoo Finance'});
  log(`comove: ${cm.groups.length} group(s), ${cm.pairs.length} pair(s) together, ${cm.opposite.length} opposite, ${cm.solo.length} independent, ${cm.nodata.length} without data; long-term ${lt.count} pair(s); ${px.months.length} months of closes for ${Object.keys(px.px).length} securities`);
  return {cm,lt,px};
}
// the chart series of one security (daily for a year, weekly for five, monthly since listing), for the page's charts
export async function closesFor(key,map={}){
  // an index: IDX:SPX, IDX:TA125 (the indices the page knows, BENCH)
  if(key.startsWith('IDX:')&&!BENCH[key.slice(4)])throw new Error('unknown index');
  const t=key.startsWith('IDX:')?BENCH[key.slice(4)].t:key.startsWith('TLV:')?(map[key]||key.slice(4)+'.TA'):tickerFor(key,null,map);
  const d=await series(t,'1y','1d'); const doc={key,d:d.d,c:d.c,updatedAt:new Date().toISOString(),source:'Yahoo Finance'};
  try{const w=await series(t,'5y','1wk'); if(w.d.length>=3)doc.w=w}catch(e){}
  try{const m=await series(t,'max','1mo'); if(m.d.length>=3)doc.m=m}catch(e){}
  return doc;
}
async function series(t,range,interval){
  const r=await fetchFor(20000)(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=${range}&interval=${interval}&includePrePost=false`,{headers:{'user-agent':UA}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json(); const res=j&&j.chart&&j.chart.result&&j.chart.result[0]; if(!res)throw new Error('no result');
  const off=+res.meta.gmtoffset||0, k=res.meta.currency==='ILA'?0.01:1, cl=((res.indicators||{}).quote||[{}])[0].close||[];
  const d=[],c=[]; (res.timestamp||[]).forEach((ts,i)=>{if(cl[i]!=null&&cl[i]>0){d.push(new Date((ts+off)*1000).toISOString().slice(0,10));c.push(Math.round(cl[i]*k*1e4)/1e4)}});
  if(!d.length)throw new Error('empty'); return {d,c};
}
// the nightly GitHub mirror of the nasdaq.com screener → quotes/all and the bucket series quotes/h_<prefix>
export async function usSnapshot(store,now,log){
  const US={}; const base='https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/';
  for(const ex of ['nasdaq','nyse','amex']){
    const r=await fetchFor(60000)(base+ex+'/'+ex+'_full_tickers.json'); if(!r.ok){log('mirror',ex,r.status);continue}
    for(const x of await r.json()){const s=String(x.symbol||'').trim().replace(/\//g,'.').replace(/\^/g,'-'); if(!/^[A-Z][A-Z.\-]{0,5}$/.test(s))continue;
      // a change the mirror does not give (an empty or "NA" field) stays unknown: null, shown as "—", never as 0%
      const px=parseFloat(String(x.lastsale||'').replace(/[$,]/g,'')), pc=String(x.pctchange||''); const pct=/^-?[\d.]+%?$/.test(pc.replace(/,/g,''))?parseFloat(pc.replace(/[%,]/g,'')):null;
      if(px>0)US[s]=[Math.round(px*1e4)/1e4,pct==null||!isFinite(pct)?null:Math.round(pct*100)/100]}
  }
  if(!Object.keys(US).length)return;
  let snapDate=null; const cand={};
  for(const k of ['NVDA','MSFT','AAPL','AMZN','JPM','KO','META','GOOGL']){if(!US[k])continue; const c=store.getDoc('quotes/c_'+k); if(!c.exists)continue;
    (c.data.d||[]).forEach((dt,i)=>{const v=c.data.c[i]; if(v!=null&&Math.abs(v-US[k][0])<0.011)cand[dt]=(cand[dt]||0)+1})}
  const best=Object.entries(cand).sort((a,b)=>b[1]-a[1]||(b[0]<a[0]?-1:1))[0]; if(best)snapDate=best[0];
  if(!snapDate){const t=new Date(now); t.setUTCDate(t.getUTCDate()-1); while(t.getUTCDay()===0||t.getUTCDay()===6)t.setUTCDate(t.getUTCDate()-1); snapDate=t.toISOString().slice(0,10)}
  const old=store.getDoc('quotes/all');
  store.setDoc('quotes/all',{date:snapDate,tlvDate:old.exists?old.data.tlvDate||null:null,updatedAt:now.toISOString(),us:US,tlv:old.exists?(old.data.tlv||{}):{},source:'nasdaq.com via GitHub rreichel3/US-Stock-Symbols'});
  const BK={A:14,B:10,C:13,D:5,E:6,F:6,G:7,H:5,I:6,J:2,K:4,L:5,M:8,N:7,O:5,P:9,Q:1,R:6,S:11,T:7,U:3,V:4,W:4,X:2,Y:1,Z:1};
  const prefix=k=>{const L=k[0],n=BK[L]||1,s=k[1]||'A',idx=s>='A'&&s<='Z'?s.charCodeAt(0)-65:0;return L+String(Math.floor(idx*n/26)).padStart(2,'0')};
  const by={}; for(const [k,v] of Object.entries(US))(by[prefix(k)]=by[prefix(k)]||{})[k]=v[0];
  let changed=0;
  for(const [pre,items] of Object.entries(by)){
    const name='quotes/h_'+pre, cur=store.getDoc(name), d=cur.exists?cur.data:{d:[],c:{}};
    let dates=[...(d.d||[])], ser=Object.fromEntries(Object.entries(d.c||{}).map(([k,v])=>[k,[...v]])), dirty=false;
    if(!dates.includes(snapDate)){dates.push(snapDate);dates.sort();const i=dates.indexOf(snapDate);for(const s of Object.values(ser))s.splice(i,0,null);dirty=true}
    const i=dates.indexOf(snapDate);
    for(const [k,px] of Object.entries(items)){const s=ser[k]||(ser[k]=new Array(dates.length).fill(null)); while(s.length<dates.length)s.push(null); if(s[i]!==px){s[i]=px;dirty=true}}
    if(dates.length>250){const cut=dates.length-250;dates=dates.slice(cut);for(const k in ser)ser[k]=ser[k].slice(cut);dirty=true}
    if(dirty){store.setDoc(name,{d:dates,c:ser,updatedAt:now.toISOString()},{silent:true});changed++}
  }
  log(`US snapshot ${Object.keys(US).length} symbols (date ${snapDate}), ${changed} bucket documents changed`);
}

// 07:50: the page's alert engine; only what is new (and not marked "בדקתי") goes out; alerts/state is written
export async function morningTask(store,{log}={}){
  const docs=ownerDocs(store), now=new Date(), p=ilParts(now);
  if(!docs['portfolio/main']||!docs['quotes/latest']){log('no portfolio or quotes yet');return}
  const {out:AD,errs}=await withPage(docs,ownerUser(store),pg=>pg.evaluate(()=>({a:window.__model.alerts(),d:window.__model.digest?window.__model.digest():null})));
  const A=AD&&AD.a, G=AD&&AD.d;
  if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
  if(!A||!A.ready){log('the alert engine was not ready');return}
  const state=docs['alerts/state']||{keys:[]}, seen=new Set(state.keys||[]);
  // a company's new report already went out in its own e-mail ("earnings") when that one is on, so it is not repeated here
  const repMail=mailAllowed(store,'earnings'), items=(A.items||[]).filter(i=>i&&i.key), fresh=items.filter(i=>!seen.has(i.key)&&!i.acked&&!(repMail&&String(i.key).startsWith('rep:')));
  log(`alerts: ${items.length} now, ${fresh.length} new`);
  const SEV={crit:'חריגה',warn:'לבדיקה',info:'מידע',ok:'תקין'}, ORDER={crit:0,warn:1,info:2,ok:3}, color={crit:'#b42318',warn:'#b7791f',info:'#2464a8',ok:'#2f9e5b'};
  // 30.10: the morning summary goes out every morning (with the consent for "morning"), new alerts or not
  if(fresh.length||(G&&G.ready)){
    fresh.sort((a,b)=>(ORDER[a.sev]??9)-(ORDER[b.sev]??9));
    const S2=morningSections(G,fresh,{SEV,color});
    const url=process.env.SITE_URL||''; const when=`מחירים נכון ל-${A.pricesAt?new Date(A.pricesAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'?'}`;
    const text=`בוקר טוב.\n\n${S2.map(x=>x.t+'\n'+x.text).join('\n\n')}\n\n${when}${url?'\nלפתיחת הדף: '+url:''}\n\nעובדות מהתיק שלך ומהידיעות; לא המלצה לקנות או למכור.`;
    const html=wrapHtml('סיכום הבוקר',`<p>בוקר טוב.</p>${S2.map(x=>`<h3 style="margin:16px 0 6px;font-size:15px">${esc(x.t)}</h3>${x.html}`).join('')}<p style="color:#64748b;font-size:13px">${esc(when)}</p>${url?`<p><a href="${esc(url)}" style="color:#1e344e;font-weight:700">לפתיחת הדף ›</a></p>`:''}<p style="color:#64748b;font-size:12px">עובדות מהתיק שלך ומהידיעות; לא המלצה לקנות או למכור.</p>`);
    const head=fresh.some(i=>i.sev==='crit')?'יש חריגה חדשה':G&&G.news&&G.news.some(n=>n.level==='crit')?'ידיעה קריטית על מניה שלך':G&&G.day?`התיק ${G.day.ils>=0?'עלה':'ירד'} ${Math.abs(G.day.pct).toFixed(2)}%`:'סיכום';
    await sendAllowed(store,'morning',{subject:`תיק צ׳יק – סיכום הבוקר: ${head}`,text,html},log);
  }
  store.setDoc('alerts/state',{date:p.iso,keys:items.map(i=>i.key),moveDate:fresh.length?p.iso:(state.moveDate||null),sent:fresh.length,updatedAt:now.toISOString()});
}

// the money put in, net: as the page's depNet (withdrawals saved before 13.10.2026 were not yet taken off depIlsNow)
export function depNetOf(h,fx){
  if(!h||h.depIlsNow==null)return null; let w=0;
  for(const A of h.accounts||[])for(const d of A.deposits||[])if(+d.amount<0&&!d.inDep)w+=Math.abs(+d.amount)*((d.ccy||A.ccy)==='USD'?(+fx||0):1);
  return Math.round(((+h.depIlsNow||0)-w)*100)/100;
}
// the 1st of the month: the month-end row in history/main and the month's closes in history/prices
export async function monthlyTask(store,{log,ym=null}={}){
  const now=new Date(), p=ilParts(now);
  ym=ym||(()=>{const d=new Date(Date.UTC(p.y,p.m-1,1));d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)})();
  const [H,PX,DY,Q,P]=['history/main','history/prices','history/daily','quotes/latest','portfolio/main'].map(x=>store.getDoc(x));
  const points=(DY.exists&&DY.data.points)||{}, days=Object.keys(points).filter(k=>k.startsWith(ym)&&points[k]&&points[k].v>0).sort();
  const last=days.length?points[days[days.length-1]]:null, fx=Q.exists?(+Q.data.usdIls||null):null;
  const positions=(P.exists&&P.data.positions)||[], prices=Q.exists?(Q.data.prices||{}):{};
  let by=last&&last.by?{...last.by}:null, tot=last?last.v:null, dep=last?last.dep:null;
  if(!by){by={};tot=0;for(const x of positions){const px=prices[x.sym];if(!(px>0))continue;const v=(+x.qty||0)*px*(x.ccy==='USD'?(fx||0):1);by[x.acct]=(by[x.acct]||0)+v;tot+=v}
    for(const c of ((P.exists&&P.data.cash)||[])){const v=(+c.amount||0)*(c.ccy==='USD'?(fx||0):1);by[c.acct]=(by[c.acct]||0)+v;tot+=v}
    for(const k in by)by[k]=Math.round(by[k]*100)/100; tot=Math.round(tot*100)/100; if(H.exists)dep=depNetOf(H.data,fx)}
  const row={ym,exc:by.exc!=null?by.exc:null,blink:by.blink!=null?by.blink:null,tot,by,dep,fx,excEst:!last,at:now.toISOString()};
  const h=H.exists?H.data:{};
  store.setDoc('history/main',{...h,monthly:(h.monthly||[]).filter(r=>r.ym!==ym).concat([row]).sort((a,b)=>a.ym<b.ym?-1:1),updatedAt:now.toISOString()});
  const px=PX.exists?PX.data:{months:[],px:{}}, months=[...(px.months||[])], ser=Object.fromEntries(Object.entries(px.px||{}).map(([k,v])=>[k,[...v]]));
  const src=last&&last.px?last.px:prices;
  let idx=months.indexOf(ym); if(idx<0){months.push(ym);months.sort();idx=months.indexOf(ym);for(const s of Object.values(ser))s.splice(idx,0,null)}
  for(const s of new Set([...Object.keys(ser),...positions.map(x=>x.sym)])){const arr=ser[s]||(ser[s]=new Array(months.length).fill(null)); while(arr.length<months.length)arr.push(null); const v=src[s]; if(v>0)arr[idx]=Math.round(v*1e4)/1e4}
  store.setDoc('history/prices',{...px,months,px:ser,updatedAt:now.toISOString()});
  log(`month ${ym}: saved, ${months.length} months of closes${last?'':' (estimated from the positions)'}`);
  return row;
}

// reports by the page's own report code: archived and sent as a PDF
export async function reportTask(store,{log,kind='week'}={}){
  const now=new Date(), p=ilParts(now), specs=[];
  const prevMonth=()=>{const d=new Date(Date.UTC(p.y,p.m-1,1));d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)};
  if(kind.includes(':'))specs.push(kind);
  else if(kind==='week')specs.push('week');
  else if(kind==='month')specs.push('month:'+prevMonth());
  else if(kind==='quarter'){const m=p.m, y=m===1?p.y-1:p.y, q=m===1?4:Math.floor((m-2)/3)+1; specs.push(`quarter:${y}-Q${q}`); if(m===7)specs.push(`half:${p.y}-H1`); if(m===1){specs.push(`half:${y}-H2`);specs.push(`year:${y}`)}}
  const docs=ownerDocs(store); if(!docs['portfolio/main']||!docs['quotes/latest']){log('no portfolio or quotes yet');return []}
  for(const a of store.listDocs('reports/archive/items'))docs['reports/archive/items/'+a.id]=a.data;
  const {out,errs}=await withPage(docs,ownerUser(store),async pg=>{
    await pg.waitForFunction(()=>window.__rep.ready(),null,{timeout:45000}).catch(()=>{});
    const res=[];
    for(const spec of specs){const [k,y]=spec.split(':'); const doc=await pg.evaluate(([k,y])=>window.__rep.build(k,y),[k,y||'']); if(!doc){res.push({spec,error:'no report'});continue}
      const pdf=await pg.evaluate(R=>window.__rep.pdf(R),doc.R);
      const B=doc.R.blocks||[], cards=B.find(x=>x.t==='cards'), say=B.find(x=>x.t==='say'), rc=cards&&cards.items&&cards.items.find(c=>c.res);
      const sg=n=>(n>=0?'+':'-')+'₪'+Math.abs(Math.round(n)).toLocaleString('en-US');
      res.push({spec,doc,pdf,lines:[doc.R.title+' · '+doc.R.period,rc?`${rc.k}: ${sg(rc.gain)}${rc.pct!=null?' ('+(rc.pct>=0?'+':'')+(+rc.pct).toFixed(1)+'%)':''}`:'',say?say.text:'',cards&&cards.vals?cards.vals.map(i=>i[0]+': '+i[1]).join(' | '):''].filter(Boolean)})}
    return res;
  },{fonts:true});
  if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
  for(const r of out){
    if(r.error){log(r.spec,'→',r.error);continue}
    store.setDoc('reports/archive/items/'+r.doc.id,r.doc);
    const file=(r.doc.id.startsWith('week')?'doch-shvui':r.doc.id.startsWith('month')?'doch-hodshi':r.doc.id.startsWith('quarter')?'doch-rivoni':r.doc.id.startsWith('half')?'doch-hatzi-shnati':'doch-shnati')+'-'+p.iso+'.pdf';
    await sendAllowed(store,'reports',{subject:`תיק צ׳יק – ${r.doc.title}${r.doc.period?' · '+r.doc.period:''}`,text:r.lines.join('\n')+'\n\nהדוח המלא מצורף ושמור בארכיון בדף. עובדות ומספרים בלבד; לא המלצה לקנות או למכור.',
      html:wrapHtml(r.doc.title,`<p>${r.lines.map(esc).join('<br>')}</p><p style="color:#64748b;font-size:13px">הדוח המלא מצורף כ-PDF, וגם שמור בארכיון בדף.</p>`),attachments:[{filename:file,content:Buffer.from(r.pdf,'base64'),contentType:'application/pdf'}]},log);
    log(`${r.spec} → ${r.doc.id} saved, ${Math.round(r.pdf.length*3/4/1024)} KB PDF`);
  }
  return out.filter(r=>!r.error).map(r=>r.doc.id);
}

// 30.10: the sections of the morning summary: the last trading day, the news that matter to the holdings, the new alerts,
// the coming week. Each as text and as HTML; a section with nothing in it is left out
export function morningSections(G,fresh,{SEV={},color={}}={}){
  const out=[], ils=v=>(v<0?'−':'+')+'₪'+Math.abs(Math.round(v)).toLocaleString('en-US'), pc=v=>(v<0?'−':'+')+Math.abs(v).toFixed(2)+'%';
  if(G&&G.day){const t=`התיק ${G.day.ils>=0?'עלה':'ירד'} ${pc(G.day.pct)} (${ils(G.day.ils)})`+(G.day.top.length?`, בעיקר ${G.day.top.map(x=>`${x.sym} ${pc(x.pct)}`).join(', ')}`:'')+'.';
    out.push({t:'ביום המסחר האחרון',text:t,html:`<p style="margin:0">${esc(t)}</p>`})}
  if(G&&G.news&&G.news.length){const L=G.news.map(n=>`${n.level==='crit'?'[קריטי] ':''}${n.who?n.who+': ':''}${n.he}${n.what?'. '+n.what:''}`);
    out.push({t:'ידיעות חשובות על המניות שלך',text:L.map((l,i)=>`• ${l}${G.news[i].link?'\n  '+G.news[i].link:''}`).join('\n'),
      html:`<ul style="padding-inline-start:18px;margin:0">${G.news.map((n,i)=>`<li style="margin:6px 0">${n.level==='crit'?'<b style="color:#b42318">קריטי</b> ':''}${esc(L[i].replace(/^\[קריטי\] /,''))}${n.link?` <a href="${esc(n.link)}">${esc(n.pub||'למקור')}</a>`:''}</li>`).join('')}</ul>`})}
  if(fresh&&fresh.length)out.push({t:'התראות חדשות',text:fresh.map(i=>`[${SEV[i.sev]||i.sev}] ${i.cat?i.cat+': ':''}${i.text}`).join('\n'),
    html:`<ul style="padding-inline-start:18px;margin:0">${fresh.map(i=>`<li style="margin:6px 0"><span style="color:${color[i.sev]||'#1e293b'};font-weight:700">${esc(SEV[i.sev]||i.sev)}</span> ${i.cat?'<b>'+esc(i.cat)+':</b> ':''}${esc(i.text)}</li>`).join('')}</ul>`});
  if(G&&G.soon&&G.soon.length){const L=G.soon.map(x=>`${x.d.slice(8,10)}.${x.d.slice(5,7)}: ${x.items.join(' · ')}`);
    out.push({t:'השבוע בתיק',text:L.join('\n'),html:`<ul style="padding-inline-start:18px;margin:0">${L.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`})}
  if(G&&G.divYear)out.push({t:'דיבידנדים',text:`התיק מייצר כ-₪${G.divYear.toLocaleString('en-US')} בשנה מדיבידנדים, לפני מס.`,html:`<p style="margin:0">התיק מייצר כ-₪${G.divYear.toLocaleString('en-US')} בשנה מדיבידנדים, לפני מס.</p>`});
  return out;
}
