// 19.11 TikChik WORLD IMPACT: the impact engine's event layer. Not a second engine: it stands on the readings the site
// already makes (server/newsx.js, one reading per article, shared by everybody) and on their grouping into events
// (server/pulse.js eventsOf, the same key the alerts use), and adds what the globe and the two views need:
//   - one event per thing that happened, whatever the number of articles and publishers: the articles of an event are
//     kept with their sources; two event keys about the same thing are joined (an alias), conservatively; an admin can
//     join or part them by hand (audited);
//   - a new event apart from an update of a known one (what changed, when), from the registry of the last run;
//   - for each event: the category (sixteen), when it happened and when it was published, where (verified headquarters,
//     a country, a region), the sources and how reliable they are, the possible direction, the strength, the confidence,
//     the horizon, the explanation and the evidence;
//   - the chain of impact, event -> country -> economic factor -> sector -> company -> share / fund / index, every link
//     with its direction, strength, confidence, the reliability of its sources, direct or indirect, the horizon, the
//     explanation and the evidence. A link exists only where a reading says so, or where it is a fact of structure (a
//     share is in a sector by the site's list of securities; a fund holds a share by its published holdings). A possible
//     direction is never a forecast, and two things that happened together are never said to cause each other.
// Two views, both cut on the server:
//   - the admin (the management center's "view"): everything, with the sources, the duplicates, the weak links, the
//     failures of the feeds, the assets without a fresh price, and the corrections (each audited);
//   - a user: only the events that reach their own portfolio, and of every event only the paths that end at one of their
//     assets; a company they do not hold appears only as a link on such a path. A partner's events are built from the
//     articles a partner may read (the general news and the articles about their own securities), exactly as their alerts.
// The personal view is derived from the same engine (the same function, the same rules and corrections), never a model of
// its own per person.
import {CATS, CAT_HE, TYPE_HE, STAGE_HE, moveAfter} from './newsx.js';
import {eventsOf, holdingsOf, pathsOf, isFund, sectorMap} from './pulse.js';
import {symsOfUser, ownerLike} from './store.js';
import {audit, can} from './admin/core.js';
import {usOpen, ilOpen, ilParts} from '../shared/market.js';
import {CC, CC_HE, REG_CC, countryPt, regionPt, marketPt, hqOf, INDEX_MKT} from './impactgeo.js';

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const IMPACT_DOC='research/impact', SNAP='research/impactsnap', FIX_DOC='research/impactfix';
const DAY=864e5, H=36e5;
const LV={crit:3,imp:2,watch:1,info:0}, CONF_R={low:0,mid:1,high:2}, CONF_OF=['low','mid','high'];
const str=(v,n)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const uniq=A=>[...new Set(A.filter(Boolean))];
const minC=(a,b)=>CONF_R[a]<=CONF_R[b]?a:b;
export const DIR_HE={pos:'השפעה חיובית אפשרית',neg:'השפעה שלילית אפשרית',mixed:'השפעה מעורבת',unclear:'כיוון לא ברור'};
export const CONF_HE={high:'ביטחון גבוה',mid:'ביטחון בינוני',low:'ביטחון נמוך'};
export const S_HE={3:'חזקה',2:'בינונית',1:'חלשה'};
export const HZ_HE={short:'טווח קצר (ימים עד שבועות)',mid:'טווח בינוני (שבועות עד חודשים)',long:'טווח ארוך (חודשים ומעלה)'};
export const REL_HE={high:'מקור מוביל',official:'הודעה רשמית של החברה או הרשות',mid:'מקור רגיל',low:'מקור חלש (דעה, אתר המלצות, רשת חברתית)'};
export const FAC_HE={rates:'ריבית',inflation:'אינפלציה',usd:'הדולר',oil:'נפט',gas:'גז',chips:'שבבים',ai:'בינה מלאכותית',war:'מלחמה',sanctions:'סנקציות',tariffs:'מכסים',china:'סין',israel:'ישראל',europe:'אירופה',
  supply:'שרשרת אספקה',regulation:'רגולציה',banks:'בנקים',consumer:'צריכה פרטית',housing:'דיור',crypto:'קריפטו',gold:'זהב',jobs:'תעסוקה',growth:'צמיחה',metals:'מתכות',uranium:'אורניום',power:'חשמל',
  defense:'ביטחון',shipping:'ספנות',fed:'הפד',ecb:'הבנק המרכזי האירופי',boi:'בנק ישראל'};
export const SEC_HE={Technology:'טכנולוגיה',Finance:'פיננסים','Health Care':'בריאות','Consumer Discretionary':'צריכה',"Consumer Staples":'מוצרי יסוד',Industrials:'תעשייה',Energy:'אנרגיה',Utilities:'תשתיות',
  'Real Estate':'נדל״ן','Basic Materials':'חומרי גלם',Telecommunications:'תקשורת',Defense:'ביטחון',Semiconductors:'שבבים',Retail:'קמעונאות',Automotive:'רכב',Transportation:'תחבורה'};
export const HOW_HE={direct:'החברה שהידיעה עוסקת בה',supplier:'ספקית',customer:'לקוחה',competitor:'מתחרה',sector:'דרך הענף',macro:'דרך המאקרו',fund:'הקרן מחזיקה במניה',member:'המניה בענף',broad:'קרן רחבה על השוק'};

// the names of securities, from the page's public list (site/lib/symdb.txt, written by the build): never from quotes/latest,
// whose names say what somebody on the site holds
let NAMES=null;
export function nameMap(){if(NAMES)return NAMES; NAMES=new Map(); try{const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','site','lib','symdb.txt');
    for(const l of fs.readFileSync(f,'utf8').split(String.fromCharCode(10))){const p=l.split(String.fromCharCode(9)); if(p.length<2||!p[1])continue; const k=p[3]==='TLV'?'TLV:'+p[0]:p[0]; if(!NAMES.has(k))NAMES.set(k,p[1])}}catch(e){} return NAMES}
export const _setNames=m=>{NAMES=m instanceof Map?m:new Map(Object.entries(m||{}))};

// ---- the category: the reading's own (newer readings), else by rules from the kind, the topics and the words ----
const DISASTER=/\b(earthquakes?|quake|tsunami|hurricanes?|typhoons?|cyclones?|tornado(es)?|floods?|flooding|wildfires?|bushfires?|drought|volcan\w*|landslides?|heat ?wave)\b|רעידת אדמה|צונאמי|הוריקן|טייפון|ציקלון|שיטפון|שיטפונות|שריפת ענק|שריפות יער|בצורת|הר געש/i;
const WAR=/\b(war|missiles?|air ?strikes?|invasion|troops|ceasefire|shelling|drone strikes?|military (strike|operation)|hostilities)\b|מלחמה|טילים|תקיפה|הפסקת אש|פלישה|לחימה|כוחות צבא/i;
const CHIPW=/\b(chips?|semiconductors?|foundry|wafers?|gpus?|lithography)\b|שבב/i;
const TH_CAT=[['war','war'],['rates','rates'],['fed','rates'],['ecb','rates'],['boi','rates'],['inflation','macro'],['jobs','macro'],['growth','macro'],['consumer','macro'],['housing','macro'],['oil','energy'],['gas','energy'],
  ['power','energy'],['uranium','energy'],['tariffs','trade'],['sanctions','trade'],['supply','supply'],['shipping','supply'],['gold','commodities'],['metals','commodities'],['chips','chips'],['ai','ai'],['banks','finance'],
  ['crypto','finance'],['regulation','regulation'],['defense','geo']];
export function catsOf(x,a){
  const t=`${(a&&a.title)||''} ${(x&&x.he)||''} ${(x&&x.what)||''}`, th=new Set((x&&x.themes)||[]), sec=new Set((x&&x.sectors)||[]), out=[];
  if(x&&CATS.includes(x.cat))out.push(x.cat);
  if(DISASTER.test(t))out.push('disaster');
  const ty=x&&x.type;
  if(ty==='earnings'||ty==='guidance')out.push('earnings'); else if(ty==='ma')out.push('ma'); else if(ty==='regulation'||ty==='legal')out.push('regulation');
  else if(ty==='macro_rates')out.push('rates'); else if(ty==='inflation')out.push('macro'); else if(ty==='geo')out.push(th.has('war')||WAR.test(t)?'war':'geo');
  else if(ty==='sanctions')out.push('trade'); else if(ty==='supply')out.push('supply'); else if(ty==='energy')out.push('energy');
  else if(ty==='ai_chips')out.push(th.has('chips')&&!th.has('ai')?'chips':th.has('ai')&&!th.has('chips')?'ai':CHIPW.test(t)?'chips':'ai');
  for(const [k,c] of TH_CAT)if(th.has(k))out.push(c);
  if(sec.has('Semiconductors'))out.push('chips'); if(sec.has('Finance'))out.push('finance'); if(sec.has('Energy'))out.push('energy');
  if(['Industrials','Automotive','Transportation','Basic Materials'].some(s=>sec.has(s)))out.push('industry');
  if(!out.length)out.push(x&&x.macro?'macro':'industry');
  return uniq(out).slice(0,3);
}
// the countries: the reading's own (cc), else the regions it names that are one country
export function ccOf(x){const L=Array.isArray(x&&x.cc)?x.cc.filter(c=>CC[c]):[]; if(L.length)return L.slice(0,4); return uniq(((x&&x.regions)||[]).map(r=>REG_CC[r]).filter(Boolean)).slice(0,4)}

