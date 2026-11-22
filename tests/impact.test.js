// 19.11 TikChik WORLD IMPACT: the engine (events, joins, categories, places, sources, links), the two views cut on the
// server, the admins' corrections with their audit, the history, and every way a user might try to reach what is not
// theirs (the global graph through the documents' API, an admin route, another person's asset). No network.
// 22.11, the correction: the relation of an event to an asset is decided for each asset on its own (server/impactrel.js).
// The acceptance scenarios of the owner's order are the tests of the second half: a holder of NVIDIA only, of Lockheed
// only, of Meta only, of a memory fund only, of two together; a company that is not held; an article of three shares; the
// evidence apart from what happened; the history by its dates; a closed market; a source that was not read.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {adminSchema, auditList, auditVerify} from '../server/admin/core.js';
import {newsId, cleanX, saidIn, ruleRead, analyzeBatch, _setSymNames} from '../server/newsx.js';
import {_setSectors, _setKinds, eventsOf} from '../server/pulse.js';
import {impactTask, impactRelRun, impactForUser, impactWorld, impactFix, impactHistory, impactPast, impactQuality, reactionOf, buildEvents, catsOf, srcTier, freshOf, indicesOf, _setNames, IMPACT_DOC, FIX_DOC, SNAP} from '../server/impact.js';
import {REL_DOC, cardOf, candidatesOf, cleanRel, baseRel, needsAI, relsFor, fundRel, markGeneric, relPrompt} from '../server/impactrel.js';
import {hqOf, cityPt} from '../server/impactgeo.js';

process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.ANTHROPIC_API_KEY=''; process.env.JOBS='0'; process.env.API_RPM='1000000';
const at=new Date('2026-11-18T15:00:00Z'), h=n=>new Date(at.getTime()-n*3600e3).toISOString();
const X=o=>({what:'w',type:'other',level:'imp',dir:'unclear',cert:'fact',kind:'news',aff:[],sectors:[],themes:[],regions:[],fac:[],secx:[],macro:false,unknown:'',more:'',st:'unknown',at:at.toISOString(),...o});
const G=g=>({...g,id:newsId(g.link),seen:g.at,src:'gen',syms:g.syms||[]});
// a small world: the owner holds NVDA, QQQ and XOM; a partner holds AAPL only
export function fixture(s){
  _setSectors({NVDA:'Technology',AAPL:'Technology',XOM:'Energy',TSM:'Technology',CVX:'Energy',JPM:'Finance'}); _setKinds({NVDA:'S',AAPL:'S',XOM:'S',TSM:'S',QQQ:'E',CVX:'S'});
  _setNames({NVDA:'NVIDIA',AAPL:'Apple',XOM:'Exxon Mobil',TSM:'TSMC',QQQ:'Invesco QQQ',CVX:'Chevron'});
  const o=s.userByEmail('owner@example.com')||s.addUser({email:'owner@example.com',password:'owner-pass-123',role:'owner'});
  const a=s.addUser({email:'adm@x.co',password:'password1',role:'admin'}), f=s.addUser({email:'p@x.co',password:'password1',role:'friend'});
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:10},{sym:'QQQ',qty:5},{sym:'XOM',qty:20}],cash:[]});
  s.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'AAPL',qty:3}],cash:[]});
  s.setDoc('quotes/latest',{usdIls:3.7,prices:{NVDA:190,QQQ:600,XOM:110,AAPL:270,TSM:300,CVX:150},prev:{NVDA:200,QQQ:595,XOM:109,AAPL:268,TSM:310,CVX:149},
    meta:{NVDA:{src:'yahoo',date:'2026-11-18',at:at.getTime()-5*60e3,name:'NVIDIA Corp'},QQQ:{date:'2026-11-18',at:at.getTime()},XOM:{date:'2026-11-17',at:at.getTime()-864e5},AAPL:{date:'2026-11-18',at:at.getTime(),name:'Apple Inc'},TSM:{date:'2026-11-18',at:at.getTime(),name:'Taiwan Semiconductor (somebody holds)'}},
    stale:{CVX:'מחיר קודם'},bench:{SPX:{px:6800,prev:6750,date:'2026-11-18',at:at.getTime()},NDX:{px:25000,prev:25100,date:'2026-11-18',at:at.getTime()},TA35:{px:3400,prev:3390,date:'2026-11-18',at:at.getTime()}}});
  // what the site knows of Exxon's business (FMP's profile): the facts an analysis may rest on
  s.setDoc('research/s_XOM',{name:'Exxon Mobil',prof:{desc:'Exxon Mobil Corporation explores for and produces crude oil and natural gas in the United States and internationally. It also refines and sells petroleum products.',industry:'Oil & Gas Integrated',sector:'Energy',country:'US'},segs:[{k:'Upstream',pct:62},{k:'Energy Products',pct:25}],peers:['CVX','SHEL']});
  const NV={title:'Nvidia beats estimates',link:'https://reuters.com/nv',pub:'Reuters',at:h(3),syms:['NVDA']};
  const NV2={title:'Nvidia results top forecasts on AI demand',link:'https://cnbc.com/nv',pub:'CNBC',at:h(2.8),syms:['NVDA']};
  const AP={title:'Apple faces EU fine',link:'https://bbc.com/ap',pub:'BBC',at:h(4),syms:['AAPL']};
  s.setDoc('research/news',{items:[NV,NV2,AP]});
  const GG=[{title:'Fed holds rates steady',link:'https://reuters.com/fed',pub:'Reuters',at:h(2)},{title:'Fed keeps rates unchanged',link:'https://bloomberg.com/fed',pub:'Bloomberg',at:h(2.5)},
    {title:'OPEC+ agrees deeper output cut',link:'https://reuters.com/opec',pub:'Reuters',at:h(6)},
    {title:'Strong earthquake hits Taiwan, chip plants checked',link:'https://apnews.com/tw',pub:'Associated Press',at:h(1)},
    {title:'Strong earthquake hits Taiwan, chip plants checked',link:'https://yahoo.com/tw',pub:'Yahoo Finance',at:h(0.9)},
    {title:'Why you should buy TSMC now',link:'https://fool.com/tsm',pub:'Motley Fool',at:h(1.5)}].map(G);
  const quake={he:'רעידת אדמה בטייוואן',what:'רעידת אדמה חזקה פגעה בטייוואן.',type:'supply',level:'crit',dir:'neg',ev:'taiwan-quake',cc:['TW'],regions:['asia'],sectors:['Semiconductors'],
    aff:[{sym:'TSM',how:'direct',dir:'neg',why:'המפעלים נבדקים'},{sym:'NVDA',how:'customer',dir:'neg',why:'לקוחה של TSMC'},{sym:'AAPL',how:'customer',dir:'neg',why:'לקוחה של TSMC'}]};
  s.setDoc('research/newsx',{updatedAt:at.toISOString(),gen:GG,by:{
    [newsId(NV.link)]:X({he:'אנבידיה עקפה את התחזיות',what:'אנבידיה פרסמה דוח מעל הצפי.',type:'earnings',dir:'pos',ev:'nvda-q3-report',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:'הדוח של החברה'}],sectors:['Semiconductors'],cc:['US']}),
    [newsId(NV2.link)]:X({he:'התוצאות של אנבידיה',what:'התוצאות של אנבידיה מעל הצפי.',type:'earnings',dir:'pos',ev:'nvidia-results-beat',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:''}],cc:['US']}),
    [newsId(AP.link)]:X({he:'קנס לאפל באיחוד האירופי',what:'האיחוד האירופי קנס את אפל.',type:'regulation',dir:'neg',ev:'apple-eu-fine',aff:[{sym:'AAPL',how:'direct',dir:'neg',why:'הקנס על החברה'}],regions:['europe'],cc:['BE']}),
    [GG[0].id]:X({he:'הפד הותיר את הריבית',what:'הפד הותיר את הריבית ללא שינוי.',type:'macro_rates',level:'crit',dir:'mixed',ev:'fed-hold-nov',regions:['us'],themes:['rates','fed'],macro:true,fac:[{k:'rates',move:'unclear',why:'הריבית נשארה'}],sectors:['Finance'],secx:[{g:'Finance',via:'rates',dir:'mixed',why:'מרווחי הבנקים'}]}),
    [GG[1].id]:X({he:'הפד לא שינה ריבית',what:'הפד לא שינה ריבית.',type:'macro_rates',level:'crit',dir:'mixed',ev:'fed-rates-unchanged',regions:['us'],themes:['rates'],macro:true,fac:[{k:'rates',move:'unclear',why:''}]}),
    [GG[2].id]:X({he:'אופ״ק+ מקצצת תפוקה',what:'אופ״ק+ הסכימה על קיצוץ.',type:'energy',level:'imp',dir:'pos',ev:'opec-cut',cc:['SA'],regions:['middle_east'],themes:['oil'],fac:[{k:'oil',move:'up',why:'פחות היצע'}],sectors:['Energy'],
      secx:[{g:'Energy',via:'oil',dir:'pos',why:'מחיר נפט גבוה'}],aff:[{sym:'CVX',how:'sector',dir:'pos',why:'מפיקת נפט',via:'Energy'}]}),
    [GG[3].id]:X(quake),[GG[4].id]:X(quake),
    [GG[5].id]:X({he:'כדאי לקנות TSMC',what:'כותב ממליץ.',type:'company',level:'watch',kind:'opinion',cert:'interp',dir:'pos',ev:'tsm-buy-op',aff:[{sym:'TSM',how:'direct',dir:'pos',why:''}]})}});
  s.setDoc('research/etf',{by:{QQQ:{etf:'QQQ',src:'stockanalysis.com',asOf:'2026-11-10',top:[['NVDA',8.5],['AAPL',8.9],['MSFT',8.1]]}}});
  return {o:s.userById(o.id),a:s.userById(a.id),f:s.userById(f.id)};
}
const mk=()=>{const s=new Store(':memory:'); adminSchema(s); return s};
// the analysis in a test: the answers by event and asset; a pair that is not on the list gets "none"
const asker=ANS=>async(prompt,batch)=>JSON.stringify(batch.flatMap((b,i)=>b.pairs.map(p=>({e:i,sym:p.c.sym,...(ANS[b.e.k+'|'+p.c.sym]||{rel:'none',why_none:'אין מסלול עסקי מסוים בין האירוע לעסק של החברה'})}))));

