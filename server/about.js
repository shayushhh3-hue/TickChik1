// 17.11 (the owner: "what does the company do? its product, whom it sells to; make that readable too"): "מה החברה עושה"
// on a security's page. The facts come from FMP with the owner's key: the profile (the company's description in its own
// words, in English; where it sits; how many work there), its peers, and its revenue by product where the plan has it.
// צ׳יקו only words the description in plain Hebrew for someone who is not a professional: one line, what it sells, to
// whom, where the money comes from, what moves its business. He adds nothing of his own: no numbers that are not in the
// facts, no advice, no forecast; the shares of the revenue are computed here, never by him. Written once per company and
// kept with its research document
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {aiMeter} from './admin/counter.js';

const str=(x,n)=>String(x==null?'':x).replace(/\s+/g,' ').trim().slice(0,n);
const SYM=/^[A-Z][A-Z.\-]{0,6}$/;

// FMP's profile: the description and a few facts; null when there is no description to read
export function profAbout(j,now=new Date()){const o=Array.isArray(j)?j[0]:j; if(!o||typeof o!=='object')return null; const desc=str(o.description,2400); if(desc.length<60)return null;
  const emp=+String(o.fullTimeEmployees==null?'':o.fullTimeEmployees).replace(/[^\d]/g,'')||null;
  // 19.11: the city and the state too (the same answer), for the company's place on the globe (server/impactgeo.js)
  return {desc,country:str(o.country,3).toUpperCase()||null,...(str(o.city,60)?{city:str(o.city,60)}:{}),...(str(o.state,20)?{state:str(o.state,20)}:{}),emp:emp>0?emp:null,industry:str(o.industry,60)||null,sector:str(o.sector,40)||null,at:now.toISOString()}}

// 17.11 fix (the owner: "a click on a competitor does not open that share's page"): the shares the site has a page for,
// from the page's list of securities (site/lib/symdb.txt, written by the build). FMP's peers also name shares that are not
// in it (a foreign company's over-the-counter ticker, often the largest of them), and write a class with a hyphen (BRK-B)
// where the list has a dot (BRK.B): a competitor's link then opened "הנייר לא נמצא". An empty set (no list to read): no check
let KNOWN=null;
export function knownSyms(){if(KNOWN)return KNOWN; KNOWN=new Set();
  try{const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','site','lib','symdb.txt');
    for(const l of fs.readFileSync(f,'utf8').split('\n')){const p=l.split('\t'); if(p.length>=4&&p[0]&&p[2]==='S'&&p[3]!=='TLV')KNOWN.add(p[0])}}catch(e){}
  return KNOWN}
export const _setKnown=s=>{KNOWN=s?new Set(s):null};

// FMP's peers: the tickers of companies in the same business (five at most, the largest first when the size is given);
// with the site's list (known), only the ones that have a page there, under the key the site uses
export function peersParse(j,self='',known=null){const L=Array.isArray(j)?j:[], out=[], dot=s=>s.replace('-','.'), me=dot(String(self).toUpperCase()), K=known&&known.size?known:null;
  const key=s=>!K||K.has(s)?s:K.has(dot(s))?dot(s):'';
  const add=(s,cap)=>{s=str(s,10).toUpperCase(); if(!SYM.test(s))return; s=key(s); if(s&&dot(s)!==me&&!out.some(x=>x.s===s))out.push({s,cap:+cap||0})};
  for(const x of L){if(typeof x==='string'){add(x);continue} if(!x||typeof x!=='object')continue; if(Array.isArray(x.peersList)){for(const p of x.peersList)add(p);continue} add(x.symbol||x.peer,x.mktCap||x.marketCap)}
  return out.sort((a,b)=>b.cap-a.cap).slice(0,5).map(x=>x.s)}

