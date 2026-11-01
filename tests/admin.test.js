// 1.11 TikChik Management Center: the permissions on the server, the append-only audit log, the sign-in log, the
// activity, the suspension, and the figures (each from a real source, never made up). No network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {adminSchema, permsOf, can, setPerms, audit, auditList, auditVerify, setStatus, touch, backfillActive, ipPrefix} from '../server/admin/core.js';
import {rangeOf, executive, product, aiCost, funnel, catalog, K_ANON} from '../server/admin/metrics.js';
import {bump, countersSince, setCounterStore} from '../server/admin/counter.js';
import {createHash} from 'node:crypto';

process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.ANTHROPIC_API_KEY=''; process.env.JOBS='0';
const PAGE=new URL('../page/live.html',import.meta.url).pathname;
const mk=()=>{const s=new Store(':memory:'); adminSchema(s); return s};
const users=s=>{const o=s.addUser({email:'o@x.co',password:'password1',role:'owner'}), a=s.addUser({email:'a@x.co',password:'password1',role:'admin'}), f=s.addUser({email:'f@x.co',password:'password1',role:'friend'}), a2=s.addUser({email:'a2@x.co',password:'password1',role:'admin'});
  return {o:s.userById(o.id),a:s.userById(a.id),f:s.userById(f.id),a2:s.userById(a2.id)}};

test('permissions: the role gives the defaults; nobody changes the owner or themselves; only the owner gives "users" and "sensitive"',()=>{
  const s=mk(), U=users(s);
  assert.deepEqual([...permsOf(U.o)].sort(),['edit','sensitive','system','users','view']);
  assert.deepEqual([...permsOf(U.a)].sort(),['edit','system','users','view']);
  assert.deepEqual([...permsOf(U.f)],[]);
  assert.throws(()=>setPerms(s,U.a,U.o.id,['view']),/owner/);
  assert.throws(()=>setPerms(s,U.a,U.a.id,['view','sensitive']),/self/);
  assert.throws(()=>setPerms(s,U.a,U.a2.id,['view','edit','users','system','sensitive']),/owner_only/,'an admin cannot give "sensitive"');
  assert.throws(()=>setPerms(s,U.a,U.a2.id,['view']),/owner_only/,'nor take "users" away');
  assert.throws(()=>setPerms(s,U.f,U.a.id,['view']),/permission_denied/);
  setPerms(s,U.a,U.f.id,['view']); assert.deepEqual([...permsOf(s.userById(U.f.id))],['view'],'an admin may give a partner "view"');
  setPerms(s,U.o,U.a2.id,['view','sensitive']); assert.ok(can(s.userById(U.a2.id),'sensitive')); assert.ok(!can(s.userById(U.a2.id),'users'));
  // a suspended account has no permission at all (the owner is never suspended)
  setStatus(s,U.o,U.a.id,'suspended','בדיקה'); assert.deepEqual([...permsOf(s.userById(U.a.id))],[]);
  assert.throws(()=>setStatus(s,U.a2,U.o.id,'suspended'),/owner/); assert.throws(()=>setStatus(s,U.a2,U.a2.id,'suspended'),/self/);
});

test('the audit log is append-only and chained: the database refuses an update or a delete; a forged row breaks the chain',()=>{
  const s=mk(), U=users(s);
  audit(s,{user:U.o,action:'user.role',target:U.a.id,detail:{before:'friend',after:'admin'},ip:'10.1.2.3'});
  audit(s,{user:U.a,action:'user.suspend',target:U.f.id,detail:{note:'x'},ip:'2001:db8:1:2::5'});
  const L=auditList(s); assert.equal(L.length,2); assert.equal(L[0].action,'user.suspend'); assert.equal(L[1].ip,'10.1.2.0','the address is kept without its last number'); assert.equal(L[0].ip,'2001:db8:1::');
  assert.deepEqual(auditVerify(s),{ok:true,n:2});
  assert.throws(()=>s.db.prepare("update audit set actor='x'").run(),/append-only/);
  assert.throws(()=>s.db.prepare('delete from audit').run(),/append-only/);
  // a row slipped in by hand with a made-up hash: the chain shows where
  s.db.prepare("insert into audit(at,uid,actor,action,target,detail,ip,prev,hash) values('2026-01-01',null,'evil','user.role','x',null,'','bad','bad')").run();
  const v=auditVerify(s); assert.equal(v.ok,false); assert.equal(v.n,2);
  assert.equal(ipPrefix('::ffff:192.168.7.9'),'192.168.7.0');
});