// ---- the sources: how reliable a publisher is, by its kind (a list the admin can read; a publisher not on it is "mid") ----
const TIER_HIGH=/reuters|bloomberg|associated press|\bap\b|wall street journal|\bwsj\b|financial times|\bft\.com|the economist|nikkei|cnbc|barron|marketwatch|federal reserve|sec edgar|bank of israel|european central bank|\becb\b|globes|גלובס|calcalist|כלכליסט|themarker|דה מרקר|\bbbc\b|new york times|washington post|axios|politico|\bmaya\b|מאיה|tase/i;
const TIER_LOW=/motley fool|fool\.com|seeking alpha|investorplace|benzinga|zacks|insider monkey|gurufocus|tipranks|24\/7 wall|simply wall|\bx\.com\b|twitter|reddit|stocktwits|youtube/i;
const OFFICIAL=/business ?wire|pr ?newswire|globe ?newswire|accesswire|newsfile|press release/i;
export function srcTier(pub,kind){const p=String(pub||''); if(TIER_LOW.test(p)||kind==='opinion')return 'low'; if(TIER_HIGH.test(p))return 'high'; if(OFFICIAL.test(p)||kind==='pr')return 'official'; return 'mid'}
const TIER_R={low:0,mid:1,official:1,high:2};
const bestTier=L=>L.reduce((b,t)=>TIER_R[t]>TIER_R[b]?t:b,'low');

// ---- the horizon, by the kind of event: a rule, said to be one ----
const HZ_CAT={earnings:'short',ma:'short',disaster:'short',rates:'mid',macro:'mid',regulation:'mid',trade:'mid',geo:'mid',war:'mid',supply:'mid',energy:'mid',commodities:'mid',finance:'mid',ai:'long',chips:'long',industry:'long'};
const hzOf=cats=>HZ_CAT[cats[0]]||'mid';
const HZ_WHY='לפי סוג האירוע (כלל קבוע של האתר, לא תחזית)';

// ---- the confidence of a reading's link: what kind of statement it is, who read it, how many sources stand behind it ----
function confOf(x,{direct,tiers,nPubs}){
  if(x.rules)return {c:'low',why:'קריאה אוטומטית לפי מילים בכותרת; צ׳יקו עוד לא קרא את הכתבה'};
  let c=x.cert==='fact'?(direct?'high':'mid'):x.cert==='interp'?'mid':'low';
  let why=x.cert==='fact'?(direct?'דיווח על דבר שקרה, והחברה היא נושא הידיעה':'דיווח על דבר שקרה; הקשר הזה עקיף, והסיבה שלו כתובה בקריאה'):x.cert==='interp'?'פרשנות של המקור, לא עובדה שנבדקה':'הערכה של צ׳יקו מהקשר כללי';
  const best=bestTier(tiers);
  if(best==='low'&&c!=='low'){c=c==='high'?'mid':'low'; why+='; המקור חלש (דעה או אתר המלצות)'}
  else if(nPubs>=3&&c==='mid'&&x.cert==='fact'){c='high'; why+='; מדווח בשלושה מקורות או יותר'}
  return {c,why};
}

// ---- joining two event keys about one thing (conservative): same category, close in time, and the same company named
// directly, or (for an event of no company) the same countries and most of the headline's words in common ----
const WORDS=t=>new Set(String(t||'').toLowerCase().replace(/[^a-z0-9֐-׿ ]+/g,' ').split(/\s+/).filter(w=>w.length>2&&!/^(the|and|for|with|from|that|this|its|are|was|has|have|will|after|over|into|amid|says|said|new|more|than|about)$/.test(w)));
const jac=(a,b)=>{const A=WORDS(a), B=WORDS(b); if(!A.size||!B.size)return 0; let i=0; for(const w of A)if(B.has(w))i++; return i/(A.size+B.size-i)};
// a kind of event that happens once (a report, a deal, a decision): two readings of one company of that kind in two days are
// one event, whatever their headlines say
const ONEOFF=new Set(['earnings','guidance','ma','legal','regulation','management','rating','macro_rates','inflation']);
export function aliasesOf(E,{fix=null}={}){
  const alias={}, no=new Set(Object.keys((fix&&fix.split)||{})), L=E.filter(e=>e.ai&&!no.has(e.k)).map(e=>({e,cats:catsOf(e.x,e.lead),t:Date.parse(e.lead.at||e.lead.seen||0)||0,type:e.x.type||'other',
    dir:new Set((e.x.aff||[]).filter(z=>z.how==='direct').map(z=>z.sym)),cc:ccOf(e.x).sort().join(','),fac:(e.x.fac||[]).map(f=>f.k).sort().join(','),title:e.lead.title||'',he:e.x.he||'',key:String(e.x.ev||'').replace(/-/g,' ')}));
  L.sort((p,q)=>p.t-q.t);
  for(let i=0;i<L.length;i++){const a=L[i]; if(alias[a.e.k])continue;
    for(let j=i+1;j<L.length;j++){const b=L[j]; if(alias[b.e.k]||b.t-a.t>48*H)continue; if(a.cats[0]!==b.cats[0])continue;
      const same=a.dir.size&&[...b.dir].some(s=>a.dir.has(s)), sim=Math.max(jac(a.title,b.title),jac(a.he,b.he),jac(a.key,b.key));
      if(same&&((a.type===b.type&&ONEOFF.has(a.type))||sim>=0.35)){alias[b.e.k]=a.e.k; continue}
      // an event of no company: the same kind, the same countries and the same economic factors within a day, and some words in common
      if(!a.dir.size&&!b.dir.size&&a.cc&&a.cc===b.cc&&a.type===b.type&&a.fac&&a.fac===b.fac&&b.t-a.t<=24*H&&sim>=0.3)alias[b.e.k]=a.e.k}}
  // the admin's hand: a join by hand stands, a part by hand undoes a join
  for(const [k,v] of Object.entries((fix&&fix.alias)||{}))if(k!==v&&!no.has(k))alias[k]=v;
  for(const k of no)delete alias[k];
  // a chain of aliases ends at its root
  const root=k=>{let r=k, n=0; while(alias[r]&&n++<8)r=alias[r]; return r};
  for(const k of Object.keys(alias))alias[k]=root(k);
  return alias;
}

