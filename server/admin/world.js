// 1.11 TikChik Management Center: the global news model. The goal (said on its screen too): the deep, world-wide view
// of the news lives here, for the management, so that TikChik itself carries only what touches a person's portfolio
// (the articles on their securities, their alerts, the map of their holdings and sectors). The same articles and
// readings the site already gathers (research/news, research/newsx) are read here across everything: the events, the
// regions, the topics and their momentum, the pressure on each sector, the companies most named, the markets, the
// calendar ahead and what to watch around it, and how good the sources are. Nothing here is about anybody's holdings.
// "What may come" is the calendar and the topics around it, never a price forecast; a scenario is marked as possible.
import {ilParts} from '../../shared/market.js';
import {newsId} from '../newsx.js';
import {aiMeter} from './counter.js';
import {audit} from './core.js';

const DAY=864e5, now=()=>new Date().toISOString();
export const REG_HE={us:'ארה״ב',israel:'ישראל',europe:'אירופה',uk:'בריטניה',china:'סין',japan:'יפן',india:'הודו',russia:'רוסיה',ukraine:'אוקראינה',middle_east:'המזרח התיכון',latam:'אמריקה הלטינית',asia:'אסיה',global:'עולמי'};
export const THEME_HE={rates:'ריבית',inflation:'אינפלציה',usd:'הדולר',oil:'נפט',gas:'גז',chips:'שבבים',ai:'בינה מלאכותית',war:'מלחמה',sanctions:'סנקציות',tariffs:'מכסים',china:'סין',israel:'ישראל',europe:'אירופה',supply:'שרשרת אספקה',
  regulation:'רגולציה',banks:'בנקים',consumer:'צריכה פרטית',housing:'דיור',crypto:'קריפטו',gold:'זהב',jobs:'תעסוקה',growth:'צמיחה',metals:'מתכות',uranium:'אורניום',power:'חשמל',defense:'ביטחון',shipping:'ספנות',fed:'הפד',ecb:'הבנק המרכזי האירופי',boi:'בנק ישראל'};
export const SEC_HE={Technology:'טכנולוגיה',Finance:'פיננסים','Health Care':'בריאות','Consumer Discretionary':'צריכה',"Consumer Staples":'מוצרי יסוד',Industrials:'תעשייה',Energy:'אנרגיה',Utilities:'תשתיות','Real Estate':'נדל״ן','Basic Materials':'חומרי גלם',Telecommunications:'תקשורת',Defense:'ביטחון',Semiconductors:'שבבים',Retail:'קמעונאות',Automotive:'רכב',Transportation:'תחבורה'};
const LV={crit:3,imp:2,watch:1,info:0}, LV_HE={crit:'קריטי',imp:'חשוב',watch:'למעקב',info:'מידע'};
// the macro items of the calendar and the topics that move around them
const CAT_THEMES={inflation:['inflation','rates','fed','usd'],jobs:['jobs','growth','fed'],growth:['growth','consumer'],rates:['rates','fed','ecb','boi','usd','banks'],fed:['fed','rates','usd'],earnings:[]};
const MK=[['SPX','bench','S&P 500'],['NDX','bench','נאסד״ק 100'],['TA35','bench','ת״א 35'],['TA125','bench','ת״א 125'],['USD','fx','דולר/שקל'],['EUR','mkts','אירו/שקל'],['BRENT','mkts','נפט ברנט'],['GOLD','mkts','זהב'],['BTC','mkts','ביטקוין'],['VIX','mkts','VIX'],['TNX','mkts','אג״ח ארה״ב 10 ש׳']];

