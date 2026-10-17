// every outside call has a time limit: one stuck connection must never hold the price update forever
export const timedFetch=(u,o={})=>globalThis.fetch(u,{...o,signal:o.signal||AbortSignal.timeout(12000)});
// Market prices for the page: Yahoo Finance (US and Tel Aviv), Stooq as a fallback for US tickers, the Bank of Israel
// representative rate and the live USD/ILS rate. Plain fetch, so the same code runs in GitHub Actions and in the
// Cloudflare function. Nothing here is advice: numbers in, numbers out.
import {dm, nyParts, ilParts} from './market.js';

const UA='Mozilla/5.0 (compatible; tik-chik/1.0)';
const YH=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];

// the page's own symbols for index funds, priced from their index while no direct quote source is configured
export const PROXY={TA125:{index:'^TA125.TA',label:'לפי מדד ת״א 125'},TA90:{index:'^TA90.TA',label:'לפי מדד ת״א 90'}};
// the indices a person can follow on the home page (and the two the crisis center compares with), from the same Yahoo
// source. A US index also carries its front-month future (`fut`), which trades almost around the clock
export const BENCH={SPX:{t:'^GSPC',name:'S&P 500',fut:'ES=F'},NDX:{t:'^NDX',name:'נאסד״ק 100',fut:'NQ=F'},DJI:{t:'^DJI',name:'דאו ג׳ונס',fut:'YM=F'},RUT:{t:'^RUT',name:'ראסל 2000',fut:'RTY=F'},
  TA125:{t:'^TA125.TA',name:'ת״א 125'},TA35:{t:'^TA35.TA',name:'ת״א 35'}};

export function tickerFor(sym,pos,map){
  if(map&&map[sym])return map[sym];
  if(PROXY[sym])return null;
  if(/^\d{5,9}$/.test(sym))return sym+'.TA';
  if(pos&&pos.ccy==='ILS'&&!/\.TA$/.test(sym))return sym+'.TA';
  return sym.replace(/\./g,'-');
}

const dayOf=(ts,off)=>{const d=new Date((ts+off)*1000);return d.toISOString().slice(0,10)};

// one ticker from Yahoo's chart endpoint: last price, previous close, their dates, currency
export async function yahooChart(ticker,{fetch:f=timedFetch,range='10d'}={}){
  let last=null;
  for(const host of YH){
    try{
      const r=await f(`${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&includePrePost=false`,{headers:{'user-agent':UA,accept:'application/json'}});
      if(!r.ok){last=new Error('HTTP '+r.status);continue}
      const j=await r.json(); const res=j&&j.chart&&j.chart.result&&j.chart.result[0];
      if(!res){last=new Error((j&&j.chart&&j.chart.error&&j.chart.error.description)||'no result');continue}
      const m=res.meta||{}, off=+m.gmtoffset||0, ts=res.timestamp||[], cl=((res.indicators||{}).quote||[{}])[0].close||[];
      const bars=ts.map((t,i)=>({t,c:cl[i]})).filter(b=>b.c!=null&&b.c>0);
      let px=+m.regularMarketPrice; const ptime=+m.regularMarketTime||(bars.length?bars[bars.length-1].t:0);
      if(!(px>0)&&bars.length)px=bars[bars.length-1].c;
      if(!(px>0))throw new Error('no price');
      const pday=dayOf(ptime,off); const before=bars.filter(b=>dayOf(b.t,off)<pday);
      let prev=before.length?before[before.length-1].c:(+m.chartPreviousClose||+m.previousClose||null), prevDate=before.length?dayOf(before[before.length-1].t,off):null;
      const ccy=m.currency||''; const k=ccy==='ILA'||ccy==='GBp'?0.01:1;
      return {px:px*k,prev:prev!=null?prev*k:null,ccy:ccy==='ILA'?'ILS':ccy==='GBp'?'GBP':ccy,time:ptime*1000,closeDate:pday,prevDate,exch:m.exchangeName||'',src:'yahoo'};
    }catch(e){last=e}
  }
  throw last||new Error('yahoo failed');
}