// ---- one event, enriched, with its links. `vis` limits it to the articles one person may read ----
const node={ev:k=>'ev:'+k,cty:c=>'cty:'+c,fac:f=>'fac:'+f,sec:g=>'sec:'+g,co:s=>'co:'+s,fund:s=>'fund:'+s};
function eventOf(group,{fix,prevOf,coLoc}){
  const arts=group.arts, lead=group.lead, x=group.x, k=group.k, ai=group.ai, usable=arts.filter(z=>!ai||!z.x.rules);
  const F=((fix&&fix.ev)||{})[k]||{};
  // the sources, each publisher once, with its articles; the same headline twice is a duplicate kept as such
  const src=new Map(), seenT=new Map(), dups=[];
  arts.forEach((z,i)=>{const p=z.a.pub||'(ללא מו״ל)', tier=srcTier(z.a.pub,z.x.kind), nt=String(z.a.title||'').toLowerCase().replace(/[^a-z0-9֐-׿]+/g,' ').trim();
    if(nt&&seenT.has(nt))dups.push({i,of:seenT.get(nt),pub:z.a.pub||'',title:z.a.title||''}); else if(nt)seenT.set(nt,i);
    const o=src.get(p)||{pub:p,tier,n:0,arts:[]}; o.n++; o.arts.push(i); src.set(p,o)});
  const tiers=[...src.values()].map(s=>s.tier), nPubs=src.size, srcRel=nPubs>=3&&TIER_R[bestTier(tiers)]>=1?'high':bestTier(tiers);
  const cats=F.cat&&CATS.includes(F.cat)?uniq([F.cat,...catsOf(x,lead)]).slice(0,3):catsOf(x,lead);
  const cc=uniq(usable.flatMap(z=>ccOf(z.x))).slice(0,4), regions=uniq(usable.flatMap(z=>z.x.regions||[])).slice(0,3);
  const times=arts.map(z=>z.a.at||z.a.seen).filter(Boolean).sort();
  const level=x.level||'info', base=Math.max(1,LV[level]||1);
  // the place: the admin's, the company the event is about, the country, the region
  const directCos=uniq(usable.flatMap(z=>(z.x.aff||[]).filter(a=>a.how==='direct').map(a=>a.sym)).concat(usable.flatMap(z=>z.a.src==='co'?(z.a.syms||[]):[])));
  const coCats=new Set(['earnings','ma','industry','ai','chips','finance','regulation','supply']);
  let loc=null;
  if(F.loc&&Number.isFinite(+F.loc.lat)&&Number.isFinite(+F.loc.lon))loc={lat:+F.loc.lat,lon:+F.loc.lon,name:str(F.loc.name,60)||'',how:'fix',src:'fix'};
  if(!loc&&directCos.length&&coCats.has(cats[0])){const l=coLoc(directCos[0]); if(l&&l.how!=='market')loc={...l,of:directCos[0]}}
  if(!loc&&cc.length)loc=countryPt(cc[0],{market:cats[0]==='finance'||(cats[0]==='rates'&&cc[0]==='EU')});
  if(!loc&&regions.length)loc=regionPt(regions[0]);
  if(!loc&&directCos.length){const l=coLoc(directCos[0]); if(l)loc={...l,of:directCos[0]}}
  // the links, from the readings: each says why and rests on its articles
  const L=new Map(), why=[], ev=node.ev(k);
  const add=(from,to,o,i)=>{const id=from+'>'+to; let l=L.get(id);
    if(!l){l={id,from,to,dir:o.dir||'unclear',move:o.move||null,direct:!!o.direct,how:o.how||null,why:o.why||'',basis:o.basis||'reading',arts:[],cs:[],tiers:[],s:o.s||1}; L.set(id,l)}
    else{if(o.dir&&o.dir!=='unclear'&&l.dir!=='unclear'&&o.dir!==l.dir)l.dir='mixed'; else if(l.dir==='unclear'&&o.dir)l.dir=o.dir; if(!l.why&&o.why)l.why=o.why; l.s=Math.max(l.s,o.s||1)}
    if(i!=null&&!l.arts.includes(i)){l.arts.push(i); l.tiers.push(srcTier(arts[i].a.pub,arts[i].x.kind)); l.cs.push(confOf(arts[i].x,{direct:!!o.direct,tiers:[srcTier(arts[i].a.pub,arts[i].x.kind)],nPubs:1}))}};
  arts.forEach((z,i)=>{const xx=z.x; if(ai&&xx.rules)return;
    const b=Math.max(1,LV[xx.level]||1), ccs=ccOf(xx), one=ccs.length===1?node.cty(ccs[0]):null;
    for(const c of ccs)add(ev,node.cty(c),{dir:'unclear',direct:true,why:`האירוע קורה ב${CC_HE[c]||c} או נוגע לה ישירות`,s:b},i);
    const facs=(xx.fac||[]);
    for(const f of facs)add(one||ev,node.fac(f.k),{dir:'unclear',move:f.move,direct:!one,why:f.why||'',s:Math.max(1,b-(one?1:0))},i);
    const secx=new Map((xx.secx||[]).map(s=>[s.g,s]));
    for(const g of (xx.sectors||[])){const s=secx.get(g), via=s&&s.via&&facs.some(f=>f.k===s.via)?node.fac(s.via):(one||ev);
      add(via,node.sec(g),{dir:s?s.dir:'unclear',direct:false,why:s&&s.why?s.why:'הקריאה מונה את הענף בין הענפים שהאירוע נוגע להם',s:Math.max(1,b-1)},i)}
    const dco=(xx.aff||[]).filter(a=>a.how==='direct').map(a=>a.sym);
    for(const a of (xx.aff||[])){
      if(a.how==='direct')add(ev,node.co(a.sym),{dir:a.dir||xx.dir,direct:true,how:'direct',why:a.why||HOW_HE.direct,s:b},i);
      else if(['supplier','customer','competitor'].includes(a.how))add(dco.length===1?node.co(dco[0]):ev,node.co(a.sym),{dir:a.dir||'unclear',direct:false,how:a.how,why:a.why||'',s:Math.max(1,b-1)},i);
      else if(a.how==='sector')add(a.via&&(xx.sectors||[]).includes(a.via)?node.sec(a.via):ev,node.co(a.sym),{dir:a.dir||'unclear',direct:false,how:'sector',why:a.why||'',s:Math.max(1,b-1)},i);
      else if(a.how==='macro')add(facs.length===1?node.fac(facs[0].k):ev,node.co(a.sym),{dir:a.dir||'unclear',direct:false,how:'macro',why:a.why||'',s:1},i)}
    // the securities an article was gathered for are the companies it is about
    if(z.a.src==='co')for(const s of (z.a.syms||[]))if(!(xx.aff||[]).some(a=>a.sym===s))add(ev,node.co(s),{dir:xx.dir,direct:true,how:'direct',why:'הכתבה נאספה על החברה הזאת',s:b},i);
    if(!xx.rules&&xx.what)why.push({t:xx.what,c:xx.cert||'interp',a:[i]})});
  // each link: its confidence (the best of its readings), the reliability of its sources, the admin's hand
  const FL=(fix&&fix.link)||{}, links=[];
  for(const l of L.values()){const best=l.cs.reduce((b,c)=>CONF_R[c.c]>CONF_R[b.c]?c:b,{c:'low',why:''}), nP=new Set(l.arts.map(i=>arts[i].a.pub)).size;
    let c=best.c, cwhy=best.why; if(nP>=3&&c==='mid'&&!l.arts.every(i=>arts[i].x.rules)){c='high'; cwhy+='; מדווח בשלושה מקורות או יותר'}
    const o={id:l.id,from:l.from,to:l.to,dir:l.dir,move:l.move,s:Math.min(3,l.s),conf:c,confWhy:cwhy,rel:bestTier(l.tiers),direct:l.direct,how:l.how,hz:hzOf(cats),why:l.why,basis:l.arts.length&&l.arts.every(i=>arts[i].x.rules)?'rules':l.basis,arts:l.arts,st:'auto'};
    const f=FL[k+'|'+l.id]; if(f){if(f.st==='no')continue; o.st=f.st; if(f.dir&&['pos','neg','mixed','unclear'].includes(f.dir))o.dir=f.dir; if([1,2,3].includes(+f.s))o.s=+f.s; if(CONF_OF.includes(f.conf))o.conf=f.conf; if(f.why)o.why=str(f.why,300); if(f.note)o.note=str(f.note,300); o.fixBy=f.by||null}
    links.push(o)}
  // the direction of the event: the lead reading's, unless the admin set it; the strength by its level
  const dir=['pos','neg','mixed','unclear'].includes(F.dir)?F.dir:x.dir||'unclear', s=[1,2,3].includes(+F.s)?+F.s:Math.min(3,base);
  const cf=confOf(x,{direct:directCos.length>0,tiers,nPubs}), conf=CONF_OF.includes(F.conf)?F.conf:cf.c;
  const prev=prevOf(k);
  return {k,ev:x.ev||null,he:str(F.he,120)||x.he||'',title:lead.title||'',what:x.what||'',more:x.more||'',unknown:x.unknown||'',cats,cat:cats[0],type:x.type||'other',typeHe:TYPE_HE[x.type]||'',level,kind:x.kind||'news',
    st:group.st||'unknown',stHe:STAGE_HE[group.st||'unknown'],occ:x.occ||null,first:times[0]||null,last:times[times.length-1]||null,seen:prev?prev.seen:new Date().toISOString(),
    cc,regions,loc,dir,s,conf,confWhy:CONF_OF.includes(F.conf)?'נקבע ביד מנהל':cf.why,hz:F.hz&&HZ_HE[F.hz]?F.hz:hzOf(cats),hzWhy:F.hz?'נקבע ביד מנהל':HZ_WHY,
    ai,rules:!ai,nArt:arts.length,nPubs,srcRel,src:[...src.values()].sort((a,b)=>TIER_R[b.tier]-TIER_R[a.tier]||b.n-a.n),dups,
    arts:arts.map((z,i)=>({i,id:z.a.id,pub:z.a.pub||'',title:z.a.title||'',link:z.a.link||'',at:z.a.at||z.a.seen||null,src:z.a.src||'co',syms:z.a.src==='co'?(z.a.syms||[]).slice(0,6):[],tier:srcTier(z.a.pub,z.x.kind),he:z.x.he||'',rules:!!z.x.rules,kind:z.x.kind||'news'})),
    evid:why.slice(0,6),links,macro:usable.some(z=>z.x.macro===true),fix:Object.keys(F).length?{...F}:null,hidden:F.st==='hidden'};
}

