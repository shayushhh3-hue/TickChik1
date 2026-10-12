// The server without a browser: the store, the access rules, sign-in, documents, live changes, צ׳יקו, prices.
// Run: npm test
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Store, access} from '../server/store.js';
import {yahooChart, fetchAll, buildQuotesDoc, tickerFor} from '../shared/quotes.js';
import {ilOpen, usOpen, inPxWindow} from '../shared/market.js';

// a stand-in for Claude's API, on a local port
let claudeSrv, claudeSeen=[];
before(async()=>{
  claudeSrv=http.createServer(async(req,res)=>{let b='';for await(const c of req)b+=c; const j=JSON.parse(b); claudeSeen.push({key:req.headers['x-api-key'],ver:req.headers['anthropic-version'],body:j});
    const said=JSON.stringify(j.messages||[]);
    if(said.includes('CREDIT')){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API.'}}));return}
    if(said.includes('BADKEY')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}));return}
    if(j.model==='claude-opus-5-5'){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'rate_limit_error',message:'slow down'}}));return}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'m1',type:'message',content:[{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn'}))});
  await new Promise(r=>claudeSrv.listen(0,'127.0.0.1',r));
  process.env.ANTHROPIC_BASE_URL='http://127.0.0.1:'+claudeSrv.address().port;
  process.env.ANTHROPIC_API_KEY='sk-test';
  process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123';
});
after(()=>claudeSrv.close());

test('store: documents, merge, collections, prefix',()=>{
  const s=new Store(':memory:'); const ev=[]; s.onChange(e=>ev.push(e));
  s.setDoc('portfolio/main',{positions:[{sym:'MSFT'}],cash:[]});
  assert.deepEqual(s.getDoc('portfolio/main').data,{positions:[{sym:'MSFT'}],cash:[]});
  s.updateDoc('history/daily',{points:{'2026-10-10':{v:1}}}); s.updateDoc('history/daily',{points:{'2026-10-11':{v:2}}});
  assert.deepEqual(Object.keys(s.getDoc('history/daily').data.points),['2026-10-10','2026-10-11']);
  s.setDoc('reports/archive/items/a',{createdAt:'2026-10-01'}); s.setDoc('reports/archive/items/b',{createdAt:'2026-10-05'});
  assert.deepEqual(s.listDocs('reports/archive/items',{orderBy:'createdAt',dir:'desc'}).map(d=>d.id),['b','a']);
  s.setDoc('data/users/u1/settings/main',{x:1}); s.setDoc('data/users/u1/portfolio/main',{y:1});
  assert.deepEqual(s.pathsUnder('data/users/u1').sort(),['data/users/u1/portfolio/main','data/users/u1/settings/main']);
  assert.equal(s.pathsUnder('data/users/u').length,0,'a prefix is a whole segment');
  s.deleteDoc('reports/archive/items/a'); assert.equal(s.getDoc('reports/archive/items/a').exists,false);
  assert.ok(ev.length>=6&&ev.every(e=>e.path&&e.op));
});

test('access: the same matrix as the artifact',()=>{
  const O={id:'u_o',role:'owner'}, F={id:'u_f',role:'friend'}, G={id:'u_g',role:'friend'};
  for(const p of ['portfolio/main','plan/main','settings/main','history/main','history/daily','reports/archive/items/x','alerts/state'])assert.equal(access(O,p),'rw',p),assert.equal(access(F,p),'',p);
  for(const p of ['quotes/latest','quotes/c_MSFT','research/latest','history/prices'])assert.equal(access(O,p),'rw',p),assert.equal(access(F,p),'r',p);
  assert.equal(access(F,'watch/u_f'),'rw'); assert.equal(access(F,'watch/u_g'),''); assert.equal(access(O,'watch/u_f'),'r');
  assert.equal(access(F,'data/users/u_f/settings/main'),'rw'); assert.equal(access(F,'data/users/u_g/settings/main'),''); assert.equal(access(O,'data/users/u_f/settings/main'),'','the owner does not see a partner\'s portfolio');
  assert.equal(access(null,'quotes/latest'),'');
});