// Stooq daily history (US tickers as msft.us); last two closes
export async function stooqDaily(ticker,{fetch:f=timedFetch}={}){
  const s=ticker.toLowerCase().replace(/-/g,'-')+'.us';
  const r=await f(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`,{headers:{'user-agent':UA}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const rows=(await r.text()).trim().split('\n').slice(1).map(l=>l.split(',')).filter(p=>p.length>=5&&+p[4]>0);
  if(!rows.length)throw new Error('no rows');
  const a=rows[rows.length-1], b=rows[rows.length-2];
  return {px:+a[4],prev:b?+b[4]:null,ccy:'USD',time:new Date(a[0]+'T21:00:00Z').getTime(),closeDate:a[0],prevDate:b?b[0]:null,exch:'',src:'stooq'};
}

// the Bank of Israel representative rate for the dollar
export async function boiUsd({fetch:f=timedFetch}={}){
  for(const u of ['https://boi.org.il/PublicApi/GetExchangeRates?asJson=true','https://www.boi.org.il/PublicApi/GetExchangeRates?asJson=true']){
    try{const r=await f(u,{headers:{'user-agent':UA,accept:'application/json'}}); if(!r.ok)continue;
      const j=await r.json(); const L=j.exchangeRates||j.ExchangeRates||(Array.isArray(j)?j:[]);
      const x=L.find(e=>String(e.key||e.Key||e.currencyCode||'').toUpperCase()==='USD'); if(!x)continue;
      const rate=+(x.currentExchangeRate||x.CurrentExchangeRate||x.rate); const unit=+(x.unit||x.Unit||1)||1;
      const at=String(x.lastUpdate||x.LastUpdate||'').slice(0,10);
      if(rate>0)return {rate:rate/unit,date:at,src:'boi'};
    }catch(e){}
  }
  return null;
}

// everything the quotes document needs: {quotes:{SYM:{px,prev,...}}, fx:{rate,boi,live}, errors:[]}
export async function fetchAll(symbols,{positions=[],map={},fetch:f=timedFetch,concurrency=6,log=()=>{}}={}){
  const posOf=Object.fromEntries(positions.map(p=>[p.sym,p]));
  const out={}, errors=[], idx={};
  const need=[...new Set(symbols)].filter(Boolean);
  const tasks=need.map(sym=>async()=>{
    const pr=PROXY[sym]&&!(map&&map[sym]);
    const t=pr?PROXY[sym].index:tickerFor(sym,posOf[sym],map);
    try{const q=await yahooChart(t,{fetch:f}); if(pr)idx[sym]=q; else out[sym]=q}
    catch(e){
      if(!pr&&!/\.TA$/.test(t)){try{out[sym]=await stooqDaily(t,{fetch:f});return}catch(e2){}}
      errors.push(sym+': '+(e&&e.message||e)); log('quote failed '+sym+' ('+t+'): '+(e&&e.message||e));
    }
  });
  let i=0; await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{while(i<tasks.length){const k=i++;await tasks[k]()}}));
  const [boi,live]=await Promise.all([boiUsd({fetch:f}).catch(()=>null),yahooChart('USDILS=X',{fetch:f}).catch(()=>null)]);
  const bench={}; await Promise.all(Object.entries(BENCH).map(async([k,b])=>{try{const q=idx.TA125&&k==='TA125'?idx.TA125:await yahooChart(b.t,{fetch:f}); if(q&&q.px>0&&q.prev>0)bench[k]={px:q.px,prev:q.prev,date:q.closeDate,prevDate:q.prevDate||null,at:q.time}}catch(e){}
    if(b.fut){try{const q=await yahooChart(b.fut,{fetch:f}); if(q&&q.px>0&&q.prev>0&&bench[k])bench[k].fut={px:q.px,prev:q.prev,date:q.closeDate,at:q.time}}catch(e){}}}));
  return {quotes:out,index:idx,fx:{boi,live},bench,errors};
}

// the next quotes/latest document, from the fetched prices and the stored one
export function buildQuotesDoc({prev:old={},fetched,symbols,positions=[],now=new Date(),usOpen=false,ilOpen=false}){
  const prices={...(old.prices||{})}, prevC={...(old.prev||{})}, stale={}, meta={...(old.meta||{})};
  const posOf=Object.fromEntries(positions.map(p=>[p.sym,p]));
  let usDate='', prevDate='', ilDate='', got=0;
  for(const sym of symbols){
    const q=fetched.quotes[sym];
    if(q){got++; prices[sym]=round(q.px); if(q.prev!=null)prevC[sym]=round(q.prev); meta[sym]={src:q.src,date:q.closeDate,at:q.time};
      if(q.ccy==='USD'&&q.closeDate>usDate){usDate=q.closeDate;prevDate=q.prevDate||prevDate}
      if(q.ccy!=='USD'&&q.closeDate>ilDate)ilDate=q.closeDate;
      if(q.src==='stooq')stale[sym]='סגירה '+dm(q.closeDate);
      continue}
    const ix=fetched.index[sym];
    if(ix&&PROXY[sym]&&ix.prev>0){ // an index fund priced from its index, from the last close we have
      got++; if(ix.closeDate>ilDate)ilDate=ix.closeDate;
      const m=meta[sym]||{}; let base=prevC[sym];
      if(m.src==='index'&&m.date&&ix.closeDate>m.date&&prices[sym]>0)base=prices[sym];
      if(!(base>0))base=prices[sym]>0?prices[sym]:(posOf[sym]&&+posOf[sym].px>0?+posOf[sym].px:null);
      if(base>0){prices[sym]=round(base*ix.px/ix.prev,3);prevC[sym]=round(base,3);meta[sym]={src:'index',date:ix.closeDate,at:ix.time};stale[sym]=PROXY[sym].label;continue}
    }
    if(prices[sym]!=null)stale[sym]='מחיר קודם'; else if(posOf[sym]&&+posOf[sym].px>0){prices[sym]=+posOf[sym].px;stale[sym]='מחיר מהדוח'}
  }
  const fx=fetched.fx||{}; const usdIls=fx.live&&fx.live.px>0?round(fx.live.px,4):fx.boi?round(fx.boi.rate,4):old.usdIls;
  // the dollar's previous close, from the same Yahoo answer: with it the page can say how much of a day's change came from the
  // rate. Only when this run's rate is that same market rate; otherwise unknown (null), never a guess
  const fxPrev=fx.live&&fx.live.px>0&&fx.live.prev>0?{rate:round(fx.live.prev,4),date:fx.live.prevDate||null,now:round(fx.live.px,4)}:null;
  const fxLabel=fx.boi?`יציג בנק ישראל ${dm(fx.boi.date)}${fx.live&&fx.live.px>0?' · שער שוק '+round(fx.live.px,3):''}`:fx.live?'שער שוק':(old.fxLabel||'');
  // a price we hold but did not refresh this time (past the symbol cap, or nobody holds it now) is marked as old
  for(const sym of Object.keys(prices))if(!symbols.includes(sym)&&!stale[sym]){const d=(meta[sym]||{}).date; stale[sym]=d?'סגירה '+dm(d):'מחיר קודם'}
  // "live" only when the data says so: the market is open by the clock AND today's trades arrived (on a holiday, or when
  // every fetch failed, the last close is shown as a close)
  const usLive=usOpen&&!!usDate&&usDate===nyParts(now).iso, ilLive=ilOpen&&!!ilDate&&ilDate===ilParts(now).iso;
  const failed=symbols.length>0&&got===0;
  const priceLabel=failed?'המחירים האחרונים שהתקבלו':usLive?'מסחר חי, עיכוב של עד 15 דקות':ilLive?`מסחר חי בתל אביב${usDate?' · ארה״ב: סגירה '+dm(usDate):''}`:usDate?`סגירה ${dm(usDate)}`:(old.priceLabel||'');
  const usD=usDate||old.usDate||'', ilD=ilDate||old.ilDate||'';
  // the indices: this run's values, or the last ones with their dates when this run did not get them
  const bench={...(old.bench||{})}; for(const [k,v] of Object.entries(fetched.bench||{}))bench[k]={...v,name:(BENCH[k]||{}).name||k};
  return {prices,prev:prevC,stale,meta,usdIls,fxPrev,bench,fxLabel,priceLabel,prevLabel:prevDate?`סגירה ${dm(prevDate)}`:(old.prevLabel||''),boiUsd:fx.boi?round(fx.boi.rate,4):(old.boiUsd||null),
    source:'Yahoo Finance, בנק ישראל',
    // updatedAt = the last time prices actually arrived; a run that got nothing keeps the old time, so the page can say the prices are late
    updatedAt:failed?(old.updatedAt||null):now.toISOString(), attemptAt:now.toISOString(), got, of:symbols.length,
    usDate:usD, ilDate:ilD, lastTradeDay:[usD,ilD].sort().at(-1)||'', live:usLive||ilLive,
    errors:(fetched.errors||[]).slice(0,40)};
}
const round=(x,n=2)=>{const k=Math.pow(10,n);return Math.round(x*k)/k};
