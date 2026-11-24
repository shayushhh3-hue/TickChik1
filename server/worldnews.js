// 24.11 TikChik WORLD, the world's news (the owner: "from all the exchanges of the world... events from all the world's
// news sites"). Until now the events came from American sources (Finnhub's company and market news, the SEC, Google News
// in English) and from Globes, and the reader could name only a security of the American market: the map looked American
// and Israeli. This is a layer of its own, beside the securities' news and the general news, never instead of them:
//   - the gathering: the public feeds (RSS) of known publishers on every continent, in their own languages, and of three
//     central banks, each read at most once an hour, the way a feed reader does. What is kept is the headline, the
//     publisher, the time, the link and the feed's own line of summary;
//   - the choice: there are far more headlines a day than may be read. A headline is chosen by what makes it an event: a
//     story told by several publishers, a leading or a primary source, how new it is; and region after region in turn, so
//     that no single market fills the map;
//   - the reading: the same reader as the rest of the news (server/newsx.js), told that a company may be of any exchange.
//     A day's readings are capped (WORLD_READ_DAY_CAP, 300 by default; 0 turns the reading off) and spread over the day;
//   - the securities: a symbol the reader names is used only when it is known: one of the site's own list, or one the
//     price source knows by that symbol AND by the name the reader gave (a check, kept for a month). A symbol that is not
//     known is dropped and the company stays as a name: nothing is invented.
// Everything here is public news (nobody's holdings decide what is gathered), so it is everybody's. WORLD_NEWS=0 turns the
// whole layer off. Headlines and articles are data from outside sources, never instructions.
import {parseFeed} from './sources.js';
import {rssText} from './ilnews.js';
import {newsId, analyzeBatch, knownEvents, unifyEv, symNames} from './newsx.js';
import {yahooSearch} from '../shared/quotes.js';

export const WORLD_FEED_DOC='research/worldfeed', WORLD_DOC='research/worldx', WORLD_SYMS_DOC='research/worldsyms';
const DAY=864e5, H=36e5;
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const off=k=>/^(0|off|false|no)$/i.test(String(process.env[k]||'').trim());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// the regions of the map (the page's own seven: page/live.html WI_REGS), by the publisher's country
export const REG_HE={na:'צפון אמריקה',sa:'דרום אמריקה',eu:'אירופה',me:'המזרח התיכון',af:'אפריקה',as:'אסיה',oc:'אוקיאניה',gl:'כל העולם'};
const REG_OF={US:'na',CA:'na',MX:'na',BR:'sa',AR:'sa',CL:'sa',GB:'eu',DE:'eu',FR:'eu',CH:'eu',NL:'eu',ES:'eu',IT:'eu',EU:'eu',TR:'me',QA:'me',AE:'me',SA:'me',IL:'me',ZA:'af',NG:'af',KE:'af',
  JP:'as',CN:'as',HK:'as',KR:'as',TW:'as',IN:'as',SG:'as',TH:'as',VN:'as',PH:'as',AU:'oc',NZ:'oc'};