test('activity: one row a day, at most once a minute; the days before come from the usage, the AI and the sign-ins, once',()=>{
  const s=mk(), U=users(s); const t0=Date.parse('2026-11-01T10:00:00Z');
  touch(s,U.f,{now:t0}); touch(s,U.f,{now:t0+10e3}); touch(s,U.f,{now:t0+120e3});
  assert.equal(s.db.prepare('select hits from active_days where uid=?').get(U.f.id).hits,2,'once a minute');
  assert.ok(s.userById(U.f.id).last_seen);
  s.setDoc(`data/users/${U.a.id}/usage`,{days:{'2026-10-20':{'tab:overview':3},'2026-10-21':{'tab:news':1}}});
  s.aiAdd(U.o.id,'2026-10-25',{calls:2});
  assert.equal(backfillActive(s),3); assert.equal(backfillActive(s),0,'once');
  assert.deepEqual(s.db.prepare('select day, src from active_days where uid=? order by day').all(U.a.id).map(r=>r.day+':'+r.src),['2026-10-20:usage','2026-10-21:usage']);
});

test('the figures: each with its source; retention as "of"; AI cost only with prices; nothing invented',()=>{
  const s=mk(), U=users(s); const t=rangeOf({range:'7'});
  assert.equal(t.len,7); assert.equal(rangeOf({range:'custom',from:'2026-10-10',to:'2026-10-01'}).from,'2026-10-01','a reversed range is put in order');
  for(const u of [U.o,U.a,U.f])s.db.prepare("insert into active_days(uid,day,hits) values(?,?,1)").run(u.id,t.to);
  s.db.prepare("insert into active_days(uid,day,hits) values(?,?,1)").run(U.o.id,t.prevTo);
  s.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:2,costIls:100}]});
  s.aiModelAdd(t.to,'claude-haiku-5-5',{calls:3,input:1e6,output:2e5});
  const E=executive(s,{range:'7'}), by=Object.fromEntries(E.metrics.map(m=>[m.k,m]));
  for(const m of E.metrics){assert.ok(m.src,'a source for '+m.k); assert.ok('at' in m)}
  assert.equal(by.users.value,4); assert.equal(by.dau.value,3); assert.equal(by.portfolios.value,1); assert.equal(by.portfolios.of,4);
  assert.equal(by.retention.value,1); assert.equal(by.retention.of,1); assert.match(by.retention.note,/מעט משתמשים/);
  assert.equal(by.aicost.value,null,'no prices, no cost'); assert.match(by.aicost.note,/חסרים מחירים/);
  assert.equal(by.infra.value,null); assert.match(by.infra.note,/לא מחובר/);
  s.setMeta('aiPrices',JSON.stringify({'claude-haiku-5-5':{in:1,out:5}}));
  assert.equal(aiCost(s,t.from,t.to).total,2,'1M × $1 + 0.2M × $5');
  assert.equal(E.series.days.length,7); assert.equal(E.series.active[6],3);
});

