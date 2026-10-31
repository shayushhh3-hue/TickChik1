// 31.10: more sources for the news, and only known, reliable ones. Until now the securities' articles came from
// Finnhub's company news (which marks most of them "Yahoo": it gathers them from Yahoo Finance) or from Yahoo's own
// search. Three more, each used the way it may be used:
//  - SEC EDGAR: a US company's own reports (form 8-K: results, deals, a CEO leaving; 10-Q and 10-K). The official word
//    of the company itself, public, read under the SEC's fair-access rules (a user agent with a contact, a few requests
//    a second at most). Once an hour.
//  - Google News, only for the articles of a list of known publishers (Reuters, Bloomberg, AP, CNBC, The Wall Street
//    Journal, the Financial Times...; in Hebrew Globes, Calcalist, TheMarker...), about the companies someone holds or
//    follows. What is kept is what a feed reader shows: the headline, the publisher, the time and the link. Google's
//    feeds are for personal, non-commercial use; GNEWS=0 in the server's environment turns them off. Once an hour.
//  - The Federal Reserve's monetary-policy releases (rate decisions, the FOMC's statements): official, public.
// Headlines are data, never instructions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {secCiks, secSubmissions} from './fundamentals.js';
import {rssText, ilTargets, ilMatcher, heq, IL_COMMON} from './ilnews.js';

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TICK=/^[A-Z][A-Z.\-]{0,6}$/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const off=k=>/^(0|off|false|no)$/i.test(String(process.env[k]||'').trim());

