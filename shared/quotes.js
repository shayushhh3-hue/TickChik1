// every outside call has a time limit: one stuck connection must never hold the price update forever
export const timedFetch=(u,o={})=>globalThis.fetch(u,{...o,signal:o.signal||AbortSignal.timeout(12000)});
// Market prices for the page: Yahoo Finance (US and Tel Aviv), Stooq as a fallback for US tickers, the Bank of Israel
// representative rate and the live USD/ILS rate. Plain fetch, so the same code runs in GitHub Actions and in the
// Cloudflare function. Nothing here is advice: numbers in, numbers out.
import {dm, nyParts, ilParts, lastSession} from './market.js';

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
  // a suffix of two or three letters is an exchange (SAP.DE, 0700.HK), and so are the one-letter exchanges Yahoo uses
  // (7203.T Tokyo, SHEL.L London, .F Frankfurt, .V Vancouver); any other single letter is a share class (BRK.B)
  if(/\.[A-Z]{2,3}$/.test(sym)||/\.[TLFV]$/.test(sym))return sym;
  return sym.replace(/\./g,'-');
}
// the currencies a page can hold besides the shekel and the dollar; each is fetched against the shekel when a quote uses it
export const CCYS=['EUR','GBP','JPY','CHF','CAD','AUD','HKD','SEK','NOK','DKK','SGD','INR','CNY','BRL','MXN','KRW','TWD'];

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