test('the engine: one event per thing (two keys and two publishers joined), the sixteen categories, the places, the sources and their reliability',()=>{
  const s=mk(); fixture(s);
  const st=impactTask(s,{now:at}); assert.ok(st.events>=6,'events: '+st.events);
  const D=s.getDoc(IMPACT_DOC).data, E=k=>D.events.find(e=>e.k===k)||D.events.find(e=>e.k===D.alias[k]);
  // the two Fed keys are one event with both publishers; NVIDIA's two keys of one report too
  // the root of a join is the event seen first (the Fed's "unchanged" came half an hour before "holds")
  assert.equal(D.alias['ev:fed-hold-nov'],'ev:fed-rates-unchanged'); assert.equal(E('ev:fed-hold-nov').nPubs,2); assert.equal(E('ev:fed-hold-nov').k,'ev:fed-rates-unchanged');
  assert.equal(D.alias['ev:nvidia-results-beat'],'ev:nvda-q3-report','the same company, a report, in two days: one event');
  // the quake: two links with the same story are one event, the copy kept as a duplicate, both sources kept
  const q=E('ev:taiwan-quake'); assert.equal(q.nArt,2); assert.equal(q.dups.length,1); assert.deepEqual(q.src.map(x=>x.pub).sort(),['Associated Press','Yahoo Finance']);
  assert.equal(q.cat,'disaster','an earthquake is a natural disaster, whatever the reading\'s kind'); assert.equal(q.loc.cc,'TW');
  assert.equal(E('ev:fed-hold-nov').cat,'rates'); assert.equal(E('ev:opec-cut').cat,'energy'); assert.equal(E('ev:nvda-q3-report').cat,'earnings'); assert.equal(E('ev:apple-eu-fine').cat,'regulation');
  // NVIDIA's report is placed at its headquarters (the site's list, said so); the Fed in Washington; OPEC in Riyadh
  const nv=E('ev:nvda-q3-report'); assert.equal(nv.loc.how,'hq'); assert.equal(nv.loc.src,'list'); assert.equal(Math.round(nv.loc.lat),37);
  assert.equal(E('ev:fed-hold-nov').loc.name,'ארה״ב'); assert.equal(E('ev:opec-cut').loc.cc,'SA');
  // the reliability: a newswire high, an opinion site low; the opinion's own event keeps a low confidence
  assert.equal(srcTier('Reuters'),'high'); assert.equal(srcTier('Motley Fool'),'low'); assert.equal(srcTier('Business Wire'),'official'); assert.equal(srcTier('Some Blog'),'mid');
  const op=E('ev:tsm-buy-op'); assert.equal(op.srcRel,'low'); assert.equal(op.conf,'low');
  // every link says its direction, strength, confidence, reliability, direct or not, horizon, why and on what it rests
  for(const e of D.events)for(const l of e.links){for(const k of ['dir','s','conf','rel','direct','hz','why','basis'])assert.ok(l[k]!==undefined,e.k+' '+l.id+' '+k); assert.ok(Array.isArray(l.arts))}
  // the chain: event -> country -> factor -> sector -> company (OPEC: Saudi Arabia, oil up, energy, Chevron)
  const oc=E('ev:opec-cut').links.map(l=>l.id); for(const id of ['ev:ev:opec-cut>cty:SA','cty:SA>fac:oil','fac:oil>sec:Energy','sec:Energy>co:CVX'])assert.ok(oc.includes(id),id+' in '+oc.join(' | '));
  assert.equal(E('ev:opec-cut').links.find(l=>l.id==='cty:SA>fac:oil').move,'up');
  // 22.11: an article gathered under a share is no link by itself: the event keeps it as "listed", apart from the companies named
  assert.deepEqual(E('ev:opec-cut').named.map(z=>z.sym),['CVX']); assert.deepEqual(E('ev:opec-cut').facs.map(f=>f.k),['oil']); assert.ok(E('ev:opec-cut').nodes.includes('fac:oil'));
  // a new event, then the same again: no change; another source later: an update of the same event, not a new one
  assert.equal(E('ev:opec-cut').status,'new'); impactTask(s,{now:at}); assert.equal(s.getDoc(IMPACT_DOC).data.events.find(e=>e.k==='ev:opec-cut').status,'new','still new within six hours');
  const NX=s.getDoc('research/newsx').data; const g={title:'OPEC cut deepens, Saudi says',link:'https://ft.com/opec',pub:'Financial Times',at:h(0.5),src:'gen',syms:[]}; g.id=newsId(g.link); NX.gen.push({...g,seen:g.at});
  NX.by[g.id]={...NX.by[NX.gen[2].id],he:'הקיצוץ מעמיק',level:'crit'}; s.setDoc('research/newsx',NX);
  impactTask(s,{now:new Date(at.getTime()+8*3600e3)}); const op2=s.getDoc(IMPACT_DOC).data.events.find(e=>e.k==='ev:opec-cut');
  assert.equal(op2.status,'update'); assert.ok(op2.hist.at(-1).ch.includes('level')); assert.ok(op2.hist.at(-1).ch.includes('src')); assert.equal(op2.rev,1);
  // a snapshot of the day: what was said then, with the place, about each asset the event has a relation to
  const snap=s.listDocs(SNAP); assert.deepEqual(snap.map(r=>r.id).sort(),['2026-11-18','2026-11-19'],'a snapshot per Israeli day'); const sq=snap.find(r=>r.id==='2026-11-18').data.events.find(e=>e.k==='ev:taiwan-quake');
  assert.ok(sq.cos.some(c=>c.sym==='AAPL'&&c.dir==='neg'&&!c.direct)); assert.equal(sq.loc.name,'טייוואן'); assert.equal(sq.rels.TSM.rel,'direct'); assert.equal(sq.rels.AAPL.rel,'indirect'); assert.match(sq.rels.AAPL.mech,/לקוחה של TSMC/);
});

test('the category and the countries come from the reading when it gives them; older readings are placed by rules',()=>{
  const x=cleanX({he:'a',what:'b',type:'geo',cat:'war',cc:['il','IR','xx1','US','GB','FR']}); assert.equal(x.cat,'war'); assert.deepEqual(x.cc,['IL','IR','US','GB']);
  assert.equal(cleanX({he:'a',what:'b',cat:'nonsense'}).cat,undefined,'an unknown category is not kept');
  assert.deepEqual(catsOf({type:'geo',themes:[]},{title:'Missile strikes hit port'}).slice(0,1),['war']);
  assert.equal(catsOf({type:'sanctions',themes:['tariffs']},{title:''})[0],'trade'); assert.equal(catsOf({type:'ai_chips',themes:['chips']},{title:''})[0],'chips');
  assert.equal(catsOf({type:'ma'},{title:''})[0],'ma'); assert.equal(catsOf({type:'other',themes:['gold']},{title:''})[0],'commodities');
  assert.equal(cityPt('Cambridge','GB').lat,52.21); assert.equal(cityPt('Arlington','US','TX'),null,'an Arlington that is not in Virginia is not placed');
  assert.equal(hqOf('ZZZZ'),null,'a company nobody knows is not given a headquarters');
  assert.equal(hqOf('NVDA',{fix:{NVDA:{lat:1,lon:2,name:'x'}}}).src,'fix','an admin\'s correction comes first');
  // 22.11: what changed and why it matters, when the reading gives them
  const y=cleanX({he:'a',what:'b',chg:'המכס נכנס לתוקף.',eco:'מייקר יבוא של רכיבים.',aff:[{sym:'nvda',how:'direct',said:true},{sym:'AMD',how:'competitor',said:false}]}); assert.equal(y.chg,'המכס נכנס לתוקף.'); assert.equal(y.eco,'מייקר יבוא של רכיבים.');
  assert.deepEqual(y.aff.map(a=>[a.sym,a.said]),[['NVDA',true],['AMD',false]]); assert.equal(cleanX({he:'a',what:'b'}).chg,undefined,'an older answer is still a reading');
});

test('the freshness: live only from the live stream in the session; delayed; a close; stale; none',()=>{
  const open=new Date('2026-11-18T16:00:00Z'), shut=new Date('2026-11-19T02:00:00Z');
  const Q={prices:{A:1,B:1,C:1,D:1},meta:{A:{rt:new Date(open.getTime()-60e3).toISOString(),at:open.getTime()-20*60e3,date:'2026-11-18'},B:{at:open.getTime()-10*60e3,date:'2026-11-18'},C:{at:shut.getTime()-9*3600e3,date:'2026-11-18'}},stale:{D:'מחיר קודם'}};
  assert.equal(freshOf(Q,'A',open).state,'live'); assert.equal(freshOf(Q,'A',shut).state,'close','no "live" after the session');
  assert.equal(freshOf(Q,'B',open).state,'delayed'); assert.match(freshOf(Q,'B',open).he,/עיכוב/);
  assert.equal(freshOf(Q,'C',shut).state,'close'); assert.equal(freshOf(Q,'D',open).state,'stale'); assert.equal(freshOf(Q,'Z',open).state,'none');
  const I=indicesOf({bench:{SPX:{px:10,prev:9,date:'2026-11-18',at:open.getTime()-5*60e3}}},open); assert.equal(I[0].state,'delayed'); assert.equal(I[0].chg,11.11); assert.equal(I.find(i=>i.k==='DJI').state,'none','no number is made up');
  assert.equal(indicesOf({bench:{SPX:{px:10,prev:9,date:'2026-11-18',at:open.getTime()-5*60e3}}},shut)[0].open,false,'a closed market is said to be closed');
});

