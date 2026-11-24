// 24.11 (the owner: "every new listing: tell me there is one more share or fund"): the securities that started trading
// after the page's own list of securities was built. Three sources, each said by name on the screen:
//  - the IPO calendar: Nasdaq's own (public, no key: the priced and the expected offerings of every US exchange), and
//    Finnhub's when the owner's FINNHUB_API_KEY is set and its plan includes the calendar (a refusal is kept and said);
//  - the exchanges' symbol directory (Nasdaq Trader: every security listed on a US exchange, with a mark for a fund):
//    what it lists and the page's list lacks is the dynamic part of the search, and a symbol that was not there on the
//    run before is a new one (a new exchange-traded fund has no IPO calendar);
//  - the price source (Yahoo's chart): the first day the security traded. A new symbol whose first trade is old (a
//    renamed ticker, a move from another market) is not announced as new.
// Kept in research/ipos, which every signed-in user may read (market data, nobody's holdings): `syms`, the rows the page
// adds to its search; `items`, the listings of the last weeks (the alerts' weekly "new on the exchange", server/pulse.js);
// `upcoming`, the offerings expected. Nothing here is made up: a field a source does not give stays empty, and a run
// that got nothing keeps what was there before. Facts about what is listed, never advice to buy.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timedFetch, yahooChart} from '../shared/quotes.js';
import {fh, fhKey} from './finnhub.js';

