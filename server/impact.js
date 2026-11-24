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
//     explanation and the evidence. A link between the event and a country, a factor, a sector or a company the article
//     names exists only where a reading says so. A possible direction is never a forecast, and two things that happened
//     together are never said to cause each other;
//   - 22.11, the correction: the relation of the event to an ASSET (a holding) is decided for each asset on its own, in
//     server/impactrel.js: the subject of the article, an analysis of that asset against the facts of its business (with
//     the fact it rests on, checked), or a fund's published holdings. "The article was in the share's feed", "the share
//     is in that sector" and "a broad fund and the whole market" made links before; they make none now. Beside what the
//     engine says, what the market did (the asset's move after the day of the event, its benchmark beside it), kept apart.
// Two views, both cut on the server:
//   - the admin (the management center's "view"): everything, with the sources, the duplicates, the weak links, the
//     failures of the feeds, the assets without a fresh price, and the corrections (each audited);
//   - a user: only the events that have a relation to one of their own assets, each asset with its own explanation; a
//     company they do not hold appears only as a link on such a path (and on the event's card, among the companies the
//     public article names: never as an asset). A partner's events are built from the
//     articles a partner may read (the general news and the articles about their own securities), exactly as their alerts.
// The personal view is derived from the same engine (the same function, the same rules and corrections), never a model of
// its own per person.
import {CATS, CAT_HE, TYPE_HE, STAGE_HE, moveAfter} from './newsx.js';
import {eventsOf, holdingsOf, pathsOf, isFund, sectorMap} from './pulse.js';
import {symsOfUser, ownerLike} from './store.js';
import {audit, can} from './admin/core.js';
import {usOpen, ilOpen, ilParts} from '../shared/market.js';
import {CC, CC_HE, REG_CC, countryPt, regionPt, marketPt, hqOf, INDEX_MKT} from './impactgeo.js';
import {REL_DOC, relsFor, relTask, cardsOf, universeOf, relStatus} from './impactrel.js';
import {worldNames, ccOfSym, worldStatus, WORLD_DOC, WORLD_SYMS_DOC} from './worldnews.js';

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
const TIER_HIGH=/guardian|handelsblatt|frankfurter allgemeine|neue z[üu]rcher|le figaro|el pa[ií]s|expansi[óo]n|il sole 24|south china morning post|straits times|economic times|globe and mail|sydney morning herald|abc news|deutsche welle|yonhap|folha de|bank of england|bank of japan|reuters|bloomberg|associated press|\bap\b|wall street journal|\bwsj\b|financial times|\bft\.com|the economist|nikkei|cnbc|barron|marketwatch|federal reserve|sec edgar|bank of israel|european central bank|\becb\b|globes|גלובס|calcalist|כלכליסט|themarker|דה מרקר|\bbbc\b|new york times|washington post|axios|politico|\bmaya\b|מאיה|tase/i;
const TIER_LOW=/motley fool|fool\.com|seeking alpha|investorplace|benzinga|zacks|insider monkey|gurufocus|tipranks|24\/7 wall|simply wall|\bx\.com\b|twitter|reddit|stocktwits|youtube/i;
const OFFICIAL=/business ?wire|pr ?newswire|globe ?newswire|accesswire|newsfile|press release/i;
export function srcTier(pub,kind){const p=String(pub||''); if(TIER_LOW.test(p)||kind==='opinion')return 'low'; if(TIER_HIGH.test(p))return 'high'; if(OFFICIAL.test(p)||kind==='pr')return 'official'; return 'mid'}
const TIER_R={low:0,mid:1,official:1,high:2};
const bestTier=L=>L.reduce((b,t)=>TIER_R[t]>TIER_R[b]?t:b,'low');
// 22.11: what a source is evidence OF (the owner: the evidence repeated "what happened"). A primary source (the body that
// decided, the company's own release or filing) confirms the event itself; a news report confirms that it was reported; an
// analysis supports the explanation and confirms no new fact; an opinion is evidence of nothing. And whether the article
// was read in full, or only its headline: a source that was not opened is never shown as checked
const PRIMARY=/bank of england|bank of japan|federal reserve|sec edgar|bank of israel|european central bank|\becb\b|\bmaya\b|מאיה|\btase\b|business ?wire|pr ?newswire|globe ?newswire|accesswire|newsfile|press release|treasury|white house|bureau of labor/i;
export const VER_HE={primary:'מקור ראשוני: הגוף שהחליט או החברה עצמה. מאמת את עצם האירוע',fact:'דיווח חדשותי: מאמת שהאירוע דווח כעובדה',analysis:'ניתוח של המקור: תומך בהסבר, אינו מאמת עובדה חדשה',opinion:'טור דעה: אינו ראיה לעובדות',est:'דיווח שהקריאה שלו היא הערכה, לא עובדה מאומתת',head:'נקראה הכותרת בלבד: הכתבה עצמה לא נבדקה'};
const verOf=(x,pub,tier)=>x.rules?'head':x.kind==='opinion'?'opinion':(PRIMARY.test(String(pub||''))||x.kind==='pr'||tier==='official')?'primary':x.kind==='analysis'||x.cert==='interp'?'analysis':x.cert==='fact'?'fact':'est';

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
  // 22.11: beside the links, what the readings say plainly, for the relation of the event to each asset (server/impactrel.js):
  // the companies they name (how, why, and whether the article itself names them), the securities the articles were only
  // listed under (no link by itself), the factors and the sectors with their reasons
  const L=new Map(), why=[], ev=node.ev(k), NM=new Map(), LST=new Set(), FACS=new Map(), SECS=new Map(), THEMES=new Set(), OTH=new Map();
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
    // 22.11: a security an article was only gathered under is NOT a link (a list of "three stocks that…" and a market wrap sit
    // in the feed of every share they mention): it is kept as "listed", one of the signs that send the pair to be examined
    for(const a of (xx.aff||[])){const o=NM.get(a.sym), d=a.dir||(a.how==='direct'?xx.dir:'unclear');
      if(!o)NM.set(a.sym,{sym:a.sym,how:a.how,dir:d||'unclear',why:a.why||'',said:a.said,via:a.via||null,arts:[i],...(a.name?{name:a.name}:{}),...(a.exch?{exch:a.exch}:{})});
      else{if(!o.arts.includes(i))o.arts.push(i); if(a.how==='direct'&&o.how!=='direct'){o.how='direct'; o.dir=d||o.dir; if(a.why)o.why=a.why} else if(!o.why&&a.why)o.why=a.why;
        if(a.said===true)o.said=true; else if(o.said===undefined&&a.said===false)o.said=false}}
    for(const s of (z.a.syms||[]))if(!(xx.aff||[]).some(a=>a.sym===s))LST.add(s);
    // 24.11: a company the reading names with no known symbol (private, a state's, or a symbol that was not confirmed): a name only
    for(const c of (xx.cos||[])){const kk=String(c.name||'').toLowerCase(); if(kk&&!OTH.has(kk))OTH.set(kk,{name:c.name,how:c.how||'sector',dir:c.dir||'unclear',why:c.why||'',said:!!c.said})}
    for(const f of facs)if(!FACS.has(f.k))FACS.set(f.k,{k:f.k,move:f.move||'unclear',why:f.why||''});
    for(const g of (xx.sectors||[]))if(!SECS.has(g)){const s=secx.get(g); SECS.set(g,{g,dir:s?s.dir:'unclear',why:s&&s.why||'',via:s&&s.via||null})}
    for(const t of (xx.themes||[]))THEMES.add(t);
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
  // 22.11: what changed and why it matters economically: the reading's own words (newer readings); for an older one, the
  // reason it gave for the first factor or sector (said to be the economic path, nothing invented)
  const pickX=f=>{const z=usable.find(q=>q.x[f]); return z?z.x[f]:''}, eco=pickX('eco')||([...FACS.values()].find(f=>f.why)||{}).why||([...SECS.values()].find(s=>s.why)||{}).why||'';
  const named=[...NM.values()], listed=[...LST].filter(s=>!NM.has(s)).slice(0,12);
  return {k,ev:x.ev||null,he:str(F.he,120)||x.he||'',title:lead.title||'',what:x.what||'',chg:pickX('chg'),eco,more:x.more||'',unknown:x.unknown||'',cats,cat:cats[0],type:x.type||'other',typeHe:TYPE_HE[x.type]||'',level,kind:x.kind||'news',cert:x.cert||'est',
    named,listed,others:[...OTH.values()].slice(0,8),world:arts.every(z=>z.a.world===true),facs:[...FACS.values()],secs:[...SECS.values()],themes:[...THEMES],nodes:uniq([ev,...links.flatMap(l=>[l.from,l.to])]),
    st:group.st||'unknown',stHe:STAGE_HE[group.st||'unknown'],occ:x.occ||pickX('occ')||null,first:times[0]||null,last:times[times.length-1]||null,seen:prev?prev.seen:new Date().toISOString(),
    cc,regions,loc,dir,s,conf,confWhy:CONF_OF.includes(F.conf)?'נקבע ביד מנהל':cf.why,hz:F.hz&&HZ_HE[F.hz]?F.hz:hzOf(cats),hzWhy:F.hz?'נקבע ביד מנהל':HZ_WHY,
    ai,rules:!ai,nArt:arts.length,nPubs,srcRel,src:[...src.values()].sort((a,b)=>TIER_R[b.tier]-TIER_R[a.tier]||b.n-a.n),dups,
    // 22.11: each source as evidence: what kind it is, what it can confirm, and whether the article itself was read
    arts:arts.map((z,i)=>{const tier=srcTier(z.a.pub,z.x.kind); return {i,id:z.a.id,pub:z.a.pub||'',title:z.a.title||'',link:z.a.link||'',at:z.a.at||z.a.seen||null,got:z.a.seen||null,src:z.a.src||'co',syms:z.a.src==='co'?(z.a.syms||[]).slice(0,6):[],tier,he:z.x.he||'',rules:!!z.x.rules,kind:z.x.kind||'news',
      cert:z.x.cert||'est',rd:z.x.rules?'rules':z.x.rd||null,ver:verOf(z.x,z.a.pub,tier),primary:PRIMARY.test(String(z.a.pub||''))||z.x.kind==='pr'}}),
    evid:why.slice(0,6),links,macro:usable.some(z=>z.x.macro===true),fix:Object.keys(F).length?{...F}:null,hidden:F.st==='hidden'};
}