test('the user\'s view: only what has a relation to their own assets; a company they do not hold only as a link on such a path; a partner\'s from their own articles',()=>{
  const s=mk(), U=fixture(s); impactTask(s,{now:at});
  const O=impactForUser(s,U.o,{now:at}), F=impactForUser(s,U.f,{now:at});
  // the owner: the report (the subject of the article), the quake (the reading names NVIDIA a customer of TSMC), Apple's fine
  // through QQQ. Not OPEC: Exxon is not named, and "the same sector" is no link (22.11); the pair waits for an analysis
  const ok=O.events.map(e=>e.k); for(const k of ['ev:nvda-q3-report','ev:taiwan-quake','ev:apple-eu-fine'])assert.ok(ok.includes(k),k+' in '+ok.join(','));
  assert.ok(!ok.includes('ev:opec-cut'),'no link by the sector alone'); assert.ok(!ok.includes('ev:fed-rates-unchanged'),'no link because "the market as a whole"');
  const nv=O.events.find(e=>e.k==='ev:nvda-q3-report'), ni=nv.impacts.find(i=>i.sym==='NVDA'); assert.equal(ni.rel,'direct'); assert.equal(ni.src,'reading'); assert.equal(ni.conf,'high'); assert.equal(ni.said,true);
  // QQQ holds NVIDIA (8.5%): a fact of structure, by the published holdings, said with the weight
  const nq=nv.impacts.find(i=>i.sym==='QQQ'); assert.equal(nq.rel,'indirect'); assert.equal(nq.src,'structure'); assert.match(nq.mech,/NVDA 8\.5%/); assert.deepEqual(nv.paths.find(p=>p.to==='QQQ').nodes,['ev:ev:nvda-q3-report','co:NVDA','fund:QQQ']);
  assert.ok(O.links.some(l=>l.id==='co:NVDA>fund:QQQ'&&l.final&&/8\.5%/.test(l.why)));
  const qk=O.events.find(e=>e.k==='ev:taiwan-quake'); assert.deepEqual(qk.touches.slice().sort(),['NVDA','QQQ']); const qi=qk.impacts.find(i=>i.sym==='NVDA'); assert.equal(qi.rel,'indirect'); assert.equal(qi.conf,'low'); assert.match(qi.confWhy,/ניתוח נפרד לנכס/);
  assert.deepEqual(qk.paths.find(p=>p.to==='NVDA').nodes,['ev:ev:taiwan-quake','co:TSM','co:NVDA']); assert.equal(qk.impacts.find(i=>i.sym==='QQQ').holds.length,2,'NVIDIA and Apple, both held by the fund');
  // Apple's fine reaches the owner only through QQQ, which holds Apple (8.9%): indirect, by the fund's holdings
  const af=O.events.find(e=>e.k==='ev:apple-eu-fine'); assert.deepEqual(af.touches,['QQQ']); assert.deepEqual(af.paths[0].nodes,['ev:ev:apple-eu-fine','co:AAPL','fund:QQQ']); assert.equal(af.paths[0].direct,false);
  // the halo is the market's own move: NVDA down today, XOM up; the line colour is the possible direction, apart
  assert.equal(O.assets.find(a=>a.sym==='NVDA').halo,'down'); assert.equal(O.assets.find(a=>a.sym==='XOM').halo,'up');
  assert.equal(O.assets.find(a=>a.sym==='XOM').fresh.state,'close');
  // the partner: Apple's fine (their own article) and the quake through TSMC; never the owner's holdings as holdings
  const fk=F.events.map(e=>e.k); assert.ok(fk.includes('ev:apple-eu-fine')); assert.ok(fk.includes('ev:taiwan-quake'));
  assert.ok(!fk.includes('ev:nvda-q3-report'),'an article gathered for somebody else\'s share is not theirs');
  const FJ=JSON.stringify(F); for(const bad of ['XOM','QQQ','CVX','Exxon','NVIDIA Corp','somebody holds'])assert.ok(!FJ.includes(bad),'the partner\'s view names '+bad);
  const fq=F.events.find(e=>e.k==='ev:taiwan-quake'); assert.deepEqual(fq.touches,['AAPL']); assert.deepEqual(fq.paths[0].nodes,['ev:ev:taiwan-quake','co:TSM','co:AAPL'],'TSMC only as the link to Apple');
  assert.equal(F.nodes['co:TSM'].mine,false); assert.equal(F.nodes['co:AAPL'].mine,true); assert.ok(!F.nodes['co:NVDA'],'a company that is not on a path to their asset is no node of theirs');
  // the public article names NVIDIA: it is on the event's card as a company the reading found, never as an asset of the viewer
  assert.deepEqual(fq.found.filter(c=>c.sym==='NVDA').map(c=>[c.mine,c.by]),[[false,'reading']]); assert.ok(!F.assets.some(a=>a.sym==='NVDA'));
  assert.equal(F.pf.n,1); assert.ok(F.indices.length>=3);
});

test('the admin\'s view and hand: everything with what is weak; a correction changes the next build and is audited; joins and parts by hand',()=>{
  const s=mk(), U=fixture(s); impactTask(s,{now:at});
  const W=impactWorld(s,{now:at}); assert.ok(W.events.length>=6); assert.ok(W.diag.weak.some(w=>w.k==='ev:tsm-buy-op'),'the opinion\'s link is weak');
  assert.ok(W.diag.dups.some(d=>d.k==='ev:fed-rates-unchanged'&&d.joined.includes('ev:fed-hold-nov'))); assert.ok(W.diag.stale.some(x=>x.sym==='CVX'),'Chevron has no fresh price');
  // 22.11: the relations to assets, with what waits and what is weak: OPEC and Exxon wait for the analysis (a channel in common
  // sent the pair to be examined; it made no link); without a key the admin is told so
  assert.ok(W.diag.waitRel.some(w=>w.k==='ev:opec-cut'&&w.sym==='XOM'&&w.sigs.includes('ch')),'the pair waits, with the sign that chose it');
  assert.ok(W.diag.weakRel.some(w=>w.k==='ev:taiwan-quake'&&w.sym==='NVDA'),'a relation the reading wrote, not yet examined against the asset, is weak');
  assert.equal(W.events.find(e=>e.k==='ev:nvda-q3-report').rels.NVDA.rel,'direct');
  // a partner has no "edit": refused, nothing written
  assert.throws(()=>impactFix(s,U.f,{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'no'}),/permission_denied/); assert.throws(()=>impactFix(s,U.f,{kind:'rel',k:'ev:opec-cut',sym:'XOM',st:'ok'}),/permission_denied/); assert.equal(s.getDoc(FIX_DOC).exists,false);
  // the admin rejects a link: gone from the next build, audited with what it was
  impactFix(s,U.a,{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'no',note:'לא קשור'}); impactTask(s,{now:at});
  assert.ok(!s.getDoc(IMPACT_DOC).data.events.find(e=>e.k==='ev:opec-cut').links.some(l=>l.id==='sec:Energy>co:CVX'));
  // a category and a place corrected; a headquarters set; a join undone by hand
  impactFix(s,U.a,{kind:'event',k:'ev:opec-cut',cat:'commodities',loc:{lat:24.7,lon:46.7,name:'ריאד'}}); impactFix(s,U.a,{kind:'hq',sym:'XOM',loc:{lat:30.1,lon:-95.4,name:'Spring, TX'}});
  impactFix(s,U.a,{kind:'split',k:'ev:fed-hold-nov'}); impactTask(s,{now:at}); const D=s.getDoc(IMPACT_DOC).data;
  assert.equal(D.events.find(e=>e.k==='ev:opec-cut').cat,'commodities'); assert.equal(D.events.find(e=>e.k==='ev:opec-cut').loc.how,'fix');
  assert.ok(!D.alias['ev:fed-hold-nov'],'parted by hand'); assert.ok(D.events.some(e=>e.k==='ev:fed-hold-nov'));
  assert.throws(()=>impactFix(s,U.a,{kind:'event',k:'ev:opec-cut',cat:'astrology'}),/bad_cat/); assert.throws(()=>impactFix(s,U.a,{kind:'hq',sym:'XOM',loc:{lat:200,lon:0}}),/bad_loc/);
  assert.throws(()=>impactFix(s,U.a,{kind:'link',k:'drop table',id:'x>y'}),/bad_link/); assert.throws(()=>impactFix(s,U.a,{kind:'rel',k:'ev:opec-cut',sym:'<x>',st:'ok'}),/bad_rel/);
  const L=auditList(s,{action:'impact.'}); assert.equal(L.length,4); assert.equal(L.at(-1).action,'impact.link'); assert.equal(L.at(-1).detail.after.st,'no'); assert.equal(L.at(-1).detail.before,null);
  // 22.11: the admin's hand on a relation: refuse the quake's link to NVIDIA (gone from the owner's view), add OPEC's to Exxon
  // with its reason (said to be by hand), then give both back to the engine; each audited
  impactFix(s,U.a,{kind:'rel',k:'ev:taiwan-quake',sym:'NVDA',st:'no',note:'אין נזק למפעלים'}); assert.throws(()=>impactFix(s,U.a,{kind:'rel',k:'ev:opec-cut',sym:'XOM',st:'add'}),/why_required/);
  impactFix(s,U.a,{kind:'rel',k:'ev:opec-cut',sym:'XOM',st:'add',dir:'pos',s:2,conf:'mid',why:'אקסון מפיקה נפט; קיצוץ בהיצע מעלה את המחיר שהיא מוכרת בו.'}); impactTask(s,{now:at});
  let O=impactForUser(s,U.o,{now:at}); assert.ok(!O.events.find(e=>e.k==='ev:taiwan-quake').touches.includes('NVDA'),'refused by hand'); const ox=O.events.find(e=>e.k==='ev:opec-cut').impacts[0]; assert.equal(ox.sym,'XOM'); assert.equal(ox.src,'hand'); assert.equal(ox.st,'add'); assert.match(ox.confWhy,/ביד מנהל/);
  impactFix(s,U.a,{kind:'rel',k:'ev:taiwan-quake',sym:'NVDA',st:'auto'}); impactFix(s,U.a,{kind:'rel',k:'ev:opec-cut',sym:'XOM',st:'auto'}); impactTask(s,{now:at}); O=impactForUser(s,U.o,{now:at});
  assert.ok(O.events.find(e=>e.k==='ev:taiwan-quake').touches.includes('NVDA')); assert.ok(!O.events.some(e=>e.k==='ev:opec-cut'));
  assert.equal(auditList(s,{action:'impact.rel'}).length,4); assert.ok(auditVerify(s).ok,'the chain holds');
  // the alerts hear the joins: the two Fed keys were one event for the alerts too, until parted
  const before=eventsOf(s,{now:at,days:3}).map(e=>e.k); assert.ok(before.includes('ev:fed-hold-nov'),'parted: two events again');
  impactFix(s,U.a,{kind:'split',k:'ev:fed-hold-nov',on:false}); impactTask(s,{now:at}); assert.ok(!eventsOf(s,{now:at,days:3}).map(e=>e.k).includes('ev:fed-hold-nov'),'joined: one alert');
});