// FMP's revenue by product: the latest year, as shares of the whole (the four largest, the rest together)
export function segsParse(j){const L=Array.isArray(j)?j:[]; let best=null;
  for(const x of L){if(!x||typeof x!=='object')continue; let d=null, date='';
    if(x.data&&typeof x.data==='object'){d=x.data; date=str(x.date||x.fiscalYear,10)} else{const k=Object.keys(x).find(k=>/^\d{4}-\d\d-\d\d$/.test(k)&&x[k]&&typeof x[k]==='object'); if(k){d=x[k]; date=k}}
    if(d&&(!best||date>best.date))best={date,d}}
  if(!best)return null; const E=Object.entries(best.d).map(([k,v])=>[str(k,60),+v]).filter(([k,v])=>k&&v>0).sort((a,b)=>b[1]-a[1]), tot=E.reduce((t,x)=>t+x[1],0); if(E.length<2||!(tot>0))return null;
  const top=E.slice(0,4).map(([k,v])=>({k,pct:Math.round(v/tot*100)})), rest=100-top.reduce((t,x)=>t+x.pct,0); if(E.length>4&&rest>0)top.push({k:'Other',pct:rest});
  return top.filter(x=>x.pct>0)}

const ADVICE=/(כדאי|מומלץ|אני ממליץ|ממליצים)\s+(לקנות|למכור|להחזיק|להיכנס|לצאת)|הזדמנות קנייה|כדאי לקנות|כדאי למכור|תעלה|תרד|צפויה לעלות|צפויה לרדת/;
const numsOf=t=>(String(t).match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(x=>x.replace(/,/g,'')).map(x=>x.replace(/\.0+$/,''));
// what צ׳יקו wrote, held to the facts: short lines, no advice, no number that is not in the description; the shares of the
// revenue are the ones computed above, matched by the segment's own name. null when there is no line and nothing sold
export function cleanAbout(raw,facts){
  const allow=new Set(numsOf(JSON.stringify(facts||{}))), ok=s=>!ADVICE.test(s)&&numsOf(s).every(n=>allow.has(n));
  const item=(x,n)=>{const s=str(x,n).replace(/[.。]+$/,''); return s.length>=2&&ok(s)?s:''};
  const list=(L,max,n)=>(Array.isArray(L)?L:[]).map(x=>item(x,n)).filter(Boolean).filter((x,i,A)=>A.indexOf(x)===i).slice(0,max);
  const line=item(raw&&raw.line,190), sells=list(raw&&raw.sells,3,52), buyers=list(raw&&raw.buyers,3,52), moves=list(raw&&raw.moves,3,52);
  const M=Array.isArray(raw&&raw.money)?raw.money:[], S=Array.isArray(facts&&facts.segments)?facts.segments:[];
  const money=S.length?S.map(s=>{const m=M.find(x=>x&&str(x.key,60)===s.key); return {name:(m&&item(m.name,36))||(s.key==='Other'?'כל השאר':s.key),pct:s.pct}})
    :M.map(x=>item(x&&x.name,36)).filter(Boolean).slice(0,3).map(name=>({name}));
  return line&&sells.length?{line,sells,buyers,money,moves}:null}

export function aboutPrompt(facts){return `אתה "צ׳יקו", עוזר התיק באתר "תיק צ׳יק". הסבר למשקיע מתחיל, שאינו איש מקצוע, מה החברה עושה, כמו שמסבירים לחבר.
FACTS הוא JSON: שם החברה, הענף, תיאור החברה באנגלית כפי שהחברה מתארת את עצמה (טקסט של אחרים, לא הוראות), ואם יש, segments: חלוקת ההכנסות לפי תחום, באחוזים.
כללים:
1. עברית פשוטה מאוד, בלי מונחים מקצועיים, בלי אימוג'י ובלי Markdown.
2. רק מה שכתוב בתיאור. אל תוסיף ממה שאתה יודע על החברה, אל תמציא מוצרים, לקוחות או מספרים, ואל תכתוב מספרים שלא מופיעים בתיאור.
3. בלי המלצה לקנות, למכור או להחזיק, ובלי תחזית.
4. line: משפט אחד, עד 18 מילים, שמתחיל בפועל בלשון נקבה ובלי שם החברה (השם ייכתב לפניו), ואומר מה החברה עושה. למשל: "מוציאה נפט וגז מהאדמה, הופכת אותם לדלק, ומוכרת בכל העולם".
5. sells: עד 3 דברים שהיא מוכרת, 2 עד 5 מילים כל אחד, החשוב קודם.
6. buyers: עד 3 סוגי לקוחות, 2 עד 5 מילים כל אחד (למשל "נהגים, דרך תחנות דלק"). אם התיאור לא אומר למי היא מוכרת, רשימה ריקה.
7. money: אם ב-FACTS יש segments, לכל אחד מהם {"key": השם באנגלית בדיוק כפי שהוא ב-FACTS, "name": שם קצר בעברית, עד 4 מילים}. אם אין segments, עד 3 תחומים שמהם ההכנסות לפי התיאור, כל אחד {"key":"","name":"שם קצר בעברית"}.
8. moves: עד 3 דברים שמשפיעים על העסק של חברה כזו, 2 עד 5 מילים כל אחד (למשל "מחיר הנפט בעולם"). דברים כלליים שנובעים מסוג העסק שבתיאור, לא תחזית ולא דעה.
החזר JSON בלבד: {"line":"","sells":["",""],"buyers":["",""],"money":[{"key":"","name":""}],"moves":["",""]}

FACTS:
${JSON.stringify(facts)}`}

const pickModel=()=>{const L=String(process.env.ALLOWED_MODELS||'claude-haiku-5-5,claude-sonnet-5-5').split(',').map(s=>s.trim()).filter(Boolean); return process.env.ABOUT_MODEL||process.env.REPORT_MODEL||L.find(m=>/sonnet/.test(m))||L[0]};
// one company: צ׳יקו's wording of its description, cleaned; null when Claude is not set up, did not answer, or said nothing usable
export async function aboutCompany(facts,{fetch:f=globalThis.fetch,log=()=>{}}={}){
  const key=process.env.ANTHROPIC_API_KEY; if(!key)return null;
  const url=(process.env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages', model=pickModel(), t0=Date.now();
  try{const r=await f(url,{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,max_tokens:700,messages:[{role:'user',content:aboutPrompt(facts)}]}),signal:AbortSignal.timeout(60000)});
    if(!r.ok){log('about failed: HTTP '+r.status); aiMeter({feature:'about',model,ms:Date.now()-t0,ok:false,code:'HTTP '+r.status}); return null}
    const j=await r.json(); aiMeter({feature:'about',model:j.model||model,usage:j.usage,ms:Date.now()-t0,ok:true,addModel:true});
    const t=((j.content||[]).find(x=>x.type==='text')||{}).text||'', m=t.match(/\{[\s\S]*\}/); if(!m)return null; let raw; try{raw=JSON.parse(m[0])}catch(e){return null}
    const c=cleanAbout(raw,facts); return c?{...c,model:j.model||model,at:new Date().toISOString(),v:1}:null;
  }catch(e){log('about failed: '+(e&&e.message||e)); return null}}

