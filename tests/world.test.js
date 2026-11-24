// 24.11 TikChik WORLD, the world's news (server/worldnews.js): the gathering of the publishers' feeds, the choice of what
// is read, the securities of any exchange (a symbol is used only when it is known), the events of the whole world in a
// user's view, and what stays closed: an event known only from another person's securities. No network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {adminSchema} from '../server/admin/core.js';
import {newsId, cleanX, newsPrompt, _setSymNames} from '../server/newsx.js';
import {_setSectors, _setKinds, eventsOf} from '../server/pulse.js';
import {impactTask, impactForUser, impactWorld, buildEvents, srcTier, _setNames} from '../server/impact.js';
import {hqOf, marketPt} from '../server/impactgeo.js';
import {WORLD_FEEDS, WORLD_FEED_DOC, WORLD_DOC, WORLD_SYMS_DOC, worldGather, worldPick, worldVerify, worldTask, worldStatus, worldCap, sameCompany, ccOfSym, _resetWorldNames} from '../server/worldnews.js';

process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.ANTHROPIC_API_KEY=''; process.env.JOBS='0'; process.env.API_RPM='1000000';
const at=new Date('2026-11-18T15:00:00Z'), h=n=>new Date(at.getTime()-n*3600e3).toISOString();
const mk=()=>{const s=new Store(':memory:'); adminSchema(s); return s};
const rss=items=>`<?xml version="1.0" encoding="UTF-8"?><rss><channel>${items.map(i=>`<item><title><![CDATA[${i.t}]]></title><link>${i.l}</link><description>${i.d||''}</description><pubDate>${new Date(i.at||h(1)).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const res=(status,body)=>new Response(body,{status,headers:{'content-type':'application/rss+xml; charset=utf-8'}});
const FEEDS=[{id:'a',pub:'Nikkei Asia',cc:'JP',lang:'en',tier:'h',url:'https://feeds.test/a',all:false,http:false,reg:'as'},
  {id:'b',pub:'BBC',cc:'GB',lang:'en',tier:'h',url:'https://feeds.test/b',all:true,http:false,reg:'gl'},
  {id:'c',pub:'Bank of Japan',cc:'JP',lang:'en',tier:'p',url:'https://feeds.test/c',all:false,http:true,reg:'as'},
  {id:'d',pub:'Handelsblatt',cc:'DE',lang:'de',tier:'h',url:'https://feeds.test/d',all:false,http:false,reg:'eu'},
  {id:'e',pub:'The Guardian',cc:'GB',lang:'en',tier:'h',url:'https://feeds.test/e',all:false,http:false,reg:'eu'}];

test('the list of feeds: every one with a publisher, a country, a region of the map and an https address; no feed twice',()=>{
  assert.ok(WORLD_FEEDS.length>=50,'publishers of every continent'); const ids=new Set(), urls=new Set();
  for(const f of WORLD_FEEDS){assert.match(f.url,/^https:\/\//); assert.ok(f.pub&&/^[A-Z]{2}$/.test(f.cc)&&['p','h','m'].includes(f.tier),f.id); assert.ok(['na','sa','eu','me','af','as','oc','gl'].includes(f.reg),f.id+' has a region');
    assert.ok(!ids.has(f.id)&&!urls.has(f.url),f.id+' once'); ids.add(f.id); urls.add(f.url)}
  for(const r of ['na','sa','eu','me','af','as','oc'])assert.ok(WORLD_FEEDS.some(f=>f.reg===r),'a publisher in '+r);
  assert.equal(srcTier('Handelsblatt','news'),'high'); assert.equal(srcTier('Bank of Japan','news'),'high'); assert.equal(srcTier('Some Blog','news'),'mid');
});

test('the gathering: the feeds read as a feed reader does; a feed of all the news keeps the economy only; a refusal is asked again; a failure is said',async()=>{
  const s=mk(), asked=[];
  const f=async(u,o)=>{asked.push([u,o.headers.accept]);
    if(u.endsWith('/a'))return res(200,rss([{t:'Toyota raises profit forecast on weak yen',l:'https://asia.nikkei.com/toyota',d:'The carmaker lifted its outlook.'},{t:'An old one',l:'https://asia.nikkei.com/old',at:h(100)}]));
    if(u.endsWith('/b'))return res(200,rss([{t:'Team wins the cup final',l:'https://bbc.com/cup'},{t:'Oil jumps as strait is closed to shipping',l:'https://bbc.com/oil'}]));
    if(u.endsWith('/c'))return res(200,rss([{t:'Statement on Monetary Policy',l:'http://www.boj.or.jp/en/mopo/k261118.htm'}]));
    if(u.endsWith('/d'))return res(500,'');
    if(u.endsWith('/e'))return o.headers.accept==='*/*'?res(200,rss([{t:'UK inflation falls',l:'https://theguardian.com/infl'}])):res(403,'');
    return res(404,'')};
  const r=await worldGather(s,{fetch:f,now:at,feeds:FEEDS});
  assert.equal(r.ok,4); assert.equal(r.fail,1); assert.match(r.first,/^d: HTTP 500/);
  const D=s.getDoc(WORLD_FEED_DOC).data, T=D.items.map(a=>a.title).sort();
  assert.deepEqual(T,['Oil jumps as strait is closed to shipping','Statement on Monetary Policy','Toyota raises profit forecast on weak yen','UK inflation falls'],'no sports, nothing older than three days');
  const boj=D.items.find(a=>a.feed==='c'); assert.match(boj.link,/^https:\/\/www\.boj\.or\.jp/,'the link read as https'); assert.equal(boj.tier,'p'); assert.equal(boj.reg,'as');
  assert.equal(D.items.find(a=>a.feed==='a').sum,'The carmaker lifted its outlook.');
  assert.equal(asked.filter(([u])=>u.endsWith('/e')).length,2,'asked again the plain way after the refusal');
  assert.equal(D.feeds.d.ok,false); assert.equal(D.feeds.d.fails,1); assert.equal(D.feeds.a.ok,true);
  // within the hour nothing is asked again; an hour later the failing feed counts its failures, and a headline is not doubled
  asked.length=0; assert.equal((await worldGather(s,{fetch:f,now:new Date(at.getTime()+10*60e3),feeds:FEEDS})).due,0); assert.equal(asked.length,0);
  await worldGather(s,{fetch:f,now:new Date(at.getTime()+61*60e3),feeds:FEEDS}); const D2=s.getDoc(WORLD_FEED_DOC).data;
  assert.equal(D2.items.length,4); assert.equal(D2.feeds.d.fails,2);
  const st=worldStatus(s,{now:at}); assert.equal(st.headlines,4); assert.ok(Array.isArray(st.feeds)&&st.feeds.length===WORLD_FEEDS.length);
});

test('the choice: a story told by several publishers first, one headline of it (the best source\'s); region after region; what was read is not read again',()=>{
  const it=(id,title,pub,reg,tier,ago,lang='en')=>({id,title,pub,reg,tier,lang,at:h(ago),link:'https://x.test/'+id});
  const items=[it('1','Bank of Japan raises interest rates to 1 percent','Nikkei Asia','as','h',2),it('2','Bank of Japan raises interest rates to 1 percent in surprise','The Straits Times','as','h',1.5),
    it('3','Japan central bank raises interest rates to 1 percent','CNA','as','m',1),it('4','Local shop opens a second branch','Mint','as','m',20),
    it('5','Volkswagen to close two German plants','Handelsblatt','eu','h',3),it('6','Petrobras approves record dividend','Folha de S.Paulo','sa','h',4),it('7','Statement on Monetary Policy','Bank of Japan','as','p',2),
    it('8','A story from two days ago about earnings','CNBC','gl','h',50)];
  const P=worldPick(items,{now:at,n:4});
  assert.ok(['1','2'].includes(P[0].id),'the story of three publishers leads, by a leading publisher\'s headline'); assert.equal(P[0].pubs,3);
  assert.deepEqual(new Set(P.slice(0,3).map(p=>p.reg)),new Set(['as','eu','sa']),'a region each before a region twice');
  assert.equal(P.filter(p=>['1','2','3'].includes(p.id)).length,1,'one headline of a story'); assert.ok(!P.some(p=>p.id==='8'),'too old to be read now'); assert.ok(!P.some(p=>p.id==='4'),'a stale leftover is not worth a reading');
  assert.equal(P[3].id,'7','then the region\'s next: the primary source');
  const P2=worldPick(items,{now:at,n:4,read:new Set(['3'])}); assert.ok(!P2.some(p=>['1','2','3'].includes(p.id)),'the story was read through another headline');
});

test('the securities of any exchange: the symbol\'s country, the same company by its names, and a symbol used only when it is known',async()=>{
  assert.equal(ccOfSym('7203.T'),'JP'); assert.equal(ccOfSym('SAP.DE'),'DE'); assert.equal(ccOfSym('NOVO-B.CO'),'DK'); assert.equal(ccOfSym('BRK.B'),null,'a class of an American share'); assert.equal(ccOfSym('NVDA'),null);
  assert.ok(sameCompany('Toyota','Toyota Motor Corporation')); assert.ok(sameCompany('TSMC','Taiwan Semiconductor Manufacturing Company Limited')); assert.ok(sameCompany('BMW','Bayerische Motoren Werke AG'));
  assert.ok(sameCompany('LVMH','LVMH Moët Hennessy - Louis Vuitton, Société Européenne')); assert.ok(!sameCompany('Sony','Honda Motor Co., Ltd.')); assert.ok(!sameCompany('Global Holdings','International Group'),'general words are no name');
  assert.equal(hqOf('7203.T').name,'Toyota City'); assert.equal(hqOf('0005.HK').cc,'GB','HSBC sits in London, though it trades in Hong Kong'); assert.equal(marketPt('KR').how,'market'); assert.match(marketPt('PT').name,/פורטוגל/);
  _setSymNames({NVDA:'NVIDIA Corporation',TM:'Toyota Motor Corporation Common Stock',SONY:'Sony Group Corporation'});
  const s=mk(), asked=[], search=async q=>{asked.push(q); return q==='7203.T'?[{sym:'7203.T',name:'Toyota Motor Corporation',exch:'Tokyo Stock Exchange',type:'stock'}]:q==='6758.T'?[{sym:'6758.T',name:'Sony Group Corporation',exch:'Tokyo',type:'stock'}]:q==='BOOM.T'?(()=>{throw new Error('HTTP 429')})():[]};
  const A=[{sym:'7203.T',name:'Toyota'},{sym:'6758.T',name:'Honda'},{sym:'9999.T',name:'Nobody'},{sym:'NVDA',name:'Nvidia'},{sym:'TM',name:'Tesla'},{sym:'BOOM.T',name:'Boom'},{sym:'BAD SYM',name:'x'}];
  const V=await worldVerify(s,A,{search,now:at,pause:0});
  assert.deepEqual(V.verdict('7203.T','Toyota'),{ok:true,name:'Toyota Motor Corporation',exch:'Tokyo Stock Exchange'});
  assert.equal(V.verdict('6758.T','Honda').why,'name','the symbol is Sony\'s: not used for Honda'); assert.equal(V.verdict('9999.T','Nobody').why,'unknown');
  assert.equal(V.verdict('NVDA','Nvidia').ok,true); assert.equal(V.verdict('TM','Tesla').why,'name'); assert.equal(V.verdict('BOOM.T','Boom').why,'unverified','no answer is not a yes'); assert.equal(V.verdict('BAD SYM','x').ok,false);
  assert.deepEqual(asked,['7203.T','6758.T','9999.T','BOOM.T'],'the site\'s own list is not asked about');
  // kept: a month for a known symbol, three days for an unknown one; a failure is not kept at all
  asked.length=0; await worldVerify(s,A,{search,now:new Date(at.getTime()+2*864e5),pause:0}); assert.deepEqual(asked,['BOOM.T']);
  asked.length=0; await worldVerify(s,A,{search,now:new Date(at.getTime()+4*864e5),pause:0}); assert.deepEqual(asked,['9999.T','BOOM.T']);
  assert.equal(s.getDoc(WORLD_SYMS_DOC).data.syms['7203.T'].ok,true);
  _setSymNames(null);
});

test('the reader of the world\'s news: a company of any exchange with its name; the rest of the news is read as before',()=>{
  const p=newsPrompt([{title:'t',pub:'Nikkei Asia',cc:'JP'}],[],{world:true}); assert.match(p,/מכל בורסה בעולם/); assert.match(p,/7203\.T/); assert.match(p,/"source_country":"JP"/);
  const p0=newsPrompt([{title:'t',pub:'Reuters'}]); assert.doesNotMatch(p0,/מכל בורסה בעולם/); assert.match(p0,/סימול בבורסה האמריקאית/); assert.doesNotMatch(p0,/source_country/);
  const raw={he:'כותרת',what:'מה קרה',aff:[{sym:'7203.t',name:'Toyota Motor',as:'トヨタ',how:'direct'},{sym:'',name:'Huawei',how:'competitor'},{sym:'not a symbol',name:'X'},{sym:'NVDA',how:'supplier'}]};
  assert.deepEqual(cleanX(raw,{world:true}).aff.map(z=>[z.sym,z.name]),[['7203.T','Toyota Motor'],['','Huawei'],['NVDA','']]);
  assert.deepEqual(cleanX(raw).aff.map(z=>z.sym),['NVDA'],'the general news name American symbols only, as before');
});

// the world, read: a stand-in for the reader that answers by the headline
const ANS={'Toyota raises profit forecast on weak yen':{he:'טויוטה מעלה את תחזית הרווח',what:'טויוטה העלתה את תחזית הרווח השנתית.',type:'guidance',level:'imp',dir:'pos',cert:'fact',cat:'earnings',cc:['JP'],ev:'toyota-raises-forecast',
    aff:[{sym:'7203.T',name:'Toyota Motor',as:'Toyota',how:'direct',dir:'pos',why:'החברה שהכתבה עליה'},{sym:'6902.T',name:'Denso',as:'',how:'supplier',dir:'pos',why:'ספקית של טויוטה'},{sym:'9999.T',name:'Made Up Motors',as:'',how:'competitor',dir:'neg',why:'מתחרה'},{sym:'',name:'Huawei',as:'',how:'sector',dir:'unclear',why:'חברה פרטית'}],sectors:['Automotive'],regions:['japan']},
  'Volkswagen schließt zwei Werke':{he:'פולקסווגן סוגרת שני מפעלים',what:'פולקסווגן הודיעה על סגירת שני מפעלים בגרמניה.',type:'company',level:'crit',dir:'neg',cert:'fact',cat:'industry',cc:['DE'],ev:'vw-closes-plants',
    aff:[{sym:'VOW3.DE',name:'Volkswagen',as:'Volkswagen',how:'direct',dir:'neg',why:'החברה שהכתבה עליה'}],sectors:['Automotive'],regions:['europe']},
  'A small shop story':{he:'חנות קטנה',what:'סיפור מקומי.',type:'other',level:'info',dir:'unclear',cert:'fact',cat:'industry',cc:['BR'],ev:'small-shop',aff:[],sectors:[],regions:['latam']},
  'Nvidia hit as chip export curbs widen':{he:'הגבלות יצוא השבבים מתרחבות',what:'הוטלו הגבלות חדשות על יצוא שבבים.',type:'sanctions',level:'imp',dir:'neg',cert:'fact',cat:'trade',cc:['CN','US'],ev:'chip-export-curbs',
    aff:[{sym:'NVDA',name:'Nvidia',as:'Nvidia',how:'direct',dir:'neg',why:'ההגבלות חלות על השבבים שלה'}],sectors:['Semiconductors'],regions:['china']}};
const asker=async prompt=>{const A=JSON.parse(prompt.slice(prompt.lastIndexOf('ARTICLES:')+9)); return JSON.stringify(A.map(a=>({i:a.i,...(ANS[a.title]||{he:'x',what:'y',level:'info'})})))};
const search=async q=>q==='7203.T'?[{sym:'7203.T',name:'Toyota Motor Corporation',exch:'Tokyo Stock Exchange',type:'stock'}]:q==='6902.T'?[{sym:'6902.T',name:'DENSO Corporation',exch:'Tokyo Stock Exchange',type:'stock'}]:q==='VOW3.DE'?[{sym:'VOW3.DE',name:'Volkswagen AG',exch:'XETRA',type:'stock'}]:[];
const HEAD=[{id:'w1',title:'Toyota raises profit forecast on weak yen',pub:'Nikkei Asia',link:'https://asia.nikkei.com/toyota',at:h(2),feed:'nikkei',cc:'JP',reg:'as',lang:'en',tier:'h'},
  {id:'w2',title:'Volkswagen schließt zwei Werke',pub:'Handelsblatt',link:'https://handelsblatt.com/vw',at:h(3),feed:'handelsblatt',cc:'DE',reg:'eu',lang:'de',tier:'h'},
  {id:'w3',title:'A small shop story',pub:'Folha de S.Paulo',link:'https://folha.com/shop',at:h(1),feed:'folha',cc:'BR',reg:'sa',lang:'pt',tier:'h'},
  {id:'w4',title:'Nvidia hit as chip export curbs widen',pub:'South China Morning Post',link:'https://scmp.com/chips',at:h(4),feed:'scmp-biz',cc:'HK',reg:'as',lang:'en',tier:'h'}].map(a=>({...a,id:newsId(a.link)}));
function world(s){
  _setSectors({NVDA:'Technology',AAPL:'Technology'}); _setKinds({NVDA:'S',AAPL:'S'}); _setNames({NVDA:'NVIDIA',AAPL:'Apple'}); _setSymNames({NVDA:'NVIDIA Corporation',AAPL:'Apple Inc.'}); _resetWorldNames();
  const o=s.userByEmail('owner@example.com')||s.addUser({email:'owner@example.com',password:'owner-pass-123',role:'owner'}), f=s.addUser({email:'p@x.co',password:'password1',role:'friend'});
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:10}],cash:[]}); s.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'AAPL',qty:3}],cash:[]});
  s.setDoc('quotes/latest',{usdIls:3.7,prices:{NVDA:190,AAPL:270},prev:{NVDA:200,AAPL:268},meta:{NVDA:{date:'2026-11-18',at:at.getTime()},AAPL:{date:'2026-11-18',at:at.getTime()}}});
  // the owner's own security's article (nobody else's), and nothing in the general news
  const NV={title:'Nvidia unveils a new chip',link:'https://reuters.com/nv',pub:'Reuters',at:h(5),syms:['NVDA']};
  s.setDoc('research/news',{items:[NV]});
  s.setDoc('research/newsx',{gen:[],by:{[newsId(NV.link)]:{he:'אנבידיה מציגה שבב חדש',what:'אנבידיה הציגה שבב חדש.',type:'product',level:'imp',dir:'pos',cert:'fact',kind:'news',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:'החברה שהכתבה עליה',said:true}],sectors:[],themes:[],regions:['us'],fac:[],secx:[],macro:false,ev:'nvda-new-chip',st:'unknown',at:h(5)}}});
  s.setDoc(WORLD_FEED_DOC,{items:HEAD,feeds:{},updatedAt:at.toISOString()});
  return {o,f};
}
const noGather=async()=>({ok:0,fail:0,added:0});