const DAY=864e5;
const NQ_H={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',accept:'application/json, text/plain, */*',origin:'https://www.nasdaq.com',referer:'https://www.nasdaq.com/','accept-language':'en-US,en;q=0.9'};
export const NASDAQ_IPO=ym=>`https://api.nasdaq.com/api/ipo/calendar?date=${ym}`;
export const SYMDIR={nasdaq:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',other:'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'};
const iso=d=>d.toISOString().slice(0,10);
const SYM=/^[A-Z]{1,5}(\.[A-Z])?$/;
const num=v=>{if(v==null||v==='')return null; const n=parseFloat(String(v).replace(/[$,\s]/g,'')); return Number.isFinite(n)&&n>0?n:null};
// "11/19/2026" (Nasdaq) or "2026-11-19" (Finnhub) to 2026-11-19; anything else is no date
export const ipoDate=v=>{const s=String(v||'').trim(); let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:''};
const str=(v,n=80)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,n);
// a blank-check company (its units list before it has a business): said to be one, and named after the real companies
export const isSpac=name=>/\bAcquisition (Corp|Corporation|Company|Co|Holdings|Inc)\b|\bBlank Check\b|\bSPAC\b/i.test(String(name||''));
// an exchange's name, as the calendars write it, to the letter the page's list uses (Q Nasdaq, N NYSE, A NYSE American, P NYSE Arca, Z Cboe)
export const exLetter=x=>{const s=String(x||''); return /nasdaq/i.test(s)?'Q':/arca/i.test(s)?'P':/mkt|american|amex/i.test(s)?'A':/nyse|new york/i.test(s)?'N':/cboe|bats/i.test(s)?'Z':''};

// ---- the calendars ----
// Finnhub /calendar/ipo: {ipoCalendar:[{date, exchange, name, price ("83.00" or "18.00-20.00"), status, symbol}]}
export function fhIpoParse(j){
  const out={priced:[],upcoming:[]};
  for(const x of ((j&&j.ipoCalendar)||[])){if(!x)continue; const sym=str(x.symbol,8).toUpperCase(), date=ipoDate(x.date), st=String(x.status||'').toLowerCase(); if(!SYM.test(sym)||!date)continue;
    const p=String(x.price==null?'':x.price), range=/\d\s*-\s*\d/.test(p)?str(p,20):null, row={sym,name:str(x.name),exch:str(x.exchange,40),date,price:range?null:num(p),src:'Finnhub'};
    if(st==='priced')out.priced.push(row); else if(st==='expected')out.upcoming.push({...row,range})}
  return out;
}
// Nasdaq's calendar of one month: data.priced.rows and data.upcoming.upcomingTable.rows
export function nasdaqIpoParse(j){
  const d=(j&&j.data)||{}, out={priced:[],upcoming:[]};
  for(const x of ((d.priced&&d.priced.rows)||[])){if(!x)continue; const sym=str(x.proposedTickerSymbol,8).toUpperCase(), date=ipoDate(x.pricedDate); if(!SYM.test(sym)||!date)continue;
    out.priced.push({sym,name:str(x.companyName),exch:str(x.proposedExchange,40),date,price:num(x.proposedSharePrice),src:'Nasdaq'})}
  for(const x of ((d.upcoming&&d.upcoming.upcomingTable&&d.upcoming.upcomingTable.rows)||[])){if(!x)continue; const sym=str(x.proposedTickerSymbol,8).toUpperCase(), date=ipoDate(x.expectedPriceDate); if(!SYM.test(sym)||!date)continue;
    const p=String(x.proposedSharePrice==null?'':x.proposedSharePrice), range=/\d\s*-\s*\d/.test(p)?str(p,20):null;
    out.upcoming.push({sym,name:str(x.companyName),exch:str(x.proposedExchange,40),date,price:range?null:num(p),range,src:'Nasdaq'})}
  return out;
}

// ---- the symbol directory ----
// a share or a fund a person can look up: not a warrant, a unit of a blank-check company, a right, a note or a preferred
const NOT_SHARE=/\bWarrants?\b|-\s*Rights?\b|\bRights?(\s*\(.*)?$|\bNotes?\b|\bDebentures?\b|\bPreferred\b|\bPreference\b|\bSubordinated\b|\bSenior\b|\bBonds?\b|\d%|\bContingent Value\b|\bWhen[- ]Issued\b/i;
const unitOnly=n=>/\bUnits?\b/i.test(n)&&!/\bL\.?P\.?\b|\bPartners\b|\bCommon Units?\b|\bLimited Partner/i.test(n);
const depositaryPref=n=>/\bDepositary Shares?\b/i.test(n)&&!/\bAmerican Depositary\b/i.test(n);
export const dirName=n=>str(String(n||'').replace(/\s+-\s+.*$/,'').replace(/\s+(Class [A-Z]\s+)?(Common Stock|Common Shares?|Ordinary Shares?)\b.*$/i,'').replace(/\s+American Depositary Shares?\b.*$/i,''));
// nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
// otherlisted.txt:  ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
export function symDirParse(txt,kind='nasdaq'){
  const L=String(txt||'').split(/\r?\n/).filter(Boolean); if(L.length<2)return [];
  const H=L[0].split('|'), iS=H.indexOf(kind==='nasdaq'?'Symbol':'ACT Symbol'), iN=H.indexOf('Security Name'), iT=H.indexOf('Test Issue'), iE=H.indexOf('ETF'), iX=H.indexOf('Exchange'); if(iS<0||iN<0)return [];
  const out=[];
  for(const l of L.slice(1)){const p=l.split('|'); if(p.length<H.length||/^File Creation Time/i.test(p[0]))continue;
    const sym=str(p[iS],8).toUpperCase(), raw=str(p[iN],160), etf=iE>=0&&p[iE]==='Y'; if(!SYM.test(sym)||(iT>=0&&p[iT]==='Y'))continue;
    if(!etf&&(NOT_SHARE.test(raw)||unitOnly(raw)||depositaryPref(raw)))continue;
    out.push({sym,name:etf?str(raw):dirName(raw),etf,ex:kind==='nasdaq'?'Q':(/^[ANPZ]$/.test(p[iX]||'')?p[iX]:'')})}
  return out;
}

// ---- 24.11 (the owner: "the offerings outside the US too"): the exchanges' own pages of new listings, no key. Each row is
// keyed by the symbol the price source uses (711A.T, ITD.MI, TCB.TO, 9941.HK), so it has a page like any security found by
// the search across markets. Tokyo's and Euronext's pages are their lists of offerings (with the day of listing); Toronto's
// are every new listing (funds too); Hong Kong's page has no day, so its rows are told only once the price source shows
// their first trade. A company that traded long before its "listing" (a transfer, a second market) is not told as new
export const WORLD={jpx:'https://www.jpx.co.jp/english/listing/stocks/new/index.html',euronext:'https://live.euronext.com/en/ipo-showcase',tsx:'https://www.tsx.com/json/company-directory/recent/tsx',tsxv:'https://www.tsx.com/json/company-directory/recent/tsxv',
  hkex:'https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=en'};
const MON3={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const untag=h=>str(String(h||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#0?39;|&rsquo;/g,"'"),100);
// Tokyo: a listing is two table rows; the first carries the day ("Dec. 22, 2026"), the name and the code (<span id="711A">)
export function jpxParse(html){const out=[], re=/<td[^>]*rowspan="2"[^>]*>\s*([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})[\s\S]*?<\/td>\s*<td[^>]*rowspan="2"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<span id="([0-9][0-9A-Z]{3})">/g; let m;
  while((m=re.exec(String(html||'')))){const mo=MON3[m[1].toLowerCase()], name=untag(m[4]); if(!mo||!name)continue;
    out.push({sym:m[5]+'.T',name,exch:'Tokyo Stock Exchange',date:`${m[3]}-${String(mo).padStart(2,'0')}-${m[2].padStart(2,'0')}`,kind:'ipo',src:'JPX'})}
  return out}
// Euronext: the day, the company, the ticker, the city of the market; the price source's suffix by the city
const ENX_SFX={Paris:'PA',Amsterdam:'AS',Brussels:'BR',Lisbon:'LS',Dublin:'IR',Milan:'MI',Oslo:'OL'};
export function euronextParse(html){const out=[], rows=String(html||'').split(/<tr[\s>]/).slice(1);
  for(const r of rows){const d=(r.match(/<time datetime="(\d{4}-\d\d-\d\d)/)||[])[1], cell=c=>untag((r.match(new RegExp('views-field-'+c+'"[^>]*>([\\s\\S]*?)</td>'))||[])[1]);
    const name=cell('field-iponi-display-title'), tk=cell('field-iponi-ticker-symbol').toUpperCase(), city=cell('term-node-tid'), sfx=ENX_SFX[city]; if(!d||!name||!sfx||!/^[A-Z0-9]{1,8}$/.test(tk))continue;
    out.push({sym:tk+'.'+sfx,name,exch:'Euronext '+city,date:d,kind:'ipo',src:'Euronext'})}
  return out}
// Toronto (and its venture market): {results:[{name, date (seconds), symbol}]}; a class or unit after a dot is a hyphen at the price source
export function tsxParse(j,venture=false){const out=[];
  for(const x of ((j&&j.results)||[])){const s=String(x&&x.symbol||'').toUpperCase().replace(/\./g,'-'), t=+(x&&x.date), name=str(x&&x.name); if(!/^[A-Z][A-Z0-9\-]{0,7}$/.test(s)||!(t>0)||!name)continue;
    out.push({sym:s+(venture?'.V':'.TO'),name,exch:venture?'TSX Venture':'Toronto Stock Exchange',date:iso(new Date((t+12*3600)*1000)),kind:'list',t:/\bETF\b|\bFund\b|\bShares\b/i.test(name)?'E':'S',src:'TSX'})}
  return out}
// Hong Kong: the code and the name of each new listing (no day on the page)
export function hkexParse(html){const out=[], h=String(html||''), i=h.indexOf('<tbody',h.indexOf('Stock Code')); if(i<0)return out; const re=/<tr>\s*<td[^>]*>\s*(\d{1,5})\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g; let m;
  const body=h.slice(i,h.indexOf('</tbody>',i)+1||undefined);
  while((m=re.exec(body))){const name=untag(m[2]); if(!name||m[1].length>4)continue; out.push({sym:m[1].padStart(4,'0')+'.HK',name,exch:'Hong Kong Stock Exchange',date:'',kind:'list',src:'HKEX'})}
  return out}
export async function worldListings({fetch:f=timedFetch}={}){
  const H={'user-agent':NQ_H['user-agent'],accept:'text/html,application/json,*/*','accept-language':'en-US,en;q=0.9'}, rows=[], src={}, errors=[];
  const one=async(k,name,parse,json)=>{try{const r=await f(WORLD[k],{headers:H}); if(!r.ok)throw new Error('HTTP '+r.status); const L=parse(json?await r.json():await r.text()); if(!L.length)throw new Error('no rows read'); rows.push(...L); src[k]='ok'}
    catch(e){src[k]='err'; errors.push(name+': '+String(e&&e.message||e).slice(0,100))}};
  await Promise.all([one('jpx','JPX',jpxParse),one('euronext','Euronext',euronextParse),one('tsx','TSX',j=>tsxParse(j,false),true),one('tsxv','TSX Venture',j=>tsxParse(j,true),true),one('hkex','HKEX',hkexParse)]);
  return {rows,src,errors}}