// ---- the events now: grouped as the alerts group them, joined by alias, enriched; `visible` limits the articles ----
// a short cache per viewer's visibility: the same documents and the same minute give the same events (a page opened by
// several people, or reopened, does not rebuild them); a write to any of the documents changes the key
const CACHE=new Map();
const stamp=(store,p)=>{try{const r=store.db.prepare('select updated_at from docs where path=?').get(p); return r?r.updated_at:''}catch(e){return ''}};
export function buildEvents(store,{now=new Date(),days=7,visible=null,visKey=null,fix=undefined,prev=undefined}={}){
  const ck=visKey&&fix===undefined&&prev===undefined?[visKey,days,stamp(store,'research/newsx'),stamp(store,'research/news'),stamp(store,FIX_DOC),stamp(store,IMPACT_DOC),Math.floor(now.getTime()/60e3)].join('|'):null;
  if(ck&&CACHE.has(ck))return CACHE.get(ck);
  const FX=fix===undefined?(store.getDoc(FIX_DOC).data||{}):fix||{}, PV=prev===undefined?(store.getDoc(IMPACT_DOC).data||{}):prev||{};
  const groups=eventsOf(store,{now,days,visible,alias:false});
  const alias=aliasesOf(groups,{fix:FX}), byK=new Map(groups.map(g=>[g.k,g]));
  // an alias joins the articles into its root's group
  for(const [from,to] of Object.entries(alias)){const a=byK.get(from), b=byK.get(to); if(!a||!b||a===b)continue; b.arts.push(...a.arts); b.ai=b.ai||a.ai; byK.delete(from)}
  for(const g of byK.values())g.arts.sort((p,q)=>((p.x.rules?1:0)-(q.x.rules?1:0))||((LV[q.x.level]||0)-(LV[p.x.level]||0))||(String(q.a.at||q.a.seen)<String(p.a.at||p.a.seen)?-1:1));
  for(const g of byK.values()){g.x=g.arts[0].x; g.lead=g.arts[0].a; g.ai=g.arts.some(z=>!z.x.rules);
    g.st=(g.arts.slice().sort((p,q)=>String(q.a.at||q.a.seen)<String(p.a.at||p.a.seen)?-1:1).find(z=>z.x.st&&z.x.st!=='unknown')||{x:{}}).x.st||'unknown'}
  const PE=new Map((PV.events||[]).map(e=>[e.k,e])), prevOf=k=>PE.get(k)||PE.get(Object.keys(alias).find(a=>alias[a]===k))||null;
  const SD=new Map(), coLoc=sym=>{if(SD.has(sym))return SD.get(sym); let about=null; try{about=(store.getDoc('research/s_'+String(sym).replace(/[^A-Za-z0-9_.\-]/g,'_')).data||{}).prof||null}catch(e){}
    let l=hqOf(sym,{fix:FX.hq||null,about}); if(!l)l=/^TLV:|^\d{5,9}$/.test(sym)?marketPt('IL'):/^[A-Z][A-Z.\-]{0,6}$/.test(sym)?marketPt('US'):null; SD.set(sym,l); return l};
  const events=[...byK.values()].map(g=>eventOf(g,{fix:FX,prevOf,coLoc}));
  events.sort((a,b)=>(LV[b.level]-LV[a.level])||(String(b.last)>String(a.last)?1:-1));
  const val={events,alias,coLoc};
  if(ck){if(CACHE.size>=30)for(const k of [...CACHE.keys()].slice(0,10))CACHE.delete(k); CACHE.set(ck,val)}
  return val;
}

// ---- new or update: what changed against the last run (the registry), each change said ----
const CH_HE={new:'אירוע חדש',src:'מקור נוסף',level:'הרמה עלתה',dir:'הכיוון השתנה',cos:'חברה נוספת נוגעת לאירוע',fact:'מה שהיה הערכה דווח כעובדה',stage:'שלב האירוע השתנה',read:'צ׳יקו קרא את האירוע'};
export function changesOf(o,e){
  if(!o)return ['new'];
  const ch=[]; if(e.nPubs>o.nPubs||e.nArt>o.nArt)ch.push('src'); if((LV[e.level]||0)>(LV[o.level]||0))ch.push('level'); if(o.dir&&e.dir!==o.dir&&e.dir!=='unclear')ch.push('dir');
  const oc=new Set((o.cos||[])), nc=e.links.filter(l=>l.to.startsWith('co:')).map(l=>l.to.slice(3)); if(nc.some(s=>!oc.has(s)))ch.push('cos');
  if(o.st&&e.st!==o.st&&e.st!=='unknown')ch.push('stage'); if(o.rules&&!e.rules)ch.push('read'); if(o.conf==='low'&&e.conf!=='low'&&!o.rules)ch.push('fact');
  return ch;
}
const MATERIAL=new Set(['new','level','dir','cos','stage','fact','read']);

// ---- the run: the registry written for the admins, with the history of every event and a snapshot of the day ----
export function impactTask(store,{now=new Date(),days=7,log=()=>{}}={}){
  const t0=Date.now(), iso=now.toISOString(), PV=store.getDoc(IMPACT_DOC).data||{}, PE=new Map((PV.events||[]).map(e=>[e.k,e]));
  const {events,alias}=buildEvents(store,{now,days,prev:PV});
  let nNew=0, nUpd=0;
  const out=events.map(e=>{const o=PE.get(e.k)||PE.get(Object.keys(alias).find(a=>alias[a]===e.k)), ch=changesOf(o,e), mat=ch.filter(c=>MATERIAL.has(c));
    const hist=(o&&o.hist||[]).slice(-11); if(ch.length&&(!o||ch.join()!==((o.hist||[]).slice(-1)[0]||{}).ch?.join()))hist.push({at:iso,ch,he:ch.map(c=>CH_HE[c]).join(' · ')});
    const status=!o?'new':mat.length?'update':o.status==='new'&&now-Date.parse(o.seen||iso)<6*H?'new':'same';
    if(status==='new'&&!o)nNew++; else if(status==='update')nUpd++;
    return {...e,status,rev:(o?o.rev||0:0)+(mat.length&&o?1:0),hist,upd:mat.length&&o?iso:(o&&o.upd)||null,cos:uniq(e.links.filter(l=>l.to.startsWith('co:')).map(l=>l.to.slice(3)))}});
  const doc={v:1,at:iso,days,n:out.length,events:out,alias,stats:{events:out.length,new:nNew,upd:nUpd,links:out.reduce((t,e)=>t+e.links.length,0),aliases:Object.keys(alias).length,ms:Date.now()-t0}};
  store.setDoc(IMPACT_DOC,doc,{silent:true});
  // the snapshot of the day: what the engine said about each event and each company it reached, as it said it then
  try{snapshot(store,out,now)}catch(e){log('impact snapshot: '+(e&&e.message||e))}
  store.setMeta('impactStatus',JSON.stringify({at:iso,...doc.stats}));
  CACHE.clear();
  log(`impact: ${out.length} events (${nNew} new, ${nUpd} updated), ${doc.stats.links} links, ${doc.stats.aliases} joined, ${doc.stats.ms}ms`);
  return doc.stats;
}
// the companies an event reaches through its links (the paths of the global graph), with the path's direction, strength,
// confidence and whether it is direct
export function reachOf(e,{maxHops=4}={}){
  const out=new Map(), adj=new Map(); for(const l of e.links){if(!adj.has(l.from))adj.set(l.from,[]); adj.get(l.from).push(l)}
  const walk=(n,path,seen)=>{if(path.length>maxHops)return; for(const l of (adj.get(n)||[])){if(seen.has(l.to))continue; const P=[...path,l];
      if(l.to.startsWith('co:')){const sym=l.to.slice(3), d=lastDir(P), s=Math.min(...P.map(z=>z.s)), c=P.map(z=>z.conf).reduce(minC), direct=P.length===1&&l.direct, cur=out.get(sym);
        if(!cur||better({direct,s,c,hops:P.length},cur))out.set(sym,{sym,dir:d,s,c,direct,hops:P.length})}
      walk(l.to,P,new Set([...seen,l.to]))}};
  walk(node.ev(e.k),[],new Set([node.ev(e.k)]));
  return [...out.values()];
}
const lastDir=P=>{for(let i=P.length-1;i>=0;i--){const d=P[i].dir; if(d&&d!=='unclear')return d} return 'unclear'};
const better=(a,b)=>(a.direct!==b.direct?a.direct:a.s!==b.s?a.s>b.s:CONF_R[a.c]!==CONF_R[b.c]?CONF_R[a.c]>CONF_R[b.c]:a.hops<b.hops);
function snapshot(store,events,now){
  const day=ilParts(now).iso, p=SNAP+'/'+day;
  const items=events.filter(e=>!e.hidden).map(e=>({k:e.k,he:e.he,cat:e.cat,level:e.level,dir:e.dir,s:e.s,conf:e.conf,first:e.first,last:e.last,status:e.status,rules:e.rules,
    vis:{gen:e.arts.some(a=>a.src==='gen'),syms:uniq(e.arts.flatMap(a=>a.syms||[])).slice(0,20)},cos:reachOf(e).slice(0,40)}));
  store.setDoc(p,{day,at:now.toISOString(),n:items.length,events:items},{silent:true});
  // 180 days are kept
  const from=ilParts(new Date(now.getTime()-180*DAY)).iso; for(const r of store.listDocs(SNAP))if(r.id<from)store.deleteDoc(SNAP+'/'+r.id);
}

