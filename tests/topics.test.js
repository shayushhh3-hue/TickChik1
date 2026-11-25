// 25.11 the owner's order for the news model: a stand on the direction of every relation; a report of a price move only is
// never an event; and the news of what a company does (server/topicnews.js), gathered by phrases written from its own
// facts, listed under the security alone, and decided by the engine like any other article. No network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {adminSchema} from '../server/admin/core.js';
import {newsId, cleanX, newsPrompt, ruleRead, kindOf, moveHead, KINDS} from '../server/newsx.js';
import {eventsOf, _setSectors, _setKinds} from '../server/pulse.js';
import {relPrompt, cardOf} from '../server/impactrel.js';
import {access} from '../server/store.js';
import {newsTask} from '../server/newsfeed.js';
import {TOPIC_DOC, cleanTopics, ruleTopics, topicsPrompt, topicsTask, topicPick, topicNewsTask, topicCap} from '../server/topicnews.js';

process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.ANTHROPIC_API_KEY=''; process.env.JOBS='0'; process.env.FINNHUB_API_KEY='';
const at=new Date('2026-11-18T15:00:00Z'), h=n=>new Date(at.getTime()-n*3600e3).toISOString();
const mk=()=>{const s=new Store(':memory:'); adminSchema(s); return s};

test('a stand on the direction: the reader and the engine are told to choose a side whenever there is a path, and never to invent one',()=>{
  const p=newsPrompt([{title:'t',pub:'Reuters'}]);
  assert.match(p,/נקוט עמדה/); assert.match(p,/unclear רק כשבאמת אין בסיס להשערה/); assert.match(p,/אל תמציא אירוע או מסלול/); assert.match(p,/הכיוון \(dir\) אינו תחזית מחיר/);
  const s=mk(); _setSectors({RKLB:'Industrials'}); _setKinds({RKLB:'S'});
  s.setDoc('research/s_RKLB',{name:'Rocket Lab',prof:{desc:'Rocket Lab USA, Inc. provides launch services and space systems solutions for the space and defense industries.',industry:'Aerospace & Defense',sector:'Industrials',country:'US'}});
  const c=cardOf(s,'RKLB'), e={k:'ev:x',he:'כותרת',title:'t',what:'w',kind:'news',cert:'fact',cat:'regulation',level:'imp',cc:['US'],facs:[],secs:[],named:[],nodes:[]};
  const r=relPrompt([{e,pairs:[{c}]}]);
  assert.match(r,/נקוט עמדה: כשקבעת שיש קשר/); assert.match(r,/מה שטוב ללקוחה יכול להיות רע לספקית או למתחרה/); assert.match(r,/בלי מסלול עסקי מסוים התשובה none, לא עמדה/,'a stand never replaces the rule about a real path');
});

test('a report of a price move only: named so by the reader or by the rules, information only, never an event',()=>{
  assert.ok(KINDS.includes('move')); assert.match(newsPrompt([{title:'t'}]),/move = דיווח על תנועת מחיר בלבד/);
  for(const t of ['Stock market today: Dow closes lower as health shares slide','Why Nvidia stock is down today','Health care stocks close lower','Premarket movers: Tesla, Apple','Wall Street ends higher'])assert.ok(moveHead(t),t);
  for(const t of ['Why Nvidia stock is down today after earnings miss','Nvidia unveils new chip','FDA approval lifts drugmaker','Stocks close lower after Fed rate decision'])assert.ok(!moveHead(t),'an event behind the move: '+t);
  assert.equal(kindOf({title:'Health care stocks close lower'}),'move'); const rr=ruleRead({title:'Why Nvidia stock is down today',syms:['NVDA']}); assert.equal(rr.kind,'move'); assert.equal(rr.level,'info');
  // the reader's answer: whatever level and companies it gave, a price move is information and touches nobody
  const x=cleanX({he:'מניות הבריאות ירדו',what:'מניות הבריאות ירדו בסוף המסחר.',kind:'move',level:'crit',aff:[{sym:'UNH',how:'direct',dir:'neg'}]}); assert.equal(x.kind,'move'); assert.equal(x.level,'info'); assert.deepEqual(x.aff,[]);
  // the events: an article of a price move makes none; the real one beside it does
  const s=mk(), A=(title,link)=>({title,link,pub:'Reuters',at:h(2),syms:['UNH']}), a1=A('Health care stocks close lower','https://r.com/a1'), a2=A('UnitedHealth cuts its forecast','https://r.com/a2');
  const X=o=>({what:'w',type:'other',level:'imp',dir:'neg',cert:'fact',kind:'news',aff:[{sym:'UNH',how:'direct',dir:'neg',why:'x',said:true}],sectors:[],themes:[],regions:[],fac:[],secx:[],macro:false,at:at.toISOString(),...o});
  s.setDoc('research/news',{items:[a1,a2]}); s.setDoc('research/newsx',{gen:[],by:{[newsId(a1.link)]:X({he:'מניות הבריאות ירדו',kind:'move',level:'info',aff:[],ev:'health-stocks-fall'}),[newsId(a2.link)]:X({he:'יונייטד הלת׳ מורידה תחזית',ev:'unh-cuts-forecast'})}});
  assert.deepEqual(eventsOf(s,{now:at,days:3}).map(e=>e.k),['ev:unh-cuts-forecast']);
});