// ---- 22.11, the correction: one asset at a time ----
const FACTS={
  NVDA:{name:'NVIDIA Corporation',prof:{desc:'NVIDIA Corporation provides graphics processing units and accelerated computing platforms for data centers, gaming and automotive markets. Its data center products are sold to cloud service providers and enterprises.',industry:'Semiconductors',sector:'Technology',country:'US'},segs:[{k:'Data Center',pct:78},{k:'Gaming',pct:12}],peers:['AMD','INTC','AVGO']},
  LMT:{name:'Lockheed Martin Corporation',prof:{desc:'Lockheed Martin Corporation, a security and aerospace company, designs and manufactures the F-35 fighter aircraft, missile defense systems and space systems. It serves the U.S. government and international customers.',industry:'Aerospace & Defense',sector:'Industrials',country:'US'},segs:[{k:'Aeronautics',pct:40},{k:'Missiles and Fire Control',pct:17}],peers:['RTX','NOC','GD']},
  META:{name:'Meta Platforms, Inc.',prof:{desc:'Meta Platforms, Inc. develops products that enable people to connect through mobile devices and personal computers. It generates substantially all of its revenue from selling advertising placements on Facebook, Instagram and WhatsApp.',industry:'Internet Content & Information',sector:'Communication Services',country:'US'},segs:[{k:'Family of Apps',pct:98},{k:'Reality Labs',pct:2}],peers:['GOOGL','SNAP','PINS']},
  JPM:{name:'JPMorgan Chase & Co.',prof:{desc:'JPMorgan Chase & Co. operates as a financial services company. A large part of its revenue is net interest income from loans and deposits; it also provides investment banking and asset management.',industry:'Banks - Diversified',sector:'Financial Services',country:'US'},segs:[],peers:['BAC','C','WFC']},
  VST:{name:'Vistra Corp.',prof:{desc:'Vistra Corp. operates as an integrated retail electricity and power generation company in the United States, with natural gas, nuclear, solar and battery plants.',industry:'Utilities - Independent Power Producers',sector:'Utilities',country:'US'},segs:[],peers:['CEG','NRG']}};
const ANS={
  'ev:defense-budget|LMT':{rel:'indirect',via:['fac:defense'],mech:'לוקהיד מרטין מוכרת מטוסי קרב ומערכות טילים בעיקר לממשלת ארה״ב; תקציב ביטחון גדול יותר עשוי להגדיל את ההזמנות שלה.',fact:'serves the U.S. government',dir:'pos',s:3,conf:'high',hz:'mid',up:'אישור סופי של התקציב בשני הבתים',down:'קיצוץ בתוכניות רכש'},
  'ev:memory-prices|NVDA':{rel:'indirect',via:['fac:chips'],mech:'אנבידיה קונה זיכרון מהיר לכרטיסים שהיא מוכרת למרכזי נתונים; זיכרון יקר יותר מעלה את עלות הייצור שלה, והביקוש שמייקר אותו בא מאותם שרתים.',fact:'accelerated computing platforms for data centers',dir:'mixed',s:1,conf:'mid',hz:'mid',up:'מחסור מתמשך בזיכרון',down:'חוזי אספקה ארוכים במחיר קבוע'},
  'ev:fed-cut|JPM':{rel:'indirect',via:['fac:rates'],mech:'חלק גדול מההכנסות של ג׳יי־פי מורגן הוא הפער בין הריבית על הלוואות לריבית על פיקדונות; ריבית נמוכה יותר עשויה לצמצם אותו.',fact:'net interest income from loans and deposits',dir:'neg',s:2,conf:'mid',hz:'mid'},
  'ev:sony-nvidia-deal|NVDA':{rel:'indirect',via:['co:SONY'],mech:'סוני תקנה מאנבידיה מעבדים גרפיים לשנים הבאות: הזמנה של המוצר העיקרי שלה מלקוחה גדולה.',fact:'graphics processing units',dir:'pos',s:2,conf:'high',hz:'long'},
  'ev:eu-ai-rules|META':{rel:'indirect',via:['fac:regulation'],mech:'כללי הבינה המלאכותית של האיחוד עשויים לחייב את מטא לשנות מוצרים שהיא מפעילה באירופה.',fact:'operates large language models across Europe',dir:'neg',s:2,conf:'high',hz:'long'},
  'ev:ai-spending|NVDA':{rel:'indirect',via:['fac:ai'],mech:'ההוצאה על בינה מלאכותית גדלה, והחברה חשופה לתחום.',fact:'',dir:'pos',s:2,conf:'mid'},
  'ev:ai-spending|META':{rel:'indirect',via:['fac:ai'],mech:'ההוצאה על בינה מלאכותית גדלה, והחברה חשופה לתחום.',fact:'',dir:'pos',s:2,conf:'mid'},
  'ev:chip-export-curbs|NVDA':{rel:'direct',via:[],mech:'כדאי למכור את המניה לפני שההגבלות ייכנסו לתוקף.',fact:'',dir:'neg',s:3,conf:'high'}};