// ================= the data's freshness: live, delayed, a close (historical), or none; never "live" when it is not =================
export function freshOf(Q,sym,now=new Date()){
  const m=((Q&&Q.meta)||{})[sym]||{}, px=+(((Q&&Q.prices)||{})[sym]), stale=((Q&&Q.stale)||{})[sym];
  if(!(px>0))return {state:'none',he:'אין מחיר',at:null};
  const il=/^TLV:|^\d{5,9}$/.test(sym)||m.ccy==='ILS'||m.src==='maya', open=il?ilOpen(now):usOpen(now), today=il?ilParts(now).iso:null;
  const rtAt=m.rt?Date.parse(m.rt):0;
  if(stale)return {state:'stale',he:'לא עדכני: '+stale,at:m.at?new Date(m.at).toISOString():null};
  if(!il&&rtAt&&now-rtAt<3*60e3&&open)return {state:'live',he:'זמן אמת (מסחר בארה״ב)',at:new Date(rtAt).toISOString()};
  const at=m.at?new Date(m.at):null;
  if(open&&at&&now-at<40*60e3)return {state:'delayed',he:'בעיכוב של עד 15 דקות',at:at.toISOString()};
  return {state:'close',he:m.date?`מחיר סגירה ${String(m.date).slice(8,10)}.${String(m.date).slice(5,7)}`:'מחיר אחרון שהתקבל',at:at?at.toISOString():null,date:m.date||null};
}
const BENCH_ORDER=[['SPX','S&P 500'],['NDX','נאסד״ק 100'],['DJI','דאו ג׳ונס'],['TA35','ת״א 35'],['TA125','ת״א 125']];
export function indicesOf(Q,now=new Date()){
  const B=(Q&&Q.bench)||{}; return BENCH_ORDER.map(([k,name])=>{const b=B[k]; if(!b||!(+b.px>0))return {k,name,state:'none',he:'אין נתון'};
    const chg=+b.prev>0?Math.round((b.px/b.prev-1)*1e4)/100:null, il=INDEX_MKT[k]==='IL', open=il?ilOpen(now):usOpen(now), at=b.at?new Date(b.at):null;
    const fr=open&&at&&now-at<40*60e3?{state:'delayed',he:'בעיכוב של עד 15 דקות'}:{state:'close',he:b.date?`סגירה ${String(b.date).slice(8,10)}.${String(b.date).slice(5,7)}`:'נתון אחרון'};
    const mp=marketPt(INDEX_MKT[k]||'US');
    return {k,name,px:+b.px,prev:+b.prev||null,chg,...fr,at:at?at.toISOString():null,date:b.date||null,loc:mp}})}

// ================= a user's view: the paths that end at their assets, and nothing else =================
const visFor=(store,u)=>{if(!u||ownerLike(u))return null; const ok=symsOfUser(store,u.id); return a=>a.src==='gen'||(a.syms||[]).some(k=>ok.has(k))};
// the structural links of one portfolio: a held share in a sector, a held fund holding a share
function structLinks(e,HD,etf,{sectorOf}){
  const out=[], held=new Map(HD.pos.map(h=>[h.sym,h])), named=new Set(e.links.filter(l=>l.to.startsWith('co:')).map(l=>l.to.slice(3)));
  // a sector the event touches -> a held share in it that the event does not name
  for(const l of e.links){if(!l.to.startsWith('sec:'))continue; const g=l.to.slice(4);
    for(const h of HD.pos){if(h.fund||named.has(h.sym)||sectorOf(h.sym)!==g)continue;
      out.push({id:l.to+'>co:'+h.sym,from:l.to,to:'co:'+h.sym,dir:null,s:1,conf:'low',confWhy:'החברה לא מוזכרת; הקשר הוא דרך הענף שלה בלבד',rel:'high',direct:false,how:'member',hz:l.hz,
        why:`${h.sym} נמצאת בענף ${SEC_HE[g]||g} (לפי רשימת הניירות של האתר)`,basis:'structure',arts:[],st:'auto',ev:[{t:'רשימת הניירות של האתר: הענף של המניה',c:'fact'}]})}}
  // a company the event reaches -> a held fund that holds it (by the fund's published holdings)
  for(const [F,d] of Object.entries(etf||{})){if(!held.has(F)||!d||!Array.isArray(d.top))continue;
    for(const [sym,w] of d.top){if(!named.has(sym)||!(+w>=1))continue;
      out.push({id:'co:'+sym+'>fund:'+F,from:'co:'+sym,to:'fund:'+F,dir:null,s:+w>=5?2:1,conf:'mid',confWhy:'עובדה: הקרן מחזיקה במניה; ההשפעה על הקרן לפי המשקל',rel:'high',direct:false,how:'fund',hz:null,
        why:`${sym} היא ${w}% מ-${d.etf&&d.etf!==F?d.etf+' (הקרן שהקרן שלך עוקבת כמוה)':F} לפי אחזקות הקרן${d.asOf?' ('+d.asOf.slice(8,10)+'.'+d.asOf.slice(5,7)+')':''}`,basis:'structure',arts:[],st:'auto',
        ev:[{t:`אחזקות הקרן מ-${d.src||'האתר של הקרן'}${d.asOf?', נכון ל-'+d.asOf:''}`,c:'fact'}]})}}
  // a broad market fund and an event of the whole market (the reading says "macro"): a weak, general link, said to be so
  // 19.11: only a fund of the event's own market (an Israeli index fund and the Bank of Israel, an American one and the Fed),
  // or any broad fund for an event of no country: a rate decision in Washington is not a link to a Tel Aviv index by itself
  const macro=e.macro&&e.links.some(l=>l.to.startsWith('fac:'))&&eventMacro(e), mkt=s=>/^(TLV:|\d)/.test(s)||/^TA\d+$/.test(s)?'IL':'US';
  if(macro)for(const h of HD.pos){if(!h.fund||out.some(o=>o.to==='fund:'+h.sym)||(e.cc.length&&!e.cc.includes(mkt(h.sym))))continue; const f=e.links.find(l=>l.to.startsWith('fac:'));
    out.push({id:f.to+'>fund:'+h.sym,from:f.to,to:'fund:'+h.sym,dir:null,s:1,conf:'low',confWhy:'כלל כללי: אירוע של השוק כולו נוגע לקרן רחבה',rel:'mid',direct:false,how:'broad',hz:f.hz,
      why:`${h.sym} היא קרן רחבה; לפי הקריאה האירוע עשוי לנגוע במניות רבות במקביל`,basis:'rules',arts:[],st:'auto',ev:[]})}
  return out;
}
// the paths from an event to the assets: depth-first over the event's links and the portfolio's structural ones
function pathsTo(e,assets,extra,{maxHops=6,perAsset=3}={}){
  const adj=new Map(), all=[...e.links,...extra]; for(const l of all){if(!adj.has(l.from))adj.set(l.from,[]); adj.get(l.from).push(l)}
  const found=new Map();
  const walk=(n,P,seen)=>{if(P.length>=maxHops)return; for(const l of (adj.get(n)||[])){if(seen.has(l.to))continue; const Q=[...P,l];
      if(assets.has(l.to)){const a=assets.get(l.to), d=lastDir(Q.map(z=>({...z,dir:z.dir||null}))), s=Math.min(...Q.map(z=>z.s||1)), c=Q.map(z=>z.conf).reduce(minC);
        const p={to:a.sym,node:l.to,links:Q.map(z=>z.id),nodes:[node.ev(e.k),...Q.map(z=>z.to)],dir:d,s,conf:c,direct:Q.length===1&&!!l.direct,hops:Q.length};
        const L=found.get(a.sym)||[]; L.push(p); found.set(a.sym,L)}
      walk(l.to,Q,new Set([...seen,l.to]))}};
  walk(node.ev(e.k),[],new Set([node.ev(e.k)]));
  const out=[]; for(const L of found.values()){L.sort((a,b)=>better({direct:a.direct,s:a.s,c:a.conf,hops:a.hops},{direct:b.direct,s:b.s,c:b.conf,hops:b.hops})?-1:1); out.push(...L.slice(0,perAsset))}
  return {paths:out,all};
}
// a node's short label (a company by its ticker; its name apart, for a tooltip)
const nodeLabel=(id)=>{const [t,v]=[id.slice(0,id.indexOf(':')),id.slice(id.indexOf(':')+1)];
  return t==='cty'?(CC_HE[v]||v):t==='fac'?(FAC_HE[v]||v):t==='sec'?(SEC_HE[v]||v):v};