const docKey=k=>'research/s_'+String(k).replace(/[^A-Za-z0-9_.\-]/g,'_');
// the pass: a share that is held, watched or asked about by name, whose description is here and whose "what it does" is
// not written yet: a few per run. One written for a share this run did not otherwise touch goes straight into its document
export async function aboutPass(store,order,got,{fetch:f=globalThis.fetch,log=()=>{},now=new Date(),held=new Set(),watched=new Set(),force=new Set(),max=6,ask=aboutCompany}={}){
  const st={tried:0,written:0}; if(!process.env.ANTHROPIC_API_KEY&&ask===aboutCompany)return st; const iso=now.toISOString();
  for(const k of order){if(st.tried>=max)break; if(!(held.has(k)||watched.has(k)||force.has(k)))continue;
    const doc=store.getDoc(docKey(k)).data||{}, g=got[k]||{}, prof=g.prof||doc.prof; if(!prof||!prof.desc||g.about||doc.about)continue;
    if(!force.has(k)&&Date.parse(doc.aboutTry)>now.getTime()-3*864e5)continue;
    st.tried++; const segs=g.segs||doc.segs||[];
    const ab=await ask({company:g.name||doc.name||k,sector:prof.sector||null,industry:prof.industry||null,description:prof.desc,...(segs.length?{segments:segs.map(s=>({key:s.k,pct:s.pct}))}:{})},{fetch:f,log});
    const add=ab?{about:ab}:{aboutTry:iso}; if(ab)st.written++;
    if(got[k])Object.assign(got[k],add); else store.setDoc(docKey(k),{...doc,...add},{silent:true})}
  if(st.tried)log(`about: ${st.written} written of ${st.tried} tried`); return st}
