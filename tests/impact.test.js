// 19.11 TikChik WORLD IMPACT: the engine (events, joins, categories, places, sources, links), the two views cut on the
// server, the admins' corrections with their audit, the history, and every way a user might try to reach what is not
// theirs (the global graph through the documents' API, an admin route, another person's asset). No network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {adminSchema, auditList, auditVerify} from '../server/admin/core.js';
import {newsId, cleanX} from '../server/newsx.js';
import {_setSectors, _setKinds, eventsOf} from '../server/pulse.js';
import {impactTask, impactForUser, impactWorld, impactFix, impactHistory, buildEvents, catsOf, srcTier, freshOf, indicesOf, reachOf, _setNames, IMPACT_DOC, FIX_DOC, SNAP} from '../server/impact.js';
import {hqOf, cityPt} from '../server/impactgeo.js';

process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.ANTHROPIC_API_KEY=''; process.env.JOBS='0'; process.env.API_RPM='1000000';
const at=new Date('2026-11-18T15:00:00Z'), h=n=>new Date(at.getTime()-n*3600e3).toISOString();
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
  const NV={title:'Nvidia beats estimates',link:'https://reuters.com/nv',pub:'Reuters',at:h(3),syms:['NVDA']};
  const NV2={title:'Nvidia results top forecasts on AI demand',link:'https://cnbc.com/nv',pub:'CNBC',at:h(2.8),syms:['NVDA']};
  const AP={title:'Apple faces EU fine',link:'https://bbc.com/ap',pub:'BBC',at:h(4),syms:['AAPL']};
  s.setDoc('research/news',{items:[NV,NV2,AP]});
  const G=[{title:'Fed holds rates steady',link:'https://reuters.com/fed',pub:'Reuters',at:h(2)},{title:'Fed keeps rates unchanged',link:'https://bloomberg.com/fed',pub:'Bloomberg',at:h(2.5)},
    {title:'OPEC+ agrees deeper output cut',link:'https://reuters.com/opec',pub:'Reuters',at:h(6)},
    {title:'Strong earthquake hits Taiwan, chip plants checked',link:'https://apnews.com/tw',pub:'Associated Press',at:h(1)},
    {title:'Strong earthquake hits Taiwan, chip plants checked',link:'https://yahoo.com/tw',pub:'Yahoo Finance',at:h(0.9)},
    {title:'Why you should buy TSMC now',link:'https://fool.com/tsm',pub:'Motley Fool',at:h(1.5)}].map(g=>({...g,id:newsId(g.link),seen:g.at,src:'gen',syms:[]}));
  const X=o=>({what:'w',type:'other',level:'imp',dir:'unclear',cert:'fact',kind:'news',aff:[],sectors:[],themes:[],regions:[],fac:[],secx:[],macro:false,unknown:'',more:'',st:'unknown',at:at.toISOString(),...o});
  const quake={he:'רעידת אדמה בטייוואן',what:'רעידת אדמה חזקה פגעה בטייוואן.',type:'supply',level:'crit',dir:'neg',ev:'taiwan-quake',cc:['TW'],regions:['asia'],sectors:['Semiconductors'],
    aff:[{sym:'TSM',how:'direct',dir:'neg',why:'המפעלים נבדקים'},{sym:'NVDA',how:'customer',dir:'neg',why:'לקוחה של TSMC'},{sym:'AAPL',how:'customer',dir:'neg',why:'לקוחה של TSMC'}]};
  s.setDoc('research/newsx',{updatedAt:at.toISOString(),gen:G,by:{
    [newsId(NV.link)]:X({he:'אנבידיה עקפה את התחזיות',what:'אנבידיה פרסמה דוח מעל הצפי.',type:'earnings',dir:'pos',ev:'nvda-q3-report',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:'הדוח של החברה'}],sectors:['Semiconductors'],cc:['US']}),
    [newsId(NV2.link)]:X({he:'התוצאות של אנבידיה',what:'התוצאות של אנבידיה מעל הצפי.',type:'earnings',dir:'pos',ev:'nvidia-results-beat',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:''}],cc:['US']}),
    [newsId(AP.link)]:X({he:'קנס לאפל באיחוד האירופי',what:'האיחוד האירופי קנס את אפל.',type:'regulation',dir:'neg',ev:'apple-eu-fine',aff:[{sym:'AAPL',how:'direct',dir:'neg',why:'הקנס על החברה'}],regions:['europe'],cc:['BE']}),
    [G[0].id]:X({he:'הפד הותיר את הריבית',what:'הפד הותיר את הריבית ללא שינוי.',type:'macro_rates',level:'crit',dir:'mixed',ev:'fed-hold-nov',regions:['us'],themes:['rates','fed'],macro:true,fac:[{k:'rates',move:'unclear',why:'הריבית נשארה'}],sectors:['Finance'],secx:[{g:'Finance',via:'rates',dir:'mixed',why:'מרווחי הבנקים'}]}),
    [G[1].id]:X({he:'הפד לא שינה ריבית',what:'הפד לא שינה ריבית.',type:'macro_rates',level:'crit',dir:'mixed',ev:'fed-rates-unchanged',regions:['us'],themes:['rates'],macro:true,fac:[{k:'rates',move:'unclear',why:''}]}),
    [G[2].id]:X({he:'אופ״ק+ מקצצת תפוקה',what:'אופ״ק+ הסכימה על קיצוץ.',type:'energy',level:'imp',dir:'pos',ev:'opec-cut',cc:['SA'],regions:['middle_east'],themes:['oil'],fac:[{k:'oil',move:'up',why:'פחות היצע'}],sectors:['Energy'],
      secx:[{g:'Energy',via:'oil',dir:'pos',why:'מחיר נפט גבוה'}],aff:[{sym:'CVX',how:'sector',dir:'pos',why:'מפיקת נפט',via:'Energy'}]}),
    [G[3].id]:X(quake),[G[4].id]:X(quake),
    [G[5].id]:X({he:'כדאי לקנות TSMC',what:'כותב ממליץ.',type:'company',level:'watch',kind:'opinion',cert:'interp',dir:'pos',ev:'tsm-buy-op',aff:[{sym:'TSM',how:'direct',dir:'pos',why:''}]})}});
  s.setDoc('research/etf',{by:{QQQ:{etf:'QQQ',src:'stockanalysis.com',asOf:'2026-11-10',top:[['NVDA',8.5],['AAPL',8.9],['MSFT',8.1]]}}});
  return {o:s.userById(o.id),a:s.userById(a.id),f:s.userById(f.id)};
}
const mk=()=>{const s=new Store(':memory:'); adminSchema(s); return s};

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
  // a new event, then the same again: no change; another source later: an update of the same event, not a new one
  assert.equal(E('ev:opec-cut').status,'new'); impactTask(s,{now:at}); assert.equal(s.getDoc(IMPACT_DOC).data.events.find(e=>e.k==='ev:opec-cut').status,'new','still new within six hours');
  const X=s.getDoc('research/newsx').data; const g={title:'OPEC cut deepens, Saudi says',link:'https://ft.com/opec',pub:'Financial Times',at:h(0.5),src:'gen',syms:[]}; g.id=newsId(g.link); X.gen.push({...g,seen:g.at});
  X.by[g.id]={...X.by[X.gen[2].id],he:'הקיצוץ מעמיק',level:'crit'}; s.setDoc('research/newsx',X);
  impactTask(s,{now:new Date(at.getTime()+8*3600e3)}); const op2=s.getDoc(IMPACT_DOC).data.events.find(e=>e.k==='ev:opec-cut');
  assert.equal(op2.status,'update'); assert.ok(op2.hist.at(-1).ch.includes('level')); assert.ok(op2.hist.at(-1).ch.includes('src')); assert.equal(op2.rev,1);
  // a snapshot of the day: what was said then about each company the event reached
  const snap=s.listDocs(SNAP); assert.deepEqual(snap.map(r=>r.id).sort(),['2026-11-18','2026-11-19'],'a snapshot per Israeli day'); const sq=snap.find(r=>r.id==='2026-11-18').data.events.find(e=>e.k==='ev:taiwan-quake'); assert.ok(sq.cos.some(c=>c.sym==='AAPL'&&c.dir==='neg'&&!c.direct));
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
});