function world(s){
  _setSectors({NVDA:'Technology',LMT:'Industrials',META:'Technology',JPM:'Finance',VST:'Utilities',MU:'Technology',SONY:'Technology'}); _setKinds({NVDA:'S',LMT:'S',META:'S',JPM:'S',VST:'S',DRAM:'E',MU:'S'});
  _setNames({NVDA:'NVIDIA Corporation',LMT:'Lockheed Martin Corporation',META:'Meta Platforms, Inc.',JPM:'JPMorgan Chase & Co.',VST:'Vistra Corp.',DRAM:'Roundhill Memory ETF',MU:'Micron Technology',SONY:'Sony Group Corporation',CEG:'Constellation Energy',NRG:'NRG Energy'});
  s.userByEmail('owner@example.com')||s.addUser({email:'owner@example.com',password:'owner-pass-123',role:'owner'}); const a=s.addUser({email:'adm@x.co',password:'password1',role:'admin'}), U={a:s.userById(a.id)};
  for(const [k,syms] of Object.entries({nv:['NVDA'],lm:['LMT'],me:['META'],dr:['DRAM'],nl:['NVDA','LMT'],vs:['VST'],jp:['JPM']})){const u=s.addUser({email:k+'@x.co',password:'password1',role:'friend'}); U[k]=s.userById(u.id); s.setDoc(`data/users/${u.id}/portfolio`,{positions:syms.map(sym=>({sym,qty:10})),cash:[]})}
  s.setDoc('portfolio/main',{positions:[],cash:[]});
  for(const [k,d] of Object.entries(FACTS))s.setDoc('research/s_'+k,d);
  s.setDoc('research/etf',{by:{DRAM:{etf:'DRAM',src:'stockanalysis.com',asOf:'2026-11-14',top:[['MU',24.5],['SNDK',9.8],['WDC',8.1],['STX',6]]}}});
  const px={NVDA:190,LMT:480,META:700,DRAM:42,VST:160,JPM:300}; s.setDoc('quotes/latest',{usdIls:3.7,prices:px,prev:{NVDA:188,LMT:470,META:707,DRAM:41,VST:158,JPM:303},meta:Object.fromEntries(Object.keys(px).map(k=>[k,{date:'2026-11-18',at:at.getTime()-10*60e3}])),bench:{SPX:{px:6800,prev:6750,date:'2026-11-18',at:at.getTime()-10*60e3}}});
  // the feed of NVIDIA and of Meta carries a market wrap that is about neither
  const WRAP={title:'Stock market today: Dow slips as traders await data',link:'https://cnbc.com/wrap',pub:'CNBC',at:h(5),syms:['NVDA','META']};
  s.setDoc('research/news',{items:[WRAP]});
  const GG=[{title:'Senate passes $925 billion defense budget bill',link:'https://reuters.com/def',pub:'Reuters',at:h(8)},
    {title:'DRAM contract prices jump as AI servers soak up supply',link:'https://reuters.com/dram',pub:'Reuters',at:h(7)},
    {title:'3 energy stocks set to benefit from data center power demand',link:'https://barrons.com/power',pub:"Barron's",at:h(6)},
    {title:'Fed cuts rates by a quarter point',link:'https://federalreserve.gov/pr',pub:'Federal Reserve',at:h(4)},
    {title:'Sony cuts PlayStation 5 price for the holidays',link:'https://reuters.com/ps5',pub:'Reuters',at:h(9)},
    {title:'Sony signs multi-year GPU supply deal with Nvidia',link:'https://businesswire.com/sony',pub:'Business Wire',at:h(3)},
    {title:'Sony, Nvidia deal: what analysts say',link:'https://fool.com/sony',pub:'Motley Fool',at:h(2.5)},
    {title:'EU adopts stricter rules for AI models',link:'https://ft.com/euai',pub:'Financial Times',at:h(10)},
    {title:'Big Tech AI spending to reach $500 billion',link:'https://bloomberg.com/capex',pub:'Bloomberg',at:h(11)},
    {title:'US weighs new curbs on AI chip exports',link:'https://reuters.com/curbs',pub:'Reuters',at:h(12)}].map(G);
  s.setDoc('research/newsx',{updatedAt:at.toISOString(),gen:GG,by:{
    [newsId(WRAP.link)]:X({he:'המסחר בוול סטריט: הדאו יורד קלות',what:'המדדים נסחרו בירידה קלה לפני נתוני מאקרו.',type:'market',level:'watch',ev:'market-wrap',aff:[],cc:['US'],rd:'full'}),
    [GG[0].id]:X({he:'הסנאט אישר תקציב ביטחון מוגדל',what:'הסנאט אישר תקציב ביטחון של 925 מיליארד דולר.',chg:'התקציב עבר בסנאט ומחכה לחתימת הנשיא.',eco:'יותר כסף ממשלתי לרכש של מערכות נשק.',type:'geo',cat:'geo',level:'imp',dir:'pos',ev:'defense-budget',cc:['US'],regions:['us'],themes:['defense'],
      fac:[{k:'defense',move:'up',why:'תקציב הרכש גדל'}],sectors:['Defense'],secx:[{g:'Defense',via:'defense',dir:'pos',why:'יותר הזמנות מהממשלה'}],aff:[{sym:'LMT',how:'sector',dir:'pos',why:'קבלנית ביטחונית גדולה',via:'Defense',said:true}],occ:'2026-11-17',rd:'full'}),
    [GG[1].id]:X({he:'מחירי שבבי הזיכרון עולים',what:'מחירי החוזים של זיכרון DRAM עלו בחדות בגלל ביקוש משרתי בינה מלאכותית.',type:'ai_chips',cat:'chips',level:'imp',dir:'pos',ev:'memory-prices',themes:['chips','ai'],fac:[{k:'chips',move:'up',why:'הביקוש לזיכרון עולה'}],sectors:['Semiconductors'],
      aff:[{sym:'MU',how:'direct',dir:'pos',why:'יצרנית זיכרון',said:true},{sym:'NVDA',how:'customer',dir:'mixed',why:'קונה זיכרון לכרטיסים שלה',said:false}],rd:'full'}),
    [GG[2].id]:X({he:'שלוש מניות אנרגיה שנהנות מהביקוש לחשמל',what:'כותב מונה שלוש חברות חשמל שנהנות מהביקוש של מרכזי נתונים.',type:'sector',cat:'energy',level:'watch',kind:'analysis',cert:'interp',dir:'pos',ev:'power-demand-stocks',themes:['power','ai'],fac:[{k:'power',move:'up',why:'מרכזי נתונים צורכים יותר חשמל'}],sectors:['Utilities'],
      aff:[{sym:'VST',how:'direct',dir:'pos',why:'מפיקת חשמל בטקסס',said:true},{sym:'CEG',how:'direct',dir:'pos',why:'מפעילת כורים גרעיניים',said:true},{sym:'NRG',how:'direct',dir:'pos',why:'מפיקה ומוכרת חשמל',said:true}],rd:'full'}),
    [GG[3].id]:X({he:'הפד הוריד את הריבית ברבע אחוז',what:'הפד הוריד את הריבית ברבע נקודת אחוז.',type:'macro_rates',cat:'rates',level:'crit',dir:'mixed',kind:'pr',ev:'fed-cut',cc:['US'],themes:['rates','fed'],macro:true,fac:[{k:'rates',move:'down',why:'הריבית ירדה'}],sectors:['Finance'],secx:[{g:'Finance',via:'rates',dir:'mixed',why:'מרווחי הריבית של הבנקים'}],rd:'full'}),
    [GG[4].id]:X({he:'סוני מוזילה את הפלייסטיישן 5',what:'סוני הורידה את מחיר הקונסולה לקראת החגים.',type:'product',level:'watch',ev:'sony-ps5-price',cc:['JP'],aff:[{sym:'SONY',how:'direct',dir:'mixed',why:'מחיר נמוך יותר, יותר יחידות',said:true}],rd:'full'}),
    [GG[5].id]:X({he:'סוני חתמה על הסכם אספקה עם אנבידיה',what:'סוני חתמה על הסכם רב־שנתי לקניית מעבדים גרפיים מאנבידיה.',type:'contract',level:'imp',kind:'pr',dir:'pos',ev:'sony-nvidia-deal',cc:['JP'],aff:[{sym:'SONY',how:'direct',dir:'pos',why:'מבטיחה אספקה',said:true},{sym:'NVDA',how:'supplier',dir:'pos',why:'הספקית בהסכם',said:true}],rd:'full'}),
    [GG[6].id]:X({he:'מה אומרים על העסקה של סוני ואנבידיה',what:'כותב מעריך את העסקה.',type:'contract',level:'watch',kind:'opinion',cert:'interp',dir:'pos',ev:'sony-nvidia-deal',aff:[{sym:'SONY',how:'direct',dir:'pos',why:'',said:true},{sym:'NVDA',how:'supplier',dir:'pos',why:'',said:true}],rd:'head'}),
    [GG[7].id]:X({he:'האיחוד האירופי אימץ כללים למודלי בינה מלאכותית',what:'האיחוד האירופי אימץ כללים מחמירים למודלים גדולים.',type:'regulation',cat:'regulation',level:'imp',dir:'neg',ev:'eu-ai-rules',regions:['europe'],themes:['regulation','ai'],fac:[{k:'regulation',move:'up',why:'כללים חדשים'}],rd:'full'}),
    [GG[8].id]:X({he:'ההוצאה על בינה מלאכותית תגיע ל-500 מיליארד',what:'חברות הטכנולוגיה הגדולות יוציאו כ-500 מיליארד דולר על תשתיות.',type:'ai_chips',cat:'ai',level:'imp',dir:'pos',cert:'interp',ev:'ai-spending',themes:['ai'],fac:[{k:'ai',move:'up',why:'ההשקעה בתשתיות גדלה'}],rd:'full'}),
    [GG[9].id]:X({he:'ארה״ב שוקלת הגבלות חדשות על יצוא שבבים',what:'הממשל שוקל להחמיר את ההגבלות על יצוא שבבי בינה מלאכותית.',type:'sanctions',cat:'trade',level:'imp',dir:'neg',ev:'chip-export-curbs',themes:['chips','china'],fac:[{k:'chips',move:'unclear',why:'פחות שווקים'}],aff:[{sym:'NVDA',how:'direct',dir:'neg',why:'מוכרת שבבים לסין',said:false}],rd:'full'})}});
  return U;
}

test('22.11 one asset at a time: the cards, the pairs that are examined, an answer held to the facts',()=>{
  const s=mk(); world(s); const {events}=buildEvents(s,{now:at}), E=k=>events.find(e=>e.k===k);
  const nv=cardOf(s,'NVDA'), lm=cardOf(s,'LMT'), me=cardOf(s,'META'), dr=cardOf(s,'DRAM',{etfBy:s.getDoc('research/etf').data.by}), cards=new Map([nv,lm,me,dr].map(c=>[c.sym,c]));
  // the card: only what the site holds, each with where it came from; the channels are read from the business, not the sector
  assert.equal(lm.industry,'Aerospace & Defense'); assert.match(lm.src.desc,/FMP/); assert.ok(lm.ch.includes('defense')); assert.ok(nv.ch.includes('chips')&&nv.ch.includes('ai')); assert.ok(me.ch.includes('ads')); assert.ok(!me.ch.includes('defense')&&!nv.ch.includes('defense'));
  assert.equal(dr.kind,'fund'); assert.deepEqual(dr.fund.top[0],['MU',24.5]); assert.match(dr.src.fund,/stockanalysis/);
  // the defense budget: Lockheed is examined; NVIDIA and Meta are not even candidates (no sign at all)
  assert.deepEqual([...candidatesOf(E('ev:defense-budget'),cards).keys()],['LMT']);
  // the market wrap sits in two feeds: "listed", which sends the pair to be examined and makes no link
  const wr=candidatesOf(E('ev:market-wrap'),cards); assert.deepEqual([...wr.keys()].sort(),['META','NVDA']); assert.deepEqual(wr.get('NVDA').sig,['listed']); assert.equal(baseRel(E('ev:market-wrap'),nv,wr.get('NVDA')),null); assert.equal(needsAI(E('ev:market-wrap'),nv,wr.get('NVDA')),true);
  // the three energy shares: an event of a lesser level reaches by a channel only through a factor the reading gave (power): not NVIDIA
  assert.ok(!candidatesOf(E('ev:power-demand-stocks'),cards).has('NVDA'));
  // a "direct" the article does not name is not the subject: no link until it is examined
  const cu=candidatesOf(E('ev:chip-export-curbs'),cards).get('NVDA'); assert.equal(baseRel(E('ev:chip-export-curbs'),nv,cu),null); assert.equal(needsAI(E('ev:chip-export-curbs'),nv,cu),true);
  // the fund: by its published holdings, with the weight; under 3% together it is no link
  const mp=E('ev:memory-prices'), fr=fundRel(mp,dr,candidatesOf(mp,cards).get('DRAM')); assert.equal(fr.rel,'indirect'); assert.equal(fr.src,'structure'); assert.equal(fr.tot,24.5); assert.match(fr.mech,/MU 24\.5%/); assert.equal(fr.conf,'mid'); assert.equal(fr.s,2);
  assert.equal(fundRel(mp,{...dr,fund:{...dr.fund,top:[['MU',2.1]]}},{holds:[['MU',2.1]]}),null);
  // the answer: a quoted fact is checked against the card; "direct" is the subject only; no fact and not in the article: low
  const cdL=candidatesOf(E('ev:defense-budget'),cards).get('LMT'), a=cleanRel(ANS['ev:defense-budget|LMT'],E('ev:defense-budget'),lm,cdL);
  assert.equal(a.rel,'indirect'); assert.equal(a.grounded,true); assert.equal(a.basis,'facts'); assert.equal(a.s,2,'an indirect relation is never "strong"'); assert.equal(a.conf,'high'); assert.deepEqual(a.via,['fac:defense']); assert.match(a.confWhy,/נבדקה מול המקור/);
  const b=cleanRel({...ANS['ev:defense-budget|LMT'],fact:'sells tanks to forty countries',via:['fac:oil','fac:defense','co:ZZZ']},E('ev:defense-budget'),lm,cdL); assert.equal(b.grounded,false); assert.equal(b.fact,''); assert.equal(b.basis,'article','Lockheed is named in the article'); assert.deepEqual(b.via,['fac:defense'],'only the event\'s own nodes');
  const eu=E('ev:eu-ai-rules'), c=cleanRel(ANS['ev:eu-ai-rules|META'],eu,me,candidatesOf(eu,cards).get('META')); assert.equal(c.grounded,false); assert.equal(c.basis,'knowledge'); assert.equal(c.conf,'low'); assert.match(c.confWhy,/ידע כללי/);
  assert.equal(cleanRel({rel:'indirect',mech:'קצר'},eu,me,{sig:['ch']}).rel,'none','a link with no explanation is no link'); assert.equal(cleanRel(ANS['ev:chip-export-curbs|NVDA'],E('ev:chip-export-curbs'),nv,cu).rel,'none','advice is refused');
  assert.equal(cleanRel({rel:'direct',mech:'החברה מושפעת ישירות מההחלטה הזאת על כל העסק שלה.',conf:'high'},eu,me,{sig:['ch']}).rel,'indirect','"direct" is the subject of the article only');
  assert.equal(cleanRel({rel:'maybe'},eu,me,{}),null);
  // the same explanation for two assets: both marked, both low
  const g=markGeneric({NVDA:{rel:'indirect',src:'ai',mech:ANS['ev:ai-spending|NVDA'].mech,conf:'mid'},META:{rel:'indirect',src:'ai',mech:ANS['ev:ai-spending|META'].mech,conf:'mid'},LMT:{rel:'none',src:'ai'}}); assert.ok(g.NVDA.generic&&g.META.generic); assert.equal(g.NVDA.conf,'low'); assert.match(g.META.confWhy,/אותו הסבר/);
  // the prompt: the facts of each asset once, the event's own nodes, and the rule that the same sector is no path
  const P=relPrompt([{e:E('ev:defense-budget'),pairs:[{c:lm,cd:cdL}]}]); assert.match(P,/serves the U\.S\. government/); assert.match(P,/"fac:defense"/); assert.match(P,/"אותו ענף"/); assert.match(P,/"pairs":\["LMT"\]/); assert.ok(!P.includes('NVIDIA'),'an asset that is not examined is not sent');
});