test('users and passwords',()=>{
  const s=new Store(':memory:');
  const u=s.addUser({email:'A@Example.com ',password:'12345678',role:'friend',mustChange:true});
  assert.equal(u.email,'a@example.com'); assert.equal(u.must_change,1);
  assert.ok(s.checkPassword(s.userByEmail('a@example.com'),'12345678')); assert.ok(!s.checkPassword(u,'nope'));
  assert.throws(()=>s.addUser({email:'a@example.com',password:'12345678'}),/exists/);
  assert.throws(()=>s.addUser({email:'b@example.com',password:'short'}),/short_password/);
  assert.throws(()=>s.addUser({email:'not-an-email',password:'12345678'}),/bad_email/);
  const sid=s.newSession(u.id); assert.equal(s.session(sid).id,u.id); s.endSessions(u.id); assert.equal(s.session(sid),null);
  s.setPassword(u.id,'abcdefgh'); assert.ok(s.checkPassword(s.userById(u.id),'abcdefgh')); assert.equal(s.userById(u.id).must_change,0);
});

async function startApp(){
  const {createApp,bootstrap}=await import('../server/index.js');
  const store=new Store(':memory:'); bootstrap(store);
  store.setDoc('portfolio/main',{positions:[{sym:'MSFT',ccy:'USD',qty:1,acct:'exc'}],cash:[]});
  store.setDoc('quotes/latest',{prices:{MSFT:500},prev:{MSFT:490},usdIls:3.07});
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false});
  const srv=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))}); const base='http://127.0.0.1:'+srv.address().port;
  const jar={};
  const req=async(who,method,url,body,hdr={})=>{const r=await fetch(base+url,{method,headers:{...(jar[who]?{cookie:jar[who]}:{}),'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{}),...hdr},body:body===undefined?undefined:JSON.stringify(body)});
    const sc=r.headers.get('set-cookie'); if(sc)jar[who]=sc.split(';')[0]; let j=null; try{j=await r.json()}catch(e){} return {status:r.status,j}};
  return {store,srv,base,req,jar};
}

test('sign-in, documents, permissions, partners, live changes, export',async()=>{
  const {store,srv,base,req,jar}=await startApp();
  try{
    assert.equal((await req('x','GET','/api/db/doc?path=portfolio/main')).status,401,'signed out');
    assert.equal((await req('x','POST','/api/login',{email:'owner@example.com',password:'wrong'})).status,401);
    let r=await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'}); assert.equal(r.status,200); assert.equal(r.j.me.owner,true);
    assert.ok(/tc_sid=/.test(jar.o));
    r=await req('o','GET','/api/db/doc?path=portfolio/main'); assert.equal(r.j.data.positions[0].sym,'MSFT');
    assert.equal((await req('o','PUT','/api/db/doc?path=settings/main',{rules:{maxPos:10}})).status,200);
    assert.equal((await req('o','PATCH','/api/db/doc?path=settings/main',{rules:{maxGroup:40}})).status,200);
    assert.deepEqual(store.getDoc('settings/main').data.rules,{maxPos:10,maxGroup:40});
    // a write without the page's header is refused (no cross-site form can send it)
    const nf=await fetch(base+'/api/db/doc?path=settings/main',{method:'PUT',headers:{cookie:jar.o,'content-type':'application/json'},body:'{}'}); assert.equal(nf.status,403);
    assert.equal((await req('o','GET','/api/db/doc?path=../etc/passwd')).status,400);
    // the owner adds a partner
    r=await req('o','POST','/api/users',{email:'friend@example.com',name:'אורי',password:'first-pass-1'}); assert.equal(r.status,200);
    assert.equal((await req('o','POST','/api/users',{email:'friend@example.com',password:'first-pass-1'})).status,400);
    r=await req('f','POST','/api/login',{email:'friend@example.com',password:'first-pass-1'}); assert.equal(r.j.me.owner,false); assert.equal(r.j.me.mustChange,true);
    const fid=r.j.me.id;
    {const pr=await req('f','POST','/api/password',{old:'first-pass-1',password:'my-own-pass'}); assert.equal(pr.status,200,JSON.stringify(pr.j))}
    assert.equal(store.userById(fid).must_change,0);
    assert.equal((await req('f','GET','/api/db/doc?path=portfolio/main')).status,403,'the partner cannot read the owner\'s portfolio');
    assert.equal((await req('f','GET','/api/db/doc?path=quotes/latest')).status,200);
    assert.equal((await req('f','PUT','/api/db/doc?path=quotes/latest',{})).status,403);
    assert.equal((await req('f','PUT','/api/db/doc?path=data/users/'+fid+'/portfolio',{positions:[{sym:'KO'}]})).status,200);
    assert.equal((await req('o','GET','/api/db/doc?path=data/users/'+fid+'/portfolio')).status,403,'and the owner cannot read the partner\'s');
    assert.equal((await req('f','GET','/api/users')).status,403);
    // live changes: the partner's stream carries quotes but not the owner's settings
    const ctl=new AbortController(); const got=[];
    const sr=await fetch(base+'/api/db/stream',{headers:{cookie:jar.f},signal:ctl.signal});
    const rd=sr.body.getReader(); const pump=(async()=>{try{for(;;){const {value,done}=await rd.read(); if(done)break; got.push(new TextDecoder().decode(value))}}catch(e){}})();
    await new Promise(r=>setTimeout(r,100));
    store.setDoc('settings/main',{x:1}); store.setDoc('quotes/latest',{prices:{MSFT:501}});
    await new Promise(r=>setTimeout(r,200)); ctl.abort(); await pump;
    const evs=got.join('').split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)).path);
    assert.deepEqual(evs,['quotes/latest']);
    // lists
    store.setDoc('reports/archive/items/a',{createdAt:'2026-10-01'}); store.setDoc('reports/archive/items/b',{createdAt:'2026-10-05'});
    r=await req('o','GET','/api/db/list?path=reports/archive/items&orderBy=createdAt&dir=desc&limit=1'); assert.deepEqual(r.j.docs.map(d=>d.id),['b']);
    // export leaves out the partners' private documents; import writes
    r=await req('o','GET','/api/db/export'); assert.ok(r.j.docs['portfolio/main']&&!Object.keys(r.j.docs).some(p=>p.startsWith('data/users/')));
    r=await req('o','POST','/api/db/import',{docs:{'research/latest':{companies:{}},'data/users/zzz/x/y':{a:1},'bad':{}}}); assert.equal(r.j.n,1);
    // removing a partner removes their data
    assert.equal((await req('o','DELETE','/api/users/'+fid)).status,200);
    assert.equal(store.getDoc('data/users/'+fid+'/portfolio').exists,false);
    assert.equal((await req('f','GET','/api/db/doc?path=quotes/latest')).status,401,'their session ended');
    // sign out
    await req('o','POST','/api/logout',{}); jar.o=''; assert.equal((await req('o','GET','/api/me')).j.me,null);
  }finally{srv.close()}
});