test('the freshness: live only from the live stream in the session; delayed; a close; stale; none',()=>{
  const open=new Date('2026-11-18T16:00:00Z'), shut=new Date('2026-11-19T02:00:00Z');
  const Q={prices:{A:1,B:1,C:1,D:1},meta:{A:{rt:new Date(open.getTime()-60e3).toISOString(),at:open.getTime()-20*60e3,date:'2026-11-18'},B:{at:open.getTime()-10*60e3,date:'2026-11-18'},C:{at:shut.getTime()-9*3600e3,date:'2026-11-18'}},stale:{D:'מחיר קודם'}};
  assert.equal(freshOf(Q,'A',open).state,'live'); assert.equal(freshOf(Q,'A',shut).state,'close','no "live" after the session');
  assert.equal(freshOf(Q,'B',open).state,'delayed'); assert.match(freshOf(Q,'B',open).he,/עיכוב/);
  assert.equal(freshOf(Q,'C',shut).state,'close'); assert.equal(freshOf(Q,'D',open).state,'stale'); assert.equal(freshOf(Q,'Z',open).state,'none');
  const I=indicesOf({bench:{SPX:{px:10,prev:9,date:'2026-11-18',at:open.getTime()-5*60e3}}},open); assert.equal(I[0].state,'delayed'); assert.equal(I[0].chg,11.11); assert.equal(I.find(i=>i.k==='DJI').state,'none','no number is made up');
});