// ---- the events now: grouped as the alerts group them, joined by alias, enriched; `visible` limits the articles ----
// a short cache per viewer's visibility: the same documents and the same minute give the same events (a page opened by
// several people, or reopened, does not rebuild them); a write to any of the documents changes the key
const CACHE=new Map();
const stamp=(store,p)=>{try{const r=store.db.prepare('select updated_at from docs where path=?').get(p); return r?r.updated_at:''}catch(e){return ''}};
// 24.11: world = which of the world's news join (server/worldnews.js): 'top' the important events (the registry and each
// portfolio's view are made of these), 'all' every event that was read (the view of the whole world), false none
export function buildEvents(store,{now=new Date(),days=7,visible=null,visKey=null,fix=undefined,prev=undefined,world='top'}={}){
  const ck=visKey&&fix===undefined&&prev===undefined?[visKey,world,days,stamp(store,'research/newsx'),stamp(store,'research/news'),stamp(store,WORLD_DOC),stamp(store,WORLD_SYMS_DOC),stamp(store,FIX_DOC),stamp(store,IMPACT_DOC),Math.floor(now.getTime()/60e3)].join('|'):null;
  if(ck&&CACHE.has(ck))return CACHE.get(ck);
  const FX=fix===undefined?(store.getDoc(FIX_DOC).data||{}):fix||{}, PV=prev===undefined?(store.getDoc(IMPACT_DOC).data||{}):prev||{};
  const groups=eventsOf(store,{now,days,visible,alias:false,world});
  const alias=aliasesOf(groups,{fix:FX}), byK=new Map(groups.map(g=>[g.k,g]));
  // an alias joins the articles into its root's group
  for(const [from,to] of Object.entries(alias)){const a=byK.get(from), b=byK.get(to); if(!a||!b||a===b)continue; b.arts.push(...a.arts); b.ai=b.ai||a.ai; byK.delete(from)}
  for(const g of byK.values())g.arts.sort((p,q)=>((p.x.rules?1:0)-(q.x.rules?1:0))||((LV[q.x.level]||0)-(LV[p.x.level]||0))||(String(q.a.at||q.a.seen)<String(p.a.at||p.a.seen)?-1:1));
  for(const g of byK.values()){g.x=g.arts[0].x; g.lead=g.arts[0].a; g.ai=g.arts.some(z=>!z.x.rules);
    g.st=(g.arts.slice().sort((p,q)=>String(q.a.at||q.a.seen)<String(p.a.at||p.a.seen)?-1:1).find(z=>z.x.st&&z.x.st!=='unknown')||{x:{}}).x.st||'unknown'}
  const PE=new Map((PV.events||[]).map(e=>[e.k,e])), prevOf=k=>PE.get(k)||PE.get(Object.keys(alias).find(a=>alias[a]===k))||null;
  const SD=new Map(), coLoc=sym=>{if(SD.has(sym))return SD.get(sym); let about=null; try{about=(store.getDoc('research/s_'+String(sym).replace(/[^A-Za-z0-9_.\-]/g,'_')).data||{}).prof||null}catch(e){}
    // 24.11: a security of another exchange with no known headquarters is placed at that exchange (said to be the exchange)
    let l=hqOf(sym,{fix:FX.hq||null,about}); if(!l)l=/^TLV:|^\d{5,9}$/.test(sym)?marketPt('IL'):ccOfSym(sym)?marketPt(ccOfSym(sym)):/^[A-Z][A-Z.\-]{0,6}$/.test(sym)?marketPt('US'):null; SD.set(sym,l); return l};
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
// 22.11: every event carries its relation to each asset the engine examines (server/impactrel.js): the analysis where it
// was made, what stands without one (the subject of the article, a fund's holdings), what was refused and what waits
export function impactTask(store,{now=new Date(),days=7,log=()=>{}}={}){
  const t0=Date.now(), iso=now.toISOString(), PV=store.getDoc(IMPACT_DOC).data||{}, PE=new Map((PV.events||[]).map(e=>[e.k,e]));
  const B=buildEvents(store,{now,days,prev:PV}), alias=B.alias; let nW=0; const events=B.events.filter(e=>!e.world||++nW<=250);
  const REL=store.getDoc(REL_DOC).data||null, FX=store.getDoc(FIX_DOC).data||{}, cards=cardsOf(store,universeOf(store),{names:nameMap()}), ai=!!process.env.ANTHROPIC_API_KEY;
  let nNew=0, nUpd=0, nRel=0, nNone=0, nWait=0;
  const out=events.map(e=>{const o=PE.get(e.k)||PE.get(Object.keys(alias).find(a=>alias[a]===e.k)), ch=changesOf(o,e), mat=ch.filter(c=>MATERIAL.has(c));
    const hist=(o&&o.hist||[]).slice(-11); if(ch.length&&(!o||ch.join()!==((o.hist||[]).slice(-1)[0]||{}).ch?.join()))hist.push({at:iso,ch,he:ch.map(c=>CH_HE[c]).join(' · ')});
    const status=!o?'new':mat.length?'update':o.status==='new'&&now-Date.parse(o.seen||iso)<6*H?'new':'same';
    if(status==='new'&&!o)nNew++; else if(status==='update')nUpd++;
    const rels=relsFor(e,cards,{REL,fix:FX,ai}); for(const r of Object.values(rels)){if(r.rel==='direct'||r.rel==='indirect')nRel++; else if(r.rel==='none')nNone++; else nWait++}
    return {...e,status,rev:(o?o.rev||0:0)+(mat.length&&o?1:0),hist,upd:mat.length&&o?iso:(o&&o.upd)||null,cos:uniq(e.links.filter(l=>l.to.startsWith('co:')).map(l=>l.to.slice(3))),rels}});
  const doc={v:2,at:iso,days,n:out.length,events:out,alias,stats:{events:out.length,new:nNew,upd:nUpd,links:out.reduce((t,e)=>t+e.links.length,0),aliases:Object.keys(alias).length,rels:nRel,none:nNone,wait:nWait,ms:Date.now()-t0}};
  store.setDoc(IMPACT_DOC,doc,{silent:true});
  // the snapshot of the day: what the engine said about each event and each asset it reached, as it said it then
  try{snapshot(store,out,now)}catch(e){log('impact snapshot: '+(e&&e.message||e))}
  store.setMeta('impactStatus',JSON.stringify({at:iso,...doc.stats}));
  CACHE.clear();
  log(`impact: ${out.length} events (${nNew} new, ${nUpd} updated), ${doc.stats.links} links, ${nRel} relations to assets (${nNone} refused, ${nWait} waiting), ${doc.stats.aliases} joined, ${doc.stats.ms}ms`);
  return doc.stats;
}
// 22.11: the analysis of the pairs that wait (Claude, a few a run), then the registry again with what was decided
export async function impactRelRun(store,{now=new Date(),days=7,log=()=>{},fetch:f=globalThis.fetch,ask=null,...o}={}){
  let nW=0; const events=buildEvents(store,{now,days}).events.filter(e=>!e.world||++nW<=250);
  const st=await relTask(store,events,{now,log,fetch:f,ask,names:nameMap(),...o});
  if(st.judged)impactTask(store,{now,days,log:()=>{}});
  return st;
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
// 22.11: the snapshot keeps the analysis as it was first said: for each event the place, what happened, and for each asset
// the relation with its direction, strength, confidence, horizon, explanation, the fact it rests on, and when it was said.
// What was said earlier the same day is not written over by a later run (the first statement is the one measured later)
const relSnap=(r,e,iso)=>({rel:r.rel,dir:r.dir||'unclear',s:r.s||1,conf:r.conf||'low',hz:r.hz||e.hz||null,mech:r.mech||'',fact:r.fact||'',basis:r.basis||null,src:r.src||null,pending:!!r.pending,at:r.at||iso,...(r.via&&r.via.length?{via:r.via}:{})});
function snapshot(store,events,now){
  const day=ilParts(now).iso, p=SNAP+'/'+day, iso=now.toISOString(), old=new Map((((store.getDoc(p).data||{}).events)||[]).map(e=>[e.k,e]));
  const items=events.filter(e=>!e.hidden&&(!e.world||Object.values(e.rels||{}).some(r=>r.rel==='direct'||r.rel==='indirect'))).map(e=>{const o=old.get(e.k), R={};
    for(const [s,r] of Object.entries(e.rels||{})){if(r.rel!=='direct'&&r.rel!=='indirect')continue; const was=o&&o.rels&&o.rels[s]; R[s]=was&&!was.pending?was:relSnap(r,e,iso)}
    return {k:e.k,he:e.he,what:e.what||'',cat:e.cat,level:e.level,dir:e.dir,s:e.s,conf:e.conf,occ:e.occ||null,first:e.first,last:e.last,got:e.seen||null,status:e.status,rules:e.rules,nPubs:e.nPubs,srcRel:e.srcRel,cc:e.cc,
      loc:e.loc?{lat:e.loc.lat,lon:e.loc.lon,name:e.loc.name||'',how:e.loc.how||null}:null,
      vis:{gen:e.arts.some(a=>a.src==='gen'),syms:uniq(e.arts.flatMap(a=>a.syms||[])).slice(0,20)},cos:reachOf(e).slice(0,40),rels:R,src:e.arts.slice(0,3).map(a=>({pub:a.pub,title:a.title,link:a.link,at:a.at}))}});
  store.setDoc(p,{v:2,day,at:iso,n:items.length,events:items},{silent:true});
  // 180 days are kept
  const from=ilParts(new Date(now.getTime()-180*DAY)).iso; for(const r of store.listDocs(SNAP))if(r.id<from)store.deleteDoc(SNAP+'/'+r.id);
}

// ================= the data's freshness: live, delayed, a close (historical), or none; never "live" when it is not =================
export function freshOf(Q,sym,now=new Date()){
  const m=((Q&&Q.meta)||{})[sym]||{}, px=+(((Q&&Q.prices)||{})[sym]), stale=((Q&&Q.stale)||{})[sym];
  if(!(px>0))return {state:'none',he:'אין מחיר',at:null};
  const il=/^TLV:|^\d{5,9}$/.test(sym)||m.ccy==='ILS'||m.src==='maya', open=il?ilOpen(now):usOpen(now);
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
    return {k,name,px:+b.px,prev:+b.prev||null,chg,...fr,open,at:at?at.toISOString():null,date:b.date||null,loc:mp}})}

