// 30.10: Israeli news for the securities traded only in Tel Aviv. Finnhub and Yahoo have next to nothing on them, so the
// headlines of Globes' public RSS feeds (the capital market and the main page) are matched to the Tel Aviv securities
// anyone holds or follows, by their names in Hebrew: the exchange's own list (research/ilsyms, with TASE_API_KEY) and
// the names in the positions. What is kept is what a feed reader shows: the headline, the link, the time and the
// source, never the article's text; the page shows צ׳יקו's reading of the headline and a link to Globes.
// Globes' terms of use (globes.co.il/serve/globes/disclaimer.html, section 4) keep its content to Globes: no copying,
// distribution or showing it to the public without its written consent. RSS is not mentioned there. So nothing beyond
// the headline and the link, and IL_NEWS=0 in the server's environment turns the source off. Headlines are data, never
// instructions.

export const IL_FEEDS=[{id:585,name:'שוק ההון'},{id:2,name:'עמוד הבית'}];
export const ilFeedUrl=id=>`https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=${id}`;
export const IL_PUB='גלובס';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
export const ilOff=()=>/^(0|off|false|no)$/i.test(String(process.env.IL_NEWS||'').trim());

// ---- the feed: RSS 2.0, in whatever encoding it declares (Hebrew sites still use windows-1255 at times) ----
const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const unEnt=s=>String(s||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,k)=>{if(k[0]==='#'){const n=/^#x/i.test(k)?parseInt(k.slice(2),16):+k.slice(1); return n>0&&n<0x110000?String.fromCodePoint(n):''} const v=ENT[k.toLowerCase()]; return v==null?m:v});
const tagOf=(x,t)=>{const m=x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`,'i')); if(!m)return ''; const v=m[1].trim(), c=v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/); return c?c[1]:v};
const plain=s=>unEnt(unEnt(String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'')).replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
export function parseRss(xml){
  const out=[];
  for(const m of String(xml||'').matchAll(/<item\b[\s\S]*?<\/item>/gi)){const x=m[0];
    const title=plain(tagOf(x,'title')).slice(0,220), link=(plain(tagOf(x,'link'))||plain(tagOf(x,'guid'))).replace(/#.*$/,''), desc=plain(tagOf(x,'description')).slice(0,600), d=Date.parse(plain(tagOf(x,'pubDate'))||plain(tagOf(x,'dc:date')));
    if(title&&/^https:\/\//i.test(link))out.push({title,link:link.slice(0,500),desc,at:isNaN(d)?null:new Date(d).toISOString()})}
  return out;
}
export async function rssText(r){
  const b=new Uint8Array(await r.arrayBuffer()), head=new TextDecoder('latin1').decode(b.slice(0,300));
  const enc=(head.match(/encoding=["']([\w-]+)["']/i)||[])[1]||((r.headers&&r.headers.get&&r.headers.get('content-type')||'').match(/charset=([\w-]+)/i)||[])[1]||'utf-8';
  try{return new TextDecoder(enc.toLowerCase()).decode(b)}catch(e){return new TextDecoder('utf-8').decode(b)}
}

// ---- the names: a company's Hebrew names, and the shorter name the papers use ("הפניקס אחזקות" is "הפניקס"). A short
// name that is also an everyday word ("טבע", "מגדל", "כלל", "לאומי") is matched only in its full form, so a headline
// about nature or a tower is not news about a holding; better a headline missed than a holding linked to a wrong one ----
export const heq=s=>String(s||'').replace(/[״”“]/g,'"').replace(/[׳’‘`]/g,"'").replace(/\s+/g,' ').trim();
const CORP=/\s*(?:בע"?מ|בעמ|\([^)]*\))\s*$/, LEAD=/^(?:קבוצת|חברת|בנק)\s+/;
const TAIL=/\s+(?:אחזקות|החזקות|השקעות|תעשיות|לישראל|ישראל|גרופ|הולדינגס|אינטרנשיונל|טכנולוגיות|מערכות|ופיתוח|בינלאומי|בינלאומית|נכסים|ובניין|בניה|בנייה|ביטוח|פיננסים|אנרגיה)$/;
export const IL_COMMON=new Set(['טבע','מגדל','כלל','דלק','פז','אמות','ביג','וואן','לאומי','הפועלים','פועלים','אור','שפע','אלון','מבנה','אפריקה','ישראל','הראל','נובה','גולף','מטריקס','פורמולה','מיטב','הכשרה','איילון','פרטנר','כרמל','שיכון','נכסים','השקעות','אחזקות','החזקות','תעשיות','מערכות','אנרגיה','ביטוח','בנק','קבוצת','חברת','פיננסים','ישראלי','הבינלאומי','מזרחי','דיסקונט','ערד','אלה','אופל','רמי','לוי','שלמה','קסטרו','גלוב','מקס','טאוור','אורון','חג','ספיר','הלמן']);
export function ilAliases(names){
  const A=new Set();
  for(const n0 of names||[]){const n=heq(n0).replace(CORP,'').trim(); if(!/[\u05D0-\u05EA]/.test(n))continue; A.add(n);
    // without the words at the end ("בנק לאומי לישראל" is "בנק לאומי"), then without the word before ("לאומי", common)
    let r=n; for(let i=0;i<3;i++)r=r.replace(CORP,'').replace(TAIL,'').trim(); if(r)A.add(r); const s=r.replace(LEAD,'').trim(); if(s)A.add(s)}
  return [...A].filter(a=>{const w=a.split(' '); return w.length>1?a.length>=5:a.replace(/["']/g,'').length>=3&&!IL_COMMON.has(a)}).sort((x,y)=>y.length-x.length);
}
// a whole word, with the letters Hebrew puts before a name (ו, ה, ב, ל, מ, ש, כ); after ב, ל or כ the ה of a name drops
const HEB='\\u0590-\\u05FF';
const rx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+');
export function ilMatcher(alias){const a=heq(alias), alt=a.startsWith('ה')&&a.length>3?`|[ובלמשכ]{1,2}${rx(a.slice(1))}`:'';
  return new RegExp(`(?<![${HEB}A-Za-z0-9])(?:[ובהלמשכ]{0,2}${rx(a)}${alt})(?![${HEB}A-Za-z0-9])`)}

// the Tel Aviv shares anyone holds or follows, with their names, each by the key it is kept under (a position's own
// symbol: "TLV:LUMI", "LUMI" in shekels, or the exchange's number "604611"; the watch lists' "TLV:LUMI"), so an article
// reaches the holding itself. A number that is not a share in the exchange's list (a fund) is left out: a fund's name
// carries its manager's ("הראל מחקה ת"א 125"), and news about the manager is not news about the fund
export function ilTargets(store){
  const IL=store.getDoc('research/ilsyms').data||{}, bySym=new Map(), byId=new Map();
  for(const r of (IL.stocks||[]))if(Array.isArray(r)){bySym.set(String(r[0]).toUpperCase(),r); if(+r[4])byId.set(String(+r[4]),r)}
  const stockOf=(s,ccy)=>/^TLV:[A-Z0-9.]{1,10}$/.test(s)?(bySym.get(s.slice(4))||[]):/^\d{5,9}$/.test(s)?byId.get(String(+s))||null:ccy==='ILS'&&/^[A-Z][A-Z0-9.]{0,9}$/.test(s)?(bySym.get(s)||[]):null;
  const names=new Map(), add=(s,ccy,n)=>{if(typeof s!=='string')return; const r=stockOf(s,ccy); if(!r)return; const L=names.get(s)||[]; for(const x of [n,r[1],r[2]])if(x&&typeof x==='string'&&!L.includes(x))L.push(x); names.set(s,L)};
  const pf=d=>{for(const x of ((d&&d.positions)||[]))if(x)add(x.sym,x.ccy,x.name)};
  pf(store.getDoc('portfolio/main').data);
  for(const p of store.pathsUnder('data/users'))if(/\/portfolio$/.test(p))pf(store.getDoc(p).data);
  for(const w of store.listDocs('watch'))for(const k of ['held','marks','syms'])for(const s of ((w.data||{})[k]||[]))if(/^TLV:/.test(String(s)))add(s);
  return [...names].map(([sym,N])=>({sym,aliases:ilAliases(N)})).filter(t=>t.aliases.length).sort((a,b)=>a.sym<b.sym?-1:1);
}
// the headlines of the last days that name a held or followed Tel Aviv security, by link
export function ilMatch(items,targets,{now=new Date(),days=3}={}){
  const M=targets.map(t=>({sym:t.sym,re:t.aliases.map(ilMatcher)})), from=now.getTime()-days*864e5, by=new Map();
  for(const it of items){if(!/^https:\/\/(www\.)?globes\.co\.il\//i.test(it.link))continue; const t=it.at?Date.parse(it.at):now.getTime(); if(t<from)continue;
    const txt=heq(`${it.title} ${it.desc||''}`), hit=M.filter(m=>m.re.some(re=>re.test(txt))).map(m=>m.sym); if(!hit.length)continue;
    const cur=by.get(it.link); if(cur){for(const s of hit)if(!cur.syms.includes(s))cur.syms.push(s); continue}
    by.set(it.link,{title:it.title,pub:IL_PUB,link:it.link,at:it.at&&t<=now.getTime()+36e5?it.at:now.toISOString(),sum:null,syms:hit.slice(0,4)})}
  return [...by.values()];
}
export async function ilNews(store,{fetch:f=globalThis.fetch,now=new Date(),feeds=IL_FEEDS}={}){
  if(ilOff())return {items:[],ok:0,fail:0,off:true,targets:0};
  const T=ilTargets(store); if(!T.length)return {items:[],ok:0,fail:0,targets:0};
  let ok=0, fail=0, first=null; const all=[];
  for(const fd of feeds){try{const r=await f(ilFeedUrl(fd.id),{headers:{'user-agent':UA,accept:'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'},signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error('HTTP '+r.status); const L=parseRss(await rssText(r)); if(!L.length)throw new Error('no items'); all.push(...L); ok++}
    catch(e){fail++; first=first||`globes ${fd.id}: ${e.message}`}}
  return {items:ilMatch(all,T,{now}),ok,fail,first,targets:T.length,seen:all.length};
}