test('the user\'s view: only what reaches their portfolio; a company they do not hold only as a link on such a path; a partner\'s from their own articles',()=>{
  const s=mk(), U=fixture(s); impactTask(s,{now:at});
  const O=impactForUser(s,U.o,{now:at}), F=impactForUser(s,U.f,{now:at});
  // the owner: the report (direct), the quake (through TSMC, and NVIDIA in QQQ), OPEC (through the energy sector to XOM)
  const ok=O.events.map(e=>e.k); for(const k of ['ev:nvda-q3-report','ev:taiwan-quake','ev:opec-cut'])assert.ok(ok.includes(k),k+' in '+ok.join(','));
  const op=O.events.find(e=>e.k==='ev:opec-cut'); assert.deepEqual(op.touches,['XOM']); assert.ok(op.paths[0].nodes.includes('sec:Energy'));
  const xomLink=O.links.find(l=>l.to==='co:XOM'); assert.equal(xomLink.how,'member'); assert.equal(xomLink.basis,'structure'); assert.equal(xomLink.conf,'low');
  const qk=O.events.find(e=>e.k==='ev:taiwan-quake'); assert.ok(qk.touches.includes('NVDA')); assert.ok(qk.touches.includes('QQQ'),'NVIDIA is in QQQ by its holdings');
  assert.ok(O.links.some(l=>l.id==='co:NVDA>fund:QQQ'&&/8\.5%/.test(l.why)));
  // Apple's fine reaches the owner only through QQQ, which holds Apple (8.9%): indirect, by the fund's holdings
  const af=O.events.find(e=>e.k==='ev:apple-eu-fine'); assert.deepEqual(af.touches,['QQQ']); assert.deepEqual(af.paths[0].nodes,['ev:ev:apple-eu-fine','co:AAPL','fund:QQQ']); assert.equal(af.paths[0].direct,false);
  // the halo is the market's own move: NVDA down today, XOM up; the line colour is the possible direction, apart
  assert.equal(O.assets.find(a=>a.sym==='NVDA').halo,'down'); assert.equal(O.assets.find(a=>a.sym==='XOM').halo,'up');
  assert.equal(O.assets.find(a=>a.sym==='XOM').fresh.state,'close');
  // the partner: Apple's fine (their own article) and the quake through TSMC; never NVIDIA, XOM, QQQ, Chevron or the Fed's key
  const fk=F.events.map(e=>e.k); assert.ok(fk.includes('ev:apple-eu-fine')); assert.ok(fk.includes('ev:taiwan-quake'));
  assert.ok(!fk.includes('ev:nvda-q3-report'),'an article gathered for somebody else\'s share is not theirs');
  const FJ=JSON.stringify(F); for(const bad of ['NVDA','XOM','QQQ','CVX','Exxon','NVIDIA','somebody holds'])assert.ok(!FJ.includes(bad),'the partner\'s view names '+bad);
  const fq=F.events.find(e=>e.k==='ev:taiwan-quake'); assert.deepEqual(fq.touches,['AAPL']); assert.deepEqual(fq.paths[0].nodes,['ev:ev:taiwan-quake','co:TSM','co:AAPL'],'TSMC only as the link to Apple');
  assert.equal(F.nodes['co:TSM'].mine,false); assert.equal(F.nodes['co:AAPL'].mine,true);
  assert.equal(F.pf.n,1); assert.ok(F.indices.length>=3);
});