// ================= what the market did, apart from what the engine said =================
// The close before the day of the event, the first close on or after it, and one, five and twenty trading days on; beside
// each, the same for the benchmark of the asset's market; and the volume of the first day against the twenty before it.
// Never the cause: two things that happened together are not said to cause each other.
const isIL=sym=>/^TLV:|^\d{5,9}$/.test(String(sym));
const closesOf=(store,key)=>{try{const d=store.getDoc('quotes/c_'+String(key).replace(':','_')).data; return d&&Array.isArray(d.d)&&Array.isArray(d.c)&&d.d.length>=2?d:null}catch(e){return null}};
export function reactionOf(C,B,day){
  if(!C||!day)return null; const d=C.d, c=C.c, i0=d.findIndex(x=>x>=day);
  if(i0<0)return {wait:true,last:d[d.length-1]};          // the event is after the last close the site has
  if(i0<1)return null; const base=+c[i0-1]; if(!(base>0))return null;
  const pc=(A,b,i)=>{const v=+A[i]; return v>0?Math.round((v/b-1)*1e4)/100:null}, o={base,baseDay:d[i0-1],day0:d[i0],same:d[i0]===day,d1:pc(c,base,i0),d2:pc(c,base,i0+1),d5:pc(c,base,i0+4),d20:pc(c,base,i0+19)};
  if(B&&Array.isArray(B.d)){const j0=B.d.findIndex(x=>x>=day), bb=j0>=1?+B.c[j0-1]:0; if(bb>0)o.bench={d1:pc(B.c,bb,j0),d2:pc(B.c,bb,j0+1),d5:pc(B.c,bb,j0+4),d20:pc(B.c,bb,j0+19)}}
  if(Array.isArray(C.v)&&+C.v[i0]>0){const pv=C.v.slice(Math.max(0,i0-20),i0).map(Number).filter(v=>v>0); if(pv.length>=10)o.vol=Math.round(+C.v[i0]/(pv.reduce((t,v)=>t+v,0)/pv.length)*100)/100}
  return o;
}
const evDay=e=>{const f=String(e.first||'').slice(0,10); return e.occ&&(!f||e.occ<=f)?e.occ:f||null};
const benchOf=sym=>isIL(sym)?['IDX:TA125','ת״א 125']:['IDX:SPX','S&P 500'];
// the direction that was said against what followed, by the move against the benchmark when there is one (else the move
// itself): the same way, the opposite, almost no move, or not yet known. A count, never a proof
const versus=(dir,r,k='d5')=>{if(dir!=='pos'&&dir!=='neg')return 'none'; if(!r||r.wait)return 'wait'; const v=r[k]!=null?r[k]:k==='d5'?r.d1:null; if(v==null)return 'wait';
  const b=r.bench&&r.bench[k]!=null?r.bench[k]:r.bench&&k==='d5'&&r[k]==null?r.bench.d1:null, x=b==null?v:Math.round((v-b)*100)/100; return Math.abs(x)<0.3?'flat':(x>0)===(dir==='pos')?'same':'opposite'};

// ================= a user's view: the relations of the events to their own assets, and nothing else =================
const visFor=(store,u)=>{if(!u||ownerLike(u))return null; const ok=symsOfUser(store,u.id); return a=>a.src==='gen'||(a.syms||[]).some(k=>ok.has(k))};
// a node's short label (a company by its ticker; its name apart, for a tooltip)
const nodeLabel=(id)=>{const [t,v]=[id.slice(0,id.indexOf(':')),id.slice(id.indexOf(':')+1)];
  return t==='cty'?(CC_HE[v]||v):t==='fac'?(FAC_HE[v]||v):t==='sec'?(SEC_HE[v]||v):v};
// the asset's place: a share at its headquarters (or its exchange, said to be), a fund or an index at its market
function assetLoc(sym,fund,coLoc){if(fund)return isIL(sym)?marketPt('IL'):marketPt('US'); return coLoc(sym)}
function sparkOf(store,sym,n=30){const d=closesOf(store,sym); if(!d)return null; const c=d.c.slice(-n).map(Number).filter(v=>v>0); return c.length>=5?{c,from:d.d[Math.max(0,d.d.length-n)],to:d.d[d.d.length-1]}:null}
// the path of one relation: from the event, through the steps the relation names (each joined by the reading's own links
// where they exist), into the asset; the last link is the relation itself, with its explanation and what it rests on
function pathFor(e,r,a){
  const adj=new Map(); for(const l of e.links){if(!adj.has(l.from))adj.set(l.from,[]); adj.get(l.from).push(l)}
  const bfs=(from,to)=>{const q=[[from,[]]], seen=new Set([from]); while(q.length){const [n,P]=q.shift(); if(n===to)return P; if(P.length>=4)continue; for(const l of (adj.get(n)||[]))if(!seen.has(l.to)){seen.add(l.to); q.push([l.to,[...P,l]])}} return null};
  const ev=node.ev(e.k), steps=[ev,...(r.via||[]).filter(v=>v!==a.id&&v!=='co:'+a.sym)], L=[];
  for(let i=0;i<steps.length-1;i++){const P=bfs(steps[i],steps[i+1]); if(P&&P.length)L.push(...P);
    else L.push({id:steps[i]+'>'+steps[i+1],from:steps[i],to:steps[i+1],dir:null,s:1,conf:r.conf,confWhy:'',rel:e.srcRel,direct:false,how:null,hz:e.hz,why:'',basis:'analysis',arts:[],st:'auto'})}
  const last=steps[steps.length-1], z=(e.named||[]).find(q=>q.sym===a.sym);
  L.push({id:last+'>'+a.id,from:last,to:a.id,dir:r.dir||'unclear',s:r.s||1,conf:r.conf||'low',confWhy:r.confWhy||'',rel:e.srcRel,direct:r.rel==='direct',how:r.how||(r.src==='structure'?'fund':null),hz:r.hz||e.hz,why:r.mech||'',
    fact:r.fact||'',basis:r.basis||null,src:r.src||null,up:r.up||'',down:r.down||'',pending:!!r.pending,generic:!!r.generic,arts:(z&&z.arts)||[],st:r.st||'auto',final:true});
  const seen=new Set(), LL=L.filter(l=>!seen.has(l.id)&&seen.add(l.id));
  return {links:LL,path:{to:a.sym,node:a.id,links:LL.map(l=>l.id),nodes:[ev,...LL.map(l=>l.to)],dir:r.dir||'unclear',s:r.s||1,conf:r.conf||'low',direct:r.rel==='direct',hops:LL.length,pending:!!r.pending}};
}
// where the fact a relation rests on came from (the card's own source of that field)
const factSrc=(c,fact)=>{if(!c||!fact)return null; const n=s=>String(s||'').toLowerCase().replace(/\s+/g,' '), f=n(fact);
  if(c.fund&&n(c.fund.top.map(([s,w])=>`${s} ${w}%`).join(' ')).includes(f.split(',')[0]))return c.src.fund;
  if(n(c.desc).includes(f))return c.src.desc; if(n(c.segs.map(s=>`${s.k} ${s.pct==null?'':s.pct+'%'}`).join(' ')).includes(f))return c.src.segs; if(n(c.peers.join(' ')).includes(f))return c.src.peers;
  return c.industry&&n(c.industry).includes(f)?'הענף של החברה (FMP)':c.src.desc||c.src.fund||null};
const relScore=(I,bySym)=>I.reduce((t,i)=>{const a=bySym.get(i.sym)||{}, w=a.w==null?1:Math.max(0.5,a.w/5); return t+(i.rel==='direct'?3:1)*(i.s||1)*(CONF_R[i.conf]+1)*w*(i.pending?0.6:1)},0);
const VER_R={primary:0,fact:1,analysis:2,est:3,opinion:4,head:5};
// the evidence of an event: its sources, the primary ones first, each with what it can confirm and whether it was read
const evidenceOf=(e,mineNamed)=>e.arts.slice().sort((a,b)=>(VER_R[a.ver]-VER_R[b.ver])||(TIER_R[b.tier]-TIER_R[a.tier])||(String(a.at)<String(b.at)?-1:1)).slice(0,8)
  .map(a=>({pub:a.pub,title:a.title,link:a.link,at:a.at,got:a.got||null,tier:a.tier,kind:a.kind,cert:a.cert,ver:a.ver,verHe:VER_HE[a.ver]||'',rd:a.rd||null,primary:!!a.primary,supports:mineNamed.filter(z=>(z.arts||[]).includes(a.i)).map(z=>z.sym)}));