test('22.11 the acceptance scenarios: each holder sees their own asset\'s events, each with its own explanation; what is not theirs is not there',async()=>{
  const s=mk(), U=world(s); impactTask(s,{now:at});
  // before the analysis: only the subject of an article and a fund's holdings stand; nothing by a feed, a sector or the market
  let nv=impactForUser(s,U.nv,{now:at}); assert.ok(!nv.events.some(e=>e.k==='ev:market-wrap'),'the wrap in NVIDIA\'s feed is not NVIDIA\'s event'); assert.ok(!nv.events.some(e=>e.k==='ev:fed-cut'));
  assert.ok(!impactForUser(s,U.me,{now:at}).events.length,'Meta: nothing stands without an analysis, and nothing is shown');
  process.env.ANTHROPIC_API_KEY=''; const st=await impactRelRun(s,{now:at,ask:asker(ANS)});
  assert.ok(st.judged>=8,'pairs decided: '+JSON.stringify(st)); assert.ok(st.none>=3); const R=s.getDoc(REL_DOC).data;
  assert.equal(R.by['ev:market-wrap'].rels.NVDA.rel,'none'); assert.equal(R.by['ev:market-wrap'].rels.META.rel,'none'); assert.ok(R.used>=st.judged);
  // a second run asks nothing again: what was decided stands until the event or the asset's facts change
  const st2=await impactRelRun(s,{now:at,ask:async()=>{throw new Error('asked again')}}); assert.equal(st2.asked,0);
  nv=impactForUser(s,U.nv,{now:at}); const lm=impactForUser(s,U.lm,{now:at}), me=impactForUser(s,U.me,{now:at}), dr=impactForUser(s,U.dr,{now:at}), nl=impactForUser(s,U.nl,{now:at}), vs=impactForUser(s,U.vs,{now:at}), jp=impactForUser(s,U.jp,{now:at});
  const K=v=>v.events.map(e=>e.k).sort();
  // NVIDIA only: the memory prices (a customer of memory), the deal with Sony, the AI spending; not the defense budget, the
  // rate cut, the three energy shares, the PlayStation, the market wrap; the export curbs were refused (advice) and are not shown
  assert.deepEqual(K(nv),['ev:ai-spending','ev:memory-prices','ev:sony-nvidia-deal']);
  // Lockheed only: the defense budget, with Lockheed's own path and the fact it rests on
  assert.deepEqual(K(lm),['ev:defense-budget']); const li=lm.events[0].impacts[0]; assert.equal(li.sym,'LMT'); assert.equal(li.rel,'indirect'); assert.equal(li.dir,'pos'); assert.equal(li.conf,'high'); assert.equal(li.fact,'serves the U.S. government'); assert.match(li.factSrc,/FMP/); assert.equal(li.basis,'facts');
  assert.match(li.mech,/ממשלת ארה״ב/); assert.equal(li.up,'אישור סופי של התקציב בשני הבתים'); assert.equal(li.hz,'mid'); assert.deepEqual(li.path,['ev:ev:defense-budget','cty:US','fac:defense','co:LMT'],'event, country, factor, asset');
  // Meta only: the EU's rules (a weak link, said to be weak) and the AI spending; not the memory prices (examined, refused)
  assert.deepEqual(K(me),['ev:ai-spending','ev:eu-ai-rules']); const mi=me.events.find(e=>e.k==='ev:eu-ai-rules').impacts[0]; assert.equal(mi.conf,'low'); assert.equal(mi.basis,'knowledge'); assert.match(mi.confWhy,/ידע כללי/);
  // the memory fund only: by what it holds (Micron, 24.5%), a fact of structure
  assert.deepEqual(K(dr),['ev:memory-prices']); const di=dr.events[0].impacts[0]; assert.equal(di.src,'structure'); assert.match(di.mech,/MU 24\.5%/); assert.deepEqual(di.path,['ev:ev:memory-prices','co:MU','fund:DRAM']); assert.match(di.factSrc,/אחזקות הקרן/);
  // NVIDIA and Lockheed together: each event under its own asset, with its own explanation; no event under both
  assert.deepEqual(K(nl),['ev:ai-spending','ev:defense-budget','ev:memory-prices','ev:sony-nvidia-deal']); for(const e of nl.events)assert.equal(e.touches.length,1,e.k+' touches '+e.touches);
  assert.deepEqual(nl.events.find(e=>e.k==='ev:defense-budget').touches,['LMT']); assert.deepEqual(nl.events.find(e=>e.k==='ev:memory-prices').touches,['NVDA']);
  assert.notEqual(nl.events.find(e=>e.k==='ev:defense-budget').impacts[0].mech,nl.events.find(e=>e.k==='ev:memory-prices').impacts[0].mech);
  // the same explanation given to NVIDIA and to Meta is marked generic and kept low for both
  for(const v of [nv,me]){const i=v.events.find(e=>e.k==='ev:ai-spending').impacts[0]; assert.equal(i.generic,true); assert.equal(i.conf,'low')}
  // Sony is not held: no asset, no node of its own; in the deal it is the link on NVIDIA's path, marked not mine
  assert.ok(!nv.assets.some(a=>a.sym==='SONY')); assert.ok(!K(nv).includes('ev:sony-ps5-price'),'Sony\'s own news is not NVIDIA\'s holder\'s'); assert.equal(nv.nodes['co:SONY'].mine,false); assert.equal(nv.nodes['co:NVDA'].mine,true);
  const sd=nv.events.find(e=>e.k==='ev:sony-nvidia-deal'); assert.deepEqual(sd.paths[0].nodes,['ev:ev:sony-nvidia-deal','co:SONY','co:NVDA']); assert.equal(sd.impacts[0].conf,'high'); assert.equal(sd.impacts[0].said,true);
  assert.ok(!Object.keys(lm.nodes).includes('co:SONY')&&!JSON.stringify(lm).includes('SONY'),'and for a holder of Lockheed, Sony is nowhere');
  // the article of three shares: all three on the card as named in the source, the held one marked; the engine's own finds apart
  assert.deepEqual(K(vs),['ev:power-demand-stocks']); const pw=vs.events[0]; assert.deepEqual(pw.said.map(c=>[c.sym,c.mine]),[['VST',true],['CEG',false],['NRG',false]]); assert.equal(pw.found.length,0); assert.equal(pw.said[0].name,'Vistra Corp.'); assert.match(pw.said[1].why,/כורים/);
  assert.equal(pw.impacts[0].rel,'direct'); assert.equal(pw.impacts[0].conf,'mid','an analysis is not a reported fact'); assert.equal(pw.cert,'interp');
  const mm=nv.events.find(e=>e.k==='ev:memory-prices'); assert.deepEqual(mm.said.map(c=>c.sym),['MU']); assert.deepEqual(mm.found.map(c=>[c.sym,c.mine,c.by]),[['NVDA',true,'reading']],'NVIDIA is the reader\'s inference, not named in the article');
  // the rate cut: a bank, by its own mechanism; nobody else
  assert.deepEqual(K(jp),['ev:fed-cut']); assert.match(jp.events[0].impacts[0].mech,/הלוואות/); assert.equal(jp.events[0].impacts[0].fact,'net interest income from loans and deposits');
  // what happened apart from the evidence apart from why it matters apart from what the market did
  const d=sd; assert.match(d.what,/הסכם רב־שנתי/); assert.equal(d.evidence.length,2); assert.equal(d.evidence[0].ver,'primary','the company\'s own release first'); assert.equal(d.evidence[0].pub,'Business Wire'); assert.equal(d.evidence[0].rd,'full');
  assert.equal(d.evidence[1].ver,'opinion'); assert.equal(d.evidence[1].rd,'head','an article read by its headline only is said to be so'); assert.match(d.evidence[1].verHe,/אינו ראיה/); assert.ok(d.evidence.every(v=>v.title!==d.what&&v.link),'the evidence is the sources, not the story again');
  const db=lm.events[0]; assert.equal(db.chg,'התקציב עבר בסנאט ומחכה לחתימת הנשיא.'); assert.equal(db.eco,'יותר כסף ממשלתי לרכש של מערכות נשק.'); assert.equal(db.occ,'2026-11-17'); assert.ok(db.first&&db.got,'the event\'s day, the publication and the arrival are kept apart');
  assert.equal(db.impacts[0].mkt.day,'2026-11-17'); assert.equal(db.impacts[0].mkt.bench,'S&P 500'); assert.equal(db.impacts[0].mkt.r,null,'no closes: no reaction is made up');
  // every event shown has a relation with an explanation; none is there "because it is in the portfolio"
  for(const v of [nv,lm,me,dr,nl,vs,jp])for(const e of v.events){assert.ok(e.impacts.length>0); for(const i of e.impacts){assert.ok(i.mech.length>=15,e.k+' '+i.sym); assert.ok(['direct','indirect'].includes(i.rel)); assert.ok(v.assets.some(a=>a.sym===i.sym))}}
  // the admin sees what was examined and refused, with the reason
  const W=impactWorld(s,{now:at}), wr=W.events.find(e=>e.k==='ev:market-wrap'); assert.equal(wr.rels.NVDA.rel,'none'); assert.match(wr.rels.NVDA.why,/אין מסלול/); assert.deepEqual(wr.listed.slice().sort(),['META','NVDA']);
  assert.ok(W.diag.weakRel.some(w=>w.k==='ev:eu-ai-rules'&&w.sym==='META'&&w.why.includes('לא נשען על עובדה מפרטי הנכס'))); assert.ok(W.diag.weakRel.some(w=>w.k==='ev:ai-spending'&&w.why.includes('אותו הסבר לשני נכסים')));
  assert.equal(W.events.find(e=>e.k==='ev:chip-export-curbs').rels.NVDA.rel,'none'); assert.equal(W.stats.rels>0,true);
});