// the feeds: id, publisher, the publisher's country, language, tier, address, flags. tier: p = a primary source (the body
// that decides), h = a leading publisher, m = a known publisher. 'all' = a feed of all the news, of which only the
// headlines about the economy, the markets and the events that move them are kept. 'gl' = a feed about the whole world
// (its region is the world's, not its publisher's). Each address answered with a feed on 24.11.2026
// 'http' = the feed writes its links with http, though the site serves https: the links are read as https
const F=(id,pub,cc,lang,tier,url,fl='')=>({id,pub,cc,lang,tier,url,all:fl.includes('all'),http:fl.includes('http'),reg:fl.includes('gl')?'gl':REG_OF[cc]||'gl'});
export const WORLD_FEEDS=[
  // the world as a whole
  F('cnbc-world','CNBC','US','en','h','https://www.cnbc.com/id/100727362/device/rss/rss.html','gl'),
  F('bbc-biz','BBC','GB','en','h','https://feeds.bbci.co.uk/news/business/rss.xml','gl'),
  F('bbc-world','BBC','GB','en','h','https://feeds.bbci.co.uk/news/world/rss.xml','gl all'),
  F('nyt-world','The New York Times','US','en','h','https://rss.nytimes.com/services/xml/rss/nyt/World.xml','gl all'),
  F('ft','Financial Times','GB','en','h','https://www.ft.com/rss/home','gl'),
  F('oilprice','OilPrice.com','US','en','m','https://oilprice.com/rss/main','gl'),
  F('mining','MINING.COM','CA','en','m','https://www.mining.com/feed/','gl'),
  // North America
  F('wsj-markets','The Wall Street Journal','US','en','h','https://feeds.content.dowjones.io/public/rss/RSSMarketsMain'),
  F('marketwatch','MarketWatch','US','en','h','https://feeds.content.dowjones.io/public/rss/mw_topstories'),
  F('nyt-biz','The New York Times','US','en','h','https://rss.nytimes.com/services/xml/rss/nyt/Business.xml'),
  F('globeandmail','The Globe and Mail','CA','en','h','https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/'),
  F('cbc','CBC','CA','en','m','https://www.cbc.ca/webfeed/rss/rss-business'),
  // Europe
  F('cnbc-europe','CNBC','GB','en','h','https://www.cnbc.com/id/19794221/device/rss/rss.html'),
  F('guardian','The Guardian','GB','en','h','https://www.theguardian.com/uk/business/rss'),
  F('boe','Bank of England','GB','en','p','https://www.bankofengland.co.uk/rss/news'),
  F('ecb','European Central Bank','EU','en','p','https://www.ecb.europa.eu/rss/press.html'),
  F('euronews','Euronews','EU','en','m','https://www.euronews.com/rss?level=theme&name=business'),
  F('dw','Deutsche Welle','DE','en','h','https://rss.dw.com/rdf/rss-en-bus'),
  F('handelsblatt','Handelsblatt','DE','de','h','https://www.handelsblatt.com/contentexport/feed/finanzen'),
  F('faz','Frankfurter Allgemeine','DE','de','h','https://www.faz.net/rss/aktuell/wirtschaft/'),
  F('tagesschau','Tagesschau','DE','de','m','https://www.tagesschau.de/wirtschaft/index~rss2.xml'),
  F('france24','France 24','FR','en','m','https://www.france24.com/en/business/rss'),
  F('lefigaro','Le Figaro','FR','fr','h','https://www.lefigaro.fr/rss/figaro_economie.xml'),
  F('nzz','Neue Zürcher Zeitung','CH','de','h','https://www.nzz.ch/wirtschaft.rss'),
  F('nos','NOS','NL','nl','m','https://feeds.nos.nl/nosnieuwseconomie'),
  F('expansion','Expansión','ES','es','h','https://e00-expansion.uecdn.es/rss/mercados.xml'),
  F('elpais','El País','ES','es','h','https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada'),
  F('sole24','Il Sole 24 Ore','IT','it','h','https://www.ilsole24ore.com/rss/finanza.xml'),
  // the Middle East
  F('aljazeera','Al Jazeera','QA','en','m','https://www.aljazeera.com/xml/rss/all.xml','all'),
  F('gulfnews','Gulf News','AE','en','m','https://gulfnews.com/feed','all'),
  F('dailysabah','Daily Sabah','TR','en','m','https://www.dailysabah.com/rssFeed/business'),
  F('hurriyet','Hürriyet Daily News','TR','en','m','https://www.hurriyetdailynews.com/rss/economy'),
  // Asia
  F('cnbc-asia','CNBC','SG','en','h','https://www.cnbc.com/id/19832390/device/rss/rss.html'),
  F('nikkei','Nikkei Asia','JP','en','h','https://asia.nikkei.com/rss/feed/nar'),
  F('japantimes','The Japan Times','JP','en','m','https://www.japantimes.co.jp/feed/','all'),
  F('boj','Bank of Japan','JP','en','p','https://www.boj.or.jp/en/rss/whatsnew.xml','http'),
  F('scmp-biz','South China Morning Post','HK','en','h','https://www.scmp.com/rss/92/feed'),
  F('scmp-china','South China Morning Post','CN','en','h','https://www.scmp.com/rss/318421/feed'),
  F('koreaherald','The Korea Herald','KR','en','m','https://www.koreaherald.com/rss/kh_Business'),
  F('yonhap','Yonhap','KR','en','h','https://en.yna.co.kr/RSS/news.xml','all'),
  F('taipeitimes','Taipei Times','TW','en','m','https://www.taipeitimes.com/xml/index.rss','all'),
  F('et-markets','The Economic Times','IN','en','h','https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'),
  F('mint','Mint','IN','en','m','https://www.livemint.com/rss/markets'),
  F('hindu-bl','The Hindu BusinessLine','IN','en','m','https://www.thehindubusinessline.com/markets/feeder/default.rss'),
  F('straitstimes','The Straits Times','SG','en','h','https://www.straitstimes.com/news/business/rss.xml'),
  F('cna','CNA','SG','en','m','https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936'),
  F('bt-sg','The Business Times','SG','en','m','https://www.businesstimes.com.sg/rss/top-stories'),
  F('bangkokpost','Bangkok Post','TH','en','m','https://www.bangkokpost.com/rss/data/business.xml'),
  F('vnexpress','VnExpress International','VN','en','m','https://e.vnexpress.net/rss/business.rss'),
  F('bworld','BusinessWorld','PH','en','m','https://www.bworldonline.com/feed/'),
  // Africa
  F('moneyweb','Moneyweb','ZA','en','m','https://www.moneyweb.co.za/feed/'),
  F('businessday-ng','BusinessDay','NG','en','m','https://businessday.ng/feed/'),
  // South America
  F('folha','Folha de S.Paulo','BR','pt','h','https://feeds.folha.uol.com.br/mercado/rss091.xml'),
  F('infomoney','InfoMoney','BR','pt','m','https://www.infomoney.com.br/feed/'),
  // Oceania
  F('smh','The Sydney Morning Herald','AU','en','h','https://www.smh.com.au/rss/business.xml'),
  F('abc-au','ABC News (Australia)','AU','en','h','https://www.abc.net.au/news/feed/51892/rss.xml')];