test('the phrases of a business: from the facts, never the company\'s name, never general words; the rules\' own when there is no reader',async()=>{
  assert.deepEqual(cleanTopics(['satellite launch contracts','Rocket Lab launches','stock market','x','space systems defense budget for small satellites today','NASA budget'],{sym:'RKLB',name:'Rocket Lab USA Inc.'}),['satellite launch contracts','nasa budget']);
  assert.deepEqual(ruleTopics({sym:'XOM',name:'Exxon Mobil',industry:'Oil & Gas Integrated',segs:[{k:'Upstream',pct:62},{k:'Chemical Products',pct:9}]}),['oil industry','gas industry','upstream market']);
  const s=mk(); _setKinds({RKLB:'S',QQQ:'E',NOFACT:'S'}); _setSectors({});
  s.setDoc('research/s_RKLB',{name:'Rocket Lab',prof:{desc:'Rocket Lab USA, Inc. provides launch services and space systems solutions for the space and defense industries.',industry:'Aerospace & Defense',sector:'Industrials',country:'US'}});
  const asked=[], ask=async p=>{asked.push(p); return JSON.stringify([{i:0,q:['satellite launch contracts','Rocket Lab stock','space defense budget']}])};
  assert.match(topicsPrompt([cardOf(s,'RKLB')]),/Never the company's name/);
  let r=await topicsTask(s,{syms:['RKLB','QQQ','NOFACT','TLV:TEVA'],now:at,ask}); assert.equal(r.made,1); assert.equal(asked.length,1,'one call for the companies that have facts');
  assert.deepEqual(s.getDoc(TOPIC_DOC).data.by.RKLB.q,['satellite launch contracts','space defense budget'],'its own name is not a topic'); assert.equal(s.getDoc(TOPIC_DOC).data.by.RKLB.src,'ai'); assert.equal(s.getDoc(TOPIC_DOC).data.by.NOFACT,undefined,'no facts: no phrases');
  await topicsTask(s,{syms:['RKLB'],now:new Date(at.getTime()+864e5),ask}); assert.equal(asked.length,1,'kept for 45 days');
  await topicsTask(s,{syms:['RKLB'],now:new Date(at.getTime()+50*864e5),ask}); assert.equal(asked.length,2);
  // no reader: the facts' own words (the industry), and a reader later replaces them
  const s2=mk(); s2.setDoc('research/s_RKLB',s.getDoc('research/s_RKLB').data); r=await topicsTask(s2,{syms:['RKLB'],now:at}); assert.equal(s2.getDoc(TOPIC_DOC).data.by.RKLB.src,'rules'); assert.deepEqual(s2.getDoc(TOPIC_DOC).data.by.RKLB.q,['aerospace industry','defense industry']);
  await topicsTask(s2,{syms:['RKLB'],now:at,ask}); assert.equal(s2.getDoc(TOPIC_DOC).data.by.RKLB.src,'ai');
  // a security nobody holds any more leaves the list; the document is the management's (its keys are what people hold)
  await topicsTask(s,{syms:[],now:at,ask}); assert.deepEqual(s.getDoc(TOPIC_DOC).data.by,{});
  assert.equal(access({id:'u1',role:'friend'},TOPIC_DOC),''); assert.equal(access({id:'o',role:'owner'},TOPIC_DOC),'r');
});

test('the gathering by the business: trusted publishers, a word of the phrase in the headline, no price moves; a few an hour, a cap a day; listed under the security alone',async()=>{
  const it=(title,host,ago)=>({title,link:'https://news.google.com/rss/articles/'+encodeURIComponent(title),at:h(ago),src:host,srcUrl:'https://'+host});
  const L=[it('FAA tightens rules for commercial satellite launch licences - Reuters','reuters.com',3),it('Satellite launch stocks close lower - CNBC','cnbc.com',2),it('A recipe for launch day snacks - Reuters','reuters.com',2),it('New satellite constellation contracts awarded - Some Blog','someblog.com',1),it('Old satellite launch delay - Reuters','reuters.com',80),it('Pentagon space budget grows - Bloomberg','bloomberg.com',5)];
  const P=topicPick(L,{phrases:['satellite launch contracts','space defense budget'],now:at});
  assert.deepEqual(P.map(a=>[a.title,a.pub]),[['FAA tightens rules for commercial satellite launch licences','Reuters'],['Pentagon space budget grows','Bloomberg']],'not the price move, not the snack, not the blog, not the old one');
  const s=mk(); _setKinds({RKLB:'S',NVDA:'S'}); _setSectors({});
  s.setDoc('research/s_RKLB',{name:'Rocket Lab',prof:{desc:'Rocket Lab USA, Inc. provides launch services and space systems solutions for the space and defense industries.',industry:'Aerospace & Defense',sector:'Industrials',country:'US'}});
  const ask=async()=>JSON.stringify([{i:0,q:['satellite launch contracts','space defense budget']}]), qs=[], search=async q=>{qs.push(q); return L};
  let r=await topicNewsTask(s,{syms:['RKLB','NVDA'],now:at,ask,search,pause:0});
  assert.equal(r.ok,1,'only the company that has facts is searched'); assert.equal(qs[0],'("satellite launch contracts" OR "space defense budget") when:2d');
  assert.deepEqual(r.items.map(a=>[a.syms.join(),a.topic,a.pub]),[['RKLB','satellite launch contracts','Reuters'],['RKLB','satellite launch contracts','Bloomberg']]);
  // the day's cap: what was gathered is counted, and at the cap nothing is searched
  assert.equal(topicCap(),120); assert.equal((await topicNewsTask(s,{syms:['RKLB'],now:at,ask,search,pause:0,dayCap:2})).capped,true); assert.equal(qs.length,1);
  process.env.TOPIC_NEWS='0'; assert.equal((await topicNewsTask(s,{syms:['RKLB'],now:at,ask,search,pause:0})).off,true); delete process.env.TOPIC_NEWS;
  process.env.GNEWS='0'; assert.equal((await topicNewsTask(s,{syms:['RKLB'],now:at,ask,search,pause:0})).off,true); delete process.env.GNEWS;
  // through the news run: the articles join the security's list, marked as gathered by its business; once an hour
  const o=s.addUser({email:'owner@example.com',password:'owner-pass-123',role:'owner'}); s.setDoc('portfolio/main',{positions:[{sym:'RKLB',qty:5,name:'Rocket Lab'}],cash:[]});
  const s3=s, noNet=async()=>new Response('{}',{status:404}); let n=0;
  const topics=async(st,o2)=>{n++; return topicNewsTask(st,{...o2,ask,search,pause:0,dayCap:50})};
  await newsTask(s3,{fetch:noNet,now:new Date(at.getTime()+864e5),market:[],il:null,more:null,topics});
  const N=s3.getDoc('research/news').data.items.filter(a=>a.topic); assert.equal(N.length,2); assert.ok(N.every(a=>a.syms.join()==='RKLB'&&a.topic==='satellite launch contracts'));
  await newsTask(s3,{fetch:noNet,now:new Date(at.getTime()+864e5+10*60e3),market:[],il:null,more:null,topics}); assert.equal(n,1,'not again within the hour');
});