test('the run: the day\'s cap spread over the day, the readings kept apart from the general news, the unknown symbol dropped and the company kept as a name',async()=>{
  const s=mk(); world(s);
  // no reader: nothing is read, nothing is invented
  let st=await worldTask(s,{now:at,gather:noGather,search,pause:0}); assert.equal(st.ai,false); assert.equal(st.read,0); assert.equal((s.getDoc(WORLD_DOC).data||{arts:[]}).arts.length,0);
  // a reader that refuses (a key that is not accepted) reads nothing and uses nothing of the day's cap
  st=await worldTask(s,{now:at,gather:noGather,ask:async()=>{throw new Error('HTTP 401')},search,pause:0}); assert.equal(st.read,0); assert.equal(st.usedNow,0,'nothing was read: nothing is counted'); assert.match(st.first,/no usable answer/);
  // the cap at 0 turns the reading off; a small cap is spread: by 15:00 UTC of a day of 8, five and a batch may have been read
  st=await worldTask(s,{now:at,gather:noGather,ask:asker,search,pause:0,dayCap:0}); assert.equal(st.read,0);
  st=await worldTask(s,{now:new Date('2026-11-18T00:10:00Z'),gather:noGather,ask:asker,search,pause:0,dayCap:2,perBatch:1,perRun:6}); assert.equal(st.read,2,'no more than the day\'s cap');
  assert.equal((await worldTask(s,{now:at,gather:noGather,ask:asker,search,pause:0,dayCap:2,perBatch:1})).read,0,'the cap was reached');
  st=await worldTask(s,{now:at,gather:noGather,ask:asker,search,pause:0,dayCap:300}); assert.equal(st.read,2); assert.equal(st.usedNow,4);
  const W=s.getDoc(WORLD_DOC).data; assert.equal(W.arts.length,4); assert.ok(W.arts.every(a=>a.src==='gen'&&a.world===true&&a.syms.length===0));
  const toy=W.by[newsId('https://asia.nikkei.com/toyota')];
  assert.deepEqual(toy.aff.map(z=>[z.sym,z.name,z.exch,z.said]),[['7203.T','Toyota Motor Corporation','Tokyo Stock Exchange',true],['6902.T','DENSO Corporation','Tokyo Stock Exchange',false]],'said: named in the headline, or not');
  assert.deepEqual(toy.cos.map(c=>[c.name,c.tried||null,c.dropped||null]),[['Made Up Motors','9999.T','unknown'],['Huawei',null,null]],'a symbol that is not known is never shown');
  assert.equal(st.dropped>=0,true); assert.equal(Object.keys(s.getDoc('research/newsx').data.by).length,1,'the general news\' document is not touched');
  // a second run reads nothing twice
  assert.equal((await worldTask(s,{now:new Date(at.getTime()+20*60e3),gather:noGather,ask:asker,search,pause:0})).read,0);
  // a symbol the price source could not be asked about is asked about again at the next run, and then takes its place
  {const s2=mk(); world(s2); let down=true; const flaky=async q=>{if(down)throw new Error('HTTP 429'); return search(q)};
    await worldTask(s2,{now:at,gather:noGather,ask:asker,search:flaky,pause:0}); const id=newsId('https://asia.nikkei.com/toyota');
    assert.deepEqual(s2.getDoc(WORLD_DOC).data.by[id].aff,[],'not checked: not shown'); assert.ok(s2.getDoc(WORLD_DOC).data.by[id].cos.some(c=>c.tried==='7203.T'&&c.dropped==='unverified'));
    down=false; const st2=await worldTask(s2,{now:new Date(at.getTime()+20*60e3),gather:noGather,ask:asker,search:flaky,pause:0}); assert.ok(st2.fixed>=2,JSON.stringify(st2));
    const x=s2.getDoc(WORLD_DOC).data.by[id]; assert.deepEqual(x.aff.map(z=>z.sym).sort(),['6902.T','7203.T']); assert.deepEqual(x.cos.map(c=>[c.name,c.dropped||null]),[['Huawei',null],['Made Up Motors','unknown']])}
  assert.equal(worldCap(),300); process.env.WORLD_READ_DAY_CAP='40'; assert.equal(worldCap(),40); process.env.WORLD_READ_DAY_CAP='0'; assert.equal(worldCap(),0); delete process.env.WORLD_READ_DAY_CAP;
  process.env.WORLD_NEWS='0'; assert.deepEqual(await worldTask(s,{now:at,ask:asker}),{off:true}); delete process.env.WORLD_NEWS;
});