// the page's own list (site/lib/symdb.txt, written by the build): the symbols the search already has
let SITE=null;
export function siteSyms(){if(SITE)return SITE; SITE=new Set();
  try{const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','site','lib','symdb.txt');
    for(const l of fs.readFileSync(f,'utf8').split('\n')){const p=l.split('\t'); if(p.length>=4&&p[0]&&p[3]!=='TLV')SITE.add(p[0])}}catch(e){}
  return SITE}
export const _setSite=s=>{SITE=s?new Set(s):null};

// the Monday of a day's week (a trading week), as its key
export const weekOf=d=>{const t=new Date(String(d).slice(0,10)+'T12:00:00Z'); if(isNaN(t))return ''; t.setUTCDate(t.getUTCDate()-((t.getUTCDay()+6)%7)); return iso(t)};

// what the alerts and the page announce: an offering from the calendar, or a new symbol whose first day of trading is
// known and recent. Newest first
export function ipoFresh(D,{now=new Date(),days=10}={}){
  const from=iso(new Date(now.getTime()-days*DAY)), to=iso(new Date(now.getTime()+DAY));
  // a listing of another exchange is told only once the price source shows its first trade (its page lists transfers too)
  return ((D&&D.items)||[]).filter(it=>it&&it.sym&&!it.old&&((it.kind==='ipo'&&!it.far)||it.first)).map(it=>({...it,d:it.first||it.date})).filter(it=>it.d&&it.d>=from&&it.d<=to)
    .sort((a,b)=>(a.d<b.d?1:a.d>b.d?-1:0)||((a.kind==='ipo'?0:1)-(b.kind==='ipo'?0:1))||((a.spac?1:0)-(b.spac?1:0))||(a.sym<b.sym?-1:1));
}