// the asset's place: a share at its headquarters (or its exchange, said to be), a fund or an index at its market
function assetLoc(sym,fund,coLoc){if(fund)return /^TLV:|^\d{5,9}$/.test(sym)?marketPt('IL'):marketPt('US'); return coLoc(sym)}
function sparkOf(store,sym,n=30){try{const d=store.getDoc('quotes/c_'+String(sym).replace(':','_')).data; if(!d||!Array.isArray(d.c)||!Array.isArray(d.d))return null; const c=d.c.slice(-n).map(Number).filter(v=>v>0); return c.length>=5?{c,from:d.d[Math.max(0,d.d.length-n)],to:d.d[d.d.length-1]}:null}catch(e){return null}}

export function impactForUser(store,u,{now=new Date(),days=7,limit=40}={}){
  const pa=pathsOf(u), P=store.getDoc(pa.portfolio).data, Q=store.getDoc('quotes/latest').data||{}, HD=holdingsOf(P,Q);
  const vis=visFor(store,u), sec=sectorMap(), sectorOf=s=>{const g=sec.get(s)||''; return ({'Information Technology':'Technology',Financials:'Finance',Materials:'Basic Materials',Healthcare:'Health Care'})[g]||g};
  const {events,coLoc}=buildEvents(store,{now,days,visible:vis,visKey:vis?'u:'+u.id+':'+[...symsOfUser(store,u.id)].sort().join(','):'all'});
  const PV=store.getDoc(IMPACT_DOC).data||{}, PE=new Map((PV.events||[]).map(e=>[e.k,e]));
  const etfAll=(store.getDoc('research/etf').data||{}).by||{}, etf=Object.fromEntries(Object.entries(etfAll).filter(([k])=>HD.pos.some(h=>h.sym===k)));
  const mine=new Set(HD.pos.map(h=>h.sym)), names=nameMap(), coName=s=>(mine.has(s)&&((Q.meta||{})[s]||{}).name)||names.get(s)||null;
  // the assets: the holdings, each with its price, today's move (the halo: the market's own move, nothing else) and freshness
  const assets=new Map(), A=[];
  let dayV=0, dayKnown=true;
  for(const h of HD.pos){const px=+((Q.prices||{})[h.sym]), pv=+((Q.prev||{})[h.sym]), chg=px>0&&pv>0?Math.round((px/pv-1)*1e4)/100:null, fr=freshOf(Q,h.sym,now);
    if(h.w!=null&&chg!=null&&HD.total)dayV+=h.val*(1-1/(1+chg/100)); else dayKnown=false;
    const id=(h.fund?'fund:':'co:')+h.sym, loc=assetLoc(h.sym,h.fund,coLoc);
    const a={sym:h.sym,id,name:coName(h.sym),kind:h.fund?'fund':'stock',w:h.w,px:px>0?px:null,chg,fresh:fr,loc,sec:h.fund?null:sectorOf(h.sym)||null,
      halo:chg==null||fr.state==='none'?'none':chg>0.05?'up':chg<-0.05?'down':'flat'};
    assets.set(id,a); A.push(a)}
  // a held fund named as a company in a reading ("co:QQQ") is the same asset
  for(const a of A)if(a.kind==='fund')assets.set('co:'+a.sym,a);
  // the events that reach the portfolio, each with only its paths to the assets
  const out=[], usedL=new Map(), usedN=new Set();
  for(const e of events){if(e.hidden)continue;
    const extra=structLinks(e,HD,etf,{sectorOf}), {paths,all}=pathsTo(e,assets,extra); if(!paths.length)continue;
    // a fund the article lists without naming it in the headline is reached through what it holds, not directly (as the alerts)
    const said=`${e.title} ${e.he}`, named=s=>new RegExp(`(^|[^A-Za-z0-9])${reEsc(String(s).replace(/^TLV:/,''))}([^A-Za-z0-9]|$)`).test(said);
    for(const p of paths){const a=assets.get(p.node); if(a&&a.kind==='fund'&&p.direct&&!named(a.sym)){p.direct=false; p.conf='low'; p.note='הקרן מופיעה בכתבה כנכס קשור, לא בכותרת: הקשר עקיף, דרך מה שהקרן מחזיקה'}}
    const byId=new Map(all.map(l=>[l.id,l]));
    for(const p of paths){for(const id of p.links){const l=byId.get(id); if(!l)continue; const dir=l.dir||p.dir;
        usedL.set(e.k+'|'+id,{id,ek:e.k,from:l.from,to:l.to,dir,move:l.move||null,s:l.s||1,conf:l.conf,confWhy:l.confWhy||'',rel:l.rel,direct:!!l.direct,how:l.how||null,hz:l.hz||e.hz,why:l.why||'',basis:l.basis,st:l.st||'auto',
          ev:l.ev||l.arts.map(i=>{const a=e.arts[i]; return a?{t:a.he||a.title,pub:a.pub,link:a.link,at:a.at,tier:a.tier}:null}).filter(Boolean).slice(0,4)})}
      for(const n of p.nodes)usedN.add(n)}
    const o=PE.get(e.k);
    out.push({k:e.k,he:e.he,what:e.what,more:e.more,unknown:e.unknown,cats:e.cats,cat:e.cat,catHe:CAT_HE[e.cat],type:e.type,level:e.level,kind:e.kind,st:e.st,stHe:e.stHe,occ:e.occ,first:e.first,last:e.last,
      status:o?(o.status||'same'):'new',upd:o&&o.upd||null,cc:e.cc,regions:e.regions,loc:e.loc,dir:e.dir,s:e.s,conf:e.conf,confWhy:e.confWhy,hz:e.hz,hzWhy:e.hzWhy,rules:e.rules,nArt:e.nArt,nPubs:e.nPubs,srcRel:e.srcRel,
      src:e.src.map(s=>({pub:s.pub,tier:s.tier,n:s.n})),arts:e.arts.slice(0,6).map(a=>({pub:a.pub,title:a.title,link:a.link,at:a.at,tier:a.tier,he:a.he})),evid:e.evid.map(v=>({t:v.t,c:v.c})),
      touches:uniq(paths.map(p=>p.to)),paths,rel:relOf(paths,assets)})}
  out.sort((a,b)=>(b.rel-a.rel)||(LV[b.level]-LV[a.level])||(String(b.last)>String(a.last)?1:-1));
  const ev=out.slice(0,limit), keepK=new Set(ev.map(e=>e.k));
  const links=[...usedL.values()].filter(l=>keepK.has(l.ek));
  const nodes={}; for(const e of ev){nodes['ev:'+e.k]={t:'ev',label:e.he,loc:e.loc}; for(const p of e.paths)for(const n of p.nodes)if(!nodes[n]){const t=n.slice(0,n.indexOf(':'));
      nodes[n]={t,label:nodeLabel(n),...(t==='co'||t==='fund'?{name:coName(n.slice(n.indexOf(':')+1))}:{}),loc:t==='cty'?countryPt(n.slice(4)):t==='co'?(assets.get(n)||{}).loc||coLoc(n.slice(3)):t==='fund'?(assets.get(n)||{}).loc||null:null,mine:assets.has(n)}}}
  // the portfolio's line: the value and today's move only when every price is known (else said to be partial)
  const pf={total:HD.total,n:HD.pos.length,known:HD.wOk,day:HD.wOk&&dayKnown?Math.round(dayV):null,dayPct:HD.wOk&&dayKnown&&HD.total?Math.round(dayV/(HD.total-dayV)*1e4)/100:null,usdPct:HD.usdPct,
    fresh:worstFresh(A)};
  const keys=A.filter(a=>a.kind==='stock'||a.kind==='fund').sort((a,b)=>(b.w||0)-(a.w||0)).slice(0,6).map(a=>({...a,spark:sparkOf(store,a.sym),events:ev.filter(e=>e.touches.includes(a.sym)).length}));
  return {mode:'me',at:now.toISOString(),days,engineAt:PV.at||null,pf,assets:A,keys,indices:indicesOf(Q,now),events:ev,links,nodes,
    priceLabel:Q.priceLabel||'',filters:filtersOf(ev,A),
    notes:['הכיוון הוא השערה מקריאת החדשות, לא תחזית ולא המלצה. קו ירוק או אדום הוא כיוון אפשרי; ההילה סביב נכס היא התנועה שלו בשוק בפועל היום.',
      'מוצגים רק אירועים שיש להם מסלול מוסבר לנכס בתיק. חברה שלא בתיק מופיעה רק כחוליה במסלול כזה.']};
}
// an event of the whole market: the reading said so (macro), Claude's, a level that counts
function eventMacro(e){return e.level==='crit'||e.level==='imp'?e.cats.some(c=>['rates','macro','war','geo','trade','energy'].includes(c)):false}
const relOf=(paths,assets)=>paths.reduce((t,p)=>{const a=assets.get(p.node)||{}; const w=a.w==null?1:Math.max(0.5,a.w/5); return t+(p.direct?3:1)*p.s*(CONF_R[p.conf]+1)*w},0);
const FR_R={none:0,stale:1,close:2,delayed:3,live:4};
const worstFresh=A=>{if(!A.length)return null; const w=A.reduce((b,a)=>FR_R[a.fresh.state]<FR_R[b.fresh.state]?a:b); const n=A.filter(a=>a.fresh.state===w.fresh.state).length; return {state:w.fresh.state,he:w.fresh.he,n}};
function filtersOf(ev,A){const cc=new Map(), reg=new Set(), sec=new Set(), cats=new Set();
  for(const e of ev){for(const c of e.cc)cc.set(c,CC_HE[c]||c); for(const r of e.regions)reg.add(r); for(const c of e.cats)cats.add(c)}
  for(const a of A)if(a.sec)sec.add(a.sec);
  return {countries:[...cc].map(([k,he])=>({k,he})),regions:[...reg],sectors:[...sec].map(k=>({k,he:SEC_HE[k]||k})),cats:[...cats].map(k=>({k,he:CAT_HE[k]}))}}