test('the events of the whole world: in the map\'s world view with the company where it sits; the portfolio\'s view and the alerts as before; nobody else\'s securities',async()=>{
  const s=mk(), {o,f}=world(s);
  await worldTask(s,{now:new Date('2026-11-18T23:30:00Z'),gather:noGather,ask:asker,search,pause:0}); impactTask(s,{now:at});
  // the alerts' events: the securities' and the market's only
  assert.deepEqual(eventsOf(s,{now:at,days:7}).map(e=>e.k),['ev:nvda-new-chip']);
  // the registry: the world's important events join (not the small story)
  const K=e=>e.k, top=buildEvents(s,{now:at}).events.map(K).sort(), all=buildEvents(s,{now:at,world:'all'}).events.map(K).sort();
  assert.deepEqual(top,['ev:chip-export-curbs','ev:nvda-new-chip','ev:toyota-raises-forecast','ev:vw-closes-plants']); assert.ok(all.includes('ev:small-shop')); assert.equal(buildEvents(s,{now:at,world:false}).events.length,1);
  // the owner (NVDA): the portfolio's view shows what reaches NVDA; the world's view shows the whole world
  const me=impactForUser(s,o,{now:at}), wd=impactForUser(s,o,{now:at,scope:'world'});
  assert.equal(me.scope,'me'); assert.deepEqual(me.events.map(K).sort(),['ev:chip-export-curbs','ev:nvda-new-chip'],'a world event that names the holding reaches the portfolio\'s view');
  assert.equal(wd.scope,'world'); assert.deepEqual(wd.events.map(K).sort(),['ev:chip-export-curbs','ev:nvda-new-chip','ev:toyota-raises-forecast','ev:vw-closes-plants'],'not the small story: not worth watching');
  assert.equal(wd.events[0].k,'ev:vw-closes-plants','by the event\'s own level'); assert.equal(wd.nMine,2);
  const toy=wd.events.find(e=>e.k==='ev:toyota-raises-forecast');
  assert.equal(toy.mine,false); assert.equal(toy.world,true); assert.deepEqual(toy.impacts,[]); assert.equal(toy.loc.name,'Toyota City'); assert.equal(toy.loc.how,'hq');
  assert.deepEqual(toy.said.map(z=>[z.sym,z.name,z.xcc,z.exch]),[['7203.T','Toyota Motor Corporation','JP','Tokyo Stock Exchange']]);
  assert.deepEqual(toy.found.map(z=>[z.sym,z.xcc,z.by]),[['6902.T','JP','reading']]); assert.deepEqual(toy.others.map(c=>c.name),['Made Up Motors','Huawei']);
  assert.equal(wd.nodes['co:7203.T'].loc.name,'Toyota City'); assert.equal(wd.nodes['co:6902.T'].loc.how,'market','no known headquarters: at its exchange, said to be'); assert.match(wd.nodes['co:6902.T'].loc.name,/טוקיו/);
  const vw=wd.events.find(e=>e.k==='ev:vw-closes-plants'); assert.equal(vw.loc.name,'Wolfsburg'); assert.equal(vw.src[0].tier,'high');
  const chip=wd.events.find(e=>e.k==='ev:chip-export-curbs'); assert.equal(chip.mine,true); assert.equal(chip.impacts[0].sym,'NVDA'); assert.equal(chip.impacts[0].rel,'direct');
  assert.match(wd.notes[1],/מכל העולם/); assert.match(me.notes[1],/רק אירוע שנמצא לו קשר/); assert.equal(wd.world.read,4);
  // the partner (AAPL only): the world's public events, and never the owner's own security's article
  const pw=impactForUser(s,f,{now:at,scope:'world'}), pm=impactForUser(s,f,{now:at});
  assert.deepEqual(pw.events.map(K).sort(),['ev:chip-export-curbs','ev:toyota-raises-forecast','ev:vw-closes-plants']); assert.ok(!JSON.stringify(pw).includes('nvda-new-chip'),'known only from the owner\'s security');
  assert.equal(pw.events.find(e=>e.k==='ev:chip-export-curbs').mine,false); assert.deepEqual(pm.events,[]); assert.equal(pw.assets.length,1); assert.equal(pw.assets[0].sym,'AAPL');
  // the management's world: the world's status beside the registry
  const adm=impactWorld(s,{now:at}); assert.equal(adm.world.read,4); assert.ok(adm.events.some(e=>e.k==='ev:vw-closes-plants'&&e.world));
  _setSymNames(null);
});