// a feed of all the news: only what is about the economy, the markets, or an event that moves them
const MKT=/\b(econom\w*|inflation|deflation|interest rates?|central bank|rate (cut|hike|rise|decision)s?|monetary|stocks?|shares|equit(y|ies)|markets?|investors?|bonds?|yields?|currenc(y|ies)|dollar|euro|yen|yuan|rupee|oil|crude|opec|gas|lng|energy|electricity|tariffs?|sanctions?|embargo|trade (deal|war|talks|pact)|exports?|imports?|gdp|recession|unemployment|wages|earnings|profits?|revenue|merger|acquisitions?|takeover|buyout|ipo|bankrupt\w*|bailout|strikes?|walkout|supply chains?|semiconductors?|chips?|factor(y|ies)|shipping|ports?|canal|strait|pipeline|refiner(y|ies)|mining|mines?|steel|copper|lithium|gold|wheat|grain|war|missiles?|air ?strikes?|ceasefire|invasion|troops|blockade|earthquake|tsunami|typhoon|hurricane|cyclone|floods?|wildfires?|elections?|coup|nuclear|budget|tax(es)?|debt|deficit|banks?|banking|insurers?|airlines?|automakers?|billion|trillion)\b/i;
// what makes a headline an event at first sight (a point in the choice, never a reading)
const BIG=/\b(rate (cut|hike|decision)|cuts? rates?|raises? rates?|holds? rates?|earnings|results|profit warning|merger|acquires?|acquisition|takeover|buyout|bankrupt\w*|default|sanctions?|tariffs?|embargo|export (ban|controls?)|strike|recall|shutdown|halts?|outage|explosion|earthquake|tsunami|typhoon|hurricane|floods?|war|missiles?|ceasefire|invasion|blockade|coup|record (high|low)|plunge[sd]?|soars?|surges?|slumps?|crash(es|ed)?)\b/i;
const STOP=/^(the|and|for|with|from|that|this|its|are|was|has|have|will|after|over|into|amid|says|said|new|der|die|das|und|les|des|que|del|los|las|una|por|para)$/;
const WORDS=t=>new Set(String(t||'').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu,' ').split(/\s+/).filter(w=>w.length>2&&!STOP.test(w)));
const jac=(A,B)=>{if(!A.size||!B.size)return 0; let i=0; for(const w of A)if(B.has(w))i++; return i/(A.size+B.size-i)};
const TIER_W={p:3,h:2,m:1};