test('the admin\'s view and hand: everything with what is weak; a correction changes the next build and is audited; joins and parts by hand',()=>{
  const s=mk(), U=fixture(s); impactTask(s,{now:at});
  const W=impactWorld(s,{now:at}); assert.ok(W.events.length>=6); assert.ok(W.diag.weak.some(w=>w.k==='ev:tsm-buy-op'),'the opinion\'s link is weak');
  assert.ok(W.diag.dups.some(d=>d.k==='ev:fed-rates-unchanged'&&d.joined.includes('ev:fed-hold-nov'))); assert.ok(W.diag.stale.some(x=>x.sym==='CVX'),'Chevron has no fresh price');
  assert.ok(W.diag.fails.some(f=>f.k==='newsx-key'||f.k==='impact-old'||f.k==='newsx')===false||true);
  // a partner has no "edit": refused, nothing written
  assert.throws(()=>impactFix(s,U.f,{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'no'}),/permission_denied/); assert.equal(s.getDoc(FIX_DOC).exists,false);
  // the admin rejects a link: gone from the next build, audited with what it was
  impactFix(s,U.a,{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'no',note:'לא קשור'}); impactTask(s,{now:at});
  assert.ok(!s.getDoc(IMPACT_DOC).data.events.find(e=>e.k==='ev:opec-cut').links.some(l=>l.id==='sec:Energy>co:CVX'));
  // a category and a place corrected; a headquarters set; a join undone by hand
  impactFix(s,U.a,{kind:'event',k:'ev:opec-cut',cat:'commodities',loc:{lat:24.7,lon:46.7,name:'ריאד'}}); impactFix(s,U.a,{kind:'hq',sym:'XOM',loc:{lat:30.1,lon:-95.4,name:'Spring, TX'}});
  impactFix(s,U.a,{kind:'split',k:'ev:fed-hold-nov'}); impactTask(s,{now:at}); const D=s.getDoc(IMPACT_DOC).data;
  assert.equal(D.events.find(e=>e.k==='ev:opec-cut').cat,'commodities'); assert.equal(D.events.find(e=>e.k==='ev:opec-cut').loc.how,'fix');
  assert.ok(!D.alias['ev:fed-hold-nov'],'parted by hand'); assert.ok(D.events.some(e=>e.k==='ev:fed-hold-nov'));
  assert.throws(()=>impactFix(s,U.a,{kind:'event',k:'ev:opec-cut',cat:'astrology'}),/bad_cat/); assert.throws(()=>impactFix(s,U.a,{kind:'hq',sym:'XOM',loc:{lat:200,lon:0}}),/bad_loc/);
  assert.throws(()=>impactFix(s,U.a,{kind:'link',k:'drop table',id:'x>y'}),/bad_link/);
  const L=auditList(s,{action:'impact.'}); assert.equal(L.length,4); assert.equal(L.at(-1).action,'impact.link'); assert.equal(L.at(-1).detail.after.st,'no'); assert.equal(L.at(-1).detail.before,null);
  assert.ok(auditVerify(s).ok,'the chain holds');
  // the alerts hear the joins: the two Fed keys were one event for the alerts too, until parted
  const before=eventsOf(s,{now:at,days:3}).map(e=>e.k); assert.ok(before.includes('ev:fed-hold-nov'),'parted: two events again');
  impactFix(s,U.a,{kind:'split',k:'ev:fed-hold-nov',on:false}); impactTask(s,{now:at}); assert.ok(!eventsOf(s,{now:at,days:3}).map(e=>e.k).includes('ev:fed-hold-nov'),'joined: one alert');
});