test('product intelligence: a summary of everybody needs three active people, else only the viewer\'s own; the catalog is read from the page',()=>{
  const s=mk(), U=users(s), t=rangeOf({range:'30'});
  s.setDoc('usage/main',{days:{[t.to]:{'tab:overview':5,'tab:news':2}}});
  s.setDoc(`data/users/${U.f.id}/usage`,{days:{[t.to]:{'tab:news':4,chiko:1},[t.from]:{'tab:news':1}}});
  s.db.prepare("insert into active_days(uid,day,hits) values(?,?,1)").run(U.o.id,t.to); s.db.prepare("insert into active_days(uid,day,hits) values(?,?,1)").run(U.f.id,t.to);
  let P=product(s,{range:'30'},{viewer:U.o,pageFile:PAGE});
  assert.equal(P.own,true); assert.equal(P.contributors,2); assert.equal(K_ANON,3);
  assert.equal(P.rows.find(r=>r.k==='tab:news').n,2,'only the owner\'s own: the partner\'s 5 are not in it'); assert.equal(P.rows.find(r=>r.k==='tab:news').people,null); assert.equal(P.funnel,null);
  s.db.prepare("insert into active_days(uid,day,hits) values(?,?,1)").run(U.a.id,t.to);
  P=product(s,{range:'30'},{viewer:U.o,pageFile:PAGE});
  assert.equal(P.own,false); const nw=P.rows.find(r=>r.k==='tab:news'); assert.equal(nw.n,7); assert.equal(nw.people,2); assert.equal(nw.repeat,1,'the partner used it on two days');
  assert.equal(nw.kind,'screen'); assert.ok(nw.name&&nw.name!=='news','the screen\'s name from the page: '+nw.name);
  const C=catalog(PAGE); assert.ok(Object.keys(C.tabs).length>=5,'tabs: '+Object.keys(C.tabs).length); assert.ok(Object.keys(C.secs).length>=20,'sections: '+Object.keys(C.secs).length);
  assert.ok(P.never.length>0&&!P.never.some(x=>x.k==='tab:news'));
  // the funnel of the account's steps
  s.setDoc('settings/main',{targets:{tech:50},goal:1e6,years:10}); s.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:1,costIls:10}]});
  const F=Object.fromEntries(funnel(s,s.users()).map(x=>[x.k,x.n])); assert.equal(F.acct,4); assert.equal(F.pf,1); assert.equal(F.cost,1); assert.equal(F.targets,1); assert.equal(F.goal,1); assert.equal(F.plan,0);
});

test('the counters: per day, kind, key and cohort, summed in place, no person',()=>{
  const s=mk(); setCounterStore(s);
  bump('nav','overview>news',1,{cohort:'new'}); bump('nav','overview>news',2,{cohort:'new'}); bump('nav','overview>news',1,{cohort:'vet'});
  const L=countersSince(s,'nav','2000-01-01'); assert.equal(L.length,2); assert.equal(L.find(r=>r.cohort==='new').n,3);
  assert.equal(s.db.prepare("select count(*) n from pragma_table_info('counters') where name in ('uid','email')").get().n,0,'no column for a person');
  setCounterStore(null);
});