test('sign-up with the invite code',async()=>{
  const {store,srv,req,jar}=await startApp();
  try{
    const reg=(who,body)=>req(who,'POST','/api/register',body);
    // closed until the owner sets a code
    assert.equal((await req('x','GET','/api/me')).j.signup,false);
    let r=await reg('a',{email:'new@example.com',password:'new-pass-123',code:'ANYTHING'}); assert.equal(r.status,403); assert.equal(r.j.error.code,'closed');
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    assert.equal((await req('a','GET','/api/invite')).status,403,'only the owner sees the code');
    r=await req('o','POST','/api/invite',{}); const code=r.j.code; assert.match(code,/^[A-Z0-9]{8}$/);
    assert.equal((await req('x','GET','/api/me')).j.signup,true);
    // a wrong code, a short password, a taken address
    r=await reg('a',{email:'new@example.com',password:'new-pass-123',code:'WRONG123'}); assert.equal(r.j.error.code,'bad_code');
    r=await reg('a',{email:'new@example.com',password:'short',code}); assert.equal(r.j.error.code,'short_password');
    r=await reg('a',{email:'owner@example.com',password:'new-pass-123',code}); assert.equal(r.j.error.code,'exists');
    // the right code, typed in lower case with spaces: signed in at once, a partner, no forced password change
    r=await reg('a',{email:'New@Example.com',password:'new-pass-123',code:' '+code.toLowerCase().slice(0,4)+' '+code.toLowerCase().slice(4)}); assert.equal(r.status,200,JSON.stringify(r.j));
    assert.equal(r.j.me.owner,false); assert.equal(r.j.me.mustChange,false);
    const me=(await req('a','GET','/api/me')).j.me; assert.equal(me.email,'new@example.com');
    assert.equal((await req('a','GET','/api/db/doc?path=portfolio/main')).status,403,'not the owner\'s portfolio');
    assert.equal((await req('a','PUT','/api/db/doc?path=data/users/'+me.id+'/portfolio',{positions:[]})).status,200,'their own');
    // their own backup: only their documents; restoring writes only their own paths
    let ex=await req('a','GET','/api/db/export'); assert.deepEqual(Object.keys(ex.j.docs),['data/users/'+me.id+'/portfolio']);
    r=await req('a','POST','/api/db/import',{docs:{['data/users/'+me.id+'/settings']:{x:1},'portfolio/main':{positions:[]},'data/users/other/portfolio':{a:1}}}); assert.equal(r.j.n,1);
    assert.equal(store.getDoc('data/users/'+me.id+'/settings').data.x,1); assert.notDeepEqual(store.getDoc('portfolio/main').data.positions,[]);
    ex=await req('o','GET','/api/db/export'); assert.ok(!Object.keys(ex.j.docs).some(p=>p.startsWith('data/users/')),'the owner\'s backup leaves partners out');
    // a new code stops the old one; closing stops sign-up; the registered user still signs in
    const c2=(await req('o','POST','/api/invite',{})).j.code; assert.notEqual(c2,code);
    r=await reg('b',{email:'b@example.com',password:'b-pass-1234',code}); assert.equal(r.j.error.code,'bad_code');
    assert.equal((await req('o','POST','/api/invite',{code:'my code 2026'})).j.code,'MYCODE2026');
    assert.equal((await req('o','POST','/api/invite',{code:'א'})).status,400);
    assert.equal((await req('o','DELETE','/api/invite')).status,200);
    r=await reg('b',{email:'b@example.com',password:'b-pass-1234',code:'MYCODE2026'}); assert.equal(r.j.error.code,'closed');
    assert.equal((await req('x','GET','/api/me')).j.signup,false);
    jar.a=''; assert.equal((await req('a','POST','/api/login',{email:'new@example.com',password:'new-pass-123'})).status,200);
    // guessing codes hits the brake
    await req('o','POST','/api/invite',{}); let last;
    for(let i=0;i<13;i++)last=await reg('g',{email:'g'+i+'@example.com',password:'g-pass-1234',code:'GUESS'+i+'XX'});
    assert.equal(last.status,429);
  }finally{srv.close()}
});