export function worldModel(store,{days=3,at=new Date()}={}){
  days=Math.max(1,Math.min(7,+days||3)); const from=new Date(at.getTime()-days*DAY).toISOString(), d1=new Date(at.getTime()-DAY).toISOString();
  const N=store.getDoc('research/news').data||{}, X=store.getDoc('research/newsx').data||{}, by=X.by||{};
  const arts=[...(N.items||[]).map(a=>({...a,id:newsId(a.link),src:'co'})),...(X.gen||[]).map(a=>({...a,id:a.id||newsId(a.link),src:'gen'}))].filter(a=>a&&a.link&&(a.at||a.seen||'')>=from);
  const seen=new Set(), A=[]; for(const a of arts){if(seen.has(a.id))continue; seen.add(a.id); A.push({...a,x:by[a.id]||null})}
  const read=A.filter(a=>a.x), ai=read.filter(a=>!a.x.rules);
  // the events: one per event key (a reading without one is its own event); the reading that stands for it is Claude's
  // before the rules', then the higher level
  const E=new Map();
  for(const a of read){const k=a.x.ev||('id:'+a.id); let e=E.get(k);
    if(!e){e={k,arts:[],pubs:new Set(),regions:new Set(),themes:new Set(),sectors:new Set(),aff:new Map(),dirs:{pos:0,neg:0,mixed:0,unclear:0},first:null,last:null,lead:null}; E.set(k,e)}
    e.arts.push(a); if(a.pub)e.pubs.add(a.pub); const t=a.at||a.seen; if(!e.first||t<e.first)e.first=t; if(!e.last||t>e.last)e.last=t;
    for(const r of (a.x.regions||[]))e.regions.add(r); for(const t2 of (a.x.themes||[]))e.themes.add(t2); for(const s of (a.x.sectors||[]))e.sectors.add(s);
    for(const f of (a.x.aff||[])){const o=e.aff.get(f.sym)||{sym:f.sym,how:f.how,dir:f.dir,n:0}; o.n++; if(f.how==='direct')o.how='direct'; e.aff.set(f.sym,o)}
    e.dirs[a.x.dir in e.dirs?a.x.dir:'unclear']++;
    const better=!e.lead||((e.lead.x.rules?1:0)-(a.x.rules?1:0)||(LV[a.x.level]||0)-(LV[e.lead.x.level]||0))>0; if(better)e.lead=a}
  const dirOf=d=>d.pos>d.neg&&d.pos>=d.mixed?'pos':d.neg>d.pos&&d.neg>=d.mixed?'neg':(d.pos||d.neg||d.mixed)?'mixed':'unclear';
  const events=[...E.values()].map(e=>{const x=e.lead.x; return {k:e.k,he:x.he,what:x.what||'',level:x.level||'info',kind:x.kind||'news',cert:x.cert||'est',rules:!!x.rules,dir:dirOf(e.dirs),
    n:e.arts.length,pubs:[...e.pubs],single:e.pubs.size<=1,first:e.first,last:e.last,regions:[...e.regions],themes:[...e.themes],sectors:[...e.sectors],
    companies:[...e.aff.values()].sort((a,b)=>(a.how==='direct'?0:1)-(b.how==='direct'?0:1)||b.n-a.n).slice(0,8),links:e.arts.slice(0,3).map(a=>({title:a.title,pub:a.pub,link:a.link}))}})
    .sort((a,b)=>(LV[b.level]-LV[a.level])||(b.pubs.length-a.pubs.length)||(b.last>a.last?1:-1));
  // the regions: how many events, how serious, which way they lean
  const regions=Object.keys(REG_HE).map(r=>{const L=events.filter(e=>e.regions.includes(r)); return {r,name:REG_HE[r],n:L.length,crit:L.filter(e=>e.level==='crit').length,imp:L.filter(e=>e.level==='imp').length,
    pos:L.filter(e=>e.dir==='pos').length,neg:L.filter(e=>e.dir==='neg').length,top:L.slice(0,3).map(e=>e.he)}}).filter(r=>r.n).sort((a,b)=>b.crit*3+b.imp*2+b.n-(a.crit*3+a.imp*2+a.n));
  // the topics' momentum: the last day against the average day before it in the window (articles read by Claude)
  const TH={}; for(const a of ai){const t=a.at||a.seen, last=t>=d1; for(const k of (a.x.themes||[])){const o=TH[k]||(TH[k]={k,name:THEME_HE[k]||k,now:0,before:0,pos:0,neg:0}); last?o.now++:o.before++; if(a.x.dir==='pos')o.pos++; if(a.x.dir==='neg')o.neg++}}
  const prevDays=Math.max(1,days-1), themes=Object.values(TH).map(o=>{const base=o.before/prevDays; return {...o,base:Math.round(base*10)/10,ratio:base>0?Math.round(10*o.now/base)/10:null,
    state:days<2?'only':o.now>=2&&(base===0||o.now>=base*1.5)?'up':base>0&&o.now<base*0.6?'down':'same'}}).sort((a,b)=>b.now-a.now||b.before-a.before);
  // the pressure on each sector: the events that touch it and their lean, and the companies named in it
  const SE={}; for(const e of events)for(const s of e.sectors){const o=SE[s]||(SE[s]={s,name:SEC_HE[s]||s,n:0,pos:0,neg:0,mixed:0,crit:0,companies:new Map()}); o.n++; if(e.dir in o)o[e.dir]++; if(e.level==='crit')o.crit++; for(const c of e.companies)o.companies.set(c.sym,(o.companies.get(c.sym)||0)+1)}
  const sectors=Object.values(SE).map(o=>({s:o.s,name:o.name,n:o.n,pos:o.pos,neg:o.neg,mixed:o.mixed,crit:o.crit,net:o.pos-o.neg,lean:o.pos>o.neg*1.5?'pos':o.neg>o.pos*1.5?'neg':o.pos||o.neg?'mixed':'unclear',
    companies:[...o.companies.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([sym,n])=>({sym,n}))})).sort((a,b)=>b.n-a.n);
  // the companies named most, across everything (direct mentions apart)
  const CO={}; for(const e of events)for(const c of e.companies){const o=CO[c.sym]||(CO[c.sym]={sym:c.sym,events:0,direct:0,pos:0,neg:0}); o.events++; if(c.how==='direct')o.direct++; if(c.dir==='pos')o.pos++; if(c.dir==='neg')o.neg++}
  const companies=Object.values(CO).sort((a,b)=>b.events-a.events||b.direct-a.direct).slice(0,20);
  // the markets now
  const Q=store.getDoc('quotes/latest').data||{}, markets=MK.map(([k,src,name])=>{let px,pv,date; if(src==='fx'){px=+Q.usdIls; pv=Q.fxPrev?+Q.fxPrev.rate:0} else{const o=((src==='bench'?Q.bench:Q.mkts)||{})[k]; if(!o)return null; px=+o.px; pv=+o.prev; date=o.date}
    return px>0&&pv>0?{k,name,px,chg:Math.round(10000*(px/pv-1))/100,date:date||null}:null}).filter(Boolean);
  // what may come: the calendar of the next two weeks, and for each macro item the topics around it in the news now
  const C=store.getDoc('research/ecocal').data||{}, t0=ilParts(at).iso, t14=ilParts(new Date(at.getTime()+14*DAY)).iso;
  const ahead=(C.items||[]).filter(i=>i&&i.d>=t0&&i.d<=t14&&(i.cat!=='earnings'||(i.imp||0)>=2)).slice(0,40).map(i=>{const rel=(CAT_THEMES[i.cat]||[]).map(k=>TH[k]).filter(Boolean);
    return {d:i.d,name:i.name,region:REG_HE[i.region]||i.region||'',cat:i.cat,imp:i.imp||1,est:!!i.est,sym:i.sym||null,watch:rel.length?rel.map(o=>`${o.name} (${o.now+o.before} כתבות בחדשות עכשיו)`).join(', '):null}});
  // how good the picture is
  const pubs={}; for(const a of A){const p=a.pub||'(ללא מו״ל)'; pubs[p]=(pubs[p]||0)+1}
  const XS=(()=>{try{return JSON.parse(store.getMeta('newsxStatus')||'null')}catch(e){return null}})();
  const quality={articles:A.length,read:read.length,ai:ai.length,rules:read.length-ai.length,waiting:XS?XS.waiting:null,events:events.length,singleSource:events.filter(e=>e.single).length,
    multiSource:events.filter(e=>e.pubs.length>=3).length,pubs:Object.entries(pubs).map(([p,n])=>({p,n})).sort((a,b)=>b.n-a.n).slice(0,12),
    facts:events.filter(e=>e.cert==='fact').length,interp:events.filter(e=>e.cert==='interp').length,est:events.filter(e=>e.cert==='est').length};
  return {days,from,at:at.toISOString(),updatedAt:X.updatedAt||null,events:events.slice(0,80),regions,themes,sectors,companies,markets,ahead,quality,
    goal:'מודל החדשות העולמי של TikChik: התמונה הרחבה של מה שקורה בעולם, בשווקים, באזורים ובענפים, להנהלה בלבד. כך תיק צ׳יק עצמו נשאר קל ומציג למשתמש רק את מה שנוגע לתיק שלו: הכתבות על הניירות שלו, ההתראות שלו, ומפת ההשפעה על ההחזקות והענפים שלו.'};
}