// 24.11 (the owner: "from all the exchanges of the world, events from all the world's news sites"): scope 'world' is the
// whole world's events, whether or not they reach the portfolio: every event that was read and is worth watching, from the
// public news only (the general news, the world's news) and the asker's own securities' news, exactly what the asker may
// read in the news tab; never an event known only from another person's securities. An event that reaches the portfolio
// carries its relations as in the portfolio's view ('me', as before); the others say that no relation was found
export function impactForUser(store,u,{now=new Date(),days=7,limit=40,scope='me'}={}){
  const all=scope==='world'; if(all)limit=Math.max(limit,160);
  const pa=pathsOf(u), P=store.getDoc(pa.portfolio).data, Q=store.getDoc('quotes/latest').data||{}, HD=holdingsOf(P,Q);
  const vis=visFor(store,u), sec=sectorMap(), sectorOf=s=>{const g=sec.get(s)||''; return ({'Information Technology':'Technology',Financials:'Finance',Materials:'Basic Materials',Healthcare:'Health Care'})[g]||g};
  const {events,coLoc}=buildEvents(store,{now,days,visible:vis,visKey:vis?'u:'+u.id+':'+[...symsOfUser(store,u.id)].sort().join(','):'all',world:all?'all':'top'});
  const PV=store.getDoc(IMPACT_DOC).data||{}, PE=new Map((PV.events||[]).map(e=>[e.k,e]));
  const mine=new Set(HD.pos.map(h=>h.sym)), names=nameMap(), WNM=worldNames(store), coName=s=>(mine.has(s)&&((Q.meta||{})[s]||{}).name)||names.get(s)||(WNM.get(s)||{}).name||null;
  const REL=store.getDoc(REL_DOC).data||null, FX=store.getDoc(FIX_DOC).data||{}, ai=!!process.env.ANTHROPIC_API_KEY, cards=cardsOf(store,[...mine],{names});
  // the assets: the holdings, each with its price, today's move (the halo: the market's own move, nothing else) and freshness
  const A=[], bySym=new Map(); let dayV=0, dayKnown=true;
  for(const h of HD.pos){const px=+((Q.prices||{})[h.sym]), pv=+((Q.prev||{})[h.sym]), chg=px>0&&pv>0?Math.round((px/pv-1)*1e4)/100:null, fr=freshOf(Q,h.sym,now);
    if(h.w!=null&&chg!=null&&HD.total)dayV+=h.val*(1-1/(1+chg/100)); else dayKnown=false;
    const c=cards.get(h.sym), fund=h.fund||(c&&c.kind==='fund'), id=(fund?'fund:':'co:')+h.sym, loc=assetLoc(h.sym,fund,coLoc);
    const a={sym:h.sym,id,name:coName(h.sym),kind:fund?'fund':'stock',w:h.w,px:px>0?px:null,chg,fresh:fr,loc,sec:fund?null:sectorOf(h.sym)||null,open:isIL(h.sym)?ilOpen(now):usOpen(now),
      biz:c&&c.about&&c.about.line?c.about.line:null,industry:(c&&c.industry)||null,facts:!!(c&&c.has),
      // the halo: the asset's own move in the market, green or red only while it trades and the price is fresh (live or
      // delayed). With the market closed, or no fresh figure, it is neutral ("idle": grey and still), so the last close is
      // never drawn as a move that is happening now; the number itself stays in the label, said to be a close. Never the
      // engine's direction
      halo:chg==null||(fr.state!=='live'&&fr.state!=='delayed')?'idle':chg>0.05?'up':chg<-0.05?'down':'flat',haloWhy:chg==null||fr.state==='none'?'אין מחיר עדכני':fr.state==='stale'?'המחיר לא עדכני':fr.state==='close'?((isIL(h.sym)?ilOpen(now):usOpen(now))?'המחיר האחרון הוא מחיר סגירה, לא מהמסחר של עכשיו':'המסחר סגור: מוצג מחיר הסגירה'):''};
    A.push(a); bySym.set(h.sym,a)}
  const CL=new Map(), closes=k=>{if(!CL.has(k))CL.set(k,closesOf(store,k)); return CL.get(k)};
  // what the market did after the event, for one asset: from the closes, with the benchmark beside it; and the move since,
  // by the last price, only when that price is newer than the close before the event (its freshness said, never "live" when not)
  const marketOf=(a,e)=>{const day=evDay(e), [bk,bn]=benchOf(a.sym), r=reactionOf(closes(a.sym),closes(bk),day), m=(Q.meta||{})[a.sym]||{};
    const o={day,bench:bn,open:a.open,fresh:{state:a.fresh.state,he:a.fresh.he,at:a.fresh.at||null},r:r||null,since:null,today:a.chg==null?null:a.chg};
    if(r&&!r.wait&&r.base&&a.px&&a.fresh.state!=='none'&&a.fresh.state!=='stale'&&(!m.date||m.date>=r.day0))o.since=Math.round((a.px/r.base-1)*1e4)/100;
    return o};
  const out=[], usedL=new Map(); let waiting=0;
  for(const e of events){if(e.hidden)continue;
    const rels=relsFor(e,cards,{REL,fix:FX,ai}), impacts=[], paths=[], checked=[];
    for(const [sym,r] of Object.entries(rels)){const a=bySym.get(sym); if(!a)continue;
      if(r.rel!=='direct'&&r.rel!=='indirect'){if(r.rel==='wait'&&r.pending)waiting++; if(r.rel==='none'||r.pending)checked.push({sym,rel:r.rel,why:r.why||''}); continue}
      const p=pathFor(e,r,a), c=cards.get(sym), arts3=e.arts.slice(0,3).map(x=>({t:x.title||x.he,pub:x.pub,link:x.link,at:x.at,tier:x.tier}));
      paths.push(p.path);
      for(const l of p.links){const ev0=l.final?[...(r.fact?[{t:`עובדה מפרטי הנכס: "${r.fact}"`,pub:factSrc(c,r.fact)||'',fact:true}]:[]),...((l.arts||[]).length?l.arts.map(i=>e.arts[i]).filter(Boolean).slice(0,3).map(x=>({t:x.title||x.he,pub:x.pub,link:x.link,at:x.at,tier:x.tier})):arts3)]
          :(l.arts||[]).map(i=>{const x=e.arts[i]; return x?{t:x.title||x.he,pub:x.pub,link:x.link,at:x.at,tier:x.tier}:null}).filter(Boolean).slice(0,4);
        usedL.set(e.k+'|'+l.id,{id:l.id,ek:e.k,from:l.from,to:l.to,dir:l.dir||p.path.dir,move:l.move||null,s:l.s||1,conf:l.conf,confWhy:l.confWhy||'',rel:l.rel,direct:!!l.direct,how:l.how||null,hz:l.hz||e.hz,why:l.why||'',basis:l.basis,st:l.st||'auto',
          ...(l.final?{final:true,fact:l.fact||'',src:l.src||null,up:l.up||'',down:l.down||'',pending:!!l.pending,generic:!!l.generic}:{}),ev:ev0})}
      const z=(e.named||[]).find(q=>q.sym===sym);
      impacts.push({sym,kind:a.kind,rel:r.rel,dir:r.dir||'unclear',s:r.s||1,conf:r.conf||'low',confWhy:r.confWhy||'',hz:r.hz||e.hz,mech:r.mech||'',fact:r.fact||'',factSrc:factSrc(c,r.fact),basis:r.basis||null,src:r.src||null,up:r.up||'',down:r.down||'',
        pending:!!r.pending,generic:!!r.generic,st:r.st||'auto',holds:r.holds||null,said:!!(z&&(z.said===true||(z.how==='direct'&&z.said!==false))),path:p.path.nodes,mkt:marketOf(a,e)})}
    // the whole world: an event that reaches no asset is shown too, when it was read (not a headline by the rules) and is worth watching
    if(!impacts.length&&(!all||e.rules||(LV[e.level]||0)<1))continue;
    const o=PE.get(e.k), isSaid=z=>z.said===true||(z.how==='direct'&&z.said!==false), verd=s=>{const r=rels[s]; return r?{rel:r.rel,why:r.rel==='none'||r.rel==='wait'?r.why||'':''}:null};
    // the companies: the ones the source names, apart from the ones the engine found (the reading's own inference, or the
    // analysis of an asset the article does not name)
    // 24.11: a company of another exchange carries its exchange's country (the symbol's suffix) and the exchange's name
    const exOf=z=>{const c=ccOfSym(z.sym); return c||z.exch?{...(c?{xcc:c}:{}),...(z.exch?{exch:z.exch}:{})}:{}};
    const said=(e.named||[]).filter(isSaid).map(z=>({sym:z.sym,name:coName(z.sym)||z.name||null,how:z.how,dir:z.dir,why:z.why,mine:mine.has(z.sym),...exOf(z),...(mine.has(z.sym)?{verdict:verd(z.sym)}:{})}));
    const found=[...(e.named||[]).filter(z=>!isSaid(z)).map(z=>({sym:z.sym,name:coName(z.sym)||z.name||null,how:z.how,dir:z.dir,why:z.why,mine:mine.has(z.sym),by:'reading',...exOf(z),...(mine.has(z.sym)?{verdict:verd(z.sym)}:{})})),
      ...impacts.filter(i=>!(e.named||[]).some(z=>z.sym===i.sym)).map(i=>({sym:i.sym,name:coName(i.sym),how:i.rel,dir:i.dir,why:i.mech,mine:true,by:i.src==='structure'?'structure':'analysis',verdict:{rel:i.rel,why:''}}))];
    out.push({k:e.k,he:e.he,what:e.what,chg:e.chg||'',eco:e.eco||'',more:e.more,unknown:e.unknown,cats:e.cats,cat:e.cat,catHe:CAT_HE[e.cat],type:e.type,level:e.level,kind:e.kind,cert:e.cert,st:e.st,stHe:e.stHe,
      occ:e.occ,first:e.first,last:e.last,got:e.seen||null,status:o?(o.status||'same'):'new',upd:o&&o.upd||null,cc:e.cc,regions:e.regions,loc:e.loc,dir:e.dir,s:e.s,conf:e.conf,confWhy:e.confWhy,hz:e.hz,hzWhy:e.hzWhy,rules:e.rules,
      nArt:e.nArt,nPubs:e.nPubs,srcRel:e.srcRel,src:e.src.map(s=>({pub:s.pub,tier:s.tier,n:s.n})),evidence:evidenceOf(e,(e.named||[]).filter(z=>mine.has(z.sym))),dups:(e.dups||[]).length,hist:(o&&o.hist||[]).slice(-6),
      facs:(e.facs||[]).map(f=>({k:f.k,he:FAC_HE[f.k]||f.k,move:f.move,why:f.why})),said,found,impacts,checked,touches:uniq(impacts.map(i=>i.sym)),paths,rel:relScore(impacts,bySym),
      ...(all?{mine:impacts.length>0,world:!!e.world,others:e.others||[],secs:(e.secs||[]).map(s=>({g:s.g,he:SEC_HE[s.g]||s.g,dir:s.dir,why:s.why}))}:{})})}
  // the portfolio's view: by the weight of the relation; the whole world: by the event's own level, the newest first (an
  // event that reaches the portfolio is never cut out of the list)
  if(all)out.sort((a,b)=>(LV[b.level]-LV[a.level])||(String(b.last)>String(a.last)?1:-1)); else
  out.sort((a,b)=>(b.rel-a.rel)||(LV[b.level]-LV[a.level])||(String(b.last)>String(a.last)?1:-1));
  if(all&&out.length>limit){const keep=out.filter(e=>e.mine), rest=out.filter(e=>!e.mine).slice(0,Math.max(0,limit-keep.length)), K=new Set([...keep,...rest]); out.splice(0,out.length,...out.filter(e=>K.has(e)))}
  const ev=out.slice(0,limit), keepK=new Set(ev.map(e=>e.k));
  const links=[...usedL.values()].filter(l=>keepK.has(l.ek));
  const nodes={}; for(const e of ev){nodes['ev:'+e.k]={t:'ev',label:e.he,loc:e.loc}; for(const p of e.paths)for(const n of p.nodes)if(!nodes[n]){const t=n.slice(0,n.indexOf(':')), s=n.slice(n.indexOf(':')+1), a=(t==='co'||t==='fund')?bySym.get(s):null;
      nodes[n]={t,label:nodeLabel(n),...(t==='co'||t==='fund'?{name:coName(s)}:{}),loc:t==='cty'?countryPt(s):a?a.loc:t==='co'?coLoc(s):null,mine:!!a}}
    // the whole world: the companies an event names (public news), each where it sits, so the map can show them
    if(all)for(const z of [...e.said,...e.found]){const n='co:'+z.sym; if(!nodes[n]){const a=bySym.get(z.sym); nodes[n]={t:'co',label:z.sym,name:z.name||null,loc:a?a.loc:coLoc(z.sym),mine:!!a}}}}
  // the portfolio's line: the value and today's move only when every price is known (else said to be partial)
  const pf={total:HD.total,n:HD.pos.length,known:HD.wOk,day:HD.wOk&&dayKnown?Math.round(dayV):null,dayPct:HD.wOk&&dayKnown&&HD.total?Math.round(dayV/(HD.total-dayV)*1e4)/100:null,usdPct:HD.usdPct,fresh:worstFresh(A)};
  for(const a of A)a.events=ev.filter(e=>e.touches.includes(a.sym)).length;
  const keys=A.slice().sort((a,b)=>(b.w||0)-(a.w||0)).slice(0,6).map(a=>({...a,spark:sparkOf(store,a.sym)}));
  const RS=relStatus(store);
  // 24.11: the world's news behind the view: how many publishers answered, how many articles were read, so the page can say
  // where the events come from (and when the layer is off or still empty)
  let wsrc=null; if(all){try{const WS=worldStatus(store,{now}); wsrc={off:WS.off,feeds:WS.nFeeds,ok:WS.okFeeds,read:WS.read,at:WS.updatedAt,byReg:WS.byReg}}catch(e){}}
  return {mode:'me',scope:all?'world':'me',at:now.toISOString(),days,engineAt:PV.at||null,engine:{ai,waiting,relAt:RS&&RS.at||null,capped:!!(RS&&RS.capped)},pf,assets:A,keys,indices:indicesOf(Q,now),events:ev,links,nodes,
    priceLabel:Q.priceLabel||'',filters:filtersOf(ev,A),...(all?{world:wsrc,nMine:ev.filter(e=>e.mine).length}:{}),
    notes:['הכיוון הוא השערה מניתוח החדשות, לא תחזית ולא המלצה. קו ירוק או אדום הוא כיוון אפשרי; ההילה סביב נכס היא התנועה שלו בשוק בפועל היום.',
      all?'מוצגים אירועים מכל העולם, גם כאלה שלא נמצא להם קשר לתיק שלך. אירוע שנוגע לתיק מסומן, והקשר שלו מוסבר נכס אחרי נכס; לשאר כתוב שלא נמצא קשר.'
         :'מוצג רק אירוע שנמצא לו קשר עסקי מוסבר לנכס בתיק, נכס אחרי נכס. חברה שלא בתיק מופיעה רק כחוליה במסלול כזה.']};
}
const FR_R={none:0,stale:1,close:2,delayed:3,live:4};
const worstFresh=A=>{if(!A.length)return null; const w=A.reduce((b,a)=>FR_R[a.fresh.state]<FR_R[b.fresh.state]?a:b); const n=A.filter(a=>a.fresh.state===w.fresh.state).length; return {state:w.fresh.state,he:w.fresh.he,n}};
function filtersOf(ev,A){const cc=new Map(), reg=new Set(), sec=new Set(), cats=new Set();
  for(const e of ev){for(const c of e.cc)cc.set(c,CC_HE[c]||c); for(const r of e.regions)reg.add(r); for(const c of e.cats)cats.add(c)}
  for(const a of A)if(a.sec)sec.add(a.sec);
  return {countries:[...cc].map(([k,he])=>({k,he})),regions:[...reg],sectors:[...sec].map(k=>({k,he:SEC_HE[k]||k})),cats:[...cats].map(k=>({k,he:CAT_HE[k]}))}}