test('22.11 the source names it, or the engine found it: checked against the text the reader saw',async()=>{
  _setSymNames({NVDA:'NVIDIA Corporation',META:'Meta Platforms, Inc.',GM:'General Motors Company',BAC:'Bank of America Corporation',TGT:'Target Corporation',ALL:'Allstate Corporation',VST:'Vistra Corp.'});
  assert.equal(saidIn('Nvidia beats estimates as data center sales jump','NVDA','NVIDIA Corporation'),true); assert.equal(saidIn('Chip stocks fall after earnings (NASDAQ: NVDA)','NVDA',''),true);
  assert.equal(saidIn('AMD and Intel fall; memory makers gain','NVDA','NVIDIA Corporation'),false); assert.equal(saidIn('General Motors recalls trucks','GM','General Motors Company'),true); assert.equal(saidIn('The general mood was sour','GM','General Motors Company'),false);
  assert.equal(saidIn('ALL eyes on the Fed','ALL','Allstate Corporation'),false,'a ticker that is a common word is not a mention'); assert.equal(saidIn('Allstate raises premiums','ALL','Allstate Corporation'),true);
  assert.equal(saidIn('Investors target bank stocks','TGT','Target Corporation'),false); assert.equal(saidIn('Target cuts prices','TGT','Target Corporation'),true); assert.equal(saidIn('Bank of America upgrades','BAC','Bank of America Corporation'),true);
  assert.equal(saidIn('Facebook parent to raise spending','META','Meta Platforms, Inc.'),true); assert.equal(saidIn('',' NVDA','x'),false);
  // the reader says "said: true" for both; the text names only one: the other is the reader's inference
  const arts=[{title:'Vistra signs nuclear power deal with data center operator',sum:'The Texas power producer will supply electricity.',link:'https://x.co/1',pub:'Reuters',src:'x'}];
  const got=await analyzeBatch(arts,{ask:async()=>JSON.stringify([{i:0,he:'ויסטרה חתמה על הסכם חשמל',what:'ויסטרה תספק חשמל למרכז נתונים.',type:'contract',level:'imp',dir:'pos',cert:'fact',aff:[{sym:'VST',how:'direct',dir:'pos',why:'ההסכם שלה',said:true},{sym:'NVDA',how:'customer',dir:'pos',why:'מוכרת שבבים למרכזי נתונים',said:true}],ev:'vst-deal'}])});
  assert.deepEqual(got[0].aff.map(a=>[a.sym,a.said]),[['VST',true],['NVDA',false]]); assert.equal(got[0].rd,'head','the article was not opened: said so');
  // a reading by the rules: a company the headline does not name is listed, not named
  const r=ruleRead({title:'Stock market today: Dow slips',sum:'',pub:'CNBC',syms:['NVDA','META']}); assert.deepEqual(r.aff.map(a=>a.said),[false,false]);
  assert.equal(ruleRead({title:'Nvidia beats estimates',sum:'',pub:'Reuters',syms:['NVDA']}).aff[0].said,true);
  _setSymNames(null);
});

test('22.11 the history by its dates, the board on past days, what the market did, and the engine against what followed',async()=>{
  const s=mk(), U=world(s);
  const days=[], c=[]; for(let i=0;i<70;i++){const d=new Date(Date.UTC(2026,8,14)+i*864e5); if([0,6].includes(d.getUTCDay()))continue; days.push(d.toISOString().slice(0,10)); c.push(100+i)}
  s.setDoc('quotes/c_NVDA',{key:'NVDA',d:days,c,v:days.map((d,i)=>d==='2026-10-21'?3e6:1e6),source:'Stooq'}); s.setDoc('quotes/c_LMT',{key:'LMT',d:days,c:c.map(v=>400-v),source:'Stooq'}); s.setDoc('quotes/c_IDX_SPX',{key:'IDX:SPX',d:days,c:c.map(v=>5000+v/2),source:'Yahoo Finance'});
  // what the market did after a day: the close before, the first close on or after, a week and a month on; the benchmark beside; the volume
  const C=s.getDoc('quotes/c_NVDA').data, B=s.getDoc('quotes/c_IDX_SPX').data, r=reactionOf(C,B,'2026-10-21');
  assert.equal(r.baseDay,'2026-10-20'); assert.equal(r.day0,'2026-10-21'); assert.equal(r.same,true); assert.ok(r.d1>0&&r.d5>r.d1&&r.d20>r.d5); assert.ok(r.bench.d1>0&&r.bench.d1<r.d1); assert.equal(r.vol,3);
  assert.equal(reactionOf(C,B,'2026-10-24').same,false,'a Saturday: the first close after'); assert.equal(reactionOf(C,B,'2026-10-24').day0,'2026-10-26'); assert.deepEqual(reactionOf(C,B,'2027-01-05'),{wait:true,last:days.at(-1)}); assert.equal(reactionOf(null,B,'2026-10-21'),null);
  // snapshots of three days: the earlier engine's (no relations kept), and two of the corrected one
  s.setDoc(SNAP+'/2026-10-20',{day:'2026-10-20',events:[{k:'ev:old-chip-curb',he:'הגבלות על שבבים',cat:'trade',level:'imp',dir:'neg',first:'2026-10-20T12:00:00Z',vis:{gen:true,syms:[]},cos:[{sym:'NVDA',dir:'neg',s:2,c:'mid',direct:true,hops:1}]}]});
  const rel=(o={})=>({rel:'indirect',dir:'pos',s:2,conf:'mid',hz:'mid',mech:'אנבידיה מוכרת מעבדים למרכזי נתונים; ההזמנה מגדילה את המכירות שלה.',fact:'graphics processing units',basis:'facts',src:'ai',pending:false,at:'2026-10-27T10:00:00Z',...o});
  s.setDoc(SNAP+'/2026-10-27',{v:2,day:'2026-10-27',events:[{k:'ev:cloud-order',he:'הזמנת ענק של שרתים',what:'ספקית ענן הזמינה שרתים.',cat:'ai',level:'imp',dir:'pos',occ:'2026-10-26',first:'2026-10-27T09:00:00Z',got:'2026-10-27T09:20:00Z',loc:{lat:47.6,lon:-122.3,name:'סיאטל',how:'hq'},cc:['US'],vis:{gen:true,syms:[]},cos:[],rels:{NVDA:rel()},src:[{pub:'Reuters',title:'Cloud giant orders servers',link:'https://r.co/1',at:'2026-10-27T09:00:00Z'}]},
    {k:'ev:lmt-contract',he:'חוזה ללוקהיד',what:'חוזה חדש.',cat:'industry',level:'imp',dir:'pos',first:'2026-10-27T11:00:00Z',loc:null,vis:{gen:false,syms:['LMT']},cos:[],rels:{LMT:rel({rel:'direct',dir:'pos',conf:'high',src:'reading',mech:'החוזה של החברה עצמה'})}}]});
  // the same event a day later, with another statement: the first one stays the one that was said
  s.setDoc(SNAP+'/2026-10-28',{v:2,day:'2026-10-28',events:[{k:'ev:cloud-order',he:'הזמנת ענק של שרתים',cat:'ai',level:'imp',dir:'neg',occ:'2026-10-26',first:'2026-10-27T09:00:00Z',vis:{gen:true,syms:[]},cos:[],rels:{NVDA:rel({dir:'neg'})}}]});
  // the dates are obeyed (the range was thrown away before 22.11): only the events of the range, on the event's own day
  const H=impactHistory(s,U.nv,'NVDA',{from:'2026-10-22',to:'2026-11-05',now:at}); assert.equal(H.from,'2026-10-22'); assert.equal(H.to,'2026-11-05'); assert.deepEqual(H.events.map(e=>e.k),['ev:cloud-order']); assert.ok(H.series.every(([d])=>d>='2026-10-22'&&d<='2026-11-05'));
  const e=H.events[0]; assert.equal(e.day,'2026-10-26','the day it happened, not the day it was published'); assert.equal(e.saidDay,'2026-10-27'); assert.equal(e.said.dir,'pos','what was said first'); assert.match(e.said.mech,/מרכזי נתונים/); assert.equal(e.said.fact,'graphics processing units');
  assert.equal(e.react.baseDay,'2026-10-23'); assert.ok(e.react.d5>0); assert.equal(e.vs,'same'); assert.equal(H.bench,'S&P 500'); assert.match(H.note,/סמיכות בזמן אינה סיבתיות/);
  const H1=impactHistory(s,U.nv,'NVDA',{from:'2026-10-20',to:'2026-10-20',now:at}); assert.deepEqual(H1.events.map(x=>x.k),['ev:old-chip-curb'],'one day: that day\'s events only'); assert.equal(H1.events[0].said.legacy,true); assert.equal(H1.events[0].vs,'opposite','said down, went up: shown as is');
  assert.equal(impactHistory(s,U.nv,'NVDA',{from:'garbage',to:'2099-01-01',now:at}).to,'2026-11-18','a date that is not one, or in the future, falls back to today');
  assert.throws(()=>impactHistory(s,U.nv,'LMT',{now:at}),/not_yours/); assert.throws(()=>impactHistory(s,U.lm,'NVDA',{now:at}),/not_yours/);
  // the board on past days: the viewer's own assets only, as it was said then, with the place; today's data are not mixed in
  const P=impactPast(s,U.nv,{from:'2026-10-19',to:'2026-10-30',now:at}); assert.equal(P.mode,'past'); assert.deepEqual(P.events.map(x=>x.k),['ev:cloud-order','ev:old-chip-curb']); assert.equal(P.events[0].loc.name,'סיאטל'); assert.equal(P.events[0].impacts[0].sym,'NVDA'); assert.equal(P.events[0].impacts[0].vs,'same');
  assert.equal(P.legacy,1); assert.match(P.note,/המנוע הקודם/); assert.ok(!JSON.stringify(P).includes('lmt-contract'),'another person\'s asset and article');
  assert.deepEqual(impactPast(s,U.lm,{from:'2026-10-19',to:'2026-10-30',now:at}).events.map(x=>x.k),['ev:lmt-contract']); assert.deepEqual(impactPast(s,U.me,{from:'2026-10-19',to:'2026-10-30',now:at}).events,[]);
  assert.deepEqual(impactPast(s,U.nv,{from:'2026-10-27',to:'2026-10-27',now:at}).events,[],'published on the 27th, happened on the 26th: not on the 27th');
  // the engine against what followed: each relation once, by what was said first, against the benchmark
  const Qy=impactQuality(s,{now:at}); assert.equal(Qy.n,2); assert.equal(Qy.all.d5.same,1); assert.equal(Qy.all.d5.opposite,1,'Lockheed fell after a "positive"'); assert.equal(Qy.all.d5.rate,null,'no rate from two cases'); assert.match(Qy.note,/לא הוכחה שהוא חוזה/);
  assert.deepEqual(Qy.bySrc.map(g=>g.k).sort(),['ai','reading']);
  // today's run writes today's snapshot with the relations as said now; an earlier statement of the same day is not written over
  // (with an analyser at hand, what the reading wrote is said to wait, and the analysis that comes replaces it in the snapshot)
  process.env.ANTHROPIC_API_KEY='test-only'; try{impactTask(s,{now:at}); assert.equal(s.getDoc(SNAP+'/2026-11-18').data.events.find(x=>x.k==='ev:defense-budget').rels.LMT.pending,true); await impactRelRun(s,{now:at,ask:asker(ANS)})}finally{process.env.ANTHROPIC_API_KEY=''}
  const T=s.getDoc(SNAP+'/2026-11-18').data.events.find(x=>x.k==='ev:defense-budget'); assert.equal(T.rels.LMT.pending,false); assert.equal(T.rels.LMT.dir,'pos'); assert.equal(T.rels.LMT.fact,'serves the U.S. government'); assert.equal(T.loc.name,'ארה״ב');
  impactFix(s,U.a,{kind:'rel',k:'ev:defense-budget',sym:'LMT',st:'edit',dir:'neg'}); impactTask(s,{now:new Date(at.getTime()+3600e3)});
  assert.equal(s.getDoc(IMPACT_DOC).data.events.find(x=>x.k==='ev:defense-budget').rels.LMT.dir,'neg','the registry follows the correction'); assert.equal(s.getDoc(SNAP+'/2026-11-18').data.events.find(x=>x.k==='ev:defense-budget').rels.LMT.dir,'pos','the snapshot keeps what was said first');
  // the market: a closed market is said to be closed, and a close is a close, never "live"
  const night=new Date('2026-11-19T03:00:00Z'), V=impactForUser(s,U.lm,{now:night}); assert.equal(V.assets[0].open,false); assert.equal(V.assets[0].fresh.state,'close'); assert.equal(V.events[0].impacts[0].mkt.open,false); assert.equal(V.indices[0].state,'close');
  const mk2=V.events[0].impacts[0].mkt; assert.equal(mk2.day,'2026-11-17'); assert.equal(mk2.r.baseDay,'2026-11-16'); assert.ok(mk2.r.d1<0,'Lockheed fell on the day'); assert.ok(mk2.r.bench.d1>0); assert.equal(mk2.r.d20,null,'a month on is not known yet');
});