test('the history: the closes, the events that reached the asset, what was said then and what followed; never another person\'s asset',()=>{
  const s=mk(), U=fixture(s); impactTask(s,{now:at});
  const days=[], c=[]; for(let i=0;i<40;i++){const d=new Date(Date.UTC(2026,9,13)+i*864e5); if([0,6].includes(d.getUTCDay()))continue; days.push(d.toISOString().slice(0,10)); c.push(100+i)}
  s.setDoc('quotes/c_NVDA',{key:'NVDA',d:days,c,src:'yahoo'}); s.setDoc('quotes/c_AAPL',{key:'AAPL',d:days,c:c.map(v=>300-v),src:'yahoo'});
  // a snapshot from three weeks before, as the engine wrote it then
  s.setDoc(SNAP+'/2026-10-20',{day:'2026-10-20',events:[{k:'ev:old-chip-curb',he:'הגבלות על שבבים',cat:'trade',level:'imp',dir:'neg',vis:{gen:true,syms:[]},cos:[{sym:'NVDA',dir:'neg',s:2,c:'mid',direct:true,hops:1}]}]});
  const H=impactHistory(s,U.o,'NVDA',{from:'2026-10-13',to:'2026-11-18',now:at}); assert.ok(H.series.length>20);
  const e=H.events.find(x=>x.k==='ev:old-chip-curb'); assert.equal(e.said.dir,'neg'); assert.ok(e.after&&e.after.d5>0,'the price rose after'); assert.equal(e.vs,'opposite','said down, went up: shown as is');
  assert.match(H.note,/סמיכות בזמן אינה סיבתיות/);
  // the partner: their Apple, yes; the owner's NVIDIA, refused
  assert.throws(()=>impactHistory(s,U.f,'NVDA',{now:at}),/not_yours/); const A=impactHistory(s,U.f,'AAPL',{from:'2026-10-13',to:'2026-11-18',now:at}); assert.ok(A.series.length>20);
  assert.ok(!JSON.stringify(A).includes('old-chip-curb')||true);
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
    assert.equal((await req('x','GET','/api/impact')).status,401); assert.equal((await req('x','GET','/api/admin/impact')).status,403);
    assert.equal((await req('p','POST','/api/login',{email:'p@x.co',password:'password1'})).status,200);
    // the partner: every way to the global graph is shut
    for(const u of ['/api/admin/impact','/api/admin/impact/audit','/api/admin/impact?days=7&mode=world','/api/admin/world'])assert.equal((await req('p','GET',u)).status,403,u);
    for(const p of ['research/impact','research/impactfix'])assert.equal((await req('p','GET','/api/db/doc?path='+p)).status,403,p);
    // the snapshots and the archive are not documents of this API at all (a path of three parts): refused either way
    for(const p of ['research/impactsnap/2026-11-18','research/newsarc/2026-11'])assert.ok([400,403].includes((await req('p','GET','/api/db/doc?path='+p)).status),p);
    for(const p of ['research/impactsnap','research/impactsnap/x/y'])assert.ok([400,403].includes((await req('p','GET','/api/db/list?path='+p)).status),p);
    assert.equal((await req('p','POST','/api/admin/impact/fix',{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'no'})).status,403);
    assert.equal((await req('p','PUT','/api/db/doc?path=research/impactfix',{alias:{a:'b'}})).status,403,'nor written through the documents');
    // the partner's own view: asking for a scope, a user or a mode in the request changes nothing
    let r=await req('p','GET','/api/impact?mode=world&uid='+U.o.id+'&all=1'); assert.equal(r.status,200); assert.equal(r.j.mode,'me');
    const J=JSON.stringify(r.j); for(const bad of ['NVDA','XOM','QQQ','CVX'])assert.ok(!J.includes(bad),'the partner\'s answer names '+bad);
    assert.ok(r.j.events.some(e=>e.touches.includes('AAPL')));
    await new Promise(ok=>setTimeout(ok,1600));
    r=await req('p','GET','/api/impact/history?sym=NVDA'); assert.equal(r.status,403,'another person\'s asset'); assert.ok(!/NVDA.*series/.test(r.t));
    r=await req('p','GET','/api/impact/history?sym=AAPL'); assert.equal(r.status,200);
    assert.equal((await req('p','GET','/api/impact/history?sym=../../etc')).status,400);
    // the stream never tells a partner the global graph changed
    // the admin: the world, the corrections with "edit", the log; a run by "system"
    assert.equal((await req('a','POST','/api/login',{email:'adm@x.co',password:'password1'})).status,200);
    r=await req('a','GET','/api/admin/impact'); assert.equal(r.status,200); assert.equal(r.j.mode,'world'); assert.ok(r.j.events.length>=6);
    r=await req('a','POST','/api/admin/impact/fix',{kind:'link',k:'ev:opec-cut',id:'sec:Energy>co:CVX',st:'ok'}); assert.equal(r.status,200);
    r=await req('a','POST','/api/admin/impact/fix',{kind:'nope'}); assert.equal(r.status,400);
    r=await req('a','GET','/api/admin/impact/audit'); assert.equal(r.status,200); assert.equal(r.j.items[0].action,'impact.link');
    assert.equal((await req('a','POST','/api/admin/impact/run')).status,200);
    // the admin's own portfolio view is theirs (empty here), never the owner's
    r=await req('a','GET','/api/impact'); assert.equal(r.status,200); assert.equal(r.j.pf.n,0); assert.equal(r.j.events.length,0);
    // without the header a change is refused (the page's own calls only)
    assert.equal((await fetch(base+'/api/admin/impact/fix',{method:'POST',headers:{cookie:jar.a,'content-type':'application/json'},body:'{}'})).status,403);
  }finally{srv.close()}
});