test('the API: a partner gets 404 at /admin and 403 at the API; an admin sees, cannot touch the owner or give "sensitive"; every change is audited; the log hides secrets',async()=>{
  const {createApp,bootstrap}=await import('../server/index.js');
  const store=new Store(':memory:'); bootstrap(store);
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false});
  const srv=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x))}), base='http://127.0.0.1:'+srv.address().port, jar={};
  const req=async(who,method,url,body)=>{const r=await fetch(base+url,{method,redirect:'manual',headers:{...(jar[who]?{cookie:jar[who]}:{}),'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const sc=r.headers.get('set-cookie'); if(sc)jar[who]=sc.split(';')[0]; const t=await r.text(); let j=null; try{j=JSON.parse(t)}catch(e){} return {status:r.status,j,t,h:r.headers}};
  try{
    const owner=store.userByEmail('owner@example.com');
    const a=store.addUser({email:'adm@x.co',password:'password1',role:'admin'}), f=store.addUser({email:'p@x.co',password:'password1',role:'friend'});
    // signed out: to the sign-in, with the way back
    let r=await req('x','GET','/admin'); assert.equal(r.status,302); assert.equal(r.h.get('location'),'/?next=admin');
    assert.equal((await req('x','GET','/api/admin/exec')).status,403);
    // a failed sign-in and a good one are logged
    assert.equal((await req('p','POST','/api/login',{email:'p@x.co',password:'nope'})).status,401);
    assert.equal((await req('p','POST','/api/login',{email:'p@x.co',password:'password1'})).status,200);
    r=await req('p','GET','/admin'); assert.equal(r.status,404,'a partner: the ordinary "not found"'); assert.ok(!/Management/.test(r.t));
    for(const u of ['/api/admin/exec','/api/admin/users','/api/admin/audit','/api/admin/product','/api/admin/health'])assert.equal((await req('p','GET',u)).status,403,u);
    assert.equal((await req('p','POST',`/api/admin/users/${a.id}/status`,{status:'suspended'})).status,403);
    // the admin
    assert.equal((await req('a','POST','/api/login',{email:'adm@x.co',password:'password1'})).status,200);
    r=await req('a','GET','/api/me'); assert.equal(r.j.me.mc,true);
    r=await req('a','GET','/admin'); assert.equal(r.status,200); assert.match(r.t,/TikChik Management Center/); assert.match(r.h.get('content-security-policy')||'',/frame-ancestors 'none'/);
    r=await req('a','GET','/api/admin/exec?range=7'); assert.equal(r.status,200); assert.ok(r.j.metrics.length>=12);
    r=await req('a','GET','/api/admin/users'); assert.equal(r.status,200);
    const js=JSON.stringify(r.j); for(const bad of ['hash','salt','totp_secret','totp_backup','"sid"'])assert.ok(!js.includes(bad),'no '+bad+' in the users list');
    assert.equal((await req('a','GET','/api/admin/logins')).status,403,'the sign-in log needs "sensitive"');
    r=await req('a','GET',`/api/admin/users/${f.id}`); assert.equal(r.j.logins,null); assert.match(r.j.portfolioNote,/לא מוצג/);
    assert.equal((await req('a','POST',`/api/admin/users/${owner.id}/status`,{status:'suspended'})).status,400);
    assert.equal((await req('a','POST',`/api/admin/users/${a.id}/perms`,{perms:['view','sensitive']})).status,400,'not one\'s own');
    assert.equal((await req('a','POST',`/api/admin/users/${f.id}/perms`,{perms:['view','sensitive']})).status,400,'"sensitive" is the owner\'s to give');
    assert.equal((await req('a','POST',`/api/admin/users/${f.id}/role`,{role:'admin'})).status,200);
    assert.equal((await req('a','POST',`/api/admin/users/${f.id}/role`,{role:'friend'})).status,200);
    // suspended: signed out now, cannot sign in, the admin center closed too
    assert.equal((await req('a','POST',`/api/admin/users/${f.id}/status`,{status:'suspended',note:'בדיקה'})).status,200);
    assert.equal((await req('p','GET','/api/me')).j.me,null,'the session ended');
    r=await req('p','POST','/api/login',{email:'p@x.co',password:'password1'}); assert.equal(r.status,403); assert.equal(r.j.error.code,'suspended');
    assert.equal((await req('a','POST',`/api/admin/users/${f.id}/status`,{status:'active'})).status,200);
    assert.equal((await req('p','POST','/api/login',{email:'p@x.co',password:'password1'})).status,200);
    // the audit log: everything the admin did, in order
    r=await req('a','GET','/api/admin/audit'); const acts=r.j.items.map(x=>x.action);
    assert.deepEqual(acts.slice(0,4),['user.restore','user.suspend','user.role','user.role']); assert.equal(r.j.verify.ok,true);
    assert.equal(r.j.items[1].detail.note,'בדיקה'); assert.equal(r.j.items[1].actor,'adm@x.co');
    // the owner: the sign-in log, its view audited
    assert.equal((await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'})).status,200);
    r=await req('o','GET','/api/admin/logins'); assert.equal(r.status,200);
    assert.ok(r.j.items.some(e=>e.email==='p@x.co'&&!e.ok&&e.reason==='bad_password')); assert.ok(r.j.items.some(e=>e.email==='p@x.co'&&!e.ok&&e.reason==='suspended'));
    assert.ok(r.j.items.every(e=>/\.0$|::$|^$|^\?$/.test(e.ip)),'the address shortened');
    assert.equal(store.db.prepare("select count(*) n from audit where action='sensitive.view'").get().n,1);
    // the owner gives "sensitive", then a prices change needs "edit" and is audited
    assert.equal((await req('o','POST',`/api/admin/users/${a.id}/perms`,{perms:['view','edit','users','system','sensitive']})).status,200);
    assert.equal((await req('a','GET','/api/admin/logins')).status,200,'now the admin may');
    assert.equal((await req('a','POST','/api/admin/ai/prices',{prices:{'claude-haiku-5-5':{in:1,out:5},'bad model!':{in:1,out:1}}})).status,200);
    assert.deepEqual(JSON.parse(store.getMeta('aiPrices')),{'claude-haiku-5-5':{in:1,out:5}});
    // the moves between screens: counted, no person; bad shapes dropped
    r=await req('p','POST','/api/ev',{nav:{'overview>news':2,'bad key>x':1,'news>news':4},dwell:{news:90,'<script>':5}}); assert.equal(r.j.n,2);
    assert.equal(store.db.prepare("select sum(n) n from counters where kind='nav'").get().n,2);
    // activity was recorded for every signed-in person
    assert.ok(store.db.prepare('select count(distinct uid) n from active_days').get().n>=3);
  }finally{srv.close()}
});

// ================= stage C =================
import {aiMeter} from '../server/admin/counter.js';
import {checkIncidents, incidents, incidentUpdate, newsOps, aiOps, aiQuality, security, systemOps, opsSchema} from '../server/admin/ops.js';

test('the AI meter: every call per feature and model, the background ones also in the cost table, the failures kept without content',()=>{
  const s=mk(); setCounterStore(s); const d=rangeOf({range:'today'});
  aiMeter({feature:'newsx',model:'claude-haiku-5-5',usage:{input_tokens:1000,output_tokens:200},ms:1500,ok:true,addModel:true});
  aiMeter({feature:'newsx',model:'claude-haiku-5-5',ms:3000,ok:false,code:'HTTP 529'});
  aiMeter({feature:'chat',model:'claude-sonnet-5-5',usage:{input_tokens:500,output_tokens:50},ms:800,ok:true});
  const O=aiOps(s,d), nx=O.features.find(f=>f.feature==='newsx');
  assert.equal(nx.calls,2); assert.equal(nx.ok,1); assert.equal(nx.err,1); assert.equal(nx.errPct,50); assert.equal(nx.avg,2250); assert.equal(nx.input,1000); assert.equal(nx.cost,null,'no prices');
  assert.deepEqual(O.errors,[{code:'HTTP 529',n:1}]); assert.equal(O.fails[0].feature,'newsx'); assert.ok(!('prompt' in O.fails[0]));
  assert.equal(s.aiModelsSince(d.from).find(r=>r.model==='claude-haiku-5-5').input,1000,'the background call reaches the cost table');
  assert.equal(s.aiModelsSince(d.from).find(r=>r.model==='claude-sonnet-5-5'),undefined,'the chat is counted there by the chat route, not twice');
  s.setMeta('aiPrices',JSON.stringify({'claude-haiku-5-5':{in:1,out:5}})); assert.equal(aiOps(s,d).features.find(f=>f.feature==='newsx').cost,0);   // 1000×1/1e6+200×5/1e6 = 0.002 → 0.00
  setCounterStore(null);
});

test('incidents: opened when a measure crosses its line, the management told once, closed by itself; a person\'s hand audited and kept',()=>{
  const s=mk(), U=users(s); setCounterStore(s); opsSchema(s);
  for(let i=0;i<4;i++)aiMeter({feature:'newsx',model:'m',ok:false,code:'HTTP 500'}); for(let i=0;i<2;i++)aiMeter({feature:'newsx',model:'m',ok:true});
  const pushed=[], mailed=[]; const push=async(st,uid,msg)=>{pushed.push({uid,msg}); return 1}, send=async m=>{mailed.push(m); return true};
  let o=checkIncidents(s,{push,send}); assert.ok(o.some(x=>x.key==='ai'),JSON.stringify(o));
  const ai=incidents(s).find(i=>i.key==='ai'); assert.equal(ai.sev,'bad'); assert.match(ai.note,/קריאת כתבות: 4 מתוך 6/);
  // told: the phones of everyone with "system" (owner, both admins), not the partner; no mail until switched on
  assert.deepEqual([...new Set(pushed.map(p=>p.uid))].sort(),[U.o.id,U.a.id,U.a2.id].sort()); assert.equal(mailed.length,0); assert.match(pushed[0].msg.url,/#incidents/);
  pushed.length=0; checkIncidents(s,{push,send}); assert.equal(pushed.length,0,'once'); assert.equal(incidents(s).filter(i=>i.key==='ai').length,1,'not opened twice');
  // fine again: closed by itself
  for(let i=0;i<20;i++)aiMeter({feature:'newsx',model:'m',ok:true}); checkIncidents(s,{push,send});
  assert.equal(incidents(s).find(i=>i.key==='ai').status,'closed');
  // a person takes one: audited, and it no longer closes by itself
  for(let i=0;i<30;i++)bump('rt_5xx','db',1); checkIncidents(s,{});
  const e=incidents(s).find(i=>i.key==='errors'&&i.status==='open'); incidentUpdate(s,U.a,e.id,{status:'ack',owner:U.a.id,resolution:'בודק'},'10.0.0.1');
  assert.equal(auditList(s)[0].action,'incident.update'); assert.equal(incidents(s).find(i=>i.id===e.id).auto,0);
  assert.throws(()=>incidentUpdate(s,U.a,9999,{status:'closed'}),/not_found/);
  setCounterStore(null);
});

test('the news system: sources, duplicates, articles without a source, the readings, the impact links, the personal alerts as totals only',()=>{
  const s=mk(), U=users(s); const now=new Date().toISOString();
  s.setDoc('research/news',{items:[{title:'Apple beats',pub:'Reuters',link:'https://r/1',syms:['AAPL'],at:now},{title:'Apple beats!',pub:'CNBC',link:'https://c/1',syms:['AAPL'],at:now},{title:'No source',link:'',syms:['MSFT'],at:now}],updatedAt:now});
  const id=createHash('sha1').update('https://r/1').digest('hex').slice(0,12);
  s.setDoc('research/newsx',{gen:[],by:{[id]:{he:'אפל עקפה את התחזיות',what:'הכנסות 95 מיליארד',aff:[{sym:'AAPL',how:'direct',why:'החברה עצמה'}],sectors:['Technology'],themes:[],ev:'aapl-q4',at:now,level:'imp',cert:'fact'},x2:{he:'משהו',what:'טקסט',aff:[],sectors:[],themes:[],at:now,level:'info'}}});
  s.setMeta('newsStatus',JSON.stringify({at:now,ok:5,of:6,fail:1,items:3,first:'MSFT: 404'}));
  s.setDoc('alerts/pulse',{items:[{k:'a',lv:'crit',at:now},{k:'b',lv:'imp',at:now}]}); s.setDoc(`data/users/${U.f.id}/pulse`,{items:[{k:'c',lv:'upd',at:now}]});
  const N=newsOps(s);
  assert.equal(N.articles.total,3); assert.equal(N.articles.dup,1,'"Apple beats" and "Apple beats!" are one headline'); assert.equal(N.articles.noSrc,1);
  assert.equal(N.reading.ai,2); assert.equal(N.impact.unlinked,1); assert.equal(N.impact.events3,1);
  assert.deepEqual({a:N.personal.alerts,c:N.personal.crit,u:N.personal.users},{a:3,c:1,u:2}); assert.ok(!JSON.stringify(N.personal).includes(U.f.id),'nobody named');
  assert.equal(N.sources[0].fail,1); assert.match(N.sources[0].first,/404/);
});

test('the quality check: rules over the readings, with what it found; a number not in the article and a sure-sounding forecast are flagged',()=>{
  const s=mk(); const now=new Date().toISOString(), L=['https://a/1','https://a/2'], id=l=>createHash('sha1').update(l).digest('hex').slice(0,12);
  s.setDoc('research/news',{items:[{title:'Nvidia revenue 35 billion',pub:'Reuters',link:L[0],syms:['NVDA'],at:now},{title:'Tesla news',pub:'CNBC',link:L[1],syms:['TSLA'],at:now}]});
  s.setDoc('research/newsx',{by:{[id(L[0])]:{he:'אנבידיה',what:'הכנסות 35 מיליארד',aff:[{sym:'NVDA',how:'direct',why:'החברה המדווחת'}],at:now,cert:'fact'},
    [id(L[1])]:{he:'טסלה תזנק',what:'צפויה עלייה של 40 אחוז',aff:[{sym:'TSLA',how:'direct',why:''},{sym:'GM',how:'direct',why:'מתחרה'}],at:now,kind:'opinion',cert:'fact'}}});
  const Q=aiQuality(s); assert.equal(Q.n,2); const by=Object.fromEntries(Q.crit.map(c=>[c.k,c]));
  assert.equal(by.numbers.ok,1); assert.equal(by.numbers.of,2); assert.equal(by.over.ok,1); assert.equal(by.cert.ok,1); assert.equal(by.cert.of,2); assert.equal(by.direct.ok,1); assert.equal(by.reason.ok,1);
  assert.equal(Q.flags.length,1); assert.deepEqual(Q.flags[0].why.sort(),['דעה סומנה כעובדה','חברה מושפעת בלי הסבר','מספר שלא מופיע בכותרת או בתקציר','ניסוח נחרץ או המלצה','קשר ישיר לחברה שלא מוזכרת'].sort());
  assert.match(Q.limits,/לא יודעת אם המסקנה נכונה/); assert.ok(Q.score>0&&Q.score<100);
});

test('the API of stage C: a partner refused everywhere; the sessions named by a hash, ended by "users", audited; the security posture without secrets',async()=>{
  const {createApp,bootstrap}=await import('../server/index.js');
  const store=new Store(':memory:'); bootstrap(store);
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false});
  const srv=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x))}), base='http://127.0.0.1:'+srv.address().port, jar={};
  const req=async(who,method,url,body)=>{const r=await fetch(base+url,{method,headers:{...(jar[who]?{cookie:jar[who]}:{}),'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const sc=r.headers.get('set-cookie'); if(sc)jar[who]=sc.split(';')[0]; let j=null; try{j=await r.json()}catch(e){} return {status:r.status,j}};
  try{
    store.addUser({email:'p3@x.co',password:'password1',role:'friend'}); store.addUser({email:'ad3@x.co',password:'password1',role:'admin'});
    await req('p','POST','/api/login',{email:'p3@x.co',password:'password1'}); await req('p2','POST','/api/login',{email:'p3@x.co',password:'password1'});
    await req('a','POST','/api/login',{email:'ad3@x.co',password:'password1'}); await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    for(const u of ['news','aiops','system','incidents','security','sessions'])assert.equal((await req('p','GET','/api/admin/'+u)).status,403,u);
    for(const u of ['news','aiops?range=7','system?range=7','incidents','security'])assert.equal((await req('a','GET','/api/admin/'+u)).status,200,u);
    let r=await req('a','GET','/api/admin/security'); assert.equal(r.j.sessions,undefined,'the sessions need "sensitive"'); assert.ok(r.j.checks.length>=8);
    const raw=JSON.stringify(r.j); assert.ok(!/sk-|owner-pass|password1/.test(raw),'no secret in the posture');
    assert.equal((await req('a','GET','/api/admin/sessions')).status,403);
    r=await req('o','GET','/api/admin/sessions'); assert.equal(r.status,200);
    const mine=r.j.items.filter(x=>x.email==='p3@x.co'); assert.equal(mine.length,2); assert.ok(mine.every(x=>/^[0-9a-f]{16}$/.test(x.h)),'a hash, never the id');
    assert.ok(!JSON.stringify(r.j).includes(jar.p.split('=')[1]),'the session id itself never leaves');
    // the admin ends one of the partner's two sessions
    r=await req('a','POST','/api/admin/sessions/end',{h:mine[0].h,uid:mine[0].uid}); assert.equal(r.j.ended,1);
    const alive=[(await req('p','GET','/api/me')).j.me,(await req('p2','GET','/api/me')).j.me].filter(Boolean).length; assert.equal(alive,1);
    assert.equal((await req('a','POST','/api/admin/sessions/end',{h:'all',uid:store.userByEmail('owner@example.com').id})).status,400,'not the owner\'s');
    assert.ok(store.db.prepare("select count(*) n from audit where action='session.end'").get().n>=1);
    // the requests are measured; the incidents and the alerts' switch
    r=await req('a','GET','/api/admin/system?range=today'); assert.ok(r.j.areas.some(x=>x.area==='admin'&&x.n>0),JSON.stringify(r.j.areas)+' '+JSON.stringify(store.db.prepare('select * from counters').all().slice(0,5))); assert.ok(r.j.res.rss>0);
    assert.equal((await req('p','POST','/api/admin/alerts-cfg',{push:true,mail:true})).status,403);
    r=await req('a','POST','/api/admin/alerts-cfg',{push:false,mail:true}); assert.deepEqual(r.j.cfg,{push:false,mail:true});
    r=await req('a','POST','/api/admin/incidents/check',{}); assert.equal(r.status,200);
  }finally{srv.close()}
});