// ================= the world brief: Claude reads the model and writes the picture, checked =================
const SYS=`אתה האנליסט הראשי של חדר החדשות העולמי של TikChik. אתה כותב להנהלה תמונת מצב עולמית מתוך MODEL בלבד: אירועים שנקראו מכתבות של מו״לים, אזורים, נושאים ומומנטום, לחץ על ענפים, שווקים ולוח אירועים קדימה.
כללים:
1. עברית ענינית וקצרה, בלי Markdown ובלי אימוג׳י.
2. רק מה שיש ב-MODEL. מספרים רק כפי שהם שם. אל תוסיף אירועים, שמות, מחירים או תאריכים שלא מופיעים.
3. אין תחזית מחיר ואין המלצה לקנות או למכור. "מה עשוי לקרות" נכתב כתרחיש אפשרי עם תנאי ("אם... אז עשוי..."), עם רמת סבירות נמוכה/בינונית/גבוהה ולמה.
4. הבחן בין עובדה מדווחת לבין פרשנות והשערה. אירוע ממקור יחיד מסומן כך.
5. אם התמונה חלקית (מעט כתבות, הרבה ממתינות לקריאה, מקור יחיד), אמור זאת ב-limits.
6. ev: מספרי האירועים ב-MODEL.events (מאפס) שעליהם נשען כל משפט.
החזר JSON בלבד: {"headline":"","developments":[{"t":"","why":"","ev":[0],"sure":"fact|interp|est"}],"regions":[{"r":"","t":""}],"sectors":[{"s":"","lean":"pos|neg|mixed","why":""}],"ahead":[{"d":"","t":"","watch":""}],"scenarios":[{"if":"","then":"","likely":"low|mid|high","why":""}],"limits":""}`;
const nums=s=>(String(s||'').match(/\d[\d,.]*\d|\d/g)||[]).map(x=>x.replace(/[.,]$/,'').replace(/,/g,''));
export async function worldBrief(store,user,{days=3,ask=null,force=false,env=process.env,log=()=>{}}={}){
  const M=worldModel(store,{days}), key=`worldBrief:${M.days}`, old=(()=>{try{return JSON.parse(store.getMeta(key)||'null')}catch(e){return null}})();
  if(old&&!force&&Date.now()-Date.parse(old.at)<60*60e3&&old.basis===M.updatedAt)return {...old,cached:true};
  if(!ask&&!env.ANTHROPIC_API_KEY)return {unavailable:'התקציר העולמי צריך את צ׳יקו: חסר ANTHROPIC_API_KEY ב-Railway. המודל עצמו (האירועים, האזורים, הנושאים, הענפים) זמין כאן בלי זה.'};
  if(!M.events.length)return {unavailable:'אין עדיין אירועים שנקראו בטווח, ולכן אין ממה לכתוב תקציר.'};
  const facts={events:M.events.slice(0,30).map((e,i)=>({i,he:e.he,what:e.what,level:e.level,kind:e.kind,cert:e.cert,dir:e.dir,sources:e.pubs.length,single:e.single,regions:e.regions,themes:e.themes,sectors:e.sectors,companies:e.companies.map(c=>c.sym),last:e.last})),
    regions:M.regions,themes:M.themes.slice(0,15),sectors:M.sectors.slice(0,12),markets:M.markets,ahead:M.ahead.slice(0,15),quality:{...M.quality,pubs:undefined}};
  const text=JSON.stringify(facts), L=String(env.ALLOWED_MODELS||'claude-haiku-5-5,claude-sonnet-5-5').split(',').map(s=>s.trim()).filter(Boolean), model=env.WORLD_MODEL||L.find(m=>/sonnet/.test(m))||L[0];
  let out='', t0=Date.now();
  if(ask)out=await ask({system:SYS,prompt:'MODEL:\n'+text,model});
  else{let r; try{r=await fetch((env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages',{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,max_tokens:4000,system:SYS,messages:[{role:'user',content:'MODEL:\n'+text}]}),signal:AbortSignal.timeout(150000)})}
      catch(e){aiMeter({feature:'world',model,ms:Date.now()-t0,ok:false,code:e&&e.name==='TimeoutError'?'timeout':'network'}); throw new Error('upstream')}
    if(!r.ok){aiMeter({feature:'world',model,ms:Date.now()-t0,ok:false,code:'HTTP '+r.status}); log('world brief failed: HTTP '+r.status); throw new Error('upstream')}
    const j=await r.json(); aiMeter({feature:'world',model:j.model||model,usage:j.usage,ms:Date.now()-t0,ok:true,addModel:true}); out=((j.content||[]).find(x=>x.type==='text')||{}).text||''}
  const m=out.match(/\{[\s\S]*\}/); let B=null; try{B=m?JSON.parse(m[0]):null}catch(e){B=null} if(!B||typeof B.headline!=='string')throw new Error('no_answer');
  const s=(v,n)=>String(v||'').slice(0,n), arr=(v,n)=>Array.isArray(v)?v.slice(0,n):[], evOk=i=>Number.isInteger(i)&&i>=0&&i<facts.events.length;
  const brief={headline:s(B.headline,300),developments:arr(B.developments,8).map(d=>({t:s(d.t,400),why:s(d.why,400),ev:arr(d.ev,6).filter(evOk),sure:['fact','interp','est'].includes(d.sure)?d.sure:'est'})),
    regions:arr(B.regions,8).map(r=>({r:s(r.r,30),t:s(r.t,300)})),sectors:arr(B.sectors,10).map(x=>({s:s(x.s,40),lean:['pos','neg','mixed'].includes(x.lean)?x.lean:'mixed',why:s(x.why,300)})),
    ahead:arr(B.ahead,8).map(a=>({d:s(a.d,20),t:s(a.t,200),watch:s(a.watch,300)})),scenarios:arr(B.scenarios,5).map(c=>({if:s(c.if,300),then:s(c.then,300),likely:['low','mid','high'].includes(c.likely)?c.likely:'low',why:s(c.why,300)})),limits:s(B.limits,500)};
  const have=new Set(nums(text)), said=JSON.stringify(brief), unknown=[...new Set(nums(said))].filter(x=>!have.has(x)&&!have.has(x.replace(/\.0+$/,''))&&!(+x<=31&&/^\d{1,2}$/.test(x)));
  brief.check=unknown.length?{ok:false,unknown:unknown.slice(0,8),note:'מספרים שלא מופיעים כפי שהם במודל: כדאי לבדוק מול האירועים.'}:{ok:true,note:'כל המספרים בתקציר מופיעים במודל.'};
  brief.evTitles=facts.events.map(e=>e.he); brief.at=now(); brief.model=model; brief.basis=M.updatedAt; brief.days=M.days;
  store.setMeta(key,JSON.stringify(brief)); audit(store,{user,action:'world.brief',target:'world',detail:{days:M.days,check:brief.check.ok},ip:''});
  return brief;
}