export async function ipoTask(store,{fetch:f=timedFetch,now=new Date(),log=()=>{},key=fhKey(),known=null,chart=yahooChart,keepDays=45,maxChecks=40,gap,world=true}={}){
  const K=known?new Set(known):siteSyms(), old=store.getDoc('research/ipos'), O=old.exists&&old.data?old.data:{}, seeded=Array.isArray(O.syms)&&O.dir===true;
  const src={}, errors=[], nowIso=now.toISOString(), today=iso(now), from=iso(new Date(now.getTime()-keepDays*DAY));
  const get=async(u,h)=>{const r=await f(u,{headers:h||{'user-agent':NQ_H['user-agent'],accept:'text/plain,*/*'}}); if(!r.ok)throw new Error('HTTP '+r.status); return r};
  // 1. the calendars
  const priced=[], upcoming=[];
  if(key){try{const P=fhIpoParse(await fh('/calendar/ipo',{from,to:iso(new Date(now.getTime()+30*DAY))},{fetch:f,key,...(gap!=null?{gap}:{})})); priced.push(...P.priced); upcoming.push(...P.upcoming); src.finnhub='ok'}
    catch(e){src.finnhub=e&&e.plan?'plan':e&&e.auth?'key':'err'; errors.push('Finnhub: '+String(e&&e.message||e).slice(0,120))}}
  else src.finnhub='nokey';
  {const months=[...new Set([now,new Date(now.getTime()-31*DAY)].map(d=>iso(d).slice(0,7)))]; let ok=0;
    for(const ym of months){try{const P=nasdaqIpoParse(await (await get(NASDAQ_IPO(ym),NQ_H)).json()); priced.push(...P.priced); upcoming.push(...P.upcoming); ok++}
      catch(e){errors.push(`Nasdaq ${ym}: `+String(e&&e.message||e).slice(0,120))}}
    src.nasdaq=ok?'ok':'err'}
  // 2. the directory of every listed symbol
  let dir=null;
  try{const [a,b]=await Promise.all([get(SYMDIR.nasdaq).then(r=>r.text()),get(SYMDIR.other).then(r=>r.text())]); const L=[...symDirParse(a,'nasdaq'),...symDirParse(b,'other')];
    if(L.length<2000)throw new Error(`a short list (${L.length} rows)`); dir=new Map(); for(const x of L)if(!dir.has(x.sym))dir.set(x.sym,x); src.dir='ok'}
  catch(e){src.dir='err'; errors.push('symbol directory: '+String(e&&e.message||e).slice(0,120))}
  // 2b. the exchanges outside the US
  let far=[]; if(world){const Wd=await worldListings({fetch:f}); far=Wd.rows; Object.assign(src,Wd.src); errors.push(...Wd.errors)}
  if(src.nasdaq!=='ok'&&src.finnhub!=='ok'&&!dir&&!far.length){
    store.setDoc('research/ipos',{...O,triedAt:nowIso,errors:errors.slice(0,6),sources:src},{silent:true}); log('new listings: nothing came ('+errors.join(' | ')+')'); return {ok:false,items:(O.items||[]).length,fresh:[],errors}}
  // 3. the listings kept (the last weeks), with what this run adds
  const by=new Map(); for(const it of (O.items||[]))if(it&&it.sym&&((it.old?'':it.first)||it.date||String(it.at||'').slice(0,10))>=from)by.set(it.sym,{...it});   // one found to be old is remembered as such (by the day it was listed or seen), not looked up again every run
  const fresh=[], add=(sym,o)=>{let it=by.get(sym); if(!it){it={sym,at:nowIso}; by.set(sym,it); fresh.push(sym)} return Object.assign(it,o)};
  for(const r of priced){if(r.date<from||r.date>today)continue; const was=by.get(r.sym), srcs=[...new Set([...((was&&was.src)||[]),r.src])];
    add(r.sym,{name:r.name||(was&&was.name)||r.sym,exch:r.exch||(was&&was.exch)||'',ex:exLetter(r.exch)||(was&&was.ex)||'',t:'S',date:r.date,...(r.price?{price:r.price}:{}),kind:'ipo',src:srcs,...(isSpac(r.name)?{spac:true}:{})})}
  // 3b. the listings of the other exchanges: from their day of listing on (a day still ahead is "expected")
  for(const r of far){if(r.date&&r.date>today){if(r.kind==='ipo')upcoming.push({sym:r.sym,name:r.name,exch:r.exch,date:r.date,price:null,range:null,src:r.src}); continue} if(r.date&&r.date<from)continue;
    const was=by.get(r.sym); add(r.sym,{name:(was&&was.name)||r.name,exch:r.exch,ex:'',t:r.t||(was&&was.t)||'S',...(r.date?{date:r.date}:{}),kind:r.kind,far:true,src:[...new Set([...((was&&was.src)||[]),r.src])]})}
  // 3c. Tel Aviv (24.11, the owner): the exchange's own list of traded shares (research/ilsyms, kept every morning by
  // server/ilsyms.js with the exchange's key, TASE_API_KEY). A share that was not in the list on the run before is a new
  // one; the first list seen only teaches what is listed. Without the key there is no list, and nothing is said
  try{const IL=store.getDoc('research/ilsyms').data, L=(IL&&Array.isArray(IL.stocks)?IL.stocks:[]).filter(x=>x&&/^[A-Z0-9]{1,7}$/.test(String(x[0]||'')));
    if(L.length>=100){let K0=null; try{K0=JSON.parse(store.getMeta('ipoIlKnown')||'null')}catch(e){} const was=Array.isArray(K0)?new Set(K0):null;
      if(was)for(const x of L){const k=String(x[0]); if(was.has(k))continue; add('TLV:'+k,{name:str(x[1]||x[2]||k),exch:'הבורסה בתל אביב',ex:'TLV',t:'S',date:(IL.day&&IL.day<=today?IL.day:today),kind:'list',il:true,src:['TASE']})}
      store.setMeta('ipoIlKnown',JSON.stringify([...new Set([...(was||[]),...L.map(x=>String(x[0]))])])); src.tase='ok'}
    else src.tase='nolist'}catch(e){src.tase='err'; errors.push('TASE: '+String(e&&e.message||e).slice(0,100))}
  // 4. the dynamic part of the search, and the symbols that were not listed on the run before
  let syms=Array.isArray(O.syms)?O.syms:[];
  // without the page's own list (the site was not built yet) every listed symbol would look new to the search: it waits
  const listOk=!!known||K.size>=1000; if(dir&&!listOk)errors.push('the page\'s list of securities was not found (site/lib/symdb.txt): the symbols beyond it wait');
  if(dir&&listOk){const prev=new Set(syms.map(x=>x[0])), rows=[];
    for(const x of dir.values()){if(K.has(x.sym))continue; rows.push([x.sym,x.name,x.etf?'E':'S',x.ex]);
      const it=by.get(x.sym); if(it){if(!it.ex)it.ex=x.ex; it.listed=true; if(x.etf)it.t='E'; continue}
      // the first run only learns what is listed: nothing is "new" against an empty memory
      if(seeded&&!prev.has(x.sym))add(x.sym,{name:x.name,ex:x.ex,exch:'',t:x.etf?'E':'S',kind:x.etf?'etf':'list',src:['Nasdaq Trader'],listed:true,...(isSpac(x.name)?{spac:true}:{})})}
    syms=rows.sort((a,b)=>a[0]<b[0]?-1:1).slice(0,6000)}
  // an offering the directory does not list yet is still found by its symbol
  {const have=new Set(syms.map(x=>x[0])); for(const it of by.values())if(it.kind==='ipo'&&!it.far&&!it.il&&!have.has(it.sym)&&!K.has(it.sym)){syms.push([it.sym,it.name,it.t||'S',it.ex||'']); have.add(it.sym)} syms=syms.slice().sort((x,y)=>x[0]<y[0]?-1:x[0]>y[0]?1:0)}
  // a ticker that only changed its name (FMP's list, research/symchg) is not a new security
  try{const C=(store.getDoc('research/symchg').data||{}).items||[]; for(const c of C){const it=by.get(String(c&&c.new||'')); if(it&&it.kind!=='ipo'){it.old=true; it.why='שינוי סימול'}}}catch(e){}
  // 5. the first day of trading, from the price source: asked for a listing that has none yet, a few a run, again after six hours
  let checks=0;
  const order=[...by.values()].filter(it=>!it.first&&!it.old&&!(Date.parse(it.checkedAt)>now.getTime()-6*36e5)).sort((a,b)=>((a.kind==='ipo'?0:1)-(b.kind==='ipo'?0:1))||(String(b.date||b.at)<String(a.date||a.at)?-1:1));
  for(const it of order){if(checks>=maxChecks)break; checks++; it.checkedAt=nowIso;
    try{const q=await chart(it.il?it.sym.slice(4)+'.TA':it.far?it.sym:it.sym.replace(/\./g,'-'),{fetch:f}); if(q&&q.first){if(it.far){if(q.ccy)it.ccy=q.ccy; if(q.type==='ETF')it.t='E';
          // listed on this exchange long after it first traded there: a transfer or a second line, not a new security
          if(Date.parse(q.first)<Date.parse(it.date||String(it.at).slice(0,10))-30*DAY){it.first=q.first; it.old=true; it.why='נסחר מזמן'; continue}}it.first=q.first; if(q.xname&&!it.exch)it.exch=str(q.xname,40); if(q.name&&(!it.name||it.name===it.sym))it.name=str(q.name);
        // a symbol that traded long before it was seen here is an old security under a new ticker, not a new listing
        if(it.kind!=='ipo'&&Date.parse(it.first)<Date.parse(String(it.at).slice(0,10))-60*DAY){it.old=true; it.why='נסחר מזמן'}}}
    catch(e){}}
  const items=[...by.values()].sort((a,b)=>String(b.first||b.date||b.at)<String(a.first||a.date||a.at)?-1:1).slice(0,300);
  const upc=new Map(); for(const u of upcoming)if(u.date>=today&&!upc.has(u.sym))upc.set(u.sym,{sym:u.sym,name:u.name,exch:u.exch,date:u.date,...(u.range?{range:u.range}:{}),...(u.price?{price:u.price}:{}),src:u.src,...(isSpac(u.name)?{spac:true}:{})});
  const wn=[src.jpx==='ok'?'טוקיו (JPX)':'',src.euronext==='ok'?'Euronext':'',src.tsx==='ok'||src.tsxv==='ok'?'טורונטו (TSX)':'',src.hkex==='ok'?'הונג קונג (HKEX)':'',src.tase==='ok'?'תל אביב (TASE)':''].filter(Boolean);
  const names=[src.nasdaq==='ok'?'לוח ההנפקות של Nasdaq':'',src.finnhub==='ok'?'Finnhub':'',wn.length?'רשימות הרישום של '+wn.join(', '):'',src.dir==='ok'||seeded?'רשימת הסימולים של הבורסות בארה״ב (Nasdaq Trader)':'','Yahoo Finance (יום המסחר הראשון)'].filter(Boolean);
  const doc={items,upcoming:[...upc.values()].sort((a,b)=>a.date<b.date?-1:1).slice(0,40),syms,dir:seeded||(!!dir&&listOk),sources:src,errors:errors.slice(0,6),source:names.join(', '),updatedAt:nowIso,
    n:{ipo:items.filter(x=>x.kind==='ipo').length,etf:items.filter(x=>x.kind==='etf'&&!x.old).length,dyn:syms.length}};
  store.setDoc('research/ipos',doc);
  log(`new listings: ${doc.n.ipo} offerings and ${doc.n.etf} new funds kept, ${fresh.length} new this run${fresh.length?' ('+fresh.slice(0,8).join(', ')+')':''}, ${syms.length} symbols beyond the page's list, ${checks} first-trade checks${errors.length?'; '+errors.join(' | '):''}`);
  return {ok:true,items:items.length,fresh,dyn:syms.length,checks,sources:src,errors};
}
// at a start, when the list is missing or a day old: one run, without waiting for the clock
export function ipoStale(store,{now=new Date(),maxAgeH=20}={}){const d=store.getDoc('research/ipos'), at=d.exists&&d.data?(d.data.updatedAt||d.data.triedAt):null; return !at||now.getTime()-Date.parse(at)>maxAgeH*36e5}