// ================= the admin's view: everything, with what is wrong with it =================
export function impactWorld(store,{now=new Date(),days=7,limit=200}={}){
  const PV=store.getDoc(IMPACT_DOC).data||null, from=new Date(now.getTime()-days*DAY).toISOString();
  const evs=(PV&&PV.events||[]).filter(e=>(e.last||'')>=from);
  const Q=store.getDoc('quotes/latest').data||{};
  // the duplicates: the articles of one event that are the same story, and the keys joined into another
  const dups=evs.filter(e=>(e.dups||[]).length||Object.values(PV.alias||{}).includes(e.k)).map(e=>({k:e.k,he:e.he,dups:(e.dups||[]).length,joined:Object.entries(PV.alias||{}).filter(([,v])=>v===e.k).map(([k])=>k),nArt:e.nArt,nPubs:e.nPubs})).slice(0,60);
  // the weak links: low confidence, a headline-only reading, or a single weak source
  const weak=[]; for(const e of evs)for(const l of e.links){const why=[]; if(l.conf==='low')why.push('ביטחון נמוך'); if(l.basis==='rules')why.push('קריאה לפי כותרת בלבד'); if(l.rel==='low')why.push('מקור חלש'); if(!l.why)why.push('בלי הסבר');
    if(why.length&&l.st==='auto')weak.push({k:e.k,he:e.he,link:l.id,from:l.from,to:l.to,why})}
  // the failures of the feeds that make the picture: the reading, the gathering, the engine itself
  const M=k=>{try{return JSON.parse(store.getMeta(k)||'null')}catch(e){return null}}, XS=M('newsxStatus'), NS=M('newsStatus'), IS=M('impactStatus');
  const fails=[]; if(XS&&XS.first)fails.push({k:'newsx',he:'קריאת הכתבות (צ׳יקו)',note:XS.first,at:XS.at}); if(XS&&!XS.ai)fails.push({k:'newsx-key',he:'קריאת הכתבות',note:'אין ANTHROPIC_API_KEY: האירועים נקראים לפי כותרת בלבד',at:XS.at});
  if(XS&&XS.waiting>30)fails.push({k:'newsx-wait',he:'כתבות שממתינות לקריאה',note:`${XS.waiting} כתבות עוד לא נקראו`,at:XS.at});
  if(NS&&NS.first)fails.push({k:'news',he:'איסוף הכתבות',note:String(NS.first).replace(/^[A-Z0-9.\-^=]{1,12}:\s*/,'נייר אחד: '),at:NS.at});
  if(!IS)fails.push({k:'impact',he:'מנוע ההשפעה',note:'עוד לא רץ; ירוץ אחרי הקריאה הבאה של החדשות',at:null}); else if(now-Date.parse(IS.at)>3*H)fails.push({k:'impact-old',he:'מנוע ההשפעה',note:'הריצה האחרונה לפני יותר משלוש שעות',at:IS.at});
  // the assets without a fresh price: the companies the events reach (public news), never anybody's holdings
  const named=uniq(evs.flatMap(e=>e.cos||[])), stale=[]; for(const s of named){const f=freshOf(Q,s,now); if(f.state==='none'||f.state==='stale')stale.push({sym:s,state:f.state,he:f.he,at:f.at})}
  const FX=store.getDoc(FIX_DOC).data||{};
  const nodes={}; const coLoc=sym=>{let about=null; try{about=(store.getDoc('research/s_'+String(sym).replace(/[^A-Za-z0-9_.\-]/g,'_')).data||{}).prof||null}catch(e){} return hqOf(sym,{fix:FX.hq||null,about})||marketPt(/^TLV:/.test(sym)?'IL':'US')};
  const list=evs.slice(0,limit);
  for(const e of list){nodes['ev:'+e.k]={t:'ev',label:e.he,loc:e.loc}; for(const l of e.links)for(const n of [l.from,l.to])if(!nodes[n]){const t=n.slice(0,n.indexOf(':'));
      nodes[n]={t,label:nodeLabel(n),loc:t==='cty'?countryPt(n.slice(4)):t==='co'?coLoc(n.slice(3)):null}}}
  return {mode:'world',at:now.toISOString(),days,engineAt:PV&&PV.at||null,stats:PV&&PV.stats||null,events:list.map(e=>({...e,catHe:CAT_HE[e.cat]})),nodes,indices:indicesOf(Q,now),
    diag:{dups,weak:weak.slice(0,150),nWeak:weak.length,fails,stale:stale.slice(0,80),fixes:Object.keys(FX.link||{}).length+Object.keys(FX.ev||{}).length+Object.keys(FX.hq||{}).length+Object.keys(FX.alias||{}).length},
    filters:filtersOf(list,[]),tiers:REL_HE};
}

