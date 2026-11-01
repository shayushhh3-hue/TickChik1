// 1.11 (12): "מעקב אחר תנועות בעלי עניין": the insiders' own reports of their trades in the companies held or followed,
// from the SEC (EDGAR, form 4: officers, directors and 10% owners must report within two business days). Free, no key;
// US companies only (Tel Aviv has no such feed here, and that is said on the page). For each filing: who (name, role),
// what (the kind of each transaction, told apart: an open-market buy or sale, an award, an option exercise, shares
// withheld for tax, a gift, other), how much (shares, price, value), the day of the trade and of the filing, whether
// it was under a planned trading program (rule 10b5-1), what is held after, and the link to the filing itself.
// A filing is "material" by plain thresholds (below), said on the item, never a judgement of the company.
// Kept in research/insiders (by symbol), filtered for partners like the other shared research. Nothing here forecasts.
import {secCiks,secSubmissions,secUA} from './fundamentals.js';
const DAY=864e5;
export const INS_DOC='research/insiders';
const timed=(f,ms)=>(u,o={})=>f(u,{...o,signal:o.signal||AbortSignal.timeout(ms)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// the transaction codes of form 4, and what each one is in plain words
export const TX_CODE={P:'buy',S:'sell',A:'award',M:'exercise',X:'exercise',C:'exercise',F:'tax',G:'gift',D:'to_issuer',J:'other',W:'other',Z:'other',I:'other',L:'other',U:'other',K:'other',H:'other',O:'exercise'};
export const KIND_HE={buy:'קנייה בשוק',sell:'מכירה בשוק',award:'תגמול / הענקה',exercise:'מימוש אופציות',tax:'ניכוי מס (מניות שנוכו)',gift:'מתנה',to_issuer:'החזרה לחברה',other:'אחר'};
// the kinds that are a decision with the insider's own money, against the ones that are mechanics of pay
export const DELIBERATE=new Set(['buy','sell']);
// ---- a small reader for the ownership XML (one document, flat tags; no XML library) ----
const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").trim();
const tag=(x,n)=>{const m=new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`).exec(x||''); return m?m[1]:null};
const all=(x,n)=>{const out=[], re=new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`,'g'); let m; while((m=re.exec(x||'')))out.push(m[1]); return out};
const val=(x,n)=>{const t=tag(x,n); if(t==null)return null; const v=tag(t,'value'); return unesc(v!=null?v:t)};
const num=s=>{const v=parseFloat(String(s||'').replace(/[,$]/g,'')); return isFinite(v)?v:null};
const flag=s=>/^(1|true)$/i.test(String(s||'').trim());
export function parseForm4(xml){
  if(!xml||!/ownershipDocument/.test(xml))return null;
  const own=all(xml,'reportingOwner').map(o=>{const rel=tag(o,'reportingOwnerRelationship')||'';
    return {name:unesc(tag(tag(o,'reportingOwnerId')||'','rptOwnerName')),cik:unesc(tag(tag(o,'reportingOwnerId')||'','rptOwnerCik')),director:flag(tag(rel,'isDirector')),officer:flag(tag(rel,'isOfficer')),tenPct:flag(tag(rel,'isTenPercentOwner')),other:flag(tag(rel,'isOther')),title:unesc(tag(rel,'officerTitle'))||unesc(tag(rel,'otherText'))||''}});
  const notes=Object.fromEntries(all(xml,'footnotes').flatMap(f=>{const out=[], re=/<footnote id="([^"]+)"[^>]*>([\s\S]*?)<\/footnote>/g; let m; while((m=re.exec(f)))out.push([m[1],unesc(m[2])]); return out}));
  const planDoc=flag(tag(xml,'aff10b5One'));
  const tx=(t,deriv)=>{const code=(val(t,'transactionCode')||'').toUpperCase(), ids=[...t.matchAll(/footnoteId id="([^"]+)"/g)].map(m=>m[1]), fn=ids.map(i=>notes[i]).filter(Boolean).join(' ');
    const plan=planDoc||flag(tag(tag(t,'transactionCoding')||'','aff10b5One'))||/10b5-?1/i.test(fn);
    return {date:val(t,'transactionDate'),code,kind:TX_CODE[code]||'other',ad:(val(t,'transactionAcquiredDisposedCode')||'').toUpperCase(),shares:num(val(t,'transactionShares')),px:num(val(t,'transactionPricePerShare')),after:num(val(t,'sharesOwnedFollowingTransaction')),deriv,title:val(t,'securityTitle')||'',indirect:(val(t,'directOrIndirectOwnership')||'D').toUpperCase()==='I',plan,note:fn.slice(0,300)}};
  const txs=[...all(tag(xml,'nonDerivativeTable')||'','nonDerivativeTransaction').map(t=>tx(t,false)),...all(tag(xml,'derivativeTable')||'','derivativeTransaction').map(t=>tx(t,true))].filter(t=>t.code);
  return {issuer:{name:unesc(tag(tag(xml,'issuer')||'','issuerName')),sym:unesc(tag(tag(xml,'issuer')||'','issuerTradingSymbol')).toUpperCase()},owners:own,txs,planDoc,period:unesc(tag(xml,'periodOfReport'))};
}
const ROLE_HE=o=>{const t=(o.title||'').trim(); const parts=[]; if(o.tenPct)parts.push('בעל עניין (מעל 10%)'); if(o.officer)parts.push(t||'נושא משרה'); else if(t)parts.push(t); if(o.director)parts.push('דירקטור'); if(!parts.length&&o.other)parts.push('אחר'); return parts.join(', ')||'מדווח'};
const TOP=/\b(chief executive|ceo|chief financial|cfo|president|chair|founder)\b/i;
// one filing, summed up: the kind that leads (an open-market buy or sale first), the shares and the value of each kind
export function filingSummary(p,{sym,cik,acc,filedAt,link}){
  const by={}; for(const t of p.txs){if(t.deriv&&t.kind!=='exercise')continue; const k=by[t.kind]=by[t.kind]||{kind:t.kind,shares:0,value:0,n:0,plan:false,dates:[]};
    k.n++; k.shares+=t.shares||0; if(t.px&&t.shares)k.value+=t.px*t.shares; if(t.plan)k.plan=true; if(t.date)k.dates.push(t.date)}
  const order=['buy','sell','exercise','award','tax','gift','to_issuer','other'], kinds=Object.values(by).sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)), lead=kinds[0]||null;
  const o=p.owners[0]||{name:'',title:''}, after=p.txs.filter(t=>!t.deriv&&t.after!=null).map(t=>t.after).pop();
  const dates=p.txs.map(t=>t.date).filter(Boolean).sort();
  return {acc,sym,cik,link,filedAt,owner:o.name,role:ROLE_HE(o),top:TOP.test(o.title||'')||o.tenPct,officer:o.officer,director:o.director,tenPct:o.tenPct,
    kind:lead?lead.kind:'other',shares:lead?Math.round(lead.shares):0,value:lead?Math.round(lead.value):0,plan:!!(lead&&lead.plan),deliberate:!!(lead&&DELIBERATE.has(lead.kind)),
    kinds:kinds.map(k=>({kind:k.kind,shares:Math.round(k.shares),value:Math.round(k.value),n:k.n,plan:k.plan})),txDate:dates[dates.length-1]||p.period||null,after:after!=null?Math.round(after):null,
    txs:p.txs.slice(0,8).map(t=>({date:t.date,kind:t.kind,code:t.code,shares:t.shares,px:t.px,ad:t.ad,plan:t.plan,deriv:t.deriv,indirect:t.indirect,title:t.title.slice(0,60)}))};
}
// material, by plain thresholds: an open-market trade of $250K or more; or by the chief officers / a 10% owner of $50K or
// more; a planned-program sale counts only from $1M. "cluster": three or more insiders buying in the open market within
// 30 days. "repeat": the same person with three or more filings of the same kind in 90 days
export function markFilings(L){
  const out=L.map(f=>({...f,material:false,why:[],cluster:false,repeat:false}));
  for(const f of out){if(!f.deliberate)continue; const th=f.plan&&f.kind==='sell'?1e6:f.top?5e4:2.5e5; if(f.value>=th){f.material=true; f.why.push(`${KIND_HE[f.kind]} של ${f.top?'נושא משרה בכיר או בעל עניין':'בעל עניין'} בשווי $${Math.round(f.value).toLocaleString('en-US')}${f.plan?' (בתוכנית מסחר מתוכננת)':''}`)}}
  const buys=out.filter(f=>f.kind==='buy'&&f.deliberate);
  for(const f of buys){const near=buys.filter(g=>g.owner!==f.owner&&Math.abs(Date.parse(g.txDate||g.filedAt)-Date.parse(f.txDate||f.filedAt))<=30*DAY); const names=new Set(near.map(g=>g.owner)); if(names.size>=2){f.cluster=true; f.material=true; f.why.push(`${names.size+1} בעלי עניין קנו בשוק בתוך 30 יום`)}}
  for(const f of out){const same=out.filter(g=>g.owner===f.owner&&g.kind===f.kind&&g.deliberate&&Math.abs(Date.parse(g.filedAt)-Date.parse(f.filedAt))<=90*DAY); if(f.deliberate&&same.length>=3){f.repeat=true; f.why.push(`${same.length} דיווחים של ${KIND_HE[f.kind]} מאותו אדם ב-90 יום`)}}
  return out;
}
export function pickForm4(sub,{days=120,now=new Date(),n=25}={}){
  const R=sub&&sub.filings&&sub.filings.recent; if(!R||!Array.isArray(R.form))return [];
  const from=now.getTime()-days*DAY, out=[];
  for(let i=0;i<R.form.length&&out.length<n;i++){const form=R.form[i]; if(form!=='4'&&form!=='4/A')continue; const acc=String((R.accessionNumber||[])[i]||''), doc=String((R.primaryDocument||[])[i]||''), at=String((R.acceptanceDateTime||[])[i]||(R.filingDate||[])[i]||''); const t=Date.parse(at); if(!acc||isNaN(t)||t<from)continue;
    out.push({acc,doc,filedAt:new Date(t).toISOString(),amend:form==='4/A'})}
  return out;
}
export const form4Url=(cik,acc,doc)=>`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g,'')}/${doc.replace(/^xsl[^/]*\//,'')}`;
export const filingIndexUrl=(cik,acc)=>`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g,'')}/${acc}-index.htm`;
export async function insidersTask(store,{syms=null,fetch:f=globalThis.fetch,now=new Date(),log=()=>{},pause=150,budgetMs=150e3,days=120,keepDays=200}={}){
  const t0=Date.now(), D=store.getDoc(INS_DOC).data||{by:{}}, by={...(D.by||{})}, checked={...(D.checked||{})}; let ok=0, fail=0, got=0, first=null, ciks=null;
  if(!syms){const {newsSyms}=await import('./newsfeed.js'); syms=newsSyms(store)}
  try{ciks=await secCiks(store,{fetch:f})}catch(e){log('insiders: SEC tickers: '+e.message); return {ok:0,fail:1,got:0,first:'SEC tickers: '+e.message}}
  const keep=new Date(now.getTime()-keepDays*DAY).toISOString();
  for(const sym of syms){if(Date.now()-t0>budgetMs)break; if(!/^[A-Z][A-Z.\-]{0,5}$/.test(sym))continue; const cik=ciks[sym]||ciks[sym.replace(/[.\-]/g,'')]; if(!cik)continue;
    try{const sub=await secSubmissions(cik,{fetch:f}); if(!sub){checked[sym]=now.toISOString(); continue} const have=new Set((by[sym]||[]).map(x=>x.acc)), L=(by[sym]||[]).filter(x=>x.filedAt>=keep);
      for(const fl of pickForm4(sub,{days,now})){if(have.has(fl.acc)||Date.now()-t0>budgetMs)continue; if(!/\.xml$/i.test(fl.doc))continue;
        const r=await timed(f,20000)(form4Url(cik,fl.acc,fl.doc),{headers:{'user-agent':secUA(),accept:'application/xml,text/xml'}}); if(!r.ok){fail++; first=first||`${sym} ${fl.acc}: HTTP ${r.status}`; await sleep(pause); continue}
        const p=parseForm4(await r.text()); if(!p){await sleep(pause); continue} L.push({...filingSummary(p,{sym,cik,acc:fl.acc,filedAt:fl.filedAt,link:filingIndexUrl(cik,fl.acc)}),amend:fl.amend}); got++; await sleep(pause)}
      by[sym]=markFilings(L.sort((a,b)=>a.filedAt<b.filedAt?1:-1)).slice(0,60); checked[sym]=now.toISOString(); ok++}
    catch(e){fail++; first=first||`${sym}: ${e.message}`; if(fail>=4&&!ok)break}
    await sleep(pause)}
  store.setDoc(INS_DOC,{by,checked,updatedAt:now.toISOString(),source:'SEC EDGAR, טפסי 4 (דיווחי בעלי עניין)',note:'חברות אמריקאיות בלבד; דיווח תוך יומיים מהעסקה; מידע מפגר ביחס לעסקה עצמה'});
  log(`insiders: ${ok} companies, ${got} new filings${fail?`, ${fail} failed (${first})`:''}`);
  return {ok,fail,got,first};
}