test('צ׳יקו: the server key, the model list, errors',async()=>{
  const {srv,req}=await startApp();
  try{
    assert.equal((await req('o','POST','/api/ask',{model:'claude-sonnet-5-5',messages:[]})).status,401);
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    let r=await req('o','POST','/api/ask',{model:'claude-sonnet-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]});
    assert.equal(r.status,200); assert.equal(r.j.content[0].text,'{"ok":true}');
    const last=claudeSeen[claudeSeen.length-1]; assert.equal(last.key,'sk-test'); assert.equal(last.ver,'2023-06-01');
    assert.equal((await req('o','POST','/api/ask',{model:'gpt-9',messages:[]})).status,400);
    r=await req('o','POST','/api/ask',{model:'claude-opus-5-5',messages:[]}); assert.equal(r.status,429); assert.equal(r.j.error.code,'rate_limited');
    // the reasons come back in Hebrew, so the page can say what to fix
    r=await req('o','POST','/api/ask',{model:'claude-sonnet-5-5',max_tokens:10,messages:[{role:'user',content:'CREDIT'}]}); assert.equal(r.j.error.code,'sampling_disabled'); assert.match(r.j.error.message,/אין יתרה/);
    r=await req('o','POST','/api/ask',{model:'claude-sonnet-5-5',max_tokens:10,messages:[{role:'user',content:'BADKEY'}]}); assert.equal(r.j.error.code,'sampling_disabled'); assert.match(r.j.error.message,/נדחה/);
    assert.deepEqual(Object.keys((await req('o','POST','/api/ask/check',{})).j).sort(),['ms','ok']);
    const k=process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try{r=await req('o','POST','/api/ask',{model:'claude-sonnet-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]}); assert.equal(r.status,503); assert.match(r.j.error.message,/ANTHROPIC_API_KEY/);
      r=await req('o','POST','/api/ask/check',{}); assert.equal(r.j.ok,false); assert.match(r.j.message,/חסר/)}
    finally{process.env.ANTHROPIC_API_KEY=k}
  }finally{srv.close()}
});

const yahoo=(sym,{px,closes,ccy='USD',off=-14400,lastDay='2026-10-09'})=>{const base=Date.parse(lastDay+'T20:00:00Z')/1000;const ts=closes.map((c,i)=>base-(closes.length-1-i)*86400);return {chart:{result:[{meta:{currency:ccy,symbol:sym,regularMarketPrice:px,regularMarketTime:ts[ts.length-1]+60,gmtoffset:off,chartPreviousClose:closes[0]},timestamp:ts,indicators:{quote:[{close:closes}]}}],error:null}}};
const res=(status,body)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('quotes: Yahoo, agorot, Stooq, the Bank of Israel, index funds',async()=>{
  const f=async url=>{
    if(url.includes('/chart/MSFT'))return res(200,yahoo('MSFT',{px:530.5,closes:[510,520,529.5]}));
    if(url.includes('/chart/ABRA.TA'))return res(200,yahoo('ABRA.TA',{px:12345,closes:[12000,12100,12345],ccy:'ILA',off:10800}));
    if(url.includes('/chart/BAD'))return res(404,{chart:{result:null,error:{description:'No data found'}}});
    if(url.includes('stooq.com'))return new Response('Date,Open,High,Low,Close,Volume\n2026-10-08,1,1,1,9.5,1\n2026-10-09,1,1,1,10.25,1\n',{status:200});
    if(url.includes('boi.org.il'))return res(200,{exchangeRates:[{key:'USD',currentExchangeRate:3.074,unit:1,lastUpdate:'2026-10-09T00:00:00'}]});
    if(url.includes('/chart/USDILS'))return res(200,yahoo('USDILS=X',{px:3.081,closes:[3.07,3.08],ccy:'ILS'}));
    if(url.includes('/chart/%5ETA125.TA'))return res(200,yahoo('^TA125.TA',{px:3100,closes:[3050,3000],ccy:'ILS',off:10800,lastDay:'2026-10-11'}));
    return res(500,'x')};
  const a=await yahooChart('ABRA.TA',{fetch:f}); assert.equal(a.px,123.45); assert.equal(a.ccy,'ILS');
  assert.equal(tickerFor('BRK.B'),'BRK-B'); assert.equal(tickerFor('ABRA',{ccy:'ILS'}),'ABRA.TA');
  const all=await fetchAll(['MSFT','BAD','TA125'],{positions:[{sym:'TA125',ccy:'ILS',px:61.92}],fetch:f});
  assert.equal(all.quotes.BAD.src,'stooq'); assert.ok(all.index.TA125); assert.equal(all.fx.boi.rate,3.074);
  const doc=buildQuotesDoc({prev:{prices:{TA125:61.92},prev:{TA125:61.5}},fetched:all,symbols:['MSFT','BAD','TA125'],positions:[],now:new Date('2026-10-12T08:00:00Z'),ilOpen:true});
  assert.equal(doc.prices.MSFT,530.5); assert.equal(doc.prev.MSFT,520); assert.equal(doc.stale.TA125,'לפי מדד ת״א 125'); assert.equal(doc.usdIls,3.081);
});

test('prices now: /api/prices fetches the held and followed symbols and writes quotes/latest',async()=>{
  const {store,srv,req}=await startApp(); const real=globalThis.fetch;
  store.setDoc('watch/u_x',{syms:['KO'],marks:['bad sym']});
  globalThis.fetch=async(url,o)=>{url=String(url);
    if(url.includes('/chart/MSFT'))return res(200,yahoo('MSFT',{px:530.5,closes:[510,520,529.5]}));
    if(url.includes('/chart/KO'))return res(200,yahoo('KO',{px:86.2,closes:[85,86]}));
    if(url.includes('/chart/USDILS'))return res(200,yahoo('USDILS=X',{px:3.081,closes:[3.07,3.08],ccy:'ILS'}));
    if(url.includes('boi.org.il'))return res(200,{exchangeRates:[{key:'USD',currentExchangeRate:3.074,unit:1,lastUpdate:'2026-10-09T00:00:00'}]});
    if(url.startsWith('http://127.0.0.1'))return real(url,o);
    return res(404,{})};
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    const r=await req('o','POST','/api/prices',{reason:'click'}); assert.equal(r.status,200,JSON.stringify(r.j)); assert.equal(r.j.symbols,2); assert.equal(r.j.fetched,2);
    const q=store.getDoc('quotes/latest').data; assert.equal(q.prices.MSFT,530.5); assert.equal(q.prices.KO,86.2); assert.equal(q.usdIls,3.081);
    const r2=await req('o','POST','/api/prices',{}); assert.equal(r2.j.cached,true);
    // a chart nobody asked for yet is fetched on the first read and kept
    let n=0; const f0=globalThis.fetch; globalThis.fetch=async(url,o)=>{if(String(url).includes('/chart/KO'))n++; return f0(url,o)};
    let c=await req('o','GET','/api/db/doc?path=quotes/c_KO'); assert.equal(c.j.exists,true); assert.ok(c.j.data.d.length>=2&&c.j.data.c.length===c.j.data.d.length);
    const n1=n; c=await req('o','GET','/api/db/doc?path=quotes/c_KO'); assert.equal(n,n1,'served from the store the second time'); assert.ok(store.getDoc('quotes/c_KO').exists);
    c=await req('o','GET','/api/db/doc?path=quotes/c_ZZZZ'); assert.equal(c.j.data.missing,true,'an unknown symbol is remembered as missing');
  }finally{globalThis.fetch=real; srv.close()}
});

test('market hours',()=>{
  assert.equal(ilOpen(new Date('2026-10-12T08:00:00Z')),true); assert.equal(ilOpen(new Date('2026-10-11T08:00:00Z')),false);
  assert.equal(usOpen(new Date('2026-10-12T14:00:00Z')),true); assert.equal(inPxWindow(new Date('2026-10-12T07:45:00Z')),true);
});