// ---- the gathering: the feeds that are due (each at most once in `every`), a few side by side ----
export async function worldGather(store,{fetch:f=globalThis.fetch,now=new Date(),every=50*60e3,perRun=24,perFeed=14,keepH=72,max=1400,feeds=WORLD_FEEDS,log=()=>{}}={}){
  if(off('WORLD_NEWS'))return {off:true,ok:0,fail:0,added:0};
  const D=store.getDoc(WORLD_FEED_DOC).data||{}, FS={...(D.feeds||{})}, iso=now.toISOString(), from=now.getTime()-keepH*H, live=new Set(feeds.map(x=>x.id));
  const by=new Map(); for(const a of (D.items||[]))if(a&&a.id&&live.has(a.feed)&&Date.parse(a.at||a.seen||0)>=from)by.set(a.id,a);
  for(const k of Object.keys(FS))if(!live.has(k))delete FS[k];
  const due=feeds.filter(x=>now.getTime()-(Date.parse((FS[x.id]||{}).at||0)||0)>=every).sort((a,b)=>String((FS[a.id]||{}).at||'')<String((FS[b.id]||{}).at||'')?-1:1).slice(0,perRun);
  let ok=0, fail=0, added=0, first=null;
  const one=async x=>{const prev=FS[x.id]||{};
    try{const get=accept=>f(x.url,{headers:{'user-agent':UA,accept},redirect:'follow',signal:AbortSignal.timeout(14000)});
      // a site that refuses a feed reader's "accept" (The Guardian's does, at times) is asked once more the plain way
      let r=await get('application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'); if(r&&(r.status===403||r.status===406))r=await get('*/*');
      if(!r||!r.ok)throw new Error('HTTP '+(r&&r.status));
      let xml=await rssText(r); if(x.http)xml=xml.replace(/<link>\s*http:\/\//g,'<link>https://');
      const items=parseFeed(xml); if(!items.length)throw new Error('no items in the feed');
      let n=0, kept=0;
      for(const it of items){const t=it.at?Date.parse(it.at):now.getTime(); if(t<from||t>now.getTime()+2*H)continue;
        if(x.all&&!MKT.test(`${it.title} ${it.desc||''}`))continue; if(++kept>perFeed)break;
        const id=newsId(it.link); if(by.has(id))continue;
        by.set(id,{id,title:it.title,pub:x.pub,link:it.link,at:it.at||iso,sum:(it.desc||'').slice(0,300)||null,feed:x.id,cc:x.cc,reg:x.reg,lang:x.lang,tier:x.tier,seen:iso}); n++}
      added+=n; ok++; FS[x.id]={at:iso,ok:true,n:items.length,kept:Math.min(kept,perFeed),okAt:iso}}
    catch(e){fail++; const m=String(e&&e.message||e).slice(0,80); first=first||`${x.id}: ${m}`; FS[x.id]={...prev,at:iso,ok:false,err:m,fails:(prev.ok===false?(prev.fails||1):0)+1}}};
  for(let i=0;i<due.length;i+=6)await Promise.all(due.slice(i,i+6).map(one));
  const items=[...by.values()].sort((a,b)=>String(b.at||b.seen)<String(a.at||a.seen)?-1:1).slice(0,max);
  if(due.length)store.setDoc(WORLD_FEED_DOC,{items,feeds:FS,updatedAt:iso},{silent:true});
  if(due.length)log(`world news: ${ok}/${due.length} feeds read, ${added} new headlines, ${items.length} kept${first?' (first failure: '+first+')':''}`);
  return {ok,fail,added,due:due.length,items:items.length,first};
}

// ---- the choice: which headlines are read. A score by what makes an event (told by several publishers, a leading or a
// primary source, new, an event's words), then region after region in turn; one headline of a story, the best source's ----
export function worldPick(items,{read=new Set(),now=new Date(),n=6,maxAgeH=30}={}){
  const from=now.getTime()-maxAgeH*H, C=(items||[]).filter(a=>a&&a.id&&a.title&&Date.parse(a.at||a.seen||0)>=from).map(a=>({a,w:WORDS(a.title),t:Date.parse(a.at||a.seen)}));
  // the stories: headlines of different publishers that share most of their words (the same language only, by nature)
  const used=new Set(), stories=[];
  for(let i=0;i<C.length;i++){if(used.has(i))continue; const g=[C[i]]; used.add(i);
    for(let j=i+1;j<C.length;j++){if(used.has(j)||C[j].a.lang!==C[i].a.lang)continue; if(jac(C[i].w,C[j].w)>=0.5){g.push(C[j]); used.add(j)}}
    stories.push(g)}
  const out=[];
  for(const g of stories){if(g.some(c=>read.has(c.a.id)))continue;   // a story already read (by any of its headlines) is not read twice
    const pubs=new Set(g.map(c=>c.a.pub)).size, lead=g.slice().sort((p,q)=>(TIER_W[q.a.tier]-TIER_W[p.a.tier])||(q.t-p.t))[0], age=(now.getTime()-Math.max(...g.map(c=>c.t)))/H;
    const s=TIER_W[lead.a.tier]+Math.min(6,(pubs-1)*2)+(age<6?2:age<14?1:0)+(BIG.test(lead.a.title)?1:0);
    if(s>=3)out.push({a:lead.a,s,pubs,reg:lead.a.reg||'gl'})}
  // region after region: the best of each in turn, the regions in the order of their best story
  const byReg=new Map(); for(const o of out){const L=byReg.get(o.reg)||[]; L.push(o); byReg.set(o.reg,L)}
  for(const L of byReg.values())L.sort((p,q)=>(q.s-p.s)||(String(q.a.at)<String(p.a.at)?-1:1));
  const regs=[...byReg.keys()].sort((p,q)=>byReg.get(q)[0].s-byReg.get(p)[0].s), pick=[];
  for(let round=0;pick.length<n&&round<60;round++){let any=false; for(const r of regs){const o=byReg.get(r)[round]; if(!o)continue; any=true; pick.push(o); if(pick.length>=n)break} if(!any)break}
  return pick.slice(0,n).map(o=>({...o.a,pubs:o.pubs,score:o.s}));
}

// ---- the securities of any exchange: a symbol is used only when it is known ----
// a symbol with an exchange's suffix, as the price source writes it (7203.T, 0700.HK, SAP.DE, NOVO-B.CO, RELIANCE.NS)
export const WSYM=/^[A-Z0-9][A-Z0-9\-]{0,11}\.[A-Z]{1,3}$/, USYM=/^[A-Z][A-Z.\-]{0,6}$/;
// the country of an exchange, by the symbol's suffix
export const SUFFIX_CC={T:'JP',HK:'HK',SS:'CN',SZ:'CN',KS:'KR',KQ:'KR',TW:'TW',TWO:'TW',L:'GB',IL:'GB',PA:'FR',DE:'DE',F:'DE',MU:'DE',HM:'DE',DU:'DE',SG:'DE',BE:'DE',AS:'NL',BR:'BE',LS:'PT',MI:'IT',MC:'ES',
  SW:'CH',ST:'SE',CO:'DK',HE:'FI',OL:'NO',VI:'AT',WA:'PL',IR:'IE',AT:'GR',IS:'TR',TA:'IL',SR:'SA',QA:'QA',AE:'AE',NS:'IN',BO:'IN',AX:'AU',NZ:'NZ',TO:'CA',V:'CA',NE:'CA',CN:'CA',SA:'BR',MX:'MX',BA:'AR',SN:'CL',
  JO:'ZA',SI:'SG',KL:'MY',BK:'TH',JK:'ID',VN:'VN',PS:'PH',CA:'EG',PR:'CZ',BD:'HU',RO:'RO'};
// (a class of an American share, BRK.B, has a letter that is no exchange's: null)
export const ccOfSym=sym=>{const m=/\.([A-Z]{1,3})$/.exec(String(sym||'')); return m&&WSYM.test(sym)?SUFFIX_CC[m[1]]||null:null};
const NM_STOP=/^(the|inc|corp|corporation|company|co|ltd|limited|plc|group|holdings?|holding|international|global|sa|nv|ag|se|spa|ab|asa|oyj|as|bhd|tbk|kk|lp|llc|class|common|stock|shares|ordinary|adr|ads|american|depositary|sponsored|unsponsored|registered|and|of|de|du|la|le)$/i;
const toks=n=>String(n||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(w=>w.length>=2&&!NM_STOP.test(w));
const acro=n=>String(n||'').replace(/[^A-Za-z ]+/g,' ').split(/\s+/).filter(w=>w&&!/^(and|of|the|de|du|la|le)$/i.test(w)).map(w=>w[0]).join('').toUpperCase();
// do two names say the same company? a word in common (three letters or more), one name that begins the other, or one
// that is the other's initials (TSMC, BMW, ICBC). A check of the names, so that a symbol the reader gave to another
// company is not used
export function sameCompany(a,b){const A=toks(a), B=toks(b); if(!A.length||!B.length)return false;
  if(A.some(w=>w.length>=3&&B.includes(w)))return true;
  const ja=A.join(''), jb=B.join(''); if(Math.min(ja.length,jb.length)>=4&&(jb.startsWith(ja)||ja.startsWith(jb)))return true;
  const sa=String(a||'').replace(/[^A-Za-z]/g,'').toUpperCase(), sb=String(b||'').replace(/[^A-Za-z]/g,'').toUpperCase();
  return (sa.length>=3&&sa.length<=6&&acro(b).startsWith(sa))||(sb.length>=3&&sb.length<=6&&acro(a).startsWith(sb))}
// the known symbols: the site's own list (the American market) and the ones the price source confirmed (kept a month;
// one it did not know is asked again after three days). `search` is the site's own symbol search (shared/quotes.js)
export async function worldVerify(store,affs,{search=yahooSearch,now=new Date(),max=12,pause=250,fetch:f=null}={}){
  const D=store.getDoc(WORLD_SYMS_DOC).data||{}, S={...(D.syms||{})}, US=symNames(), t=now.getTime(), iso=now.toISOString(); let asked=0, changed=false;
  const verdict=new Map();
  for(const z of affs){const sym=z&&z.sym; if(!sym)continue; const key=sym+'|'+(z.name||''); if(verdict.has(key))continue; let v=null;
    const named=n=>!z.name||sameCompany(z.name,n);
    if(USYM.test(sym)&&US.has(sym))v=named(US.get(sym))?{ok:true,name:US.get(sym),us:true}:{ok:false,why:'name'};
    else if(!WSYM.test(sym)&&!USYM.test(sym))v={ok:false,why:'unknown'};
    else{const c=S[sym], fresh=c&&t-(Date.parse(c.at||0)||0)<(c.ok?30:3)*DAY;
      if(fresh)v=c.ok?(named(c.name)?{ok:true,name:c.name,exch:c.exch||''}:{ok:false,why:'name'}):{ok:false,why:'unknown'};
      else if(asked<max){asked++;
        try{const R=await search(sym,{count:6,...(f?{fetch:f}:{})}), hit=(R||[]).find(q=>q.sym===sym&&(q.type==='stock'||q.type==='etf'));
          S[sym]=hit?{ok:true,name:hit.name,exch:hit.exch||'',type:hit.type,at:iso}:{ok:false,at:iso}; changed=true;
          v=hit?(named(hit.name)?{ok:true,name:hit.name,exch:hit.exch||''}:{ok:false,why:'name'}):{ok:false,why:'unknown'}}
        catch(e){v={ok:false,why:'unverified'}}
        if(pause)await sleep(pause)}
      else v={ok:false,why:'unverified'}}
    verdict.set(key,v)}
  if(changed){const keys=Object.keys(S); if(keys.length>4000)for(const k of keys.sort((a,b)=>String(S[a].at)<String(S[b].at)?-1:1).slice(0,keys.length-4000))delete S[k]; store.setDoc(WORLD_SYMS_DOC,{syms:S,updatedAt:iso},{silent:true}); WN.at=0}
  return {verdict:(sym,name)=>verdict.get(sym+'|'+(name||''))||{ok:false,why:'unverified'},asked};
}
// the names of the confirmed symbols of other exchanges (for the map's labels), read once a minute at most
let WN={at:0,m:new Map()};
export function worldNames(store,now=Date.now()){if(now-WN.at<60e3)return WN.m; const m=new Map(); try{for(const [k,v] of Object.entries((store.getDoc(WORLD_SYMS_DOC).data||{}).syms||{}))if(v&&v.ok&&v.name)m.set(k,{name:v.name,exch:v.exch||''})}catch(e){} WN={at:now,m}; return m}
export const _resetWorldNames=()=>{WN={at:0,m:new Map()}};

// ---- the run: gather what is due, choose within the day's cap, read, check the symbols, keep ----
const dayOf=now=>now.toISOString().slice(0,10);
export const worldCap=()=>{const v=process.env.WORLD_READ_DAY_CAP; const n=v==null||String(v).trim()===''?300:+v; return Number.isFinite(n)&&n>=0?Math.min(2000,Math.round(n)):300};
export async function worldTask(store,{fetch:f=globalThis.fetch,now=new Date(),log=()=>{},ask=null,search=yahooSearch,perRun=12,perBatch=6,keepDays=5,max=900,dayCap=worldCap(),gather=worldGather,pause=250}={}){
  if(off('WORLD_NEWS'))return {off:true};
  const t0=Date.now(), iso=now.toISOString(), day=dayOf(now), st={at:iso,read:0,picked:0,dropped:0,fail:0,first:null,ai:!!(process.env.ANTHROPIC_API_KEY||ask),cap:dayCap};
  let G=null; try{G=await gather(store,{fetch:f,now,log})}catch(e){st.first='gather: '+String(e&&e.message||e).slice(0,80)}
  st.feeds=G?{ok:G.ok,fail:G.fail,added:G.added,...(G.first?{first:G.first}:{})}:null;
  const FD=store.getDoc(WORLD_FEED_DOC).data||{}, W=store.getDoc(WORLD_DOC).data||{}, from=new Date(now.getTime()-keepDays*DAY).toISOString();
  const arts=new Map((W.arts||[]).filter(a=>a&&a.id&&(a.at||a.seen)>=from).map(a=>[a.id,a])), by={}; for(const [k,v] of Object.entries(W.by||{}))if(arts.has(k))by[k]=v;
  // the day's cap, spread over the day: by this hour no more than the day's share (and a batch to begin with)
  const used=+(store.getMeta('worldRead:'+day)||0), frac=(now.getUTCHours()*60+now.getUTCMinutes()+20)/1440, room=Math.max(0,Math.min(dayCap-used,Math.ceil(dayCap*frac)+perBatch-used));
  st.used=used;
  if(st.ai&&room>0){
    // what was read (here, or as general news) is not read again; the same story by another headline neither
    const X=store.getDoc('research/newsx').data||{}, read=new Set([...Object.keys(by),...Object.keys(X.by||{})]);
    const picks=worldPick(FD.items||[],{read,now,n:Math.min(perRun,room)}); st.picked=picks.length;
    const allBy={...(X.by||{}),...by}, atOf=new Map([...arts.values(),...picks].map(a=>[a.id,a.at||a.seen||iso]));
    for(let b=0;b*perBatch<picks.length;b++){const batch=picks.slice(b*perBatch,(b+1)*perBatch).map(a=>({...a,src:'gen',syms:[]}));
      const got=await analyzeBatch(batch,{fetch:f,log,ask,known:knownEvents(allBy,{now}),world:true}); store.setMeta('worldRead:'+day,String(used+b*perBatch+batch.length));
      if(!got){st.fail++; st.first=st.first||'analysis: no usable answer'; if(st.fail>=2)break; continue}
      // the symbols: only the known ones stay; a company whose symbol is not known stays as a name
      const affs=Object.values(got).flatMap(x=>x.aff||[]), V=await worldVerify(store,affs,{search,now,pause,...(f!==globalThis.fetch?{fetch:f}:{})});
      for(const [i,x] of Object.entries(got)){const a=batch[+i]; if(!a)continue; const keep=[], cos=[];
        for(const z of (x.aff||[])){const v=z.sym?V.verdict(z.sym,z.name):{ok:false,why:'nosym'};
          if(v.ok)keep.push({...z,name:v.name||z.name||'',...(v.exch?{exch:v.exch}:{})});
          else{if(z.sym)st.dropped++; if(z.name)cos.push({name:z.name,how:z.how,dir:z.dir,why:z.why,said:!!z.said,...(z.sym?{tried:z.sym,dropped:v.why}:{})})}}
        const y=unifyEv({...x,aff:keep,...(cos.length?{cos:cos.slice(0,8)}:{})},a,allBy,atOf); by[a.id]=y; allBy[a.id]=y;
        arts.set(a.id,{id:a.id,title:a.title,pub:a.pub,link:a.link,at:a.at||iso,sum:a.sum||null,syms:[],seen:a.seen||iso,src:'gen',cat:'world',world:true,feed:a.feed,cc0:a.cc,reg0:a.reg,lang:a.lang,...(a.pubs>1?{pubs:a.pubs}:{})}); st.read++}
      await sleep(pause)}
  }
  // a symbol that could not be checked when its article was read (the price source did not answer) is asked about again, a
  // few a run: confirmed, the company takes its symbol; unknown or another company's, it stays a name
  {const R=[]; for(const [id,x] of Object.entries(by))for(const c of (x.cos||[]))if(c&&c.dropped==='unverified'&&c.tried)R.push({id,c}); const T=R.slice(0,12);
    if(T.length){const V=await worldVerify(store,T.map(r=>({sym:r.c.tried,name:r.c.name})),{search,now,pause,...(f!==globalThis.fetch?{fetch:f}:{})});
      for(const r of T){const v=V.verdict(r.c.tried,r.c.name); if(v.why==='unverified')continue; const x={...by[r.id]}, rest=(x.cos||[]).filter(c=>c!==r.c);
        if(v.ok)x.aff=[...(x.aff||[]).filter(z=>z.sym!==r.c.tried),{sym:r.c.tried,how:r.c.how,dir:r.c.dir,why:r.c.why,said:!!r.c.said,name:v.name||r.c.name,...(v.exch?{exch:v.exch}:{})}]; else rest.push({...r.c,dropped:v.why});
        if(rest.length)x.cos=rest; else delete x.cos; by[r.id]=x; st.fixed=(st.fixed||0)+1}}}
  const list=[...arts.values()].sort((a,b)=>String(b.at||b.seen)<String(a.at||a.seen)?-1:1).slice(0,max), live=new Set(list.map(a=>a.id)); for(const k of Object.keys(by))if(!live.has(k))delete by[k];
  if(st.read||st.fixed||list.length!==(W.arts||[]).length)store.setDoc(WORLD_DOC,{arts:list,by,updatedAt:iso,n:list.length},{silent:true});
  const S={...st,kept:list.length,usedNow:+(store.getMeta('worldRead:'+day)||0),seconds:Math.round((Date.now()-t0)/1000)};
  store.setMeta('worldStatus',JSON.stringify(S));
  if(st.read||st.first)log(`world: ${st.read} articles read of ${st.picked} chosen, ${st.dropped} unknown symbols dropped, ${S.usedNow}/${dayCap} today${st.first?' (first: '+st.first+')':''}`);
  return S;
}
// what the management sees: the feeds (which answered, which did not, since when), the day's readings against the cap
export function worldStatus(store,{now=new Date()}={}){
  let S=null; try{S=JSON.parse(store.getMeta('worldStatus')||'null')}catch(e){}
  const FD=store.getDoc(WORLD_FEED_DOC).data||{}, W=store.getDoc(WORLD_DOC).data||{}, FS=FD.feeds||{}, day=dayOf(now);
  const feeds=WORLD_FEEDS.map(x=>{const s=FS[x.id]||{}; return {id:x.id,pub:x.pub,cc:x.cc,reg:x.reg,lang:x.lang,tier:x.tier,at:s.at||null,ok:s.ok===true,n:s.n||0,err:s.ok===false?s.err||'':'',fails:s.fails||0,okAt:s.okAt||null}});
  const byReg={}; for(const a of (W.arts||[])){const r=a.reg0||'gl'; byReg[r]=(byReg[r]||0)+1}
  return {off:off('WORLD_NEWS'),cap:worldCap(),used:+(store.getMeta('worldRead:'+day)||0),last:S,feeds,nFeeds:feeds.length,okFeeds:feeds.filter(x=>x.ok).length,failing:feeds.filter(x=>x.at&&!x.ok),headlines:(FD.items||[]).length,read:(W.arts||[]).length,byReg,updatedAt:W.updatedAt||null};
}