// ================= the admin's hand: approve, reject or correct; every change audited with what it was =================
const FIX_KINDS=['link','event','hq','join','split'];
export function impactFix(store,user,b,{ip=''}={}){
  if(!can(user,'edit'))throw Object.assign(new Error('permission_denied'),{status:403});
  const kind=String(b&&b.kind||''); if(!FIX_KINDS.includes(kind))throw Object.assign(new Error('bad_kind'),{status:400});
  const D=store.getDoc(FIX_DOC).data||{}, FX={link:{},ev:{},hq:{},alias:{},split:{},...D}, at=new Date().toISOString(), by=user.email||user.id;
  const k=str(b.k,80), okK=s=>/^(ev:[a-z0-9\-]{1,60}|rd:[A-Z0-9:.\-]{1,30}:\d{4}-\d\d-\d\d|id:[a-f0-9]{12})$/.test(s);
  let target='', before=null, after=null;
  if(kind==='link'){const id=str(b.id,200); if(!okK(k)||!/^[a-z]{2,4}:[^>]{1,80}>[a-z]{2,4}:[^>]{1,80}$/.test(id))throw Object.assign(new Error('bad_link'),{status:400});
    const st=['ok','no','edit','auto'].includes(b.st)?b.st:'edit', key=k+'|'+id; before=FX.link[key]||null;
    if(st==='auto')delete FX.link[key]; else FX.link[key]={st,...(['pos','neg','mixed','unclear'].includes(b.dir)?{dir:b.dir}:{}),...([1,2,3].includes(+b.s)?{s:+b.s}:{}),...(CONF_OF.includes(b.conf)?{conf:b.conf}:{}),
      ...(str(b.why,300)?{why:str(b.why,300)}:{}),...(str(b.note,300)?{note:str(b.note,300)}:{}),by,at};
    after=FX.link[key]||null; target=key}
  else if(kind==='event'){if(!okK(k))throw Object.assign(new Error('bad_event'),{status:400}); before=FX.ev[k]||null;
    const o={...(before||{})}; if(b.cat!==undefined){if(b.cat&&!CATS.includes(b.cat))throw Object.assign(new Error('bad_cat'),{status:400}); if(b.cat)o.cat=b.cat; else delete o.cat}
    if(b.loc!==undefined){if(b.loc===null)delete o.loc; else{const lat=+b.loc.lat, lon=+b.loc.lon; if(!(lat>=-90&&lat<=90&&lon>=-180&&lon<=180))throw Object.assign(new Error('bad_loc'),{status:400}); o.loc={lat,lon,name:str(b.loc.name,60)}}}
    for(const f of ['dir','conf','hz','st']){if(b[f]===undefined)continue; const ok=f==='dir'?['pos','neg','mixed','unclear']:f==='conf'?CONF_OF:f==='hz'?['short','mid','long']:['ok','hidden']; if(b[f]&&!ok.includes(b[f]))throw Object.assign(new Error('bad_'+f),{status:400}); if(b[f])o[f]=b[f]; else delete o[f]}
    if(b.s!==undefined){if(b.s&&![1,2,3].includes(+b.s))throw Object.assign(new Error('bad_s'),{status:400}); if(b.s)o.s=+b.s; else delete o.s}
    if(b.he!==undefined){if(str(b.he,120))o.he=str(b.he,120); else delete o.he}
    if(b.note!==undefined)o.note=str(b.note,300);
    const keys=Object.keys(o).filter(x=>!['by','at'].includes(x)); if(keys.length){o.by=by; o.at=at; FX.ev[k]=o} else delete FX.ev[k]; after=FX.ev[k]||null; target=k}
  else if(kind==='hq'){const sym=str(b.sym,16).toUpperCase(); if(!/^(TLV:)?[A-Z0-9.\-]{1,10}$/.test(sym))throw Object.assign(new Error('bad_sym'),{status:400}); before=FX.hq[sym]||null;
    if(b.loc===null)delete FX.hq[sym]; else{const lat=+(b.loc&&b.loc.lat), lon=+(b.loc&&b.loc.lon); if(!(lat>=-90&&lat<=90&&lon>=-180&&lon<=180))throw Object.assign(new Error('bad_loc'),{status:400});
      FX.hq[sym]={lat,lon,name:str(b.loc.name,60)||sym,by,at}} after=FX.hq[sym]||null; target='hq:'+sym}
  else if(kind==='join'){const into=str(b.into,80); if(!okK(k)||!okK(into)||k===into)throw Object.assign(new Error('bad_join'),{status:400}); before=FX.alias[k]||null; FX.alias[k]=into; delete FX.split[k]; after=into; target=k}
  else if(kind==='split'){if(!okK(k))throw Object.assign(new Error('bad_split'),{status:400}); before={alias:FX.alias[k]||null,split:!!FX.split[k]}; delete FX.alias[k]; if(b.on===false)delete FX.split[k]; else FX.split[k]={by,at}; after={split:!!FX.split[k]}; target=k}
  FX.updatedAt=at; store.setDoc(FIX_DOC,FX,{silent:true});
  audit(store,{user,action:'impact.'+kind,target,detail:{before,after},ip});
  CACHE.clear();
  return {ok:true,kind,target,before,after};
}

// ================= the history of one asset: its closes with the events that touched it, what was said then, what followed =================
// Nearness in time is not cause: the page says so beside every event. "What followed" is the asset's move after the day of
// the event (1, 5 and 20 trading days, server/newsx.js moveAfter), against the direction the engine gave then.
export function impactHistory(store,u,sym,{from=null,to=null,now=new Date()}={}){
  const pa=pathsOf(u), P=store.getDoc(pa.portfolio).data, mine=new Set(((P&&P.positions)||[]).map(p=>p&&p.sym).filter(Boolean));
  if(!mine.has(sym))throw Object.assign(new Error('not_yours'),{status:403});
  const vis=ownerLike(u)?null:symsOfUser(store,u.id), visOk=v=>!vis||!!(v&&(v.gen||(v.syms||[]).some(s=>vis.has(s))));
  const day=d=>d&&/^d{4}-dd-dd$/.test(d)?d:null;
  const t1=day(to)||ilParts(now).iso, t0=day(from)||ilParts(new Date(Date.parse(t1)-90*DAY)).iso;
  const C=store.getDoc('quotes/c_'+String(sym).replace(':','_')).data||null;
  const series=C&&Array.isArray(C.d)?C.d.map((d,i)=>[d,+C.c[i]]).filter(([d,v])=>d>=t0&&d<=t1&&v>0):[];
  // a fund: the events that reached one of its largest holdings count, said so ("דרך NVDA")
  const etf=((store.getDoc('research/etf').data||{}).by||{})[sym], inFund=new Set(((etf&&etf.top)||[]).filter(([,w])=>+w>=1).map(([s])=>s));
  const hitOf=cos=>{const d=(cos||[]).find(c=>c.sym===sym); if(d)return {...d,via:null}; const f=(cos||[]).find(c=>inFund.has(c.sym)); return f?{...f,direct:false,via:f.sym}:null};
  const seen=new Map(), snaps=store.listDocs(SNAP).map(r=>r.id).sort(), firstSnap=snaps[0]||null;
  // 1. the snapshots: what the engine said about the event on the day it saw it
  for(const id of snaps){if(id<t0||id>t1)continue; const S=store.getDoc(SNAP+'/'+id).data||{};
    for(const e of (S.events||[])){if(seen.has(e.k)||!visOk(e.vis))continue; const h=hitOf(e.cos); if(!h)continue;
      seen.set(e.k,{k:e.k,he:e.he,cat:e.cat,catHe:CAT_HE[e.cat]||'',level:e.level,day:id,first:e.first,said:{dir:h.dir,s:h.s,conf:h.c,direct:!!h.direct,via:h.via},rules:!!e.rules,src:'snap'})}}
  // 2. before the snapshots began: the archive of the readings (research/newsarc), each article as it was read then
  if(!firstSnap||t0<firstSnap)for(const r of store.listDocs('research/newsarc')){for(const it of ((r.data||{}).items||[])){const d=String(it.at||'').slice(0,10);
      if(d<t0||d>t1||(firstSnap&&d>=firstSnap))continue; if(vis&&!(it.src==='gen'||(it.syms||[]).some(s=>vis.has(s))))continue;
      const z=(it.aff||[]).find(a=>a.sym===sym)||((it.syms||[]).includes(sym)?{sym,how:'direct',dir:it.dir}:null)||(()=>{const f=(it.aff||[]).find(a=>inFund.has(a.sym)); return f?{...f,how:'fund',via:f.sym}:null})();
      if(!z)continue; const k=it.ev?'ev:'+it.ev:'id:'+it.id; if(seen.has(k))continue; const cat=catsOf(it,{title:''})[0];
      seen.set(k,{k,he:it.he,cat,catHe:CAT_HE[cat]||'',level:it.level,day:d,first:it.at,said:{dir:z.dir||it.dir,s:Math.max(1,LV[it.level]||1),conf:it.rules?'low':it.cert==='fact'?'high':'mid',direct:z.how==='direct',via:z.via||null},rules:!!it.rules,src:'arc'})}}
  const evs=[...seen.values()].sort((a,b)=>a.day<b.day?-1:1).slice(-60);
  // 3. what followed: the close before the day, and the move after 1, 5 and 20 trading days; the move on the day itself
  for(const e of evs){const m=C?moveAfter(C,e.day):null; e.after=m?{base:m.p0,baseDay:m.d0,d1:m.r1,d5:m.r5,d20:m.r20}:null;
    const i=C&&Array.isArray(C.d)?C.d.indexOf(e.day):-1; e.onDay=i>0&&+C.c[i-1]>0&&+C.c[i]>0?Math.round((+C.c[i]/+C.c[i-1]-1)*1e4)/100:null;
    const ref=e.after?(e.after.d5!=null?e.after.d5:e.after.d1):null;
    e.vs=e.said.dir==='pos'||e.said.dir==='neg'?(ref==null?'wait':Math.abs(ref)<0.3?'flat':(ref>0)===(e.said.dir==='pos')?'same':'opposite'):'none'}
  const tally={same:evs.filter(e=>e.vs==='same').length,opposite:evs.filter(e=>e.vs==='opposite').length,flat:evs.filter(e=>e.vs==='flat').length,wait:evs.filter(e=>e.vs==='wait').length};
  return {sym,from:t0,to:t1,series,src:C&&C.src||null,events:evs,tally,firstSnap,
    note:'סמיכות בזמן אינה סיבתיות: מחיר זז מסיבות רבות. "מה שנאמר אז" הוא הכיוון האפשרי שהמנוע נתן ביום האירוע; "מה שקרה" הוא תנועת המחיר אחרי, בלי לטעון שהאירוע גרם לה.'};
}