test('the API: a partner cannot reach the global graph by any route; their view is cut on the server; the admin\'s routes need "view" and "edit"',async()=>{
  const {createApp,bootstrap}=await import('../server/index.js');
  const store=new Store(':memory:'); bootstrap(store); const U=fixture(store); impactTask(store);
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false});
  const srv=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x))}), base='http://127.0.0.1:'+srv.address().port, jar={};
  const req=async(who,method,url,body,hdr={})=>{const r=await fetch(base+url,{method,redirect:'manual',headers:{...(jar[who]?{cookie:jar[who]}:{}),'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{}),...hdr},body:body===undefined?undefined:JSON.stringify(body)});
    const sc=r.headers.get('set-cookie'); if(sc)jar[who]=sc.split(';')[0]; const t=await r.text(); let j=null; try{j=JSON.parse(t)}catch(e){} return {status:r.status,j,t}};
  try{
    // signed out: nothing
    assert.equal((await req('x','GET','/api/impact')).status,401); assert.equal((await req('x','GET','/api/impact/past')).status,401); assert.equal((await req('x','GET','/api/admin/impact')).status,403); assert.equal((await req('x','GET','/api/admin/impact/quality')).status,403);
    assert.equal((await req('p','POST','/api/login',{email:'p@x.co',password:'password1'})).status,200);
    // the partner: every way to the global graph is shut
    for(const u of ['/api/admin/impact','/api/admin/impact/audit','/api/admin/impact/quality','/api/admin/impact?days=7&mode=world','/api/admin/world'])assert.equal((await req('p','GET',u)).status,403,u);
    for(const p of ['research/impact','research/impactfix','research/impactrel'])assert.equal((await req('p','GET','/api/db/doc?path='+p)).status,403,p);
    // the snapshots and the archive are not documents of this API at all (a path of three parts): refused either way
    for(const p of ['research/impactsnap/2026-11-18','research/newsarc/2026-11'])assert.ok([400,403].includes((await req('p','GET','/api/db/doc?path='+p)).status),p);
    for(const p of ['research/impactsnap','research/impactsnap/x/y'])assert.ok([400,403].includes((await req('p','GET','/api/db/list?path='+p)).status),p);
    assert.equal((await req('p','POST','/api/admin/impact/fix',{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'no'})).status,403); assert.equal((await req('p','POST','/api/admin/impact/fix',{kind:'rel',k:'ev:opec-cut',sym:'AAPL',st:'add',why:'כי כן, זה קשור מאוד לעסק'})).status,403);
    assert.equal((await req('p','POST','/api/admin/impact/run')).status,403);
    assert.equal((await req('p','PUT','/api/db/doc?path=research/impactfix',{alias:{a:'b'}})).status,403,'nor written through the documents'); assert.equal((await req('p','PUT','/api/db/doc?path=research/impactrel',{by:{}})).status,403);
    // the partner's own view: asking for a scope, a user, a mode, a symbol or a filter in the request changes nothing
    let r=await req('p','GET','/api/impact?mode=world&uid='+U.o.id+'&user='+U.o.id+'&all=1&sym=NVDA&assets=NVDA,XOM&sec=Energy'); assert.equal(r.status,200); assert.equal(r.j.mode,'me');
    const J=JSON.stringify(r.j); for(const bad of ['XOM','QQQ','CVX','NVIDIA Corp','opec'])assert.ok(!J.includes(bad),'the partner\'s answer names '+bad);
    assert.deepEqual(r.j.assets.map(a=>a.sym),['AAPL']); assert.ok(r.j.events.every(e=>e.touches.length===1&&e.touches[0]==='AAPL'&&e.impacts.every(i=>i.sym==='AAPL')));
    await new Promise(ok=>setTimeout(ok,1600));
    r=await req('p','GET','/api/impact/history?sym=NVDA'); assert.equal(r.status,403,'another person\'s asset'); assert.ok(!/NVDA.*series/.test(r.t));
    r=await req('p','GET','/api/impact/history?sym=AAPL&from=2026-11-01&to=2026-11-10'); assert.equal(r.status,200); assert.equal(r.j.from,'2026-11-01'); assert.equal(r.j.to,'2026-11-10');
    assert.equal((await req('p','GET','/api/impact/history?sym=../../etc')).status,400);
    // the board on past days is the asker's own too, whatever the request names
    r=await req('p','GET','/api/impact/past?from=2026-11-01&to=2026-11-18&uid='+U.o.id+'&sym=NVDA'); assert.equal(r.status,200); assert.equal(r.j.mode,'past'); assert.deepEqual(r.j.assets.map(a=>a.sym),['AAPL']); for(const bad of ['XOM','QQQ','opec'])assert.ok(!r.t.includes(bad),'the past names '+bad);
    assert.ok(r.j.events.every(e=>e.impacts.every(i=>i.sym==='AAPL')));
    // the admin: the world, the corrections with "edit", the log; a run by "system"
    assert.equal((await req('a','POST','/api/login',{email:'adm@x.co',password:'password1'})).status,200);
    r=await req('a','GET','/api/admin/impact'); assert.equal(r.status,200); assert.equal(r.j.mode,'world'); assert.ok(r.j.events.length>=6); assert.ok(r.j.diag.rel===null||typeof r.j.diag.rel==='object');
    r=await req('a','POST','/api/admin/impact/fix',{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'ok'}); assert.equal(r.status,200);
    r=await req('a','POST','/api/admin/impact/fix',{kind:'rel',k:'ev:taiwan-quake',sym:'NVDA',st:'ok'}); assert.equal(r.status,200);
    r=await req('a','POST','/api/admin/impact/fix',{kind:'nope'}); assert.equal(r.status,400);
    r=await req('a','GET','/api/admin/impact/audit'); assert.equal(r.status,200); assert.equal(r.j.items[0].action,'impact.rel');
    r=await req('a','POST','/api/admin/impact/run'); assert.equal(r.status,200); assert.equal(r.j.rel.ai,false,'no key: the analysis is said to be off, nothing is made up');
    r=await req('a','GET','/api/admin/impact/quality'); assert.equal(r.status,200); assert.match(r.j.note,/סמיכות בזמן אינה סיבתיות/);
    // the admin's own portfolio view is theirs (empty here), never the owner's
    r=await req('a','GET','/api/impact'); assert.equal(r.status,200); assert.equal(r.j.pf.n,0); assert.equal(r.j.events.length,0);
    // without the header a change is refused (the page's own calls only)
    assert.equal((await fetch(base+'/api/admin/impact/fix',{method:'POST',headers:{cookie:jar.a,'content-type':'application/json'},body:'{}'})).status,403);
  }finally{srv.close()}
});