test('the API: the scope is asked for, the visibility is the session\'s; a partner\'s world view carries nothing of the owner\'s',async()=>{
  const {createApp,bootstrap}=await import('../server/index.js');
  const store=new Store(':memory:'); bootstrap(store); world(store);
  // the fixture's hours are of 18.11: the headlines and the article are moved to now (the server's own clock decides the week)
  const shift=iso=>new Date(Date.now()-(at.getTime()-Date.parse(iso))).toISOString();
  {const F=store.getDoc(WORLD_FEED_DOC).data; for(const a of F.items)a.at=shift(a.at); store.setDoc(WORLD_FEED_DOC,F); const N=store.getDoc('research/news').data; for(const a of N.items)a.at=shift(a.at); store.setDoc('research/news',N)}
  const st=await worldTask(store,{gather:noGather,ask:asker,search,pause:0,dayCap:2000,perRun:12}); assert.equal(st.read,4);
  impactTask(store);
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false});
  const srv=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x))}), base='http://127.0.0.1:'+srv.address().port, jar={};
  const req=async(who,method,url,body)=>{const r=await fetch(base+url,{method,redirect:'manual',headers:{...(jar[who]?{cookie:jar[who]}:{}),'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const sc=r.headers.getSetCookie?r.headers.getSetCookie():[]; if(sc.length)jar[who]=sc.map(c=>c.split(';')[0]).join('; '); let j=null; try{j=await r.json()}catch(e){} return {status:r.status,j}};
  try{
    assert.equal((await req('x','GET','/api/impact?scope=world')).status,401,'signed out: nothing');
    await req('p','POST','/api/login',{email:'p@x.co',password:'password1'}); await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    const pw=(await req('p','GET','/api/impact?scope=world')).j; assert.equal(pw.scope,'world'); assert.ok(pw.events.length>=3); assert.ok(pw.events.some(e=>e.k==='ev:toyota-raises-forecast'));
    assert.ok(!JSON.stringify(pw).includes('nvda-new-chip')); assert.deepEqual(pw.assets.map(a=>a.sym),['AAPL']);
    await new Promise(r=>setTimeout(r,1600));
    const ow=(await req('o','GET','/api/impact?scope=world')).j; assert.ok(ow.events.some(e=>e.k==='ev:nvda-new-chip'),'the owner\'s own');
    await new Promise(r=>setTimeout(r,1600));
    const pm=(await req('p','GET','/api/impact?scope=anything')).j; assert.equal(pm.scope,'me','any other word is the portfolio\'s view');
    // the world's documents are not handed out by the documents' API to a partner
    for(const p of ['research/worldx','research/worldfeed','research/worldsyms'])assert.notEqual((await req('p','GET','/api/db/doc?path='+encodeURIComponent(p))).status,200,p);
  }finally{await new Promise(r=>srv.close(r)); _setSymNames(null)}
});