// ================= the admin's view: everything, with what is wrong with it =================
// 22.11: the relations to assets say which securities are held on the site (never by whom): they are given only to an admin
// with the permission for personal detail ("sensitive"); another admin gets the events, their links and the counts
export function impactWorld(store,{now=new Date(),days=7,limit=200,sensitive=true}={}){
  const PV=store.getDoc(IMPACT_DOC).data||null, from=new Date(now.getTime()-days*DAY).toISOString();
  const evs=(PV&&PV.events||[]).filter(e=>(e.last||'')>=from);
  const Q=store.getDoc('quotes/latest').data||{}, names=nameMap();
  // the duplicates: the articles of one event that are the same story, and the keys joined into another
  const dups=evs.filter(e=>(e.dups||[]).length||Object.values(PV.alias||{}).includes(e.k)).map(e=>({k:e.k,he:e.he,dups:(e.dups||[]).length,joined:Object.entries(PV.alias||{}).filter(([,v])=>v===e.k).map(([k])=>k),nArt:e.nArt,nPubs:e.nPubs})).slice(0,60);
  // the weak links: low confidence, a headline-only reading, or a single weak source
  const weak=[]; for(const e of evs)for(const l of e.links){const why=[]; if(l.conf==='low')why.push('ביטחון נמוך'); if(l.basis==='rules')why.push('קריאה לפי כותרת בלבד'); if(l.rel==='low')why.push('מקור חלש'); if(!l.why)why.push('בלי הסבר');
    if(why.length&&l.st==='auto')weak.push({k:e.k,he:e.he,link:l.id,from:l.from,to:l.to,why})}
  // 22.11: the weak relations to assets: at low confidence, resting on no fact of the asset, the same explanation given to
  // two assets, still waiting for the analysis, or an asset the site holds no facts about
  const weakRel=[], waitRel=[]; for(const e of evs)for(const [sym,r] of Object.entries(e.rels||{})){
      if(r.rel==='wait'){waitRel.push({k:e.k,he:e.he,sym,why:r.why||'',sigs:r.sigs||[],nofacts:!!r.nofacts}); continue} if(r.rel==='none'||r.st==='ok')continue; const why=[];
      if(r.conf==='low')why.push('ביטחון נמוך'); if(r.src==='ai'&&!r.grounded)why.push('לא נשען על עובדה מפרטי הנכס'); if(r.generic)why.push('אותו הסבר לשני נכסים'); if(r.pending)why.push('ממתין לניתוח נפרד'); if(r.cardHas===false)why.push('אין לאתר עובדות על הנכס');
      if(why.length)weakRel.push({k:e.k,he:e.he,sym,rel:r.rel,mech:r.mech||'',why})}
  // the failures of the feeds that make the picture: the reading, the gathering, the engine itself
  const M=k=>{try{return JSON.parse(store.getMeta(k)||'null')}catch(e){return null}}, XS=M('newsxStatus'), NS=M('newsStatus'), IS=M('impactStatus'), RS=relStatus(store);
  const fails=[]; if(XS&&XS.first)fails.push({k:'newsx',he:'קריאת הכתבות (צ׳יקו)',note:XS.first,at:XS.at}); if(XS&&!XS.ai)fails.push({k:'newsx-key',he:'קריאת הכתבות',note:'אין ANTHROPIC_API_KEY: האירועים נקראים לפי כותרת בלבד',at:XS.at});
  if(XS&&XS.waiting>30)fails.push({k:'newsx-wait',he:'כתבות שממתינות לקריאה',note:`${XS.waiting} כתבות עוד לא נקראו`,at:XS.at});
  if(NS&&NS.first)fails.push({k:'news',he:'איסוף הכתבות',note:String(NS.first).replace(/^[A-Z0-9.\-^=]{1,12}:\s*/,'נייר אחד: '),at:NS.at});
  if(!IS)fails.push({k:'impact',he:'מנוע ההשפעה',note:'עוד לא רץ; ירוץ אחרי הקריאה הבאה של החדשות',at:null}); else if(now-Date.parse(IS.at)>3*H)fails.push({k:'impact-old',he:'מנוע ההשפעה',note:'הריצה האחרונה לפני יותר משלוש שעות',at:IS.at});
  if(RS&&!RS.ai)fails.push({k:'rel-key',he:'ניתוח הקשר לכל נכס',note:'אין ANTHROPIC_API_KEY: מוצגים רק נכס שהוא נושא הכתבה וקרן דרך האחזקות שלה',at:RS.at});
  if(RS&&RS.first)fails.push({k:'rel',he:'ניתוח הקשר לכל נכס',note:RS.first,at:RS.at}); if(RS&&RS.capped)fails.push({k:'rel-cap',he:'ניתוח הקשר לכל נכס',note:`התקרה היומית הושגה (${RS.used} זוגות); השאר ימתינו למחר`,at:RS.at});
  // 24.11: the world's news: feeds that do not answer, the day's cap reached, no reading at all
  let WS=null; try{WS=worldStatus(store,{now})}catch(e){}
  if(WS&&!WS.off){if(WS.failing.length)fails.push({k:'world-feeds',he:'חדשות העולם: מקורות שלא ענו',note:`${WS.failing.length} מתוך ${WS.nFeeds}: ${WS.failing.slice(0,6).map(x=>x.pub).join(', ')}${WS.failing.length>6?'…':''}`,at:WS.failing[0].at});
    if(WS.cap>0&&WS.used>=WS.cap)fails.push({k:'world-cap',he:'חדשות העולם: קריאת הכתבות',note:`התקרה היומית הושגה (${WS.used} כתבות); השאר ימתינו למחר`,at:WS.last&&WS.last.at||null});
    if(WS.last&&WS.last.first)fails.push({k:'world',he:'חדשות העולם',note:WS.last.first,at:WS.last.at})}
  // the assets without a fresh price: the companies the events reach (public news), never anybody's holdings
  const named=uniq(evs.flatMap(e=>e.cos||[])), stale=[]; for(const s of named){const f=freshOf(Q,s,now); if(f.state==='none'||f.state==='stale')stale.push({sym:s,state:f.state,he:f.he,at:f.at})}
  const FX=store.getDoc(FIX_DOC).data||{};
  const nodes={}; const coLoc=sym=>{let about=null; try{about=(store.getDoc('research/s_'+String(sym).replace(/[^A-Za-z0-9_.\-]/g,'_')).data||{}).prof||null}catch(e){} return hqOf(sym,{fix:FX.hq||null,about})||marketPt(/^TLV:/.test(sym)?'IL':ccOfSym(sym)||'US')};
  const list=evs.slice(0,limit);
  for(const e of list){nodes['ev:'+e.k]={t:'ev',label:e.he,loc:e.loc}; for(const l of e.links)for(const n of [l.from,l.to])if(!nodes[n]){const t=n.slice(0,n.indexOf(':'));
      nodes[n]={t,label:nodeLabel(n),...(t==='co'?{name:names.get(n.slice(3))||null}:{}),loc:t==='cty'?countryPt(n.slice(4)):t==='co'?coLoc(n.slice(3)):null}}
    for(const s of Object.keys(e.rels||{})){const n='co:'+s; if(!nodes[n])nodes[n]={t:'co',label:s,name:names.get(s)||null,loc:coLoc(s)}}}
  const open=e=>sensitive?e:{...e,rels:{},listed:[],arts:e.arts.map(a=>({...a,syms:[]}))};
  if(!sensitive)for(const e of list)for(const s of Object.keys(e.rels||{})){const n='co:'+s; if(nodes[n]&&!e.links.some(l=>l.from===n||l.to===n))delete nodes[n]}
  return {mode:'world',at:now.toISOString(),days,engineAt:PV&&PV.at||null,stats:PV&&PV.stats||null,events:list.map(e=>({...open(e),catHe:CAT_HE[e.cat],got:e.seen||null})),nodes,indices:indicesOf(Q,now),relsShown:!!sensitive,
    diag:{dups,weak:weak.slice(0,150),nWeak:weak.length,weakRel:sensitive?weakRel.slice(0,150):[],nWeakRel:weakRel.length,waitRel:sensitive?waitRel.slice(0,100):[],nWaitRel:waitRel.length,fails,stale:stale.slice(0,80),rel:RS,
      fixes:Object.keys(FX.link||{}).length+Object.keys(FX.ev||{}).length+Object.keys(FX.hq||{}).length+Object.keys(FX.alias||{}).length+Object.keys(FX.rel||{}).length},
    filters:filtersOf(list,[]),tiers:REL_HE,ver:VER_HE,world:WS};
}