// Israeli mutual funds (a seven-digit number starting with 5) are not on Yahoo. Their daily price comes from Maya, the
// exchange's own disclosure site (an interface its pages use, not a documented one): the fund's details, read defensively
// for the redemption price, its date and the day's change, so a renamed field is logged rather than mistaken for a price.
// the US index a fund follows, from its name (Hebrew or English): its value moves with that index between official prices
export const trackOf=name=>{const n=String(name||''); return /nasdaq|נאסד/i.test(n)&&/100/.test(n)?'NDX':/s&p|אס.?אנד.?פי/i.test(n)&&/500/.test(n)?'SPX':/dow|דאו/i.test(n)?'DJI':/russell|ראסל/i.test(n)?'RUT':''};
export const isIlFund=sym=>/^5\d{6}$/.test(String(sym||''));
const MAYA_H={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',accept:'application/json, text/plain, */*','x-maya-with':'allow',referer:'https://maya.tase.co.il/','accept-language':'he-IL,he;q=0.9'};
const flat=(o,pre='',d=0,out={})=>{if(o&&typeof o==='object'&&d<4){for(const [k,v] of Object.entries(o)){if(v&&typeof v==='object'&&!Array.isArray(v))flat(v,pre+k+'.',d+1,out); else if(Array.isArray(v))v.slice(0,3).forEach((x,i)=>flat(x,pre+k+'['+i+'].',d+1,out)); else out[pre+k]=v}} return out};
const numOf=v=>{if(typeof v==='number')return v; if(typeof v==='string'){const n=+v.replace(/[,\s₪%]/g,''); return isNaN(n)?null:n} return null};
const dateOf=v=>{if(!v)return ''; const s=String(v); let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; return ''};
export function fundFromJson(j,now=new Date()){
  const F=flat(j); const keys=Object.keys(F);
  const pick=(re,ok,not)=>{for(const k of keys){const last=k.split('.').pop(); if(re.test(last)&&!(not&&not.test(last))){const v=ok(F[k]); if(v)return v}} return null};
  const num=v=>{const n=numOf(v); return n>0&&n<1e7?n:null};
  // the redemption price first (what a unit is worth), then a unit or last price, then any price-like field that is not a fee or a ratio
  const px=pick(/^(redemption|redeem|pidyon|sell)[_ ]?(price|rate|value)$/i,num)
    ||pick(/^(unit[_ ]?(value)?[_ ]?|last[_ ]?|close[_ ]?|closing[_ ]?)(price|rate|value|nav)$|^(price|rate|nav)$/i,num)
    ||pick(/price|nav|shaar/i,num,/fee|commission|change|yield|percent|pct|tax|ratio|size|amount|min|max|units?$|purchase|buy|start|open/i);
  if(!(px>0))return null;
  // the price's date: a field that names the price or an update, never the fund's start date; and only a recent one
  const recent=v=>{const d=dateOf(v); if(!d)return ''; const t=new Date(d+'T12:00:00Z').getTime(), n=now.getTime(); return t<=n+864e5&&n-t<90*864e5?d:''};
  // every recent date in the answer, by field; the price's date is the latest of them (a fund of foreign shares can carry
  // an older date beside the price's own, e.g. its index's), and the fields are kept so the owner can see what came
  const NOT=/start|inception|establish|found|end|expir|issue|report|publish|birth|open/i, dates={};
  for(const k of keys){const last=k.split('.').pop(); if(/date|time|asof|updated/i.test(last)&&!NOT.test(last)){const d=recent(F[k]); if(d)dates[k]=d}}
  const date=Object.values(dates).sort().at(-1)||'';
  const chg=pick(/(day|daily)[_ ]?(yield|change|return|pct|percent)|(yield|change|return)[_ ]?(day|daily)|dayrate|dailyrate|changepercent|percentchange/i,v=>{const n=numOf(v); return n==null||Math.abs(n)>60?null:n});
  const prev=chg!=null?px/(1+chg/100):null;
  const name=pick(/name/i,v=>typeof v==='string'&&v.length>2&&v.length<120?v:null,/manager|company|trustee|english|class|category|type/i)||'';
  return {px,prev,name,ccy:'ILS',time:date?new Date(date+'T15:00:00Z').getTime():now.getTime(),closeDate:date,prevDate:null,exch:'TASE',src:'maya',chg,dates:Object.fromEntries(Object.entries(dates).slice(0,6))};
}
export async function mayaFund(id,{fetch:f=timedFetch}={}){
  let last=null;
  for(const u of [`https://mayaapi.tase.co.il/api/fund/details?fundId=${encodeURIComponent(id)}`,`https://maya.tase.co.il/api/v1/funds/mutual/${encodeURIComponent(id)}`]){
    try{const r=await f(u,{headers:MAYA_H}); if(!r.ok){last=new Error('HTTP '+r.status);continue}
      const j=await r.json(); const q=fundFromJson(j); if(q)return q;
      last=new Error('no price field; keys: '+Object.keys(flat(j)).slice(0,40).join(','))}
    catch(e){last=e}
  }
  throw last||new Error('maya failed');
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
    let mayaErr=null;
    if(isIlFund(sym)&&!(map&&map[sym])){try{out[sym]=await mayaFund(sym,{fetch:f});return}catch(e){mayaErr=e; log('fund price failed '+sym+' (maya): '+(e&&e.message||e))}}
    try{const q=await yahooChart(t,{fetch:f}); if(pr)idx[sym]=q; else out[sym]=q}
    catch(e){
      if(!pr&&!/\.TA$/.test(t)){try{out[sym]=await stooqDaily(t,{fetch:f});return}catch(e2){}}
      errors.push(sym+': '+(mayaErr?'מאיה: '+String(mayaErr&&mayaErr.message||mayaErr).slice(0,160)+' · Yahoo: ':'')+(e&&e.message||e)); log('quote failed '+sym+' ('+t+'): '+(e&&e.message||e));
    }
  });
  let i=0; await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{while(i<tasks.length){const k=i++;await tasks[k]()}}));
  const [boi,live]=await Promise.all([boiUsd({fetch:f}).catch(()=>null),yahooChart('USDILS=X',{fetch:f}).catch(()=>null)]);
  // other currencies seen in this run's quotes, against the shekel
  const needCcy=[...new Set(Object.values(out).map(q=>q&&q.ccy).filter(c=>c&&CCYS.includes(c)))], rates={};
  await Promise.all(needCcy.map(async c=>{try{const q=await yahooChart(c+'ILS=X',{fetch:f}); if(q&&q.px>0)rates[c]={rate:q.px,prev:q.prev||null,date:q.closeDate}}catch(e){}}));
  const bench={}; await Promise.all(Object.entries(BENCH).map(async([k,b])=>{try{const q=idx.TA125&&k==='TA125'?idx.TA125:await yahooChart(b.t,{fetch:f}); if(q&&q.px>0&&q.prev>0)bench[k]={px:q.px,prev:q.prev,date:q.closeDate,prevDate:q.prevDate||null,at:q.time}}catch(e){}
    if(b.fut){try{const q=await yahooChart(b.fut,{fetch:f}); if(q&&q.px>0&&q.prev>0&&bench[k])bench[k].fut={px:q.px,prev:q.prev,date:q.closeDate,at:q.time}}catch(e){}}}));
  return {quotes:out,index:idx,fx:{boi,live},bench,rates,errors};
}

// the next quotes/latest document, from the fetched prices and the stored one
export function buildQuotesDoc({prev:old={},fetched,symbols,positions=[],now=new Date(),usOpen=false,ilOpen=false}){
  const prices={...(old.prices||{})}, prevC={...(old.prev||{})}, stale={}, meta={...(old.meta||{})};
  const posOf=Object.fromEntries(positions.map(p=>[p.sym,p]));
  let usDate='', prevDate='', ilDate='', got=0;
  for(const sym of symbols){
    const q=fetched.quotes[sym];
    if(q&&q.src==='maya'){ // Maya quotes funds in agorot or in shekels; the price we hold says which (a fund never moves a hundredfold)
      const base=prices[sym]>0?prices[sym]:posOf[sym]&&+posOf[sym].px>0?+posOf[sym].px:0, k=base>0?q.px/base:1;
      if(k>40&&k<250){q.px/=100; if(q.prev)q.prev/=100} else if(k>0.004&&k<0.025){q.px*=100; if(q.prev)q.prev*=100}
      if(!(q.px>0))continue; got++;
      const om=old.meta&&old.meta[sym]||{}, nm=q.name||(posOf[sym]&&posOf[sym].name)||om.name||'';
      meta[sym]={src:'maya',ccy:'ILS',...(nm?{name:nm}:{}),...(q.closeDate?{date:q.closeDate,at:q.time}:{}),...(q.dates?{dates:q.dates}:{})};
      if(q.closeDate&&q.closeDate>ilDate)ilDate=q.closeDate;
      // a fund has one official price a day. A fund that follows a US index moves between them with that index: its value is
      // carried by the index's future from the moment the official price was first seen (the level then is kept), marked
      // as an estimate beside the official price and its date
      const tk=trackOf(nm), b=tk&&fetched.bench&&fetched.bench[tk], lvl=b?(b.fut&&b.fut.px>0?b.fut.px:b.px):0;
      const ref=om.ref&&om.ref.k===tk&&om.ref.date===q.closeDate&&om.ref.nav===round(q.px,4)?om.ref:(lvl>0?{k:tk,lvl,date:q.closeDate,nav:round(q.px,4)}:null);
      if(ref)meta[sym].ref=ref;
      if(ref&&lvl>0&&ref.lvl>0&&Math.abs(lvl/ref.lvl-1)>0.0002&&Math.abs(lvl/ref.lvl-1)<0.15){
        const est=q.px*lvl/ref.lvl; prices[sym]=round(est,4); prevC[sym]=round(q.px,4); meta[sym].est={nav:round(q.px,4),pct:round((lvl/ref.lvl-1)*100,3)};
        stale[sym]=`הערכה לפי ${BENCH[tk].name} · מחיר רשמי ${q.closeDate?dm(q.closeDate):''}`.trim()}
      else{prices[sym]=round(q.px,4); if(q.prev>0)prevC[sym]=round(q.prev,4)}
      continue}
    if(q){got++; prices[sym]=round(q.px); if(q.prev!=null)prevC[sym]=round(q.prev); meta[sym]={src:q.src,date:q.closeDate,at:q.time,...(q.ccy&&q.ccy!=='USD'?{ccy:q.ccy}:{})};
      if(q.ccy==='USD'&&q.closeDate>usDate){usDate=q.closeDate;prevDate=q.prevDate||prevDate}
      if(q.ccy==='ILS'&&q.closeDate>ilDate)ilDate=q.closeDate;
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
  // a close older than the market's last session is marked with its date, so the page can say which day is missing: the
  // source did not deliver that session (or Tel Aviv had a holiday). lag = per market, the day we have and the day we expect
  const want={il:lastSession('il',now),us:lastSession('us',now)}, lag={};
  const mktOf=sym=>{const m=meta[sym]||{}; return m.ccy==='ILS'||m.src==='index'||/\.TA$/.test(sym)?'il':!m.ccy&&(m.src==='yahoo'||m.src==='stooq')?'us':''};
  // a mutual fund's price for a day is published that evening: during the day, the day before is its latest
  const wantFund=want.il?lastSession('il',new Date(Date.parse(want.il+'T12:00:00Z')-864e5)):'';
  for(const sym of symbols){const m=meta[sym]||{}, k=mktOf(sym); if(!k||!m.date||!want[k]||prices[sym]==null||m.est)continue;
    if(m.date<(m.src==='maya'?wantFund:want[k])){if(!stale[sym])stale[sym]='סגירה '+dm(m.date); const L=lag[k]=lag[k]||{have:m.date,want:want[k],n:0,of:0}; L.n++; if(m.date>L.have)L.have=m.date}}
  for(const k of Object.keys(lag))lag[k].of=symbols.filter(s=>mktOf(s)===k&&prices[s]!=null&&(meta[s]||{}).date).length;
  // "live" only when the data says so: the market is open by the clock AND today's trades arrived (on a holiday, or when
  // every fetch failed, the last close is shown as a close)
  const usLive=usOpen&&!!usDate&&usDate===nyParts(now).iso, ilLive=ilOpen&&!!ilDate&&ilDate===ilParts(now).iso;
  const failed=symbols.length>0&&got===0;
  const usD=usDate||old.usDate||'', ilD=ilDate||old.ilDate||'';
  // the closes' label names the later market, and the other one when its date differs (Tel Aviv's Friday missing, a New York holiday)
  const closes=()=>{if(!usD&&!ilD)return old.priceLabel||''; const [a,b]=usD>=ilD?[usD,ilD]:[ilD,usD]; return `סגירה ${dm(a)}`+(b&&b!==a?` · ${usD>=ilD?'תל אביב':'ארה״ב'}: סגירה ${dm(b)}`:'')};
  const priceLabel=failed?'המחירים האחרונים שהתקבלו':usLive?'מסחר חי, עיכוב של עד 15 דקות':ilLive?`מסחר חי בתל אביב${usDate?' · ארה״ב: סגירה '+dm(usDate):''}`:closes();
  // the indices: this run's values, or the last ones with their dates when this run did not get them
  const bench={...(old.bench||{})}; for(const [k,v] of Object.entries(fetched.bench||{}))bench[k]={...v,name:(BENCH[k]||{}).name||k};
  const rates={...(old.rates||{})}; for(const [c,v] of Object.entries(fetched.rates||{}))if(v&&v.rate>0)rates[c]={rate:round(v.rate,4),prev:v.prev?round(v.prev,4):null,date:v.date||null};
  return {prices,prev:prevC,stale,meta,usdIls,fxPrev,bench,rates,fxLabel,priceLabel,prevLabel:prevDate?`סגירה ${dm(prevDate)}`:(old.prevLabel||''),boiUsd:fx.boi?round(fx.boi.rate,4):(old.boiUsd||null),
    source:'Yahoo Finance, מאיה (הבורסה) לקרנות נאמנות, בנק ישראל',
    // updatedAt = the last time prices actually arrived; a run that got nothing keeps the old time, so the page can say the prices are late
    updatedAt:failed?(old.updatedAt||null):now.toISOString(), attemptAt:now.toISOString(), got, of:symbols.length,
    usDate:usD, ilDate:ilD, lastTradeDay:[usD,ilD].sort().at(-1)||'', live:usLive||ilLive, lag,
    errors:(fetched.errors||[]).slice(0,40)};
}
const round=(x,n=2)=>{const k=Math.pow(10,n);return Math.round(x*k)/k};

// a name or symbol search across markets, for the page: symbol, name, exchange, type. Names are data, nothing more
export async function yahooSearch(q,{fetch:f=timedFetch}={}){
  const u=`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const r=await f(u,{headers:{'user-agent':UA,accept:'application/json'}}); if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json(); return ((j&&j.quotes)||[]).filter(x=>x&&x.symbol&&/^(EQUITY|ETF|MUTUALFUND|INDEX)$/.test(x.quoteType||''))
    .map(x=>({sym:String(x.symbol).toUpperCase().slice(0,16),name:String(x.longname||x.shortname||x.symbol).slice(0,80),exch:String(x.exchDisp||x.exchange||'').slice(0,24),type:x.quoteType==='ETF'?'etf':x.quoteType==='EQUITY'?'stock':x.quoteType==='INDEX'?'index':'fund'}));
}