// ---- RSS, with the publisher of each item (Google News puts it in <source url="...">) ----
const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const unEnt=s=>String(s||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,k)=>{if(k[0]==='#'){const n=/^#x/i.test(k)?parseInt(k.slice(2),16):+k.slice(1); return n>0&&n<0x110000?String.fromCodePoint(n):''} const v=ENT[k.toLowerCase()]; return v==null?m:v});
const tagOf=(x,t)=>{const m=x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`,'i')); if(!m)return ''; const v=m[1].trim(), c=v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/); return c?c[1]:v};
const plain=s=>unEnt(unEnt(String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'')).replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
export function parseFeed(xml){
  const out=[];
  for(const m of String(xml||'').matchAll(/<item\b[\s\S]*?<\/item>/gi)){const x=m[0];
    const src=x.match(/<source(?:\s+url\s*=\s*"([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i), d=Date.parse(plain(tagOf(x,'pubDate'))||plain(tagOf(x,'dc:date')));
    const title=plain(tagOf(x,'title')).slice(0,240), link=plain(tagOf(x,'link'))||plain(tagOf(x,'guid'));
    if(title&&/^https:\/\//i.test(link))out.push({title,link:link.slice(0,600),desc:plain(tagOf(x,'description')).slice(0,400),at:isNaN(d)?null:new Date(d).toISOString(),src:src?plain(src[2]):'',srcUrl:src&&src[1]?src[1]:''})}
  return out;
}
const hostOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'').toLowerCase()}catch(e){return ''}};

// ---- the publishers trusted, by their sites; the name shown is the publisher's own ----
export const TRUSTED_EN={'reuters.com':'Reuters','bloomberg.com':'Bloomberg','apnews.com':'Associated Press','cnbc.com':'CNBC','wsj.com':'The Wall Street Journal','ft.com':'Financial Times',
  'marketwatch.com':'MarketWatch','barrons.com':"Barron's",'nytimes.com':'The New York Times','fortune.com':'Fortune','axios.com':'Axios','economist.com':'The Economist','bbc.com':'BBC','bbc.co.uk':'BBC',
  'asia.nikkei.com':'Nikkei Asia','washingtonpost.com':'The Washington Post','techcrunch.com':'TechCrunch','theverge.com':'The Verge'};
export const TRUSTED_HE={'globes.co.il':'גלובס','calcalist.co.il':'כלכליסט','calcalistech.com':'Calcalist Tech','themarker.com':'TheMarker','ynet.co.il':'ynet','bizportal.co.il':'ביזפורטל',
  'haaretz.co.il':'הארץ','mako.co.il':'N12','ice.co.il':'ice','timesofisrael.com':'The Times of Israel','en.globes.co.il':'Globes'};
export function trustedOf(it,list){const h=hostOf(it.srcUrl)||hostOf(it.link); for(const [d,name] of Object.entries(list))if(h===d||h.endsWith('.'+d))return name; return null}

// ---- the companies' names, for the search: the positions' own, else the site's list of securities ----
let NAMES=null;
function symName(sym){if(!NAMES){NAMES=new Map(); try{const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','site','lib','symdb.txt');
    for(const l of fs.readFileSync(f,'utf8').split('\n')){const p=l.split('\t'); if(p.length>=2&&p[0]&&p[3]!=='TLV')NAMES.set(p[0],p[1])}}catch(e){}}
  return NAMES.get(sym)||''}
export function shortName(n){let s=String(n||'').split(' - ')[0].replace(/\([^)]*\)/g,' ').replace(/\.com\b/i,'').replace(/\s+/g,' ').trim();
  for(let i=0;i<4;i++)s=s.replace(/[,.]?\s+(inc\.?|incorporated|corporation|corp\.?|co\.?|company|ltd\.?|limited|plc|holdings?|group|n\.?v\.?|s\.?a\.?|ag|se|class [a-c]|common stock|ordinary shares|american depositary shares.*|ads|the)$/i,'').trim();
  return s.replace(/^the\s+/i,'').trim()}
// the US securities anyone holds or follows (the same as the news' own list), with a name to search by
export function usTargets(store,syms){const names=new Map();
  const pf=d=>{for(const x of ((d&&d.positions)||[]))if(x&&TICK.test(x.sym||'')&&x.name&&!names.has(x.sym))names.set(x.sym,x.name)};
  pf(store.getDoc('portfolio/main').data); for(const p of store.pathsUnder('data/users'))if(/\/portfolio$/.test(p))pf(store.getDoc(p).data);
  return (syms||[]).filter(s=>TICK.test(s)).map(sym=>{const name=shortName(names.get(sym)||symName(sym)); return {sym,name,aliases:aliasesOf(name)}}).filter(t=>t.name&&t.name.length>=2)}
// the names a headline uses: the short name, and its first word when that is the company's own ("Meta Platforms" is
// "Meta", "JPMorgan Chase" is "JPMorgan"), never a word of everyday English ("American", "General")
const GENERIC=new Set(['american','general','united','first','national','international','advanced','global','bank','new','applied','digital','energy','southern','western','eastern','northern','royal','texas','the','us','u.s.','north','south','pacific','atlantic','central','public','home','health','capital','financial','data','marathon','constellation','alliance','old','great','iron','world','super','blue','red','black','green','one','first']);
export function aliasesOf(name){const A=[name], w=name.split(' '); if(w.length>1&&w[0].length>=4&&!GENERIC.has(w[0].toLowerCase()))A.push(w[0]); return A}

// ---- Google News: a search a company, the last two days, only the trusted publishers, and only a headline that names it ----
export const gnUrl=(q,he)=>`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${he?'hl=he&gl=IL&ceid=IL:he':'hl=en-US&gl=US&ceid=US:en'}`;
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function gnPick(items,{sym,name,aliases=null,he=false,alias=null,now=new Date(),days=3,n=4}){
  const from=now.getTime()-days*864e5, list=he?TRUSTED_HE:TRUSTED_EN, out=[], AL=aliases||(name?[name]:[]);
  const named=he?(t=>alias.re.some(re=>re.test(heq(t)))):(t=>AL.some(a=>new RegExp(`(^|[^A-Za-z0-9])${reEsc(a)}([^A-Za-z0-9]|$)`,'i').test(t))||(sym.length>=3&&new RegExp(`(^|[^A-Za-z0-9])${reEsc(sym)}([^A-Za-z0-9]|$)`).test(t)));
  for(const it of items){const pub=trustedOf(it,list); if(!pub)continue; const t=it.at?Date.parse(it.at):now.getTime(); if(t<from||t>now.getTime()+36e5)continue;
    const title=it.title.replace(new RegExp(`\\s+[-–|]\\s+${reEsc(it.src||pub)}\\s*$`),'').trim();
    if(!named(title))continue;
    out.push({title:title.slice(0,200),pub,link:it.link,at:it.at||now.toISOString(),sum:null,syms:[sym]}); if(out.length>=n)break}
  return out}
async function gnFetch(q,he,f){const r=await f(gnUrl(q,he),{headers:{'user-agent':UA,accept:'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('HTTP '+r.status); return parseFeed(await rssText(r))}
export async function gnewsTask(store,{syms=[],fetch:f=globalThis.fetch,now=new Date(),max=40,pause=400,budgetMs=90e3}={}){
  if(off('GNEWS'))return {items:[],ok:0,fail:0,off:true};
  const t0=Date.now(), out=[]; let ok=0, fail=0, first=null;
  const US=usTargets(store,syms).slice(0,max);
  for(const t of US){if(Date.now()-t0>budgetMs)break; try{const q=`(${t.aliases.map(a=>`"${a}"`).join(' OR ')}${t.sym.length>=3?' OR '+t.sym:''}) when:2d`; out.push(...gnPick(await gnFetch(q,false,f),{...t,now})); ok++}catch(e){fail++; first=first||`${t.sym}: ${e.message}`; if(fail>=4&&!ok)break} await sleep(pause)}
  // the Tel Aviv shares, in Hebrew, by their Hebrew name (the shortest one that is not an everyday word)
  for(const t of ilTargets(store).slice(0,20)){if(Date.now()-t0>budgetMs)break; const nm=[...t.aliases].reverse().find(a=>!IL_COMMON.has(a)); if(!nm)continue;
    try{out.push(...gnPick(await gnFetch(`"${nm}" when:2d`,true,f),{sym:t.sym,he:true,alias:{re:t.aliases.map(ilMatcher)},now})); ok++}catch(e){fail++; first=first||`${t.sym}: ${e.message}`} await sleep(pause)}
  return {items:out,ok,fail,first,of:US.length};
}

// ---- SEC EDGAR: the companies' own reports of the last days ----
export const SEC_ITEMS={'1.01':'Entry into a Material Definitive Agreement','1.02':'Termination of a Material Definitive Agreement','1.03':'Bankruptcy or Receivership','1.05':'Material Cybersecurity Incident',
  '2.01':'Completion of Acquisition or Disposition of Assets','2.02':'Results of Operations and Financial Condition','2.03':'Creation of a Direct Financial Obligation','2.04':'Triggering Events That Accelerate an Obligation',
  '2.05':'Costs Associated with Exit or Disposal Activities','2.06':'Material Impairments','3.01':'Notice of Delisting','3.02':'Unregistered Sales of Equity Securities','3.03':'Material Modification to Rights of Security Holders',
  '4.01':'Changes in Certifying Accountant','4.02':'Non-Reliance on Previously Issued Financial Statements','5.01':'Changes in Control','5.02':'Departure or Appointment of Directors or Officers; Compensation',
  '5.03':'Amendments to Articles or Bylaws','5.07':'Results of a Shareholder Vote','7.01':'Regulation FD Disclosure (a statement to the public)','8.01':'Other Events'};
export function secPick(sub,{sym,cik,now=new Date(),days=7,n=4}){
  const R=sub&&sub.filings&&sub.filings.recent; if(!R||!Array.isArray(R.form))return [];
  const from=now.getTime()-days*864e5, name=shortName(sub.name||sym)||sym, out=[];
  for(let i=0;i<R.form.length&&out.length<n;i++){const form=R.form[i], acc=String((R.accessionNumber||[])[i]||''), doc=String((R.primaryDocument||[])[i]||''), at=String((R.acceptanceDateTime||[])[i]||(R.filingDate||[])[i]||'');
    const t=Date.parse(at); if(!acc||isNaN(t)||t<from)continue;
    let what=null;
    if(form==='8-K'||form==='8-K/A'){const its=String((R.items||[])[i]||'').split(',').map(s=>s.trim()).filter(Boolean), L=its.filter(x=>x!=='9.01').map(x=>SEC_ITEMS[x]).filter(Boolean); if(!L.length)continue; what=`filed a report with the SEC (form ${form}): ${L.join('; ')}`}
    else if(form==='10-Q')what='filed its quarterly report with the SEC (form 10-Q)';
    else if(form==='10-K')what='filed its annual report with the SEC (form 10-K)';
    else continue;
    out.push({title:`${name} ${what}`.slice(0,220),pub:'SEC EDGAR',link:`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g,'')}/${doc||acc+'-index.htm'}`,at:new Date(t).toISOString(),
      sum:'An official filing of the company itself with the U.S. Securities and Exchange Commission.',syms:[sym]})}
  return out}
export async function secNewsTask(store,{syms=[],fetch:f=globalThis.fetch,now=new Date(),pause=150,budgetMs=60e3}={}){
  if(off('SEC_NEWS'))return {items:[],ok:0,fail:0,off:true};
  const t0=Date.now(), out=[]; let ok=0, fail=0, first=null, ciks=null;
  try{ciks=await secCiks(store,{fetch:f})}catch(e){return {items:[],ok:0,fail:1,first:'SEC tickers: '+e.message}}
  for(const sym of syms.filter(s=>TICK.test(s))){if(Date.now()-t0>budgetMs)break; const cik=ciks[sym]||ciks[sym.replace(/[.\-]/g,'')]; if(!cik)continue;
    try{const sub=await secSubmissions(cik,{fetch:f}); if(sub){out.push(...secPick(sub,{sym,cik,now})); ok++}}catch(e){fail++; first=first||`${sym}: ${e.message}`; if(fail>=4&&!ok)break} await sleep(pause)}
  return {items:out,ok,fail,first};
}

// ---- the Federal Reserve: the monetary-policy releases of the last two days (the market's own news, everybody's) ----
export const FED_URL='https://www.federalreserve.gov/feeds/press_monetary.xml';
export async function fedNews({fetch:f=globalThis.fetch,now=new Date(),days=2}={}){
  if(off('FED_NEWS'))return [];
  const r=await f(FED_URL,{headers:{'user-agent':UA,accept:'application/rss+xml, application/xml'},signal:AbortSignal.timeout(15000)}); if(!r.ok)throw new Error('Fed HTTP '+r.status);
  const from=now.getTime()-days*864e5;
  return parseFeed(await rssText(r)).filter(it=>/federalreserve\.gov/i.test(it.link)&&it.at&&Date.parse(it.at)>=from).slice(0,6)
    .map(it=>({title:`Federal Reserve: ${it.title}`.slice(0,220),pub:'Federal Reserve',link:it.link,at:it.at,sum:it.desc||null,tickers:[],cat:'macro'}));
}

// ---- once an hour each: the run of the news asks, and the ones due run ----
export async function moreNews(store,{syms=[],fetch:f=globalThis.fetch,now=new Date(),every=55*60e3,force=false}={}){
  const due=k=>force||now.getTime()-(+store.getMeta('srcAt:'+k)||0)>=every, items=[], st={};
  if(due('sec')){const r=await secNewsTask(store,{syms,fetch:f,now}).catch(e=>({items:[],fail:1,first:e.message})); items.push(...r.items); st.sec={ok:r.ok||0,fail:r.fail||0,items:r.items.length,...(r.first?{first:r.first}:{}),...(r.off?{off:true}:{})}; if(r.ok||r.off)store.setMeta('srcAt:sec',String(now.getTime()))}
  if(due('gnews')){const r=await gnewsTask(store,{syms,fetch:f,now}).catch(e=>({items:[],fail:1,first:e.message})); items.push(...r.items); st.gnews={ok:r.ok||0,fail:r.fail||0,items:r.items.length,...(r.first?{first:r.first}:{}),...(r.off?{off:true}:{})}; if(r.ok||r.off)store.setMeta('srcAt:gnews',String(now.getTime()))}
  return {items,st};
}