// ================= the admin's hand: approve, reject or correct; every change audited with what it was =================
const FIX_KINDS=['link','event','hq','join','split','rel'];
export function impactFix(store,user,b,{ip=''}={}){
  if(!can(user,'edit'))throw Object.assign(new Error('permission_denied'),{status:403});
  const kind=String(b&&b.kind||''); if(!FIX_KINDS.includes(kind))throw Object.assign(new Error('bad_kind'),{status:400});
  const D=store.getDoc(FIX_DOC).data||{}, FX={link:{},ev:{},hq:{},alias:{},split:{},rel:{},...D}, at=new Date().toISOString(), by=user.email||user.id;
  const k=str(b.k,80), okK=s=>/^(ev:[a-z0-9\-]{1,60}|rd:[A-Z0-9:.\-]{1,30}:\d{4}-\d\d-\d\d|id:[a-f0-9]{12})$/.test(s);
  let target='', before=null, after=null;
  if(kind==='link'){const id=str(b.id,200); if(!okK(k)||!/^[a-z]{2,4}:[^>]{1,80}>[a-z]{2,4}:[^>]{1,80}$/.test(id))throw Object.assign(new Error('bad_link'),{status:400});
    const st=['ok','no','edit','auto'].includes(b.st)?b.st:'edit', key=k+'|'+id; before=FX.link[key]||null;
    if(st==='auto')delete FX.link[key]; else FX.link[key]={st,...(['pos','neg','mixed','unclear'].includes(b.dir)?{dir:b.dir}:{}),...([1,2,3].includes(+b.s)?{s:+b.s}:{}),...(CONF_OF.includes(b.conf)?{conf:b.conf}:{}),
      ...(str(b.why,300)?{why:str(b.why,300)}:{}),...(str(b.note,300)?{note:str(b.note,300)}:{}),by,at};
    after=FX.link[key]||null; target=key}
  // 22.11: the relation of an event to an asset: approve it, refuse it, correct its direction, strength, confidence or
  // explanation, add one the engine did not find (said to be by hand), or give it back to the engine
  else if(kind==='rel'){const sym=str(b.sym,16).toUpperCase(); if(!okK(k)||!/^(TLV:)?[A-Z0-9.\-]{1,10}$/.test(sym))throw Object.assign(new Error('bad_rel'),{status:400});
    const st=['ok','no','edit','auto','add'].includes(b.st)?b.st:'edit', key=k+'|'+sym; before=FX.rel[key]||null;
    if(st==='add'&&!str(b.why,420))throw Object.assign(new Error('why_required'),{status:400});
    if(st==='auto')delete FX.rel[key]; else FX.rel[key]={st,...(['pos','neg','mixed','unclear'].includes(b.dir)?{dir:b.dir}:{}),...([1,2,3].includes(+b.s)?{s:+b.s}:{}),...(CONF_OF.includes(b.conf)?{conf:b.conf}:{}),
      ...(str(b.why,420)?{why:str(b.why,420)}:{}),...(str(b.note,300)?{note:str(b.note,300)}:{}),...(st==='add'?{rel:b.rel==='direct'?'direct':'indirect'}:{}),by,at};
    after=FX.rel[key]||null; target='rel:'+key}
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

// ================= the history =================
// Nearness in time is not cause: the page says so beside every event. "What was said" is what the engine said on the day it
// first saw the event (the snapshot of that day); "what followed" is the asset's move after the day of the event, with the
// benchmark beside it, never claimed to be because of the event.
const dayOk=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&!isNaN(Date.parse(d))?d:null;
const rangeOf=(from,to,now,span=90)=>{const today=ilParts(now).iso; let t1=dayOk(to)||today; if(t1>today)t1=today; let t0=dayOk(from)||ilParts(new Date(Date.parse(t1)-span*DAY)).iso; if(t0>t1)t0=t1; return {t0,t1,today}};
// what the engine said then about one asset: the relation kept in the snapshot (22.11 on); for an older snapshot, the
// company the reading named (and, for a fund, a holding of it), said to be the earlier engine's
const saidOf=(e,sym,inFund)=>{const r=e.rels&&e.rels[sym]; if(r)return {dir:r.dir,s:r.s,conf:r.conf,direct:r.rel==='direct',via:(r.via||[]).map(v=>nodeLabel(v)).join(' ← ')||null,mech:r.mech||'',fact:r.fact||'',basis:r.basis||null,hz:r.hz||null,pending:!!r.pending,at:r.at||null};
  if(e.rels)return null; const d=(e.cos||[]).find(c=>c.sym===sym); if(d)return {dir:d.dir,s:d.s,conf:d.c,direct:!!d.direct,via:null,mech:'',legacy:true};
  const f=(e.cos||[]).find(c=>inFund.has(c.sym)); return f?{dir:f.dir,s:f.s,conf:f.c,direct:false,via:f.sym,mech:'',legacy:true}:null};
export function impactHistory(store,u,sym,{from=null,to=null,now=new Date()}={}){
  const pa=pathsOf(u), P=store.getDoc(pa.portfolio).data, mine=new Set(((P&&P.positions)||[]).map(p=>p&&p.sym).filter(Boolean));
  if(!mine.has(sym))throw Object.assign(new Error('not_yours'),{status:403});
  const vis=ownerLike(u)?null:symsOfUser(store,u.id), visOk=v=>!vis||!!(v&&(v.gen||(v.syms||[]).some(s=>vis.has(s))));
  const {t0,t1,today}=rangeOf(from,to,now), C=closesOf(store,sym), [bk,bn]=benchOf(sym), B=closesOf(store,bk);
  const series=C?C.d.map((d,i)=>[d,+C.c[i]]).filter(([d,v])=>d>=t0&&d<=t1&&v>0):[];
  const etf=((store.getDoc('research/etf').data||{}).by||{})[sym], inFund=new Set(((etf&&etf.top)||[]).filter(([,w])=>+w>=3).map(([s])=>s));
  const seen=new Map(), snaps=store.listDocs(SNAP).map(r=>r.id).sort(), firstSnap=snaps[0]||null;
  // 1. the snapshots: what the engine said about the event on the day it first saw it; the event is placed on its own day
  for(const id of snaps){if(id>t1)break; const S=store.getDoc(SNAP+'/'+id).data||{};
    for(const e of (S.events||[])){if(seen.has(e.k)||!visOk(e.vis))continue; const h=saidOf(e,sym,inFund); if(!h)continue; const day=evDay(e)||id; if(day<t0||day>t1){if(day<t0)seen.set(e.k,null); continue}
      seen.set(e.k,{k:e.k,he:e.he,what:e.what||'',cat:e.cat,catHe:CAT_HE[e.cat]||'',level:e.level,day,occ:e.occ||null,first:e.first||null,got:e.got||null,saidDay:id,said:h,rules:!!e.rules,src:'snap',sources:e.src||[]})}}
  // 2. before the snapshots began: the archive of the readings (research/newsarc), each article as it was read then
  if(!firstSnap||t0<firstSnap)for(const r of store.listDocs('research/newsarc')){for(const it of ((r.data||{}).items||[])){const d=String(it.at||'').slice(0,10);
      if(d<t0||d>t1||(firstSnap&&d>=firstSnap))continue; if(vis&&!(it.src==='gen'||(it.syms||[]).some(s=>vis.has(s))))continue;
      const z=(it.aff||[]).find(a=>a.sym===sym)||(()=>{const f=(it.aff||[]).find(a=>inFund.has(a.sym)&&a.how==='direct'); return f?{...f,how:'fund',via:f.sym}:null})();
      if(!z)continue; const k=it.ev?'ev:'+it.ev:'id:'+it.id; if(seen.has(k))continue; const cat=catsOf(it,{title:''})[0];
      seen.set(k,{k,he:it.he,what:'',cat,catHe:CAT_HE[cat]||'',level:it.level,day:d,occ:null,first:it.at,got:null,saidDay:d,said:{dir:z.dir||it.dir,s:Math.max(1,LV[it.level]||1),conf:it.rules?'low':it.cert==='fact'?'high':'mid',direct:z.how==='direct',via:z.via||null,mech:'',legacy:true},rules:!!it.rules,src:'arc',sources:[]})}}
  const evs=[...seen.values()].filter(Boolean).sort((a,b)=>a.day<b.day?-1:1).slice(-80);
  // 3. what followed, and the direction that was said against it
  for(const e of evs){e.react=reactionOf(C,B,e.day); e.vs=versus(e.said.dir,e.react)}
  const tally={same:evs.filter(e=>e.vs==='same').length,opposite:evs.filter(e=>e.vs==='opposite').length,flat:evs.filter(e=>e.vs==='flat').length,wait:evs.filter(e=>e.vs==='wait').length};
  return {sym,from:t0,to:t1,today,series,src:C&&C.source||C&&C.src||null,bench:bn,benchHas:!!B,events:evs,tally,firstSnap,
    note:'סמיכות בזמן אינה סיבתיות: מחיר זז מסיבות רבות. "מה שנאמר אז" הוא הכיוון האפשרי שהמנוע נתן כשראה את האירוע לראשונה; "מה שקרה" הוא תנועת המחיר אחרי, מול המדד כשיש, בלי לטעון שהאירוע גרם לה.'};
}
// 22.11: the board on past days: the events of a range of dates that had a relation to one of the viewer's assets, as the
// engine said it then (the snapshots), each with where it happened and what the market did after. Only the viewer's own
// assets, only the articles they may read; today's data are never mixed in
export function impactPast(store,u,{from=null,to=null,now=new Date(),limit=80}={}){
  const pa=pathsOf(u), P=store.getDoc(pa.portfolio).data, Q=store.getDoc('quotes/latest').data||{}, HD=holdingsOf(P,Q), mine=new Set(HD.pos.map(h=>h.sym));
  const vis=ownerLike(u)?null:symsOfUser(store,u.id), visOk=v=>!vis||!!(v&&(v.gen||(v.syms||[]).some(s=>vis.has(s))));
  const {t0,t1,today}=rangeOf(from,to,now,7), names=nameMap(), FX=store.getDoc(FIX_DOC).data||{}, etfBy=(store.getDoc('research/etf').data||{}).by||{};
  const CL=new Map(), closes=k=>{if(!CL.has(k))CL.set(k,closesOf(store,k)); return CL.get(k)};
  const coLoc=sym=>{let about=null; try{about=(store.getDoc('research/s_'+String(sym).replace(/[^A-Za-z0-9_.\-]/g,'_')).data||{}).prof||null}catch(e){} return hqOf(sym,{fix:FX.hq||null,about})||marketPt(isIL(sym)?'IL':'US')};
  const A=HD.pos.map(h=>{const fund=h.fund||!!(etfBy[h.sym]&&etfBy[h.sym].top); return {sym:h.sym,id:(fund?'fund:':'co:')+h.sym,name:(((Q.meta||{})[h.sym]||{}).name)||names.get(h.sym)||null,kind:fund?'fund':'stock',w:h.w,loc:assetLoc(h.sym,fund,coLoc)}});
  const inFundOf=new Map(A.filter(a=>a.kind==='fund').map(a=>[a.sym,new Set((((etfBy[a.sym]||{}).top)||[]).filter(([,w])=>+w>=3).map(([s])=>s))]));
  const seen=new Map(), snaps=store.listDocs(SNAP).map(r=>r.id).sort(); let legacy=0;
  for(const id of snaps){if(id>t1)break; const S=store.getDoc(SNAP+'/'+id).data||{};
    for(const e of (S.events||[])){if(seen.has(e.k)||!visOk(e.vis))continue; const day=evDay(e)||id; if(day>t1)continue; if(day<t0){seen.set(e.k,null); continue}
      const imp=[]; for(const a of A){const h=saidOf(e,a.sym,inFundOf.get(a.sym)||new Set()); if(!h)continue; const [bk,bn]=benchOf(a.sym), r=reactionOf(closes(a.sym),closes(bk),day); imp.push({sym:a.sym,...h,bench:bn,react:r,vs:versus(h.dir,r)})}
      if(!imp.length){continue} if(!e.rels)legacy++;
      seen.set(e.k,{k:e.k,he:e.he,what:e.what||'',cat:e.cat,catHe:CAT_HE[e.cat]||'',level:e.level,dir:e.dir,s:e.s,conf:e.conf,day,occ:e.occ||null,first:e.first||null,last:e.last||null,got:e.got||null,saidDay:id,loc:e.loc||null,cc:e.cc||[],nPubs:e.nPubs||null,
        rules:!!e.rules,legacy:!e.rels,sources:e.src||[],impacts:imp,touches:imp.map(i=>i.sym)})}}
  const evs=[...seen.values()].filter(Boolean).sort((a,b)=>(a.day<b.day?1:a.day>b.day?-1:(LV[b.level]-LV[a.level]))).slice(0,limit);
  return {mode:'past',at:now.toISOString(),from:t0,to:t1,today,assets:A,events:evs,legacy,firstSnap:snaps[0]||null,
    note:'מוצג מה שהמנוע אמר אז, כפי שנשמר באותו יום, ומה שקרה בשוק אחרי. הנתונים של היום אינם מעורבים כאן.'+(legacy?' אירועים מלפני 22.11 נשמרו בלי ההסבר והמקום (המנוע הקודם).':'')};
}
// 22.11: how the engine's statements stood against what followed, over the snapshots (the admins): for every relation said
// with a direction, the asset's move against its benchmark one, five and twenty trading days after the event, by how sure
// the engine was, by the kind of relation and by where it came from. A check of the engine, never a claim that it predicts
export function impactQuality(store,{now=new Date(),days=120}={}){
  const from=ilParts(new Date(now.getTime()-days*DAY)).iso, snaps=store.listDocs(SNAP).map(r=>r.id).filter(id=>id>=from).sort(), seen=new Set(), rows=[];
  const CL=new Map(), closes=k=>{if(!CL.has(k))CL.set(k,closesOf(store,k)); return CL.get(k)};
  for(const id of snaps){const S=store.getDoc(SNAP+'/'+id).data||{}; for(const e of (S.events||[])){if(!e.rels)continue; const day=evDay(e)||id;
      for(const [sym,r] of Object.entries(e.rels)){const key=e.k+'|'+sym; if(seen.has(key))continue; seen.add(key); if(r.dir!=='pos'&&r.dir!=='neg')continue;
        const [bk]=benchOf(sym), re=reactionOf(closes(sym),closes(bk),day); rows.push({conf:r.conf,rel:r.rel,src:r.src||'reading',cat:e.cat,d1:versus(r.dir,re,'d1'),d5:versus(r.dir,re,'d5'),d20:versus(r.dir,re,'d20')})}}}
  const tally=(L,k)=>{const o={n:L.length,same:0,opposite:0,flat:0,wait:0}; for(const r of L)if(o[r[k]]!=null)o[r[k]]++; const done=o.same+o.opposite; o.rate=done>=10?Math.round(o.same/done*100):null; return o};
  const group=(f,labels)=>Object.entries(labels).map(([k,he])=>{const L=rows.filter(r=>f(r)===k); return {k,he,d1:tally(L,'d1'),d5:tally(L,'d5'),d20:tally(L,'d20')}}).filter(g=>g.d1.n);
  return {at:now.toISOString(),from,n:rows.length,all:{d1:tally(rows,'d1'),d5:tally(rows,'d5'),d20:tally(rows,'d20')},
    byConf:group(r=>r.conf,{high:'ביטחון גבוה',mid:'ביטחון בינוני',low:'ביטחון נמוך'}),byRel:group(r=>r.rel,{direct:'קשר ישיר',indirect:'קשר עקיף'}),
    bySrc:group(r=>r.src,{ai:'ניתוח נפרד לנכס',reading:'נושא הכתבה',structure:'אחזקות קרן',hand:'ביד מנהל'}),firstSnap:snaps[0]||null,
    note:'נספרים רק קשרים שנאמר בהם כיוון (חיובי או שלילי), פעם אחת לכל אירוע ונכס, לפי מה שנאמר ביום הראשון. "באותו כיוון" הוא תנועת הנכס מול המדד שלו (כשיש) אחרי יום האירוע. שיעור מוצג רק מ-10 מקרים שהסתיימו. זו בדיקה של איכות הניתוח, לא הוכחה שהוא חוזה מחירים: סמיכות בזמן אינה סיבתיות.'};
}
// 22.11: a check of a sample of the events that are here now (the admins; the owner's order: at least twenty): what the
// engine itself can answer about each, said plainly, and what only a person can. For every event ten questions: did it
// happen (a primary source, or a report read in full, against a headline alone or an opinion), is the day it happened
// known and not after its publication, are the times of publication and of arrival in order, is the source reliable, is it
// marked a fact or a reading, is it a duplicate (joined, or looks like another event that was not), do the relations to
// assets rest on something (the subject of the article, a checked fact, holdings), has each an explanation, is "direct" the
// subject only, and does the confidence fit the evidence. "pass", "warn" (look at it) or "fail" (wrong by the engine's own rules)
export function impactAudit(store,{now=new Date(),n=20,sensitive=true}={}){
  const PV=store.getDoc(IMPACT_DOC).data||{}, all=(PV.events||[]).filter(e=>!e.hidden), has=e=>Object.keys(e.rels||{}).length?1:0;
  const ev=all.slice().sort((a,b)=>(has(b)-has(a))||(LV[b.level]-LV[a.level])||(String(b.last)>String(a.last)?1:-1)).slice(0,Math.max(1,Math.min(60,n)));
  const C=(k,st,he)=>({k,st,he}), sym=s=>sensitive?s:'נכס';
  const rows=ev.map(e=>{const A=e.arts||[], R=Object.entries(e.rels||{}).filter(([,r])=>r.rel==='direct'||r.rel==='indirect'), ch=[], fday=String(e.first||'').slice(0,10);
    const prim=A.some(a=>a.ver==='primary'), factFull=A.some(a=>a.ver==='fact'&&a.rd==='full'), fact=A.some(a=>a.ver==='fact');
    ch.push(e.rules?C('happened','fail','נקרא לפי כותרת בלבד: הכתבה עצמה לא נבדקה'):prim?C('happened','pass','יש מקור ראשוני (הגוף שהחליט או החברה עצמה)'):factFull?C('happened','pass','דווח כעובדה, והכתבה נקראה במלואה'):fact?C('happened','warn','דווח כעובדה, אך נקראו רק הכותרת והתקציר'):C('happened','warn','המקורות הם ניתוח, דעה או הערכה: לא דיווח על דבר שקרה'));
    ch.push(!e.occ?C('occ','warn','הכתבות לא אומרות מתי זה קרה; מוצג מועד הפרסום, ומסומן כך'):fday&&e.occ>fday?C('occ','fail',`מועד ההתרחשות (${e.occ}) מאוחר ממועד הפרסום (${fday})`):C('occ','pass',`התרחש ${e.occ}, פורסם ${fday||'?'}`));
    ch.push(!e.first?C('pub','fail','אין מועד פרסום'):e.seen&&Date.parse(e.seen)<Date.parse(e.first)-H?C('pub','warn','המנוע רשם את האירוע לפני מועד הפרסום שבמקור: שעון המקור לא מדויק'):C('pub','pass','מועד הפרסום והמועד שבו התקבל באתר שמורים בנפרד ובסדר'));
    ch.push(e.srcRel==='low'?C('source','warn','המקור היחיד חלש (דעה, אתר המלצות או רשת חברתית)'):C('source','pass',`${REL_HE[e.srcRel]||''}${e.nPubs>1?`, ${e.nPubs} מקורות`:''}`));
    ch.push(e.kind==='opinion'&&(LV[e.level]||0)>=2?C('kind','warn','טור דעה שסווג כאירוע חשוב'):C('kind','pass',e.rules?'קריאה אוטומטית, מסומנת כך':e.cert==='fact'?'מסומן: עובדה מדווחת':e.cert==='interp'?'מסומן: פרשנות של המקור':'מסומן: הערכה'));
    // a possible duplicate that was not joined: another event of the same category within two days, naming the same company as its subject
    const dir=new Set((e.named||[]).filter(z=>z.how==='direct').map(z=>z.sym)), twin=all.filter(o=>o.k!==e.k&&o.cat===e.cat&&Math.abs(Date.parse(o.first||0)-Date.parse(e.first||0))<48*H&&(o.named||[]).some(z=>z.how==='direct'&&dir.has(z.sym))).map(o=>o.k);
    const joined=Object.entries(PV.alias||{}).filter(([,v])=>v===e.k).length;
    ch.push(twin.length?C('dup','warn','אולי כפול של: '+twin.slice(0,3).join(', ')+' (אותה חברה ואותה קטגוריה ביומיים)'):C('dup','pass',(e.dups||[]).length||joined?`אוחדו ${(e.dups||[]).length} כפילויות ו-${joined} מפתחות לאירוע אחד`:'לא נמצא אירוע דומה'));
    const soft=R.filter(([,r])=>r.pending||r.basis==='knowledge'||r.basis==='reading'||r.generic), softHe=r=>r.pending?'ממתין לניתוח':r.generic?'הסבר כללי':r.basis==='knowledge'?'ידע כללי':'מקריאת הכתבה';
    ch.push(!R.length?C('rel','pass','אין נכס משויך (אף קשר לא עמד בכללים)'):soft.length?C('rel','warn',`${soft.length} מתוך ${R.length} קשרים לא נשענים על עובדה שנבדקה (${soft.slice(0,4).map(([s,r])=>sym(s)+': '+softHe(r)).join('; ')})`):C('rel','pass',`${R.length} קשרים, כולם נושא הכתבה, עובדה שנבדקה או אחזקות קרן`));
    const noMech=R.filter(([,r])=>!(r.mech&&r.mech.length>=15)); ch.push(noMech.length?C('expl','fail','קשר בלי הסבר: '+noMech.map(([s])=>sym(s)).join(', ')):C('expl','pass',R.length?'לכל קשר יש הסבר':'אין קשרים'));
    const badDir=R.filter(([s,r])=>r.rel==='direct'&&r.src!=='hand'&&!(e.named||[]).some(z=>z.sym===s&&z.how==='direct')); ch.push(badDir.length?C('direct','fail','"ישיר" לנכס שאינו נושא הכתבה: '+badDir.map(([s])=>sym(s)).join(', ')):C('direct','pass',R.length?'"ישיר" רק לנושא הכתבה; השאר עקיף':'אין קשרים'));
    const strong=e.cert==='fact'&&(prim||TIER_R[e.srcRel]>=2||e.nPubs>=3), badC=R.filter(([,r])=>r.conf==='high'&&r.st!=='ok'&&r.st!=='edit'&&!(e.cert==='fact'&&(r.grounded||r.basis==='article'||r.src==='reading')));
    ch.push(e.conf==='high'&&e.cert!=='fact'&&!(e.fix&&e.fix.conf)?C('conf','fail','ביטחון גבוה לאירוע שאינו עובדה מדווחת'):badC.length?C('conf','fail','ביטחון גבוה לקשר שלא נשען על עובדה: '+badC.map(([s])=>sym(s)).join(', ')):e.conf==='high'&&!strong?C('conf','warn','ביטחון גבוה ממקור יחיד שאינו ראשוני'):C('conf','pass',`${CONF_HE[e.conf]||''}: ${e.confWhy||''}`));
    return {k:e.k,he:e.he,cat:e.cat,catHe:CAT_HE[e.cat]||'',level:e.level,first:e.first,nPubs:e.nPubs,rels:R.length,checks:ch,worst:ch.some(c=>c.st==='fail')?'fail':ch.some(c=>c.st==='warn')?'warn':'pass'}});
  const sum={pass:rows.filter(r=>r.worst==='pass').length,warn:rows.filter(r=>r.worst==='warn').length,fail:rows.filter(r=>r.worst==='fail').length};
  return {at:now.toISOString(),engineAt:PV.at||null,n:rows.length,of:all.length,events:rows,summary:sum,
    labels:{happened:'האם קרה',occ:'מועד ההתרחשות',pub:'מועד הפרסום',source:'אמינות המקור',kind:'עובדה או פרשנות',dup:'כפילות',rel:'הנכסים ששויכו',expl:'הסבר ההשפעה',direct:'ישיר או עקיף',conf:'רמת הביטחון'},
    note:'הבדיקה היא מה שהמנוע יכול לענות בעצמו על כל אירוע. "לבדוק" הוא מקום שבו כדאי שאדם יסתכל; "נכשל" הוא חריגה מכללי המנוע עצמו. האם אירוע באמת קרה נבדק כאן לפי סוג המקור (ראשוני, או דיווח שנקרא במלואו), לא לפי ידיעה עצמאית.'};
}
