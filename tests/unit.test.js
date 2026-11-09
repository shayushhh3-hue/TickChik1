// The server without a browser: the store, the access rules, sign-in, documents, live changes, צ׳יקו, prices.
// Run: npm test
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Store, access, partnerView} from '../server/store.js';
import fs from 'node:fs';
import {yahooChart, fetchAll, buildQuotesDoc, tickerFor} from '../shared/quotes.js';
import {ilOpen, usOpen, inPxWindow, lastSession, pxDue, ilParts} from '../shared/market.js';
import {mayaFund, isIlFund, fundFromJson, trackOf} from '../shared/quotes.js';

// 31.10: no test reaches the internet. On the CI runner it is open (here it is not), and a source the code fetched for
// real (the Fed's feed, read with the general news) added an article there and changed what two tests counted. A test
// that needs an answer from outside gives its own fetch; the server started inside a test is still reached (localhost)
{const real=globalThis.fetch; globalThis.fetch=async(u,o)=>/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(String(u&&u.url||u))?real(u,o):new Response('offline in tests',{status:503})}

// a stand-in for Claude's API, on a local port
let claudeSrv, claudeSeen=[], claudeClosed=0;
before(async()=>{
  claudeSrv=http.createServer(async(req,res)=>{let b='';for await(const c of req)b+=c; const j=JSON.parse(b); claudeSeen.push({key:req.headers['x-api-key'],ver:req.headers['anthropic-version'],body:j});
    const said=JSON.stringify(j.messages||[]);
    if(said.includes('CREDIT')){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API.'}}));return}
    if(said.includes('BADKEY')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}));return}
    if(said.includes('SLOW')){let done=false; res.on('close',()=>{if(!done)claudeClosed++}); await new Promise(r=>setTimeout(r,1500)); if(res.destroyed)return; done=true}
    if(said.includes('RATELIMIT')){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'rate_limit_error',message:'slow down'}}));return}
    // reading files: streamed. NOFABLE: the strongest model is not open to the key; REFUSE: it declines; SLOWFILE: it takes a while
    if(j.stream){if(said.includes('SLOWFILE'))await new Promise(r=>setTimeout(r,400));
      if(said.includes('LATEKEY')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}));return}
      if(j.model==='claude-haiku-5-5'&&said.includes('HAIKUDOWN')){res.writeHead(529,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'Overloaded'}}));return}
      if(j.model==='claude-fable-5-1'&&said.includes('NOFABLE')){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'not_found_error',message:'model: claude-fable-5-1'}}));return}
      if(said.includes('ALL429')){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'rate limit'}}));return}
      if(j.model==='claude-fable-5-1'&&said.includes('FABLE429')){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'Number of request tokens has exceeded your per-minute rate limit'}}));return}
      res.writeHead(200,{'content-type':'text/event-stream'}); const ev=(t,d)=>res.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
      ev('message_start',{message:{id:'m2',type:'message',role:'assistant',model:j.model,content:[],usage:{input_tokens:1000,output_tokens:1}}}); ev('ping',{});
      // REFUSE: declined before any output (not billed); REFUSEMID: after some output (billed); REFUSEX: reasoning_extraction (billed, no fallback)
      if(j.model==='claude-fable-5-1'&&said.includes('REFUSE')){const mid=said.includes('REFUSEMID'), cat=said.includes('REFUSEX')?'reasoning_extraction':mid?'general_harms':null;
        if(mid){ev('content_block_start',{index:0,content_block:{type:'text',text:''}}); ev('content_block_delta',{index:0,delta:{type:'text_delta',text:'{"pos'}})}
        ev('message_delta',{delta:{stop_reason:'refusal',stop_details:{type:'refusal',category:cat,explanation:'x'}},usage:{output_tokens:mid?7:0}}); ev('message_stop',{}); res.end(); return}
      ev('content_block_start',{index:0,content_block:{type:'thinking',thinking:''}}); ev('content_block_stop',{index:0});
      ev('content_block_start',{index:1,content_block:{type:'text',text:''}}); ev('content_block_delta',{index:1,delta:{type:'text_delta',text:'{"ok":'}}); ev('content_block_delta',{index:1,delta:{type:'text_delta',text:'"read"}'}});
      ev('content_block_stop',{index:1}); ev('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:50}}); ev('message_stop',{}); res.end(); return}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'m1',type:'message',content:[{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:20}}))});
  await new Promise(r=>claudeSrv.listen(0,'127.0.0.1',r));
  process.env.ANTHROPIC_BASE_URL='http://127.0.0.1:'+claudeSrv.address().port;
  process.env.ANTHROPIC_API_KEY='sk-test';
  process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.AI_DAILY_LIMIT='3';
});
after(()=>claudeSrv.close());

process.env.API_RPM='1000000';   // 8.11: the tests hammer one address; the ceiling is for the world

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
  assert.equal(access(F,'watch/u_f'),'rw'); assert.equal(access(F,'watch/u_g'),''); assert.equal(access(O,'watch/u_f'),'','a partner\'s list of symbols is theirs alone');
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
    r=await req('o','POST','/api/ask',{model:'claude-sonnet-5-5',max_tokens:10,messages:[{role:'user',content:'RATELIMIT'}]}); assert.equal(r.status,429); assert.equal(r.j.error.code,'rate_limited');
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

test('Claude limits: request shape, no Opus, a daily quota per partner, usage, stop cancels the call',async()=>{
  const {srv,req,base,jar}=await startApp();
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    // Opus is not on the list unless ALLOWED_MODELS says so
    assert.equal((await req('o','POST','/api/ask',{model:'claude-opus-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]})).status,400);
    // only the page's fields go out: tools and other settings are dropped, the answer length is capped
    let r=await req('o','POST','/api/ask',{model:'claude-haiku-5-5',max_tokens:999999,temperature:1,tools:[{name:'x'}],metadata:{a:1},system:'S',messages:[{role:'user',content:[{type:'text',text:'hi'},{type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}}]}]});
    assert.equal(r.status,200);
    const sent=claudeSeen[claudeSeen.length-1].body; assert.deepEqual(Object.keys(sent).sort(),['max_tokens','messages','model','system']); assert.equal(sent.max_tokens,8192);
    assert.equal((await req('o','POST','/api/ask',{model:'claude-haiku-5-5',messages:[{role:'user',content:[{type:'document',source:{}}]}]})).status,400,'unknown blocks are refused');
    assert.equal((await req('o','POST','/api/ask',{model:'claude-haiku-5-5',messages:[{role:'system',content:'x'}]})).status,400);
    // a partner: 3 calls a day (AI_DAILY_LIMIT=3 in this test run), then a clear refusal; the owner is not limited
    r=await req('o','POST','/api/users',{email:'lim@example.com',password:'lim-pass-123'}); assert.equal(r.status,200);
    await req('p','POST','/api/login',{email:'lim@example.com',password:'lim-pass-123'});
    for(let i=0;i<3;i++)assert.equal((await req('p','POST','/api/ask',{model:'claude-haiku-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]})).status,200);
    r=await req('p','POST','/api/ask',{model:'claude-haiku-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]}); assert.equal(r.status,429); assert.equal(r.j.error.code,'quota_exceeded'); assert.match(r.j.error.message,/מכסה/);
    for(let i=0;i<4;i++)assert.equal((await req('o','POST','/api/ask',{model:'claude-haiku-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]})).status,200);
    // the owner sees the usage: calls and tokens per user
    r=await req('o','GET','/api/ai/usage'); assert.equal(r.j.limit,3);
    const pr=r.j.rows.find(x=>x.email==='lim@example.com'); assert.equal(pr.today,3); assert.equal(pr.input30,300); assert.equal(pr.output30,60);
    assert.equal((await req('p','GET','/api/ai/usage')).status,403);
    // stop: the page closes the request, and the server stops waiting for Claude
    const before=claudeClosed, ctl=new AbortController();
    const pending=fetch(base+'/api/ask',{method:'POST',headers:{cookie:jar.o,'x-tc':'1','content-type':'application/json'},body:JSON.stringify({model:'claude-haiku-5-5',max_tokens:10,messages:[{role:'user',content:'SLOW'}]}),signal:ctl.signal}).catch(e=>e.name);
    await new Promise(r=>setTimeout(r,300)); ctl.abort(); assert.equal(await pending,'AbortError');
    await new Promise(r=>setTimeout(r,400)); assert.equal(claudeClosed,before+1,'the call to Claude was cancelled');
  }finally{srv.close()}
});

test('a partner reads statements like the owner: one call for a statement, several at once, and the next model at a rate limit',async()=>{
  const {srv,req}=await startApp();
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    assert.equal((await req('o','POST','/api/users',{email:'rd@example.com',password:'rd-pass-1234'})).status,200);
    await req('p','POST','/api/login',{email:'rd@example.com',password:'rd-pass-1234'});
    const read=(who,model,text)=>req(who,'POST','/api/ask',{purpose:'files',model,max_tokens:1000,messages:[{role:'user',content:text}]});
    // three statements at once (AI_DAILY_LIMIT=3 in this run), each a quick read and the strongest model's check: six calls at once
    const all=await Promise.all([1,2,3].flatMap(i=>[read('p','claude-haiku-5-5','SLOWFILE quick '+i),read('p','claude-fable-5-1','SLOWFILE check '+i)]));
    assert.deepEqual(all.map(r=>r.status),[200,200,200,200,200,200],'more than three calls at once');
    assert.deepEqual(all.map(r=>r.j.model),['claude-haiku-5-5','claude-fable-5-1','claude-haiku-5-5','claude-fable-5-1','claude-haiku-5-5','claude-fable-5-1']);
    const row=async()=>(await req('o','GET','/api/ai/usage')).j.rows.find(x=>x.email==='rd@example.com');
    let u=await row(); assert.equal(u.today,3,'three statements are three calls of the quota'); assert.equal(u.quickToday,3,'their quick reads are counted apart'); assert.equal(u.quick30,3);
    let r=await read('p','claude-fable-5-1','one more'); assert.equal(r.status,429); assert.equal(r.j.error.code,'quota_exceeded'); assert.match(r.j.error.message,/צ׳יקו/);
    r=await read('p','claude-haiku-5-5','one more'); assert.equal(r.status,429); assert.equal(r.j.error.code,'quota_exceeded'); assert.match(r.j.error.message,/הקריאות המהירות/,'the quick reads have a cap of their own');
    r=await req('p','POST','/api/ask',{model:'claude-haiku-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]}); assert.equal(r.j.error.code,'quota_exceeded','a chat with Haiku is not a quick read: it counts in the quota');
    // the strongest model has reached its rate limit: the next model reads
    const n=(await req('o','GET','/api/ai/usage')).j.rows.find(x=>x.owner);
    r=await read('o','claude-fable-5-1','FABLE429 read this'); assert.equal(r.status,200); assert.equal(r.j.model,'claude-opus-5-5'); assert.deepEqual(r.j.fallbackFrom,['claude-fable-5-1']);
    r=await read('o','claude-haiku-5-5','read quickly'); assert.equal(r.status,200);
    const o=(await req('o','GET','/api/ai/usage')).j.rows.find(x=>x.owner); assert.equal(o.today-n.today,1); assert.equal(o.quickToday-n.quickToday,1,'the owner\'s quick reads are counted apart too');
  }finally{srv.close()}
});

test('a partner: a call Anthropic refused at once does not count, and a problem in the site\'s set-up is the site\'s, in plain words',async()=>{
  const {srv,req}=await startApp();
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    assert.equal((await req('o','POST','/api/users',{email:'rf@example.com',password:'rf-pass-1234'})).status,200);
    await req('p','POST','/api/login',{email:'rf@example.com',password:'rf-pass-1234'});
    const chat=(who,text)=>req(who,'POST','/api/ask',{model:'claude-haiku-5-5',max_tokens:10,messages:[{role:'user',content:text}]});
    const read=(who,model,text)=>req(who,'POST','/api/ask',{purpose:'files',model,max_tokens:1000,messages:[{role:'user',content:text}]});
    const row=async()=>(await req('o','GET','/api/ai/usage')).j.rows.find(x=>x.email==='rf@example.com');
    // Anthropic says "slow down" at once, to every model: nothing was billed, so nothing is counted
    let r=await chat('p','RATELIMIT'); assert.equal(r.j.error.code,'rate_limited'); assert.match(r.j.error.message,/האתר הגיע למגבלת הקצב שלו/);
    r=await read('p','claude-fable-5-1','ALL429 read'); assert.equal(r.j.error.code,'rate_limited'); assert.doesNotMatch(r.j.error.message,/נוסו|claude-/,'a partner is not shown model names');
    r=await read('p','claude-haiku-5-5','ALL429 read'); assert.equal(r.j.error.code,'rate_limited');
    let u=await row(); assert.equal(u.today,0); assert.equal(u.quickToday,0);
    // no credit on the site's key: the owner is told what to do, a partner that it is the site's and not theirs
    r=await chat('o','CREDIT'); assert.equal(r.j.error.code,'sampling_disabled'); assert.match(r.j.error.message,/console\.anthropic\.com/); assert.equal(r.j.error.site,undefined);
    r=await chat('p','CREDIT'); assert.equal(r.j.error.code,'sampling_disabled'); assert.equal(r.j.error.message,'צ׳יקו לא זמין באתר כרגע, בגלל הגדרה בצד של האתר. כדאי לספר לבעל האתר.'); assert.equal(r.j.error.site,undefined);
    r=await read('p','claude-fable-5-1','BADKEY read'); assert.equal(r.j.error.code,'sampling_disabled'); assert.doesNotMatch(r.j.error.message,/Railway|API/);
    r=await read('o','claude-fable-5-1','BADKEY read'); assert.match(r.j.error.message,/Railway/);
    u=await row(); assert.equal(u.today,0,'refused at once: not counted');
    // what was read counts as before
    r=await read('p','claude-fable-5-1','read this'); assert.equal(r.status,200); u=await row(); assert.equal(u.today,1);
  }finally{srv.close()}
});

test('store: an older database gets the count of quick reads, and keeps its numbers',async()=>{
  const {DatabaseSync}=await import('node:sqlite'); const dir=fs.mkdtempSync('/tmp/tc-mig-'), f=dir+'/tc.db';
  const old=new DatabaseSync(f); old.exec("create table ai_usage(uid text not null, day text not null, calls integer not null default 0, input integer not null default 0, output integer not null default 0, primary key(uid,day)); insert into ai_usage values('u1','2026-10-14',5,100,20)"); old.close();
  try{
    const s=new Store(f); assert.deepEqual({...s.aiUsage('u1','2026-10-14')},{calls:5,input:100,output:20,quick:0});
    s.aiAdd('u1','2026-10-14',{quick:2}); s.aiAdd('u1','2026-10-14',{calls:1}); assert.deepEqual({...s.aiUsage('u1','2026-10-14')},{calls:6,input:100,output:20,quick:2});
    assert.equal(s.aiSince('2026-10-01')[0].quick,2); assert.deepEqual({...s.aiUsage('u2','2026-10-14')},{calls:0,input:0,output:0,quick:0});
    s.db.close(); const s2=new Store(f); assert.equal(s2.aiUsage('u1','2026-10-14').quick,2,'opened again: the column is there once'); s2.db.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('backups: a daily copy of the database, the last 14 kept, the owner\'s own data for mail',async()=>{
  const fs=await import('node:fs'), os=await import('node:os'), path=await import('node:path');
  const {backupNow,backupStatus,backupTask,ownerExport}=await import('../server/backup.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tcbk-')), store=new Store(':memory:');
  store.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:1}]}); store.setDoc('data/users/u1/portfolio',{positions:[{sym:'KO',qty:2}]});
  for(let d=1;d<=16;d++)backupNow(store,{dataDir:dir,keep:14,now:new Date(Date.UTC(2026,9,d,0,30))});
  const st=backupStatus(store,{dataDir:dir}); assert.equal(st.files.length,14); assert.equal(st.files[0].name,'tikchik-2026-10-16.sqlite'); assert.equal(st.last.file,'tikchik-2026-10-16.sqlite');
  const copy=new Store(path.join(dir,'backups','tikchik-2026-10-16.sqlite')); assert.equal(copy.getDoc('data/users/u1/portfolio').data.positions[0].sym,'KO','the copy holds everything'); copy.close();
  assert.ok(!Object.keys(ownerExport(store).docs).some(p=>p.startsWith('data/users/')),'the mailed copy leaves the partners out');
  const saved={...process.env}; delete process.env.RESEND_API_KEY; delete process.env.MAIL_USER; delete process.env.MAIL_PASS;
  try{const r=await backupTask(store,{dataDir:dir}); assert.equal(r.mailed,false)}finally{Object.assign(process.env,saved)}
  fs.rmSync(dir,{recursive:true,force:true});
});

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
  assert.equal(tickerFor('SAP.DE'),'SAP.DE','an exchange suffix stays'); assert.equal(tickerFor('7203.T'),'7203.T'); assert.equal(tickerFor('0700.HK'),'0700.HK');
  const all=await fetchAll(['MSFT','BAD','TA125'],{positions:[{sym:'TA125',ccy:'ILS',px:61.92}],fetch:f});
  assert.equal(all.quotes.BAD.src,'stooq'); assert.ok(all.index.TA125); assert.equal(all.fx.boi.rate,3.074);
  const doc=buildQuotesDoc({prev:{prices:{TA125:61.92},prev:{TA125:61.5}},fetched:all,symbols:['MSFT','BAD','TA125'],positions:[],now:new Date('2026-10-12T08:00:00Z'),ilOpen:true});
  assert.equal(doc.prices.MSFT,530.5); assert.equal(doc.prev.MSFT,520); assert.equal(doc.stale.TA125,'לפי מדד ת״א 125'); assert.equal(doc.usdIls,3.081);
});

test('prices: "live" only when today\'s trades arrived; a run that got nothing keeps the old time; old prices are marked',()=>{
  const q=(px,date)=>({px,prev:px-1,closeDate:date,ccy:'USD',src:'yahoo',time:'t'});
  const old={prices:{MSFT:500,OLD:7},prev:{MSFT:499},meta:{OLD:{date:'2026-10-01'}},usdIls:3.07,priceLabel:'סגירה 9.10',updatedAt:'2026-10-12T13:00:00.000Z'};
  // New York open by the clock, and the trades are from today: live
  let d=buildQuotesDoc({prev:old,fetched:{quotes:{MSFT:q(510,'2026-10-12')},index:{},errors:[]},symbols:['MSFT'],now:new Date('2026-10-12T15:00:00Z'),usOpen:true});
  assert.match(d.priceLabel,/מסחר חי/); assert.equal(d.live,true); assert.equal(d.updatedAt,'2026-10-12T15:00:00.000Z'); assert.equal(d.got,1); assert.equal(d.lastTradeDay,'2026-10-12');
  // open by the clock but the last trade is from yesterday (a holiday): a close, not "live"
  d=buildQuotesDoc({prev:old,fetched:{quotes:{MSFT:q(510,'2026-10-09')},index:{},errors:[]},symbols:['MSFT'],now:new Date('2026-10-12T15:00:00Z'),usOpen:true});
  assert.equal(d.priceLabel,'סגירה 9.10'); assert.equal(d.live,false);
  // every fetch failed: the old time and label stay, the attempt is recorded
  d=buildQuotesDoc({prev:old,fetched:{quotes:{},index:{},errors:[{sym:'MSFT'}]},symbols:['MSFT'],now:new Date('2026-10-12T15:00:00Z'),usOpen:true});
  assert.equal(d.updatedAt,old.updatedAt); assert.equal(d.priceLabel,'המחירים האחרונים שהתקבלו'); assert.equal(d.attemptAt,'2026-10-12T15:00:00.000Z'); assert.equal(d.got,0); assert.equal(d.stale.MSFT,'מחיר קודם');
  // a price that was not refreshed this time (past the cap) is marked with its date
  assert.equal(d.stale.OLD,'סגירה 1.10');
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
  // NYSE holidays and early closes (the NYSE's calendar): Thanksgiving closed, the day after closes at 13:00 New York time
  assert.equal(usOpen(new Date('2026-11-26T16:00:00Z')),false); assert.equal(usOpen(new Date('2026-11-27T17:30:00Z')),true); assert.equal(usOpen(new Date('2026-11-27T18:30:00Z')),false);
  assert.equal(usOpen(new Date('2027-03-26T15:00:00Z')),false,'Good Friday 2027');
  // Tel Aviv on Friday: until 14:00
  assert.equal(ilOpen(new Date('2026-10-16T10:50:00Z')),true); assert.equal(ilOpen(new Date('2026-10-16T11:05:00Z')),false);
  // the last session a market should have reported: Friday's close on a Sunday; Thursday's before Friday has traded half an hour
  assert.equal(lastSession('il',new Date('2026-10-18T15:00:00Z')),'2026-10-16'); assert.equal(lastSession('il',new Date('2026-10-16T06:00:00Z')),'2026-10-15');
  assert.equal(lastSession('il',new Date('2026-10-16T08:00:00Z')),'2026-10-16'); assert.equal(lastSession('us',new Date('2026-09-07T20:00:00Z')),'2026-09-04','Labor Day');
  // the price runs: weekdays on :40, every 5 minutes while a market trades, and the weekend catch-ups
  const due=iso=>pxDue(ilParts(new Date(iso)),new Date(iso));
  assert.equal(due('2026-10-18T15:40:00Z'),true,'Sunday 18:40'); assert.equal(due('2026-10-18T16:40:00Z'),false); assert.equal(due('2026-10-17T07:40:00Z'),true,'Saturday 10:40');
  assert.equal(due('2026-10-12T08:05:00Z'),true,'Monday while Tel Aviv trades'); assert.equal(due('2026-10-12T20:40:00Z'),true); assert.equal(due('2026-10-18T15:35:00Z'),false);
  // every 15 minutes at any hour, nights and weekends included, for the funds' official prices
  assert.equal(due('2026-10-20T22:15:00Z'),true,'Wednesday 01:15'); assert.equal(due('2026-10-17T19:45:00Z'),true,'Saturday 22:45'); assert.equal(due('2026-10-20T22:20:00Z'),false,'01:20, markets closed');
});

test('prices: an Israeli mutual fund comes from Maya, read defensively, in the scale of the price we hold',async()=>{
  // three shapes the fund details might take: nested with a redemption price and a day's change, flat with a unit value, and one without any price
  const shapes={a:{FundDetails:{FundId:5129283,FundName:'הראל מחקה NASDAQ 100',RedemptionPrice:'1,234.56',PurchasePrice:1240.1,DayYield:1.25,LastUpdateDate:'16/10/2026'}},
    b:{UnitValuePrice:987.6,RateDate:'2026-10-16T00:00:00',DailyYieldPercent:-0.5},
    c:{FundName:'x',Category:'y'}};
  const res=(status,body)=>({ok:status<400,status,json:async()=>body,text:async()=>JSON.stringify(body)});
  let hit=[]; const f=async(u,o)=>{hit.push(u); assert.equal(o.headers['x-maya-with'],'allow'); const id=(u.match(/(\d{7})/)||[])[1]; return id==='5129283'?res(200,shapes.a):id==='5117585'?res(200,shapes.b):id==='5127790'?res(200,shapes.c):res(404,{})};
  const a=await mayaFund('5129283',{fetch:f}); assert.equal(a.px,1234.56); assert.equal(a.closeDate,'2026-10-16'); assert.equal(a.ccy,'ILS'); assert.equal(a.src,'maya'); assert.ok(Math.abs(a.prev-1234.56/1.0125)<1e-6);
  const b=await mayaFund('5117585',{fetch:f}); assert.equal(b.px,987.6); assert.equal(b.closeDate,'2026-10-16'); assert.ok(Math.abs(b.prev-987.6/0.995)<1e-6);
  await assert.rejects(()=>mayaFund('5127790',{fetch:f}),/no price field; keys: FundName,Category/);
  // fields that look like a price or a date but are not: a fee, a ratio, the fund's start date
  const tricky=fundFromJson({ManagementFeeRate:0.75,FundStartDate:'01/03/2011',TrusteeFeeRate:0.03,Prices:{PurchasePrice:1240,RedemptionPrice:1234},YearYield:12.5,DayYield:0.4},new Date('2026-10-18T15:00:00Z'));
  assert.equal(tricky.px,1234,'the redemption price, not a fee or the purchase price'); assert.equal(tricky.closeDate,'','the start date is not the price date'); assert.ok(Math.abs(tricky.prev-1234/1.004)<1e-6);
  assert.equal(fundFromJson({ManagementFeeRate:0.75,FundStartDate:'01/03/2011'}),null,'no price at all');
  // two dates beside the price: the latest one is the price's
  const two=fundFromJson({RedemptionPrice:100,IndexDate:'15/10/2026',PriceDate:'19/10/2026'},new Date('2026-10-20T07:00:00Z'));
  assert.equal(two.closeDate,'2026-10-19'); assert.deepEqual(Object.keys(two.dates),['IndexDate','PriceDate']);
  assert.equal(isIlFund('5129283'),true); assert.equal(isIlFund('1159250'),false); assert.equal(isIlFund('MSFT'),false);
  // through fetchAll: the fund never goes to Yahoo; the stored price (in shekels) sets the scale of Maya's agorot
  hit=[]; const all=await fetchAll(['5129283'],{positions:[{sym:'5129283',ccy:'ILS',px:11.9}],fetch:f});
  assert.ok(all.quotes['5129283']); assert.ok(!hit.some(u=>u.includes('yahoo')&&u.includes('5129283')),'no Yahoo call for a mutual fund');
  const d=buildQuotesDoc({prev:{},fetched:all,symbols:['5129283'],positions:[{sym:'5129283',ccy:'ILS',px:11.9}],now:new Date('2026-10-18T15:00:00Z')});
  assert.equal(d.prices['5129283'],12.3456,'agorot became shekels'); assert.equal(d.meta['5129283'].src,'maya'); assert.equal(d.meta['5129283'].date,'2026-10-16'); assert.equal(d.stale['5129283'],undefined); assert.equal(d.ilDate,'2026-10-16');
  // a stored price already in agorot keeps Maya's scale
  const e=buildQuotesDoc({prev:{prices:{'5129283':1200}},fetched:all,symbols:['5129283'],positions:[],now:new Date('2026-10-18T15:00:00Z')});
  assert.equal(e.prices['5129283'],1234.56);
});

test('prices: a fund that follows a US index is carried from its official price by the index and the dollar',async()=>{
  // Maya's own answer for the fund (its shape on 20.10.2026), Yahoo's bars for the index and the dollar
  const maya={fundId:5129283,name:'הראל מחקהNDX 100',longName:'הראל מחקה (4D)יNASDAQ 100',redemptionPrice:373.6,ratesAsOf:'2026-10-15',yields:{dueDate:'2026-10-15',dayYield:0.27}};
  const bars=(closes)=>({chart:{result:[{meta:{gmtoffset:0},timestamp:closes.map(([d])=>Date.parse(d+'T20:00:00Z')/1000),indicators:{quote:[{close:closes.map(([,c])=>c)}]}}]}});
  const res=b=>({ok:true,status:200,json:async()=>b});
  const f=async u=>u.includes('maya.tase.co.il/api/v1/funds/mutual/5129283')?res(maya):u.includes('%5ENDX')&&u.includes('range=1mo')?res(bars([['2026-10-13',19800],['2026-10-14',20000],['2026-10-15',20100]]))
    :u.includes('USDILS')&&u.includes('range=1mo')?res(bars([['2026-10-14',3.70],['2026-10-15',3.72]])):{ok:false,status:404,json:async()=>({})};
  const q=await mayaFund('5129283',{fetch:f}); assert.equal(q.px,373.6); assert.equal(q.closeDate,'2026-10-15'); assert.match(q.name,/NDX 100/); assert.equal(trackOf(q.name),'NDX');
  const all=await fetchAll(['5129283'],{fetch:f}); assert.deepEqual(all.quotes['5129283'].base,{k:'NDX',idx:20000,idxDate:'2026-10-14',fx:3.72});
  // now: the index 2% above the 14.10 close, the dollar 1% below the 15.10 rate
  all.bench={NDX:{px:20400,prev:20300,date:'2026-10-19'}}; all.fx={live:{px:3.6828}};
  const d=buildQuotesDoc({prev:{prices:{'5129283':373}},fetched:all,symbols:['5129283'],now:new Date('2026-10-20T10:00:00Z')});
  assert.ok(Math.abs(d.prices['5129283']-373.6*1.02*0.99)<1e-3); assert.ok(Math.abs(d.prev['5129283']-d.prices['5129283']/(20400/20300))<1e-3,'4.11: the day\'s change is the index\'s day, not the way from the official price');
  assert.match(d.stale['5129283'],/^הערכה לפי נאסד״ק 100 ושער הדולר · מחיר רשמי 15.10$/); assert.equal(d.lag.il,undefined,'an estimate is not a missing session');
  // overnight: the future's move since its last settlement is added to the index's close
  all.bench={NDX:{px:20400,prev:20300,date:'2026-10-19',fut:{px:20604,prev:20400,date:'2026-10-20'}}};
  const e=buildQuotesDoc({prev:{},fetched:all,symbols:['5129283'],now:new Date('2026-10-20T07:00:00Z')});
  assert.ok(Math.abs(e.prices['5129283']-373.6*(20604/20000)*0.99)<1e-3);
  assert.equal(trackOf('מור מחקה NASDAQ100'),'NDX'); assert.equal(trackOf('הראל כספית מגמת ריבית'),'');
});

test('prices: Maya is asked past its cache on every interface, and the newest price wins',async()=>{
  // 20.10.2026: one interface still answered 15.10 while the fund's page showed 367.77 for 19.10
  const old={fundId:5129283,name:'הראל מחקהNDX 100',redemptionPrice:373.6,ratesAsOf:'2026-10-15',yields:{dayYield:0.27}};
  const cur={fundId:5129283,name:'הראל מחקהNDX 100',redemptionPrice:367.77,ratesAsOf:'2026-10-19',yields:{dayYield:-0.4}};
  const res=b=>({ok:true,status:200,json:async()=>b}); let seen=[];
  const f=async(u,o)=>{seen.push([u,o]); return u.includes('mayaapi.tase.co.il')?res(cur):res(old)};
  const q=await mayaFund('5129283',{fetch:f,now:()=>42});
  assert.equal(q.px,367.77); assert.equal(q.closeDate,'2026-10-19');
  assert.deepEqual(q.srcDates,{'maya.tase.co.il':'2026-10-15','mayaapi.tase.co.il':'2026-10-19'},'the history answered nothing here');
  assert.equal(seen.length,3,'both details interfaces and the history asked'); assert.ok(seen.every(([u,o])=>/[?&]_=42$/.test(u)&&o.headers['cache-control']==='no-cache'),'past any cache');
  // the same day on both: the fund page's own interface is kept; one interface down: the other one answers
  const g=async u=>u.includes('mayaapi')?{ok:false,status:500,json:async()=>({})}:res(cur);
  const r=await mayaFund('5129283',{fetch:g}); assert.equal(r.closeDate,'2026-10-19'); assert.equal(r.srcDates,undefined);
});

test('prices: Maya\'s fund history gives the newest price and the one before it, when the details lag',async()=>{
  const old={fundId:5129283,name:'הראל מחקהNDX 100',redemptionPrice:373.6,ratesAsOf:'2026-10-15',yields:{dayYield:0.27}};
  const hist={totalRecords:3,items:[{tradeDate:'2026-10-19T00:00:00',purchasePrice:367.77,redemptionPrice:367.77},{tradeDate:'2026-10-16T00:00:00',purchasePrice:369.1,redemptionPrice:369.1},{tradeDate:'2026-10-15T00:00:00',redemptionPrice:373.6}]};
  const res=b=>({ok:true,status:200,json:async()=>b}); let post=null;
  const f=async(u,o)=>{if(/\/history\?/.test(u)){post=o; return res(hist)} return u.includes('mayaapi')?{ok:false,status:404,json:async()=>({})}:res(old)};
  const q=await mayaFund('5129283',{fetch:f,now:()=>Date.parse('2026-10-20T17:00:00Z')});
  assert.equal(q.px,367.77); assert.equal(q.closeDate,'2026-10-19'); assert.equal(q.prev,369.1); assert.equal(q.prevDate,'2026-10-16');
  assert.match(q.name,/NDX 100/,'the name comes from the details answer, so the index estimate still knows the fund'); assert.equal(post.method,'POST'); assert.deepEqual(JSON.parse(post.body),{pageSize:10,pageNumber:1,period:0});
  assert.deepEqual(q.srcDates,{'maya.tase.co.il':'2026-10-15','maya.tase.co.il/history':'2026-10-19'});
});

test('prices: when Yahoo does not answer, a US ticker comes from Nasdaq before Stooq, and is still a US close',async()=>{
  const {nasdaqParse}=await import('../shared/quotes.js');
  const nq={data:{symbol:'MSFT',exchange:'NASDAQ-GS',primaryData:{lastSalePrice:'$530.97',netChange:'-2.55',percentageChange:'-0.48%',lastTradeTimestamp:'Oct 20, 2026 4:00 PM ET'}},status:{rCode:200}};
  assert.deepEqual(nasdaqParse(nq,new Date('2026-10-21T09:00:00Z')),{px:530.97,prev:533.52,ccy:'USD',time:Date.parse('2026-10-21T09:00:00Z'),closeDate:'2026-10-20',prevDate:null,exch:'NASDAQ-GS',src:'nasdaq'});
  assert.equal(nasdaqParse({data:{primaryData:{lastSalePrice:'N/A'}}}),null);
  const hit=[], f=async u=>{u=String(u); hit.push(u); if(u.includes('yahoo'))return {ok:false,status:429,json:async()=>({})};
    if(u.includes('api.nasdaq.com/api/quote/MSFT/info?assetclass=stocks'))return {ok:true,status:200,json:async()=>nq};
    if(u.includes('api.nasdaq.com/api/quote/VOO/info?assetclass=stocks'))return {ok:true,status:200,json:async()=>({data:null})};
    if(u.includes('api.nasdaq.com/api/quote/VOO/info?assetclass=etf'))return {ok:true,status:200,json:async()=>({data:{primaryData:{lastSalePrice:'$620.10',netChange:'+1.10',lastTradeTimestamp:'Closed at Oct 20, 2026'}}})};
    if(u.includes('stooq'))return {ok:true,status:200,text:async()=>'Date,Open,High,Low,Close\n2026-10-15,1,1,1,500\n2026-10-16,1,1,1,505'};
    return {ok:false,status:404,json:async()=>({})}};
  const all=await fetchAll(['MSFT','VOO','KO'],{fetch:f});
  assert.equal(all.quotes.MSFT.src,'nasdaq'); assert.equal(all.quotes.MSFT.closeDate,'2026-10-20'); assert.equal(all.quotes.VOO.px,620.1,'an ETF asked as an ETF'); assert.equal(all.quotes.KO.src,'stooq','Stooq is the last one');
  const d=buildQuotesDoc({prev:{},fetched:all,symbols:['MSFT','VOO','KO'],now:new Date('2026-10-21T09:00:00Z')});
  assert.equal(d.prices.MSFT,530.97); assert.equal(d.prev.MSFT,533.52); assert.equal(d.usDate,'2026-10-20','a Nasdaq close is the US date');
  assert.equal(d.stale.MSFT,undefined); assert.equal(d.stale.KO,'סגירה 16.10','Stooq\'s older close is marked'); assert.match(d.source,/Nasdaq/);
  assert.equal(d.lag.us.n,1,'only KO is behind');
});

test('prices: a close older than the last session is marked, counted per market, and named in the label',()=>{
  const q=(px,date,ccy)=>({px,prev:px-1,closeDate:date,ccy,src:'yahoo',time:'t'});
  // Sunday evening: New York closed Friday 16.10, Tel Aviv's Friday did not arrive for one of two securities
  const sun=new Date('2026-10-18T15:00:00Z');
  const d=buildQuotesDoc({prev:{},fetched:{quotes:{MSFT:q(510,'2026-10-16','USD'),'ABRA.TA':q(50,'2026-10-15','ILS'),'TEVA.TA':q(60,'2026-10-16','ILS')},index:{},errors:[]},symbols:['MSFT','ABRA.TA','TEVA.TA'],now:sun});
  assert.equal(d.stale['ABRA.TA'],'סגירה 15.10'); assert.equal(d.stale.MSFT,undefined); assert.equal(d.stale['TEVA.TA'],undefined);
  assert.deepEqual(d.lag,{il:{have:'2026-10-15',want:'2026-10-16',n:1,of:2}}); assert.equal(d.priceLabel,'סגירה 16.10');
  // every Tel Aviv price stops at Thursday: the label says so next to New York's Friday
  const e=buildQuotesDoc({prev:{},fetched:{quotes:{MSFT:q(510,'2026-10-16','USD'),'ABRA.TA':q(50,'2026-10-15','ILS')},index:{},errors:[]},symbols:['MSFT','ABRA.TA'],now:sun});
  assert.equal(e.priceLabel,'סגירה 16.10 · תל אביב: סגירה 15.10'); assert.equal(e.ilDate,'2026-10-15'); assert.equal(e.lag.il.n,1);
  // all current: nothing marked, no lag
  const f=buildQuotesDoc({prev:{},fetched:{quotes:{MSFT:q(510,'2026-10-16','USD'),'ABRA.TA':q(50,'2026-10-16','ILS')},index:{},errors:[]},symbols:['MSFT','ABRA.TA'],now:sun});
  assert.deepEqual(f.lag,{}); assert.deepEqual(f.stale,{}); assert.equal(f.priceLabel,'סגירה 16.10');
});

// ---- privacy ----
// the page's redaction, taken from the page itself so the test checks the code that runs
const PAGE=fs.readFileSync(new URL('../page/live.html',import.meta.url),'utf8');
const redactPII=new Function(PAGE.slice(PAGE.indexOf('// ---- redact:start'),PAGE.indexOf('// ---- redact:end'))+';return redactPII')();
test('privacy: personal details out of a statement\'s text, the holdings untouched',()=>{
  const r=redactPII([
    'שם הלקוח: ישראל ישראלי ת.ז. 012345674 מספר חשבון: 123-456789/12 תאריך 30/09/2026',
    'חשבון מספר \u202a654321\u202c :',
    '012345674 :ז.ת',
    'כתובת: הרצל 12, תל אביב תאריך הדוח 30.09.2026 · מיקוד 6100000',
    'טלפון 054-1234567 · a.b@gmail.com · IBAN IL62 0108 0000 0009 9999 999',
    'לכבוד\nישראל ישראלי\nרח\' הרצל 12',
    'TEVA,629014,100,3512.00,351200.00',
    'טבע תעשיות 629014 100 35.12 3,512.00 · אחוז מהתיק 4.2',
    'יתרת מזומן בחשבון,12345.67 · מענק 500 ש"ח · Security ID: 1159250 · paid 123456789',
    'עמוד 1 · 654321',
    'חשבון,נייר,כמות,שווי\n777888,KO,10,700',
  ].join('\n'),{first:'ישראל',last:'ישראלי'});
  const t=r.text;
  for(const gone of ['012345674','123-456789/12','654321','הרצל','6100000','054-1234567','a.b@gmail.com','IL62','ישראלי','777888'])assert.ok(!t.includes(gone),gone+' was removed');
  for(const kept of ['30/09/2026','30.09.2026','TEVA,629014,100,3512.00,351200.00','629014 100 35.12 3,512.00','4.2','12345.67','מענק 500','1159250','123456789','KO,10,700'])assert.ok(t.includes(kept),kept+' was kept');
  assert.deepEqual(Object.keys(r.kinds).sort(),['acct','addr','id','mail','name','phone']);
  assert.equal(redactPII('MSFT 3 4200\nNVDA 1.5 900',{}).n,0,'a plain list of holdings has nothing to remove');
});

test('privacy: a partner sees only their own securities in the shared documents',()=>{
  const s=new Store(':memory:');
  const O={id:'u_o',role:'owner'}, A={id:'u_a',role:'friend'};
  s.setDoc('data/users/u_a/portfolio',{positions:[{sym:'KO',qty:1}]}); s.setDoc('watch/u_a',{syms:['V'],held:['KO'],marks:[],seen:['1159250']});
  s.setDoc('data/users/u_a/settings',{pxAlerts:{'TLV:629014':{above:40}}});
  const Q={prices:{MSFT:500,KO:70,V:300,NVDA:180,'1159250':4.1,'629014':35},prev:{MSFT:490,KO:69,NVDA:170},stale:{NVDA:'מחיר קודם'},meta:{MSFT:{},KO:{}},usdIls:3.1,priceLabel:'x',errors:['NVDA: down','RDW: down'],got:5,of:6};
  const a=partnerView(s,A,'quotes/latest',Q);
  assert.deepEqual(Object.keys(a.prices).sort(),['1159250','629014','KO','V']); assert.deepEqual(Object.keys(a.prev),['KO']); assert.deepEqual(a.stale,{});
  assert.equal(a.errors,undefined,'the failures name everybody\'s symbols'); assert.equal(a.usdIls,3.1); assert.equal(a.priceLabel,'x');
  assert.equal(partnerView(s,O,'quotes/latest',Q),Q,'the owner sees everything');
  assert.deepEqual(Object.keys(partnerView(s,A,'history/prices',{months:['2026-09'],px:{MSFT:[1],KO:[2]}}).px),['KO']);
  assert.deepEqual(Object.keys(partnerView(s,A,'research/latest',{companies:{MSFT:{},KO:{}},events:[]}).companies),['KO']);
  const cm=partnerView(s,A,'research/comove',{groups:[{name:'g',syms:['MSFT','KO','V']},{name:'h',syms:['NVDA','KO']}],pairs:[{a:'KO',b:'V'},{a:'KO',b:'MSFT'}],opposite:[],solo:['KO','META'],nodata:['TA125'],whyPairs:{'KO|V':'x','KO|MSFT':'y'}});
  assert.deepEqual(cm.groups.map(g=>g.syms),[['KO','V']]); assert.deepEqual(cm.pairs,[{a:'KO',b:'V'}]); assert.deepEqual(cm.solo,['KO']); assert.deepEqual(cm.nodata,[]); assert.deepEqual(Object.keys(cm.whyPairs),['KO|V']);
  assert.deepEqual(partnerView(s,A,'research/longterm',{pairs:[{a:'KO',b:'V'},{a:'MSFT',b:'KO'}]}).pairs,[{a:'KO',b:'V'}]);
  assert.deepEqual(partnerView(s,A,'research/candidates',{items:[{sym:'PG'}]}),{items:[{sym:'PG'}]},'the general candidates list is the same for all');
});

test('privacy: over the API, partners and the owner do not see each other\'s symbols',async()=>{
  const {store,srv,base,req,jar}=await startApp();
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    const mk=async(who,email)=>{await req('o','POST','/api/users',{email,password:'first-pass-1'}); const r=await req(who,'POST','/api/login',{email,password:'first-pass-1'}); await req(who,'POST','/api/password',{old:'first-pass-1',password:'my-own-pass'}); return r.j.me.id};
    const a=await mk('a','a@example.com'), b=await mk('b','b@example.com');
    assert.equal((await req('a','PUT','/api/db/doc?path=watch/'+a,{held:['KO'],syms:[],marks:[],seen:[]})).status,200);
    assert.equal((await req('b','PUT','/api/db/doc?path=watch/'+b,{held:['PEP'],syms:[],marks:[],seen:[]})).status,200);
    store.setDoc('quotes/latest',{prices:{MSFT:500,KO:70,PEP:150},usdIls:3.1,errors:['PEP: x']});
    let r=await req('a','GET','/api/db/doc?path=quotes/latest'); assert.deepEqual(Object.keys(r.j.data.prices),['KO'],'not the owner\'s MSFT, not B\'s PEP');
    r=await req('o','GET','/api/db/doc?path=quotes/latest'); assert.deepEqual(Object.keys(r.j.data.prices).sort(),['KO','MSFT','PEP']);
    assert.equal((await req('a','GET','/api/db/list?path=quotes')).status,403,'no listing of the shared collections');
    assert.equal((await req('a','GET','/api/db/list?path=research')).status,403);
    assert.equal((await req('o','GET','/api/db/doc?path=watch/'+a)).status,403,'the owner does not see a partner\'s list');
    assert.equal((await req('o','GET','/api/db/list?path=watch')).status,403);
    r=await req('o','GET','/api/db/export'); assert.ok(!Object.keys(r.j.docs).some(p=>p.startsWith('watch/')),'nor in the export');
    r=await req('o','POST','/api/db/import',{docs:{['watch/'+a]:{held:['X']}}}); assert.equal(r.j.n,0,'and the import does not write it');
    r=await req('a','GET','/api/db/export'); assert.ok(r.j.docs['watch/'+a]&&!r.j.docs['watch/'+b]);
    // the live stream does not tell a partner which charts the server refreshes
    const ctl=new AbortController(), got=[]; const sr=await fetch(base+'/api/db/stream',{headers:{cookie:jar.a},signal:ctl.signal});
    const rd=sr.body.getReader(); const pump=(async()=>{try{for(;;){const {value,done}=await rd.read(); if(done)break; got.push(new TextDecoder().decode(value))}}catch(e){}})();
    await new Promise(r=>setTimeout(r,100)); store.setDoc('quotes/c_MSFT',{closes:[]}); store.setDoc('quotes/latest',{prices:{}}); await new Promise(r=>setTimeout(r,200)); ctl.abort(); await pump;
    assert.deepEqual(got.join('').split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)).path),['quotes/latest']);
  }finally{srv.close()}
});

test('privacy: no portfolio numbers or e-mail addresses in the log',async()=>{
  const {sendMail}=await import('../server/mail.js'); const lines=[], orig=console.log; console.log=(...a)=>lines.push(a.join(' '));
  const keep={R:process.env.RESEND_API_KEY,U:process.env.MAIL_USER}; delete process.env.RESEND_API_KEY; delete process.env.MAIL_USER;
  try{assert.equal(await sendMail({subject:'הודעת הבוקר: התיק 76,543 ₪',text:'שווי התיק 76,543 ₪, a@b.com'}),false)}finally{console.log=orig; if(keep.R)process.env.RESEND_API_KEY=keep.R; if(keep.U)process.env.MAIL_USER=keep.U}
  assert.equal(lines.length,1); assert.ok(!/76,543|a@b\.com|הודעת הבוקר/.test(lines[0]),lines[0]);
});

// ---- stability ----
test('the site is sent compressed when the browser accepts it, and the same file when it does not',async()=>{
  const zlib=await import('node:zlib'), os=await import('node:os'), path=await import('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tcsite-')); const html='<!doctype html><title>x</title>'+'<p>תיק צ׳יק</p>'.repeat(5000); fs.writeFileSync(path.join(dir,'index.html'),html); fs.writeFileSync(path.join(dir,'small.js'),'1');
  const {createApp}=await import('../server/index.js'); const app=createApp({store:new Store(':memory:'),siteDir:dir,jobs:false});
  const srv=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))}); const base='http://127.0.0.1:'+srv.address().port;
  const raw=(u,h)=>new Promise((ok,no)=>http.get(base+u,{headers:h},res=>{const b=[];res.on('data',c=>b.push(c));res.on('end',()=>ok({status:res.statusCode,h:res.headers,body:Buffer.concat(b)}))}).on('error',no));
  try{
    let r=await raw('/',{'accept-encoding':'gzip, deflate, br'}); assert.equal(r.h['content-encoding'],'br'); assert.equal(zlib.brotliDecompressSync(r.body).toString(),html); assert.ok(r.body.length<html.length/5); assert.equal(r.h.vary,'accept-encoding'); assert.equal(r.h['cache-control'],'no-cache');
    const tag=r.h.etag; r=await raw('/',{'accept-encoding':'br','if-none-match':tag}); assert.equal(r.status,304);
    r=await raw('/index.html',{'accept-encoding':'gzip'}); assert.equal(r.h['content-encoding'],'gzip'); assert.equal(zlib.gunzipSync(r.body).toString(),html);
    r=await raw('/',{'accept-encoding':'identity'}); assert.equal(r.h['content-encoding'],undefined); assert.equal(r.body.toString(),html);
    r=await raw('/small.js',{'accept-encoding':'br'}); assert.equal(r.h['content-encoding'],undefined,'a small file is sent as it is');
    r=await raw('/../../etc/passwd',{'accept-encoding':'br'}); assert.notEqual(r.status,200);
  }finally{srv.close(); fs.rmSync(dir,{recursive:true,force:true})}
});

test('jobs: one that hangs does not hold the queue; a job already waiting is not queued twice',async()=>{
  const {startJobs}=await import('../server/jobs.js'); const ran=[], lines=[];
  const J=startJobs(new Store(':memory:'),{log:(...a)=>lines.push(a.join(' ')),every:1e9,limits:{slow:150},schedule:[
    {name:'slow',when:()=>false,run:()=>new Promise(()=>{})},{name:'b',when:()=>false,run:async()=>{ran.push('b')}}]});
  try{J.run('slow'); J.run('b'); J.run('b'); assert.equal(J.queue.filter(j=>j.name==='b').length,1);
    await new Promise(r=>setTimeout(r,400)); assert.deepEqual(ran,['b']); assert.ok(lines.some(l=>/slow still running/.test(l)))}
  finally{J.stop()}
});

// ---- analysts' data from Yahoo Finance ----
const yq=(o)=>({quoteSummary:{result:[o],error:null}});
const YSUM={
  NVDA:yq({financialData:{grossMargins:{raw:0.75},operatingMargins:{raw:0.6},profitMargins:{raw:0.55},freeCashflow:{raw:50},totalRevenue:{raw:200},returnOnEquity:{raw:1.1},debtToEquity:{raw:12.5},currentRatio:{raw:4.2},
    recommendationMean:{raw:1.4},recommendationKey:'strong_buy',numberOfAnalystOpinions:{raw:58},targetMeanPrice:{raw:225.4},revenueGrowth:{raw:0.62},earningsGrowth:{raw:0.7},currentPrice:{raw:180.1}},
    summaryDetail:{trailingPE:{raw:51.2},forwardPE:{raw:31.5},dividendYield:{raw:0.0002},beta:{raw:1.9}},defaultKeyStatistics:{'52WeekChange':{raw:0.35}},
    calendarEvents:{earnings:{earningsDate:[{raw:Date.parse('2026-11-19T21:00:00Z')/1000}]}},recommendationTrend:{trend:[{period:'0m',strongBuy:20,buy:30,hold:6,sell:1,strongSell:1}]},price:{currency:'USD'}}),
  'TEVA.TA':yq({financialData:{profitMargins:{raw:0.09},numberOfAnalystOpinions:{raw:4},recommendationMean:{raw:2.7},targetMeanPrice:{raw:7500},currentPrice:{raw:6200}},summaryDetail:{trailingPE:{raw:23}},price:{currency:'ILA'}}),
  KO:yq({financialData:{numberOfAnalystOpinions:{raw:0}},summaryDetail:{dividendYield:{raw:0.03}},price:{currency:'USD'}})
};
function fakeYahoo({crumbFail=false}={}){const seen=[]; return {seen,f:async(u,o={})=>{u=String(u); seen.push(u);
  if(u.startsWith('https://fc.yahoo.com'))return new Response('',{status:404,headers:{'set-cookie':'A3=d=AQABBC; Domain=.yahoo.com; Path=/'}});
  if(u.includes('/v1/test/getcrumb'))return crumbFail?new Response('',{status:401}):(o.headers&&/A3=/.test(o.headers.cookie)?new Response('Ab3cD.eF'):new Response('',{status:403}));
  const m=u.match(/quoteSummary\/([^?]+)\?.*crumb=([^&]+)/); if(m){const t=decodeURIComponent(m[1]); if(decodeURIComponent(m[2])!=='Ab3cD.eF')return new Response('',{status:401});
    return YSUM[t]?new Response(JSON.stringify(YSUM[t]),{headers:{'content-type':'application/json'}}):new Response(JSON.stringify({quoteSummary:{result:null,error:{code:'Not Found'}}}),{status:404})}
  return new Response('',{status:500})}}}
test('analysts: Yahoo Finance into the same documents the page reads, the old figures kept where Yahoo has none',async()=>{
  const {researchTask,figures}=await import('../server/research.js'); const s=new Store(':memory:'); const Y=fakeYahoo();
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'},{sym:'TA125'},{sym:'1159250'}]});
  s.setDoc('watch/u_a',{held:['KO'],marks:['TLV:TEVA'],seen:['ZZZZ'],syms:[]});
  s.setDoc('research/latest',{companies:{NVDA:{f:7,z:9.1,roic:40,inv:{consensus:'Buy'},rating:'Hold'}},events:[],source:'stockanalysis.com',updatedAt:'2026-10-09T13:14:53Z'});
  s.setDoc('research/universe',{keys:['NVDA','KO','QQQQ']}); s.setDoc('research/fit',{rows:{NVDA:[1,2,3,8,5,6,7,8,'Buy',1,1,'2026-01-01',1]},n:1,updatedAt:'2026-10-11T19:50:17Z'});
  s.setDoc('research/candidates',{items:[{sym:'KO',name:'Coca-Cola',pe:20,dy:2.5,group:'cons'}],updatedAt:'2026-10-07T18:30:00Z'});
  const now=new Date('2026-10-14T01:15:00Z'); const st=await researchTask(s,{fetch:Y.f,now,pause:0});
  assert.equal(st.ok,3); assert.equal(st.none,2,'ZZZZ and QQQQ are not covered'); assert.equal(st.fail,0);
  const L=s.getDoc('research/latest').data, n=L.companies.NVDA;
  assert.equal(L.source,'Yahoo Finance'); assert.equal(L.updatedAt,now.toISOString());
  assert.equal(n.gm,75); assert.equal(n.pm,55); assert.equal(n.fcfm,25); assert.equal(n.de,0.13); assert.equal(n.rating,'Strong Buy'); assert.equal(n.target,225.4); assert.equal(n.analysts,58);
  assert.equal(n.next,'2026-11-19'); assert.equal(n.revg,62); assert.equal(n.beta,1.9); assert.deepEqual(n.votes,{buy:50,hold:6,sell:2});
  assert.equal(n.f,7); assert.equal(n.z,9.1); assert.equal(n.roic,40,'what Yahoo does not give stays'); assert.equal(n.inv,undefined,'the second source is no longer updated, so it goes');
  assert.ok(L.companies.KO,'a partner\'s holding is in the shared document (each partner sees only their own)');
  const tv=s.getDoc('research/s_TLV_TEVA').data; assert.equal(tv.target,75,'agorot to shekels'); assert.equal(tv.rating,'Hold','a mean of 2.7 is Hold'); assert.equal(tv.source,'Yahoo Finance');
  assert.equal(s.getDoc('research/s_KO').data.rating,undefined,'no analysts, no rating'); assert.equal(s.getDoc('research/s_KO').data.dy,3);
  const F=s.getDoc('research/fit').data; assert.deepEqual(F.rows.NVDA,[55,110,0.13,8,51.2,31.5,0.02,62,'Strong Buy',225.4,58,'2026-11-19',1.9]); assert.equal(F.source,'Yahoo Finance');
  assert.equal(s.getDoc('research/candidates').data.items[0].dy,3); assert.equal(s.getDoc('research/candidates').data.items[0].name,'Coca-Cola');
  assert.ok(!Y.seen.some(u=>/TA125|1159250/.test(u)),'index funds and security numbers are not asked');
  assert.equal(JSON.parse(s.getMeta('researchStatus')).ok,3);
  assert.equal(figures({},now).rating,null);
});
test('reports: the latest quarter from Yahoo, a new one becomes an event, and the days after a report date are checked again',async()=>{
  const {researchTask,reportOf,repLine,dueReports}=await import('../server/research.js'); const s=new Store(':memory:');
  const R=x=>({raw:x}), Q=d=>R(Date.parse(d+'T00:00:00Z')/1000);
  // Netflix, Q3 2026 (reported 20.10.2026): EPS 0.87 against 0.82, revenue $12.87B
  const nflx={price:{currency:'USD',regularMarketPrice:R(68.69)},financialData:{financialCurrency:'USD',currentPrice:R(68.69),totalRevenue:R(48e9),revenueGrowth:R(0.118)},summaryDetail:{},defaultKeyStatistics:{},
    calendarEvents:{earnings:{earningsDate:[Q('2027-01-20')]}},
    earnings:{financialCurrency:'USD',financialsChart:{quarterly:[{date:'4Q2025',revenue:R(12.05e9),earnings:R(2.4e9)},{date:'1Q2026',revenue:R(12.2e9),earnings:R(2.9e9)},{date:'2Q2026',revenue:R(12.5e9),earnings:R(3.1e9)},{date:'3Q2026',revenue:R(12.874e9),earnings:R(3.66e9)}]}},
    earningsHistory:{history:[{quarter:Q('2025-12-31'),epsActual:R(0.56),epsEstimate:R(0.55),surprisePercent:R(0.018)},{quarter:Q('2026-03-31'),epsActual:R(0.66),epsEstimate:R(0.68),surprisePercent:R(-0.029)},{quarter:Q('2026-06-30'),epsActual:R(0.72),epsEstimate:R(0.7),surprisePercent:R(0.029)},{quarter:Q('2026-09-30'),epsActual:R(0.87),epsEstimate:R(0.82),surprisePercent:R(0.061)}]},
    earningsTrend:{trend:[{period:'0q',endDate:'2026-12-31',growth:R(0.12),earningsEstimate:{avg:R(0.66),numberOfAnalysts:R(30)},revenueEstimate:{avg:R(13.44e9),growth:R(0.115)}},{period:'0y',endDate:'2026-12-31',earningsEstimate:{avg:R(2.91)},revenueEstimate:{avg:R(51.1e9)}}]}};
  const r=reportOf(nflx);
  assert.equal(r.q,'2026-09-30'); assert.equal(r.label,'Q3 2026'); assert.deepEqual(r.eps,{a:0.87,e:0.82,s:6.1}); assert.equal(r.rev,12.874e9); assert.equal(r.ni,3.66e9); assert.equal(r.revQoQ,2.99);
  assert.equal(r.hist.length,4); assert.equal(r.now.eps,0.66); assert.equal(r.now.revG,11.5); assert.equal(r.year.rev,51.1e9);
  assert.equal(repLine(r),'דוח Q3 2026 · רווח למניה 0.87 מול צפי 0.82 (+6.1%, מעל לצפי) · הכנסות $12.87B (+2.99% מהרבעון הקודם)');
  assert.equal(reportOf({}),null,'no report data: nothing, not zeros');
  // stored: the Q2 report and the report date 20.10; the night after it, Q3 arrives
  s.setDoc('portfolio/main',{positions:[{sym:'NFLX'}]});
  s.setDoc('research/s_NFLX',{sym:'NFLX',next:'2026-10-20',rep:{q:'2026-06-30',label:'Q2 2026',at:'2026-07-16'}});
  s.setDoc('research/latest',{companies:{},events:[]});
  assert.deepEqual(dueReports(s,new Date('2026-10-21T04:20:00Z')),['NFLX'],'the report date has come and its report is not in');
  assert.deepEqual(dueReports(s,new Date('2026-10-19T04:20:00Z')),[],'not before the date');
  const f=async(u,o={})=>{u=String(u); if(u.startsWith('https://fc.yahoo.com'))return new Response('',{status:404,headers:{'set-cookie':'A3=x; Path=/'}});
    if(u.includes('getcrumb'))return new Response('Ab3cD.eF'); if(u.includes('quoteSummary/NFLX')&&u.includes('earningsHistory'))return new Response(JSON.stringify({quoteSummary:{result:[nflx]}})); return new Response('',{status:500})};
  const asked=[], mailed=[], explain=async(F)=>{asked.push(F); return {findings:['הרווח למניה 0.87, מעל לצפי האנליסטים (0.82).','ההכנסות $12.87B.'],explain:'הרבעון היה מעל הצפי ברווח.',model:'x',at:'t',headlines:0}};
  const mail=async(st0,items)=>{mailed.push(...items); return true};
  const st=await researchTask(s,{fetch:f,now:new Date('2026-10-21T04:20:00Z'),pause:0,only:['NFLX'],explain,mail});
  assert.equal(st.ok,1); assert.equal(st.reports,1);
  assert.equal(asked.length,1,'one explanation for the new report'); assert.equal(asked[0].eps.actual,'0.87'); assert.equal(asked[0].revenue,'$12.87B'); assert.ok(asked[0].findings.length>=3,'the findings from the numbers go with it');
  assert.equal(mailed.length,1); assert.equal(mailed[0].sym,'NFLX'); assert.equal(mailed[0].rep.ai.explain,'הרבעון היה מעל הצפי ברווח.');
  const d=s.getDoc('research/s_NFLX').data; assert.equal(d.rep.q,'2026-09-30'); assert.match(d.rep.find[0],/^הרווח למניה 0\.87, מעל לצפי האנליסטים \(0\.82\), הפתעה של \+6\.1%\.$/); assert.equal(d.rep.ai.findings.length,2); assert.equal(d.rep.at,'2026-10-20','the day it was reported'); assert.equal(d.next,'2027-01-20');
  const L=s.getDoc('research/latest').data; assert.equal(L.events.length,1); assert.equal(L.events[0].sym,'NFLX'); assert.equal(L.events[0].date,'2026-10-20'); assert.match(L.events[0].text,/^דוח Q3 2026/); assert.equal(L.events[0].ai.explain,'הרבעון היה מעל הצפי ברווח.'); assert.equal(L.events[0].label,'Q3 2026');
  assert.equal(L.companies.NFLX.rep.label,'Q3 2026','a holding carries it into the shared document');
  assert.deepEqual(dueReports(s,new Date('2026-10-21T12:20:00Z')),['NFLX'],'in, and asked again for the share\'s move in the day after it');
  assert.deepEqual(dueReports(s,new Date('2026-10-23T12:20:00Z')),[],'not after that');
  const st2=await researchTask(s,{fetch:f,now:new Date('2026-10-22T04:20:00Z'),pause:0,only:['NFLX'],explain,mail}); assert.equal(st2.reports,0,'the same quarter again is not a new event');
  assert.equal(asked.length,1,'not explained twice'); assert.equal(mailed.length,1,'not mailed twice'); assert.equal(s.getDoc('research/s_NFLX').data.rep.ai.explain,'הרבעון היה מעל הצפי ברווח.','the explanation stays');
  // Claude's text: a sentence with a number it was not given, or with advice, is dropped
  const {cleanText}=await import('../server/explain.js'); const c=cleanText({findings:['הרווח למניה 0.87.','הרווח צפוי לגדול ב-40%.','כדאי לקנות לפני הדוח הבא.'],explain:'ההכנסות $12.87B. המניה תעלה.'},asked[0]);
  assert.deepEqual(c.findings,['הרווח למניה 0.87.']); assert.equal(c.explain,'ההכנסות $12.87B.'); assert.equal(c.dropped,3);
  assert.equal(s.getDoc('research/latest').data.events.length,1); assert.equal(s.getDoc('research/s_NFLX').data.rep.at,'2026-10-20');
});
test('a report as an analysis: earnings and revenue against the estimates from before the report, the next quarter, the share after hours; the mail waits for the revenue; the earlier report is kept',async()=>{
  const {researchTask,dueReports}=await import('../server/research.js'); const {repSum,repLines,cleanText}=await import('../server/explain.js'); const s=new Store(':memory:');
  const R=x=>({raw:x}), Q=d=>R(Date.parse(d+'T00:00:00Z')/1000), T=iso=>Math.round(Date.parse(iso)/1000);
  const hist=(n)=>[{quarter:Q('2025-12-31'),epsActual:R(0.56),epsEstimate:R(0.55)},{quarter:Q('2026-03-31'),epsActual:R(0.66),epsEstimate:R(0.68)},{quarter:Q('2026-06-30'),epsActual:R(0.72),epsEstimate:R(0.7)},{quarter:Q('2026-09-30'),epsActual:R(0.87),epsEstimate:R(0.82),surprisePercent:R(0.061)}].slice(0,n);
  const FIN=[{date:'4Q2025',revenue:R(12.05e9)},{date:'1Q2026',revenue:R(12.2e9)},{date:'2Q2026',revenue:R(12.5e9)},{date:'3Q2026',revenue:R(13.44e9)}], fin=n=>FIN.slice(0,n);
  // Yahoo before the report (the evening of 20.10): Q2 is the last report; for the report of 21.10 the analysts expect 0.82
  // and $12.87B; for the quarter after it 0.73
  const before={price:{currency:'USD'},financialData:{financialCurrency:'USD'},summaryDetail:{},defaultKeyStatistics:{},
    calendarEvents:{earnings:{earningsDate:[Q('2026-10-21')],earningsAverage:R(0.82),revenueAverage:R(12.87e9)}},
    earnings:{financialCurrency:'USD',financialsChart:{quarterly:fin(3)},earningsChart:{quarterly:[{date:'4Q2025'},{date:'1Q2026'},{date:'2Q2026'}]}},earningsHistory:{history:hist(3)},
    earningsTrend:{trend:[{period:'0q',endDate:'2026-09-30',earningsEstimate:{avg:R(0.82)},revenueEstimate:{avg:R(12.87e9)}},{period:'+1q',endDate:'2026-12-31',earningsEstimate:{avg:R(0.73)},revenueEstimate:{avg:R(13.9e9)}}]}};
  // after it (21.10, 17:20 in New York): Q3 is in, the revenue chart not yet; the calendar has moved to January; the analysts
  // now expect 0.67 for the quarter after; the share is down 4% after hours
  const after=(revIn,price)=>({...before,price:{currency:'USD',...price},calendarEvents:{earnings:{earningsDate:[Q('2027-01-20')],earningsAverage:R(0.67),revenueAverage:R(13.5e9)}},
    earnings:{financialCurrency:'USD',financialsChart:{quarterly:revIn?fin(4):fin(3)},earningsChart:{quarterly:[{date:'1Q2026'},{date:'2Q2026'},{date:'3Q2026'}]}},earningsHistory:{history:hist(4)},
    earningsTrend:{trend:[{period:'0q',endDate:'2026-12-31',earningsEstimate:{avg:R(0.67)},revenueEstimate:{avg:R(13.5e9)}},{period:'+1q',endDate:'2027-03-31',earningsEstimate:{avg:R(0.7)}}]}});
  const ah={marketState:'POST',regularMarketChangePercent:R(0.005),regularMarketTime:T('2026-10-21T20:00:00Z'),postMarketChangePercent:R(-0.04),postMarketTime:T('2026-10-21T21:19:00Z')};
  let Y=before; const f=async(u)=>{u=String(u); if(u.startsWith('https://fc.yahoo.com'))return new Response('',{status:404,headers:{'set-cookie':'A3=x; Path=/'}});
    if(u.includes('getcrumb'))return new Response('Ab3cD.eF'); if(u.includes('quoteSummary/NFLX'))return new Response(JSON.stringify({quoteSummary:{result:[Y]}})); return new Response('',{status:500})};
  const mailed=[], mail=async(st0,items)=>{mailed.push(...items); return true}, explain=async()=>({findings:['x'],explain:'הרבעון היה מעל הצפי, והצפי לרבעון הבא ירד.',guidance:'',model:'x',at:'t',headlines:0});
  s.setDoc('portfolio/main',{positions:[{sym:'NFLX',name:'נטפליקס'}]}); s.setDoc('research/latest',{companies:{},events:[]});
  s.setDoc('research/s_NFLX',{sym:'NFLX',next:'2026-10-21',rep:{q:'2026-03-31',label:'Q1 2026',at:'2026-04-16'}});
  const run=iso=>researchTask(s,{fetch:f,now:new Date(iso),pause:0,only:['NFLX'],explain,mail});
  await run('2026-10-20T20:00:00Z');   // the night before: Q2 arrives (late), and the estimates for the coming report are kept
  let d=s.getDoc('research/s_NFLX').data; assert.equal(d.est.date,'2026-10-21'); assert.equal(d.est.rev,12.87e9); assert.equal(d.est.nq.eps,0.73);
  assert.deepEqual(d.reps.map(x=>x.q),['2026-03-31'],'the report before it is kept in the list of earlier reports');
  // the report: earnings in, revenue not yet: no mail, no explanation, and it is checked again
  Y=after(false,ah); mailed.length=0; await run('2026-10-21T21:20:00Z');
  d=s.getDoc('research/s_NFLX').data; assert.equal(d.rep.q,'2026-09-30'); assert.equal(d.rep.revPend,true); assert.equal(mailed.length,0,'the mail waits for the revenue');
  assert.equal(d.rep.revE,12.87e9,'the revenue estimate from before the report'); assert.deepEqual(d.rep.nxW,{end:'2026-12-31',eps:0.73,rev:13.9e9});
  assert.deepEqual(d.reps.map(x=>x.q),['2026-06-30','2026-03-31']);
  assert.deepEqual(dueReports(s,new Date('2026-10-21T21:40:00Z')),['NFLX'],'asked again for its revenue');
  // twenty minutes later the revenue is in: the analysis and the mail
  Y=after(true,{...ah,postMarketTime:T('2026-10-21T21:39:00Z')}); await run('2026-10-21T21:40:00Z');
  d=s.getDoc('research/s_NFLX').data; assert.equal(d.rep.revPend,false); assert.equal(mailed.length,1); assert.ok(d.rep.mailed);
  const S=repSum(d.rep);
  assert.deepEqual([S.eps.e,S.eps.a,S.eps.res,S.rev.e,S.rev.a,S.rev.res,S.nx.was,S.nx.now,S.nx.res,S.rx.k,S.rx.pct],[0.82,0.87,'up',12.87e9,13.44e9,'up',0.73,0.67,'down','post',-4]);
  const L=repLines(S,'נטפליקס','NFLX');
  assert.deepEqual(L.slice(0,7),['👈 נטפליקס (סימול NFLX) פרסמה את הדוח לרבעון Q3 2026 (21.10.2026):','צפי רווח למניה: 0.82$','רווח למניה בפועל: 0.87$ (מעל הצפי)','צפי הכנסות: 12.87 מיליארד דולר','הכנסות בפועל: 13.44 מיליארד דולר (מעל הצפי)',
    '👈 צפי האנליסטים לרבעון הבא ירד: רווח למניה 0.67$ במקום 0.73$ לפני הדוח.','👈 המניה יורדת ב-4.0% במסחר המאוחר (אפטר מרקט), נכון ל-00:39.']);
  assert.equal(mailed[0].rep.ai.explain,'הרבעון היה מעל הצפי, והצפי לרבעון הבא ירד.','the explanation waited for the revenue too');
  const ev=s.getDoc('research/latest').data.events[0]; assert.equal(ev.sum.rev.res,'up'); assert.equal(ev.sum.rx.k,'post');
  // the next day's session: the move of the day after the report, then, when it is over, said in the past
  Y=after(true,{marketState:'REGULAR',regularMarketChangePercent:R(-0.061),regularMarketTime:T('2026-10-22T17:00:00Z')}); await run('2026-10-22T17:00:00Z');
  d=s.getDoc('research/s_NFLX').data; assert.deepEqual([d.rep.rx.k,d.rep.rx.pct,d.rep.rx.fin],['day',-6.1,false]);
  Y=after(true,{marketState:'POST',regularMarketChangePercent:R(-0.058),regularMarketTime:T('2026-10-22T20:00:00Z'),postMarketChangePercent:R(0.002),postMarketTime:T('2026-10-22T21:00:00Z')}); await run('2026-10-22T21:00:00Z');
  d=s.getDoc('research/s_NFLX').data; assert.deepEqual([d.rep.rx.k,d.rep.rx.pct,d.rep.rx.fin],['day',-5.8,true]);
  assert.equal(repLines(repSum(d.rep),'נטפליקס','NFLX').at(-1),'👈 המניה ירדה ב-5.8% ביום המסחר שאחרי הדוח.');
  assert.equal(mailed.length,1,'mailed once'); assert.deepEqual(dueReports(s,new Date('2026-10-22T21:20:00Z')),[],'nothing left to wait for');
  // a report found long after it came out: its move is not known, not taken from today's session
  s.setDoc('research/s_NFLX',{sym:'NFLX',rep:{q:'2026-06-30',label:'Q2 2026',at:'2026-07-16'}}); Y=after(true,{marketState:'REGULAR',regularMarketChangePercent:R(0.02),regularMarketTime:T('2026-11-20T17:00:00Z')});
  await run('2026-11-20T17:00:00Z'); assert.equal(s.getDoc('research/s_NFLX').data.rep.rx,null);
  // the company's outlook: only from the headlines, and said so
  const facts={headlines:[{title:'Netflix forecasts fourth-quarter profit below estimates'}]};
  assert.equal(cleanText({guidance:'החברה צופה רווח נמוך מהצפי לרבעון הרביעי.'},facts).guidance,'לפי הכותרות, החברה צופה רווח נמוך מהצפי לרבעון הרביעי.');
  assert.equal(cleanText({guidance:'החברה צופה רווח נמוך.'},{headlines:[]}).guidance,'','no headlines, no outlook');
});
test('the report e-mail: the analysis in the lines of the market news, then what it means; not the report itself',async()=>{
  const {reportsMail,repSum}=await import('../server/explain.js'); const env0={k:process.env.RESEND_API_KEY,to:process.env.MAIL_TO}, f0=globalThis.fetch, sent=[];
  globalThis.fetch=async(u,o)=>{if(String(u).includes('api.resend.com')){sent.push(JSON.parse(o.body));return new Response('{"id":"x"}',{status:200})} return f0(u,o)};
  try{process.env.RESEND_API_KEY='re_test'; process.env.MAIL_TO='owner@example.com';
    const s=new Store(':memory:'); s.setDoc('settings/main',{name:'x',mail:{earnings:true}});
    const rep={q:'2026-09-30',label:'Q3 2026',at:'2026-10-21',ccy:'USD',eps:{a:0.87,e:0.82,s:6.1},rev:13.44e9,revE:12.87e9,now:{end:'2026-12-31',eps:0.67},nxW:{end:'2026-12-31',eps:0.73},rx:{k:'post',pct:-4,t:Math.round(Date.parse('2026-10-21T21:19:00Z')/1000)},ai:{explain:'הרבעון היה מעל הצפי, אבל הצפי לרבעון הבא ירד.'}};
    assert.equal(await reportsMail(s,[{sym:'NFLX',name:'נטפליקס',rep}]),true);
    const m=sent[0]; assert.equal(m.subject,'תיק צ׳יק – דוח חדש: נטפליקס (NFLX) · רווח למניה מעל הצפי');
    assert.ok(m.text.startsWith(['👈 נטפליקס (סימול NFLX) פרסמה את הדוח לרבעון Q3 2026 (21.10.2026):','צפי רווח למניה: 0.82$','רווח למניה בפועל: 0.87$ (מעל הצפי)','צפי הכנסות: 12.87 מיליארד דולר','הכנסות בפועל: 13.44 מיליארד דולר (מעל הצפי)',
      '👈 צפי האנליסטים לרבעון הבא ירד: רווח למניה 0.67$ במקום 0.73$ לפני הדוח.','👈 המניה יורדת ב-4.0% במסחר המאוחר (אפטר מרקט), נכון ל-00:19.','מה זה אומר: הרבעון היה מעל הצפי, אבל הצפי לרבעון הבא ירד.'].join('\n')),m.text);
    assert.match(m.text,/לא המלצה לקנות או למכור/); assert.match(m.html,/<b style="color:#15803d">\(מעל הצפי\)<\/b>/);
    // a report whose revenue is not in yet says so, and a missing estimate is said, not invented
    const L=(await import('../server/explain.js')).repLines(repSum({...rep,revPend:true,eps:{a:0.87}}),'נטפליקס','NFLX');
    assert.deepEqual(L.slice(1,5),['צפי רווח למניה: אין במקור','רווח למניה בפועל: 0.87$','צפי הכנסות: 12.87 מיליארד דולר','הכנסות בפועל: עוד לא עודכנו במקור']);
  }finally{globalThis.fetch=f0; if(env0.k==null)delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY=env0.k; if(env0.to==null)delete process.env.MAIL_TO; else process.env.MAIL_TO=env0.to}
});
test('dividends for the calendar: the ex-dividend and payment days and the last dividend; the one before is kept when Yahoo moves on; a report date in a range is an estimate',async()=>{
  const {researchTask,figures}=await import('../server/research.js'); const s=new Store(':memory:');
  const R=x=>({raw:x}), Q=d=>R(Date.parse(d+'T00:00:00Z')/1000);
  const ko=(ex,pay)=>({price:{currency:'USD'},financialData:{},defaultKeyStatistics:{lastDividendValue:R(0.51),lastDividendDate:Q('2026-09-15')},summaryDetail:{dividendRate:R(2.04),exDividendDate:Q(ex)},
    calendarEvents:{exDividendDate:Q(ex),dividendDate:Q(pay),earnings:{earningsDate:[Q('2026-10-27'),Q('2026-10-29')]}}});
  const f0=figures(ko('2026-09-15','2026-10-01'),new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(f0.div,{ex:'2026-09-15',pay:'2026-10-01',rate:2.04,last:{amt:0.51,date:'2026-09-15'}}); assert.equal(f0.next,'2026-10-27'); assert.equal(f0.nextEst,true,'two days: not confirmed');
  assert.equal(figures({...ko('2026-09-15','2026-10-01'),calendarEvents:{earnings:{earningsDate:[Q('2026-10-27')],isEarningsDateEstimate:false}}},new Date('2026-10-20T00:00:00Z')).nextEst,false);
  // Tel Aviv: the dividend in agorot, kept in shekels
  assert.equal(figures({price:{currency:'ILA'},financialData:{},summaryDetail:{},defaultKeyStatistics:{lastDividendValue:R(120)},calendarEvents:{}},new Date()).div.last.amt,1.2);
  let Y=ko('2026-09-15','2026-10-01'); const f=async u=>{u=String(u); if(u.startsWith('https://fc.yahoo.com'))return new Response('',{status:404,headers:{'set-cookie':'A3=x; Path=/'}});
    if(u.includes('getcrumb'))return new Response('Ab3cD.eF'); if(u.includes('quoteSummary/KO'))return new Response(JSON.stringify({quoteSummary:{result:[Y]}})); return new Response('',{status:500})};
  s.setDoc('portfolio/main',{positions:[{sym:'KO'}]}); s.setDoc('research/latest',{companies:{},events:[]});
  await researchTask(s,{fetch:f,now:new Date('2026-10-20T01:00:00Z'),pause:0,only:['KO'],explain:async()=>null,mail:async()=>true});
  Y=ko('2026-11-28','2026-12-15'); await researchTask(s,{fetch:f,now:new Date('2026-11-02T01:00:00Z'),pause:0,only:['KO'],explain:async()=>null,mail:async()=>true});
  const d=s.getDoc('research/s_KO').data; assert.equal(d.div.ex,'2026-11-28'); assert.deepEqual(d.divHist.map(x=>[x.ex,x.pay]),[['2026-09-15','2026-10-01']]);
  assert.equal(s.getDoc('research/latest').data.companies.KO.divHist.length,1,'a holding carries them into the shared document');
});
test('analysts: when Yahoo will not open a session, nothing is overwritten and the status says so',async()=>{
  const {researchTask}=await import('../server/research.js'); const s=new Store(':memory:');
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'}]}); s.setDoc('research/latest',{companies:{NVDA:{rating:'Hold'}},updatedAt:'2026-10-09T13:14:53Z'});
  const st=await researchTask(s,{fetch:fakeYahoo({crumbFail:true}).f,pause:0});
  assert.equal(st.stopped,'session'); assert.equal(s.getDoc('research/latest').data.updatedAt,'2026-10-09T13:14:53Z'); assert.equal(s.getDoc('research/latest').data.companies.NVDA.rating,'Hold');
});
test('prices for every US security: a change the mirror does not give is unknown (null), not 0%',async()=>{
  const {usSnapshot}=await import('../server/tasks.js'); const s=new Store(':memory:'); const real=globalThis.fetch;
  globalThis.fetch=async u=>String(u).includes('/nasdaq/')?new Response(JSON.stringify([{symbol:'AAA',lastsale:'$10.00',pctchange:'1.5%'},{symbol:'BBB',lastsale:'$5',pctchange:'NA'},{symbol:'CCC',lastsale:'$7.25',pctchange:''},{symbol:'DDD',lastsale:'$3',pctchange:'-2.25%'}]),{status:200}):new Response('',{status:404});
  try{await usSnapshot(s,new Date('2026-10-14T00:40:00Z'),()=>{})}finally{globalThis.fetch=real}
  const us=s.getDoc('quotes/all').data.us;
  assert.deepEqual(us.AAA,[10,1.5]); assert.deepEqual(us.DDD,[3,-2.25]);
  assert.deepEqual(us.BBB,[5,null],'"NA" is not a change of 0%'); assert.deepEqual(us.CCC,[7.25,null],'an empty field is not a change of 0%');
});
test('prices: the dollar\'s previous close is kept only when this run\'s rate is the market rate',()=>{
  const q={px:510,prev:500,closeDate:'2026-10-12',ccy:'USD',src:'yahoo',time:'t'};
  let d=buildQuotesDoc({prev:{},fetched:{quotes:{MSFT:q},index:{},errors:[],fx:{live:{px:3.7123,prev:3.6801,prevDate:'2026-10-09'},boi:{rate:3.70,date:'2026-10-12'}}},symbols:['MSFT'],now:new Date('2026-10-12T15:00:00Z'),usOpen:true});
  assert.equal(d.usdIls,3.7123); assert.deepEqual(d.fxPrev,{rate:3.6801,date:'2026-10-09',now:3.7123});
  d=buildQuotesDoc({prev:{usdIls:3.7},fetched:{quotes:{MSFT:q},index:{},errors:[],fx:{boi:{rate:3.70,date:'2026-10-12'}}},symbols:['MSFT'],now:new Date('2026-10-12T15:00:00Z'),usOpen:true});
  assert.equal(d.fxPrev,null,'the Bank of Israel rate has no previous close in the same answer: unknown');
});
test('prices: the two indices are kept with their dates; a run that misses one keeps the last value',()=>{
  const q={px:510,prev:500,closeDate:'2026-10-12',ccy:'USD',src:'yahoo',time:'t'};
  let d=buildQuotesDoc({prev:{},fetched:{quotes:{MSFT:q},index:{},errors:[],bench:{SPX:{px:5800,prev:5850,date:'2026-10-12',prevDate:'2026-10-09'},TA125:{px:2900,prev:2890,date:'2026-10-13'}}},symbols:['MSFT'],now:new Date('2026-10-13T08:00:00Z')});
  assert.equal(d.bench.SPX.name,'S&P 500'); assert.equal(d.bench.SPX.date,'2026-10-12'); assert.equal(d.bench.TA125.prev,2890);
  d=buildQuotesDoc({prev:d,fetched:{quotes:{MSFT:q},index:{},errors:[],bench:{TA125:{px:2950,prev:2900,date:'2026-10-14'}}},symbols:['MSFT'],now:new Date('2026-10-14T08:00:00Z')});
  assert.equal(d.bench.SPX.date,'2026-10-12','the old S&P value stays, with its own date'); assert.equal(d.bench.TA125.date,'2026-10-14');
});

test('e-mail: nothing automatic goes out without the owner\'s consent, per kind; the page sees what happened',async()=>{
  const {sendAllowed, mailAllowed, mailNote}=await import('../server/mail.js');
  const env0={k:process.env.RESEND_API_KEY,to:process.env.MAIL_TO}, f0=globalThis.fetch, sent=[];
  globalThis.fetch=async(u,o)=>{if(String(u).includes('api.resend.com')){sent.push(JSON.parse(o.body));return new Response('{"id":"x"}',{status:200})} return f0(u,o)};
  try{
    const s=new Store(':memory:'), msg={subject:'test',text:'₪1,234',html:'<p>x</p>'};
    process.env.RESEND_API_KEY='re_test'; process.env.MAIL_TO='owner@example.com';
    s.setDoc('settings/main',{name:'x'});
    assert.equal(mailAllowed(s,'reports'),false,'off when never chosen');
    assert.equal(await sendAllowed(s,'reports',msg),false); assert.equal(sent.length,0);
    assert.equal(s.getDoc('system/mail').data.last.reports.result,'off');
    s.setDoc('settings/main',{name:'x',mail:{reports:true}});
    assert.equal(await sendAllowed(s,'reports',msg),true); assert.equal(sent.length,1);
    assert.equal(await sendAllowed(s,'morning',msg),false,'one kind on does not turn on the others'); assert.equal(sent.length,1);
    const st=s.getDoc('system/mail').data; assert.equal(st.ready,true); assert.equal(st.last.reports.result,'sent'); assert.equal(st.last.morning.result,'off');
    assert.ok(!JSON.stringify(st).includes('1,234')&&!JSON.stringify(st).includes('@'),'no content and no address in the status');
    delete process.env.RESEND_API_KEY; assert.equal(await sendAllowed(s,'reports',msg),false); assert.equal(s.getDoc('system/mail').data.last.reports.result,'not_ready');
    // the backup copy: off in the settings means no mail, the backup on disk still happens
    const {backupTask}=await import('../server/backup.js'); process.env.RESEND_API_KEY='re_test';
    const dir=fs.mkdtempSync('/tmp/tc-bk-'); const r=await backupTask(s,{dataDir:dir}); assert.equal(r.mailed,false); assert.ok(fs.existsSync(r.file)); assert.equal(sent.length,1);
    s.setDoc('settings/main',{name:'x',mail:{backup:true}}); const r2=await backupTask(s,{dataDir:dir}); assert.equal(r2.mailed,true); assert.equal(sent.length,2);
    assert.deepEqual(sent[1].attachments.map(x=>x.filename.replace(/\d{4}-\d\d-\d\d/,'D')),['tikchik-backup-D.json.gz'],'without a passphrase: the owner\'s data only');
    // 30.10: with BACKUP_KEY the full copy goes too, encrypted: only the passphrase opens it, and it is the whole database
    {const {openBackup}=await import('../server/backup.js'); const {execFileSync}=await import('node:child_process');
      s.setDoc('data/users/u9/portfolio',{positions:[{sym:'KO',qty:2}]}); process.env.BACKUP_KEY='a long passphrase';
      try{const r3=await backupTask(s,{dataDir:dir}); assert.equal(r3.mailed,true); assert.ok(r3.full.fits); assert.ok(r3.docs&&r3.docs.docs>0,'the copy on the disk was opened and counted');
        const att=sent[2].attachments.find(x=>/\.enc$/.test(x.filename)), enc=Buffer.from(att.content,'base64');
        assert.ok(!enc.toString('latin1').includes('portfolio'),'nothing readable without the passphrase');
        assert.throws(()=>openBackup(enc,'wrong'),/wrong passphrase/);
        const encF=dir+'/full.enc', out=dir+'/restored.sqlite'; fs.writeFileSync(encF,enc);
        const said=execFileSync(process.execPath,['tools/restore.js',encF,out],{env:{...process.env,BACKUP_KEY:'a long passphrase'},encoding:'utf8',stderr:'pipe'});
        assert.match(said,/^ok: .*documents/); const R=new Store(out); assert.equal(R.getDoc('data/users/u9/portfolio').data.positions[0].sym,'KO','the partners\' data is in the full copy'); R.db.close();
        assert.match(JSON.parse(s.getMeta('lastBackupMailInfo')).what,/עותק מלא מוצפן/)}
      finally{delete process.env.BACKUP_KEY}}
    fs.rmSync(dir,{recursive:true,force:true});
  }finally{globalThis.fetch=f0; if(env0.k==null)delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY=env0.k; if(env0.to==null)delete process.env.MAIL_TO; else process.env.MAIL_TO=env0.to}
});

test('reading files: the strongest model, the next one when it cannot read, a long read kept open, the cost per model',async()=>{
  const {srv,req,base,jar}=await startApp(), k0=process.env.AI_KEEPALIVE_MS;
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    const ask=(content,o={})=>req('o','POST','/api/ask',{purpose:'files',model:'claude-fable-5-1',max_tokens:999999,messages:[{role:'user',content}],...o});
    let r=await ask('read this statement'); assert.equal(r.status,200); assert.equal(r.j.model,'claude-fable-5-1'); assert.equal(r.j.content[0].text,'{"ok":"read"}'); assert.deepEqual(r.j.fallbackFrom,[]);
    const sent=claudeSeen[claudeSeen.length-1].body; assert.equal(sent.stream,true); assert.equal(sent.max_tokens,32000,'room for the thinking, capped'); assert.equal(sent.purpose,undefined,'only the page\'s fields go to Claude');
    assert.equal((await req('o','POST','/api/ask',{model:'claude-fable-5-1',max_tokens:10,messages:[{role:'user',content:'hi'}]})).status,400,'the chat does not get the strongest model');
    assert.equal((await ask('x',{model:'claude-sonnet-5-5'})).status,400,'file reading uses only the file models');
    // the quick read of a file: Haiku, streamed the same way and with the same room, and with no next model when it fails
    r=await ask('read quickly',{model:'claude-haiku-5-5'}); assert.equal(r.status,200); assert.equal(r.j.model,'claude-haiku-5-5'); assert.deepEqual(r.j.fallbackFrom,[]);
    {const q=claudeSeen[claudeSeen.length-1].body; assert.equal(q.stream,true); assert.equal(q.max_tokens,32000)}
    {const n=claudeSeen.length; r=await ask('HAIKUDOWN',{model:'claude-haiku-5-5'}); assert.equal(r.j.error.code,'upstream_error'); assert.equal(claudeSeen.length-n,1,'no next model for the quick read')}
    r=await ask('NOFABLE read this'); assert.equal(r.status,200); assert.equal(r.j.model,'claude-opus-5-5'); assert.deepEqual(r.j.fallbackFrom,['claude-fable-5-1']);
    const fab=async()=>((await req('o','GET','/api/ai/usage')).j.byModel.find(x=>x.model==='claude-fable-5-1')||{calls:0});
    let f0=await fab(); r=await ask('REFUSE read this'); assert.equal(r.j.model,'claude-opus-5-5','a refusal hands over to the next model'); assert.deepEqual(r.j.fallbackFrom,['claude-fable-5-1']);
    assert.equal((await fab()).calls,f0.calls,'declined before any output, in a category that is not billed: not counted');
    f0=await fab(); r=await ask('REFUSEMID read this'); assert.equal(r.j.model,'claude-opus-5-5'); assert.equal(r.j.content[0].text,'{"ok":"read"}','what the first model wrote before it declined is dropped');
    assert.equal((await fab()).calls,f0.calls+1,'declined after some output: billed, so counted');
    let n1=claudeSeen.length; r=await ask('REFUSEX read this'); assert.equal(r.status,502); assert.equal(r.j.error.code,'refused'); assert.equal(claudeSeen.length-n1,1,'reasoning_extraction: no next model');
    // a read that takes long: the answer starts with spaces (JSON allows them) so the connection stays open
    process.env.AI_KEEPALIVE_MS='60';
    const raw=await fetch(base+'/api/ask',{method:'POST',headers:{cookie:jar.o,'x-tc':'1','content-type':'application/json'},body:JSON.stringify({purpose:'files',model:'claude-fable-5-1',max_tokens:100,messages:[{role:'user',content:'SLOWFILE read'}]})});
    const t=await raw.text(); assert.equal(raw.status,200); assert.match(t,/^ +\{/); assert.equal(JSON.parse(t).content[0].text,'{"ok":"read"}');
    // a failure after the answer has started comes as {"error":...} (the status is already 200)
    r=await ask('SLOWFILE LATEKEY'); assert.equal(r.status,200); assert.equal(r.j.error.code,'sampling_disabled');
    // no time left in Railway's 15 minutes for the next model: the first model's answer is the answer, nothing more is sent
    process.env.AI_FILE_BUDGET_MS=String(2*60*1000+300); const n0=claudeSeen.length;
    r=await ask('SLOWFILE NOFABLE'); assert.equal(r.j.error&&r.j.error.code!=null,true); assert.equal(claudeSeen.length-n0,1,'the next model did not start'); assert.ok(!/נוסו/.test(r.j.error.message));
    delete process.env.AI_FILE_BUDGET_MS;
    const u=(await req('o','GET','/api/ai/usage')).j, by=Object.fromEntries(u.byModel.map(x=>[x.model,x]));
    assert.deepEqual(u.fileModels,['claude-fable-5-1','claude-opus-5-5']); assert.equal(by['claude-fable-5-1'].calls,4,'two reads and the two billed declines'); assert.equal(by['claude-fable-5-1'].input,4000);
    assert.equal(by['claude-opus-5-5'].calls,3); assert.equal(by['claude-fable-5-1'].output,107);
  }finally{if(k0==null)delete process.env.AI_KEEPALIVE_MS; else process.env.AI_KEEPALIVE_MS=k0; delete process.env.AI_FILE_BUDGET_MS; srv.close()}
});

// ---- 21.10 (2): two-step sign-in, the indices, the price watch, Finnhub ----
test('two-step sign-in: the standard codes, set up, on with a first code, a code is good once, backup codes, off with password and code, the owner\'s way back',async()=>{
  const {b32encode,b32decode,hotp,totpMatch,step}=await import('../server/totp.js');
  // RFC 6238's own test key ("12345678901234567890"): 59 s → 287082 (the last 6 of 94287082), 1111111109 s → 081804
  const key=Buffer.from('12345678901234567890'), sec=b32encode(key);
  assert.equal(sec,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); assert.deepEqual(b32decode(sec),key);
  assert.equal(hotp(key,Math.floor(59/30)),'287082'); assert.equal(hotp(key,Math.floor(1111111109/30)),'081804');
  assert.equal(totpMatch(sec,'287082',{now:59000}),1); assert.equal(totpMatch(sec,'287082',{now:59000+30000}),1,'the code before still counts (a clock a little off)');
  assert.equal(totpMatch(sec,'287082',{now:59000,after:1}),-1,'a code already used is not good again'); assert.equal(totpMatch(sec,'12345',{now:59000}),-1);
  const {store,srv,req,jar}=await startApp(); const k0=process.env.TWOFA_OFF;
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    assert.deepEqual((await req('o','GET','/api/2fa')).j,{on:false,backupLeft:0,override:false});
    const s1=(await req('o','POST','/api/2fa/setup',{})).j; assert.match(s1.secret,/^[A-Z2-7]{32}$/); assert.match(s1.uri,/^otpauth:\/\/totp\/.+secret=[A-Z2-7]{32}&issuer=/);
    // still off until a first code is given: the login asks nothing yet
    await req('p','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'}); assert.ok(jar.p,'a second device');
    const now=()=>hotp(b32decode(s1.secret),step());
    assert.equal((await req('o','POST','/api/2fa/enable',{code:'000000'===now()?'111111':'000000'})).status,400);
    const on=(await req('o','POST','/api/2fa/enable',{code:now()})).j; assert.equal(on.codes.length,8); assert.match(on.codes[0],/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    assert.equal((await req('p','GET','/api/db/doc?path=portfolio/main')).status,401,'the other devices are signed out');
    assert.equal((await req('o','GET','/api/db/doc?path=portfolio/main')).status,200,'this one stays');
    assert.equal(store.userByEmail('owner@example.com').totp_backup.includes(on.codes[0]),false,'only hashes are kept');
    // the login now wants the code
    let r=await req('x','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'}); assert.equal(r.status,401); assert.equal(r.j.error.code,'need_code'); assert.ok(!jar.x,'no session without the code');
    r=await req('x','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123',code:'12'}); assert.equal(r.j.error.code,'bad_code');
    r=await req('x','POST','/api/login',{email:'owner@example.com',password:'wrong',code:now()}); assert.equal(r.j.error.code,'bad_login','the password first');
    // the same code was used to switch it on: it is not good again; a backup code is, once
    r=await req('x','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123',code:on.codes[0].toUpperCase()}); assert.equal(r.status,200);
    r=await req('y','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123',code:on.codes[0]}); assert.equal(r.status,401,'a backup code works once');
    assert.equal((await req('o','GET','/api/2fa')).j.backupLeft,7);
    // the owner lost the phone and the codes: TWOFA_OFF=1 in the environment lets the password in
    process.env.TWOFA_OFF='1'; r=await req('z','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'}); assert.equal(r.status,200); delete process.env.TWOFA_OFF;
    // off: the password and a code (a backup code too)
    assert.equal((await req('o','POST','/api/2fa/disable',{password:'nope',code:on.codes[1]})).status,400);
    assert.equal((await req('o','POST','/api/2fa/disable',{password:'owner-pass-123',code:on.codes[1]})).status,200);
    assert.equal((await req('o','GET','/api/2fa')).j.on,false); assert.equal((await req('q','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'})).status,200);
  }finally{if(k0==null)delete process.env.TWOFA_OFF; else process.env.TWOFA_OFF=k0; srv.close()}
});

test('the indices for "האם אני עושה טוב?": Yahoo\'s series read, weekly before the daily, kept in research/bench for every user',async()=>{
  const {chartParse,joinSeries,benchTask}=await import('../server/bench.js');
  const ch=(ts,c)=>({chart:{result:[{meta:{gmtoffset:0},timestamp:ts,indicators:{quote:[{close:c}]}}]}});
  const day=d=>Date.parse(d+'T20:00:00Z')/1000;
  assert.deepEqual(chartParse(ch([day('2026-10-19'),day('2026-10-20'),day('2026-10-20')+60],[100,null,102])),{d:['2026-10-19','2026-10-20'],c:[100,102]},'a missing close is left out; a second bar of a day replaces the first');
  assert.deepEqual(joinSeries({d:['2020-01-03','2021-06-04','2021-06-11'],c:[1,2,3]},{d:['2021-06-07','2021-06-08'],c:[4,5]}),{d:['2020-01-03','2021-06-04','2021-06-07','2021-06-08'],c:[1,2,4,5]});
  const store=new Store(':memory:'), asked=[];
  const f=async u=>{asked.push(u); const t=decodeURIComponent(u.split('/chart/')[1].split('?')[0]); const w=/interval=1wk/.test(u);
    return new Response(JSON.stringify(ch(w?[day('2018-01-05')]:[day('2026-10-19'),day('2026-10-20')],w?[10]:t==='^GSPC'?[6000,6050]:t==='USDILS=X'?[3.7,3.71]:[2500,2510])),{status:200})};
  assert.equal(await benchTask(store,{fetch:f}),true);
  const d=store.getDoc('research/bench').data; assert.deepEqual(d.spx,{d:['2018-01-05','2026-10-19','2026-10-20'],c:[10,6000,6050]}); assert.deepEqual(d.fx.c,[10,3.7,3.71]); assert.equal(d.names.ta125,'ת״א 125');
  assert.ok(asked.some(u=>u.includes(encodeURIComponent('^TA125.TA'))));
  assert.equal(access({id:'u_x',role:'friend'},'research/bench'),'r','market data: every user reads it');
});

test('the price watch: prices stopped while a market trades, a session missing for 3 hours, a gap the page found; one e-mail per problem, with consent',async()=>{
  const {pxProblems,pxAlertsDue,pxWatchTask,selfCheckNote}=await import('../server/pxwatch.js');
  const open=new Date('2026-10-21T15:00:00Z'), closed=new Date('2026-10-24T09:00:00Z');   // a Wednesday afternoon in New York; a Saturday
  const q={updatedAt:'2026-10-21T11:30:00Z',lag:{us:{have:'2026-10-19',want:'2026-10-20',n:3}},prices:{A:1}};
  const P=pxProblems(q,open); assert.deepEqual(P.map(p=>p.key),['late','lag:us:2026-10-20']); assert.match(P[0].text,/לא התעדכנו מאז 21\.10 14:30/); assert.match(P[1].text,/חסר המחיר של 20\.10 ל-3 ניירות/);
  assert.deepEqual(pxProblems({...q,lag:{}},closed),[],'old prices on a weekend are not a problem');
  let a=pxAlertsDue(P,null,open); assert.deepEqual(a.send.map(p=>p.key),['late'],'a lag waits 3 hours');
  a=pxAlertsDue(P,a.state,new Date(open.getTime()+3.1*36e5)); assert.deepEqual(a.send.map(p=>p.key),['lag:us:2026-10-20']);
  a=pxAlertsDue(P,a.state,new Date(open.getTime()+5*36e5)); assert.deepEqual(a.send,[],'not again within 12 hours');
  a=pxAlertsDue([],a.state,new Date(open.getTime()+6*36e5)); assert.deepEqual(a.state.seen,{},'gone: the next time is a new problem');
  const store=new Store(':memory:'); store.setDoc('quotes/latest',q); selfCheckNote(store,{bad:[{name:'חשיפה לפי ענף',t:'חשיפה לפי ענף: ₪10 במקום ₪12.'}]},open);
  const r=await pxWatchTask(store,{now:open}); assert.equal(r.open,3); assert.equal(r.sent,0,'no consent, nothing sent');
  assert.equal(store.getDoc('system/mail').data.last.pxalert.result,'off'); assert.ok(store.getDoc('system/pxwatch').data.sent.late,'counted as told, so the next half hour does not ask again');
  assert.ok(store.getDoc('system/pxwatch').data.open.some(k=>k.startsWith('sum:')));
});

test('Finnhub: the first source for a US ticker when its key is set, and the free ones stay behind it',async()=>{
  const {finnhubParse,fetchAll}=await import('../shared/quotes.js');
  assert.equal(finnhubParse({c:0,pc:0,t:0}),null,'an unknown ticker answers with zeros');
  const q=finnhubParse({c:512.3,pc:505,t:1792612800}); assert.equal(q.px,512.3); assert.equal(q.prev,505); assert.equal(q.src,'finnhub'); assert.equal(q.closeDate,'2026-10-21');
  const k0=process.env.FINNHUB_API_KEY; const seen=[];
  const f=async u=>{seen.push(String(u)); if(String(u).includes('finnhub.io'))return new Response(JSON.stringify(String(u).includes('symbol=MSFT')?{c:512.3,pc:505,t:1792612800}:{c:0,pc:0,t:0}),{status:200}); return new Response('{}',{status:404})};
  try{process.env.FINNHUB_API_KEY='k1';
    const r=await fetchAll(['MSFT','ZZZZ'],{fetch:f}); assert.equal(r.quotes.MSFT.src,'finnhub'); assert.ok(seen.some(u=>u.includes('token=k1')));
    assert.ok(seen.some(u=>u.includes('yahoo')&&u.includes('ZZZZ')),'a ticker Finnhub does not know goes on to Yahoo');
    delete process.env.FINNHUB_API_KEY; seen.length=0; await fetchAll(['MSFT'],{fetch:f}); assert.ok(!seen.some(u=>u.includes('finnhub')),'no key, no call');
  }finally{if(k0==null)delete process.env.FINNHUB_API_KEY; else process.env.FINNHUB_API_KEY=k0}
});

test('the site: the PDF and Excel libraries in files of their own, loaded when needed, with a version in the address',async()=>{
  const {buildSite}=await import('../tools/build.js'); const root=new URL('..',import.meta.url).pathname; buildSite(root);
  const h=fs.readFileSync(root+'site/index.html','utf8'), page=fs.readFileSync(root+'page/live.html','utf8');
  assert.ok(!/SheetJS|jsPDF - PDF Document|define\("pdfjs-dist\/build\/pdf"/.test(h),'not inside the page');
  for(const n of ['jspdf','xlsx','pdf','pdfworker'])assert.ok(fs.statSync(root+'site/lib/'+n+'.js').size>100000,n);
  assert.match(h,/window\.__tcLib=/); assert.match(h,/"pdf":"lib\/pdf\.js\?v=[0-9a-f]{10}"/);
  assert.ok(h.length<page.length*0.5,'the page the phone loads is less than half: '+h.length+' / '+page.length);
  assert.ok(/SheetJS/.test(page),'the page in Claude keeps them inside');
});

test('Israeli securities for the search: the exchange\'s own lists (shares, funds, indices) with a key; a fund by its number from Maya',async()=>{
  const {ilBuild,ilSymsTask,DW}=await import('../server/ilsyms.js');
  const B=ilBuild({types:[{securityFullTypeCode:'0101',securityTypeDesc:'מניות'},{securityFullTypeCode:'0501',securityTypeDesc:'אג"ח קונצרני'},{securityFullTypeCode:'0601',securityTypeDesc:'כתבי אופציה'}],
    sec:[{securityId:604611,symbol:'LUMI',securityName:'לאומי',companyName:'בנק לאומי',companySector:'בנקים',securityFullTypeCode:'0101'},{securityId:1,symbol:'LUMI.B1',securityName:'לאומי אג"ח',securityFullTypeCode:'0501'},{securityId:2,symbol:'X.W1',securityName:'אופ',securityFullTypeCode:'0601'}],
    funds:[{fundId:5129283,fundName:'הראל מחקה נאסד"ק 100',classificationMajor:{code:1,value:'מניות'},classificationMain:{code:2,value:'חו"ל'},exposureProfile:'6A'}],indices:[{indexId:142,indexName:'ת"א-35'}]});
  assert.deepEqual(B.stocks,[['LUMI','לאומי','בנק לאומי','בנקים',604611]],'shares only');
  assert.deepEqual(B.funds,[['5129283','הראל מחקה נאסד"ק 100','מניות','חו"ל','6A']]); assert.deepEqual(B.indices,[['142','ת"א-35']]);
  const store=new Store(':memory:'), asked=[];
  const f=async(u,o)=>{asked.push({u:String(u),h:o.headers}); const p=String(u).slice(DW.length);
    const J=p.startsWith('/basic-securities/trade-securities-list/')?{tradeSecuritiesList:{result:p.endsWith('/21')?[]:[{securityId:604611,symbol:'LUMI',securityName:'לאומי',companyName:'בנק לאומי',companySector:'בנקים',securityFullTypeCode:'0101'}],total:1}}
      :p.startsWith('/basic-securities/securities-types')?{securitiesTypes:{result:[{securityFullTypeCode:'0101',securityTypeDesc:'מניות'}],total:1}}
      :p.startsWith('/fund/fund-list')?{funds:{result:[{fundId:5129283,fundName:'הראל מחקה נאסד"ק 100',classificationMajor:{code:1,value:'מניות'}}],total:1}}
      :p.startsWith('/basic-indices/indices-list')?{indicesList:{result:[{indexId:142,indexName:'ת"א-35'}],total:1}}:{};
    return new Response(JSON.stringify(J),{status:200})};
  assert.equal(await ilSymsTask(store,{fetch:f,key:'',log:()=>{}}),false,'no key: nothing asked'); assert.equal(asked.length,0);
  assert.equal(await ilSymsTask(store,{fetch:f,key:'k-1',now:new Date('2026-10-21T08:00:00Z')}),true);
  const d=store.getDoc('research/ilsyms').data; assert.equal(d.day,'2026-10-20','the day before, when today has no list yet'); assert.equal(d.stocks[0][0],'LUMI'); assert.equal(d.funds[0][0],'5129283');
  assert.equal(asked[0].h.apikey,'k-1'); assert.equal(asked[0].h['accept-language'],'he-IL');
  assert.equal(access({id:'u_x',role:'friend'},'research/ilsyms'),'r');
  // a fund by its number, through the server, from Maya
  const {srv,req}=await startApp(); const real=globalThis.fetch;
  globalThis.fetch=async(u,o)=>{const s=String(u); if(s.startsWith('http://127.0.0.1'))return real(u,o);
    if(s.includes('maya.tase.co.il/api/v1/funds/mutual/5129283/history'))return new Response(JSON.stringify({items:[{tradeDate:'2026-10-19',redemptionPrice:367.77},{tradeDate:'2026-10-16',redemptionPrice:365.1}]}),{status:200});
    if(s.includes('maya.tase.co.il/api/v1/funds/mutual/5129283'))return new Response(JSON.stringify({redemptionPrice:367.77,ratesAsOf:'2026-10-19',name:'הראל מחקה נאסד"ק 100',yields:{dayYield:0.73}}),{status:200});
    return new Response('{}',{status:404})};
  try{
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    const r=(await req('o','GET','/api/ilfund?id=5129283')).j;
    assert.equal(r.name,'הראל מחקה נאסד"ק 100'); assert.equal(r.px,367.77); assert.equal(r.date,'2026-10-19'); assert.deepEqual(r.series,{d:['2026-10-16','2026-10-19'],c:[365.1,367.77]});
    assert.equal((await req('o','GET','/api/ilfund?id=12')).status,400); assert.equal((await req('o','GET','/api/ilfund?id=5999999')).status,404);
  }finally{globalThis.fetch=real; srv.close()}
});

// ---- co-movement, long-term ties and month-end closes from the close series ----
import {comoveOf, longtermOf, monthlyCloses, corr} from '../shared/comove.js';
test('comove: groups of securities that move together, pairs, opposite movers, the independent ones, those without data',()=>{
  // 120 trading days; A and B follow one factor, C follows the opposite of it, D is noise, E has no series
  const days=[]; {let t=Date.UTC(2026,3,1); while(days.length<120){const d=new Date(t); if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(d.toISOString().slice(0,10)); t+=864e5}}
  let seed=7; const rnd=()=>{seed=(seed*16807)%2147483647; return seed/2147483647-0.5};
  const f=days.map(()=>rnd()*0.04), mk=(g,noise)=>{const c=[100]; for(let i=1;i<days.length;i++)c.push(c[i-1]*(1+g*f[i]+noise*rnd()*0.01)); return {d:days,c}};
  const S={A:mk(1,0.2),B:mk(1,0.2),C:mk(-1,0.2),D:{d:days,c:days.map((_,i)=>50+Math.sin(i/3)*5+rnd()*2)},E:null};
  const o=comoveOf(S,{days:60,names:{A:'tech',B:'tech',C:'fin'},groupNames:{tech:'טכנולוגיה'}});
  assert.equal(o.days,60); assert.equal(o.from,days[60]); assert.equal(o.to,days[119]);
  assert.deepEqual(o.groups.map(g=>[g.name,g.syms]),[['טכנולוגיה',['A','B']]]); assert.ok(o.groups[0].same>0.8,'they moved the same way most days: '+o.groups[0].same);
  assert.deepEqual(o.pairs.map(p=>p.a+p.b),['AB']); assert.ok(o.pairs[0].r>0.9);
  assert.ok(o.opposite.some(p=>(p.a==='A'||p.a==='B')&&p.b==='C'&&p.r<-0.8),'C against the factor: '+JSON.stringify(o.opposite));
  assert.deepEqual(o.solo,['D']); assert.deepEqual(o.nodata,['E']); assert.equal(o.pairRule.sig,0.26);
  // too few securities: nothing invented
  const e=comoveOf({A:S.A},{days:60}); assert.deepEqual(e.groups,[]); assert.deepEqual(e.solo,['A']);
});
test('comove: long-term ties from the weekly series, month-end closes beside what the document holds',()=>{
  const wk=[]; {let t=Date.UTC(2021,0,8); while(wk.length<260){wk.push(new Date(t).toISOString().slice(0,10)); t+=7*864e5}}
  let seed=3; const rnd=()=>{seed=(seed*16807)%2147483647; return seed/2147483647-0.5};
  const f=wk.map(()=>rnd()*0.03), mk=g=>{const c=[100]; for(let i=1;i<wk.length;i++)c.push(c[i-1]*(1+g*f[i]+rnd()*0.004)); return {d:wk,c}};
  const W={A:mk(1),B:mk(1),C:mk(-1)};
  const lt=longtermOf(W); assert.equal(lt.count,3); assert.equal(lt.pairs[0].a+lt.pairs[0].b,'AB'); assert.ok(lt.pairs[0].r>0.8); assert.ok(lt.pairs[2].r<-0.8); assert.equal(lt.from,'2021-02-01'); assert.ok(lt.pairs[0].n>=55);
  // month-end closes: the weekly series for the old months, the daily one for the recent ones, a saved value kept for a security without a series
  const daily={d:['2025-12-30','2025-12-31','2026-01-15','2026-01-30'],c:[10,11,12,13]};
  const prev={months:['2025-11','2025-12'],px:{X:[5,6],A:[1,2]}};
  const pxd=monthlyCloses({A:{...W.A,...daily},B:W.B},prev,{until:'2026-02-10'});
  assert.equal(pxd.months[pxd.months.length-1],'2026-01'); assert.equal(pxd.px.A[pxd.months.length-1],13,'January from the daily series'); assert.equal(pxd.px.A[pxd.months.indexOf('2025-12')],11,'the daily close wins over the saved one');
  assert.equal(pxd.px.X[pxd.months.indexOf('2025-11')],5,'a saved month of a security without a series stays'); assert.ok(pxd.px.B.filter(x=>x!=null).length>50);
  assert.equal(corr([1,2,3],[2,4,6]),1);
});
test('comoveTask: the three documents from the series the store holds, for everybody\'s securities',async()=>{
  const {Store}=await import('../server/store.js'); const {comoveTask}=await import('../server/tasks.js');
  const st=new Store(':memory:');
  const days=[]; {let t=Date.UTC(2026,0,5); while(days.length<130){const d=new Date(t); if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(d.toISOString().slice(0,10)); t+=864e5}}
  let seed=11; const rnd=()=>{seed=(seed*16807)%2147483647; return seed/2147483647-0.5}; const f=days.map(()=>rnd()*0.03);
  const mk=g=>{const c=[100]; for(let i=1;i<days.length;i++)c.push(c[i-1]*(1+g*f[i]+rnd()*0.003)); return {d:days,c}};
  st.setDoc('portfolio/main',{positions:[{sym:'MSFT',group:'tech',qty:1},{sym:'AAPL',group:'tech',qty:1},{sym:'5129283',group:'il',qty:1}]});
  const u=st.addUser({email:'p@example.com',password:'friend-pass-9',role:'friend'}); st.setDoc(`data/users/${u.id}/portfolio`,{positions:[{sym:'XOM',group:'ind',qty:1}]});
  st.setDoc('quotes/c_MSFT',{key:'MSFT',...mk(1)}); st.setDoc('quotes/c_AAPL',{key:'AAPL',...mk(1)}); st.setDoc('quotes/c_XOM',{key:'XOM',...mk(-1)});
  const logs=[]; const {cm,lt,px}=comoveTask(st,{log:m=>logs.push(m)});
  assert.deepEqual(cm.groups.map(g=>[g.name,g.syms]),[['טכנולוגיה',['AAPL','MSFT']]]); assert.deepEqual(cm.nodata,['5129283']); assert.ok(cm.opposite.length>=1,'XOM against the tech pair');
  assert.equal(st.getDoc('research/comove').data.source,'Yahoo Finance'); assert.equal(lt.count,0,'no weekly series: no long-term ties'); assert.ok(px.months.length>=4&&px.px.MSFT,'month-ends from the daily series');
  assert.match(logs.join(' '),/comove: 1 group/);
});

// 25.10: the second source for the company figures: the SEC's company facts, Finnhub, the beta from the closes
test('fundamentals: twelve months from the reports, the ratios at the price, the beta, and the fill when Yahoo refuses',async()=>{
  const {ttmOf,factRows,secFigures,betaOf,finnhubFigures,fillFundamentals}=await import('../server/fundamentals.js');
  const F=(start,end,val,form='10-Q',filed=end)=>({start,end,val,form,filed});
  const I=(end,val,form='10-Q')=>({end,val,form,filed:end});
  const facts={facts:{'us-gaap':{
    Revenues:{units:{USD:[F('2024-01-01','2024-12-31',800,'10-K'),F('2025-01-01','2025-12-31',1000,'10-K'),F('2025-01-01','2025-06-30',450),F('2026-01-01','2026-06-30',600)]}},
    NetIncomeLoss:{units:{USD:[F('2025-01-01','2025-12-31',200,'10-K'),F('2025-01-01','2025-06-30',90),F('2026-01-01','2026-06-30',130)]}},
    EarningsPerShareDiluted:{units:{'USD/shares':[F('2025-01-01','2025-12-31',2,'10-K'),F('2025-01-01','2025-06-30',0.9),F('2026-01-01','2026-06-30',1.3)]}},
    CommonStockDividendsPerShareDeclared:{units:{'USD/shares':[F('2025-01-01','2025-12-31',0.5,'10-K')]}},
    StockholdersEquity:{units:{USD:[I('2025-12-31',900,'10-K'),I('2026-06-30',1200)]}},
    LongTermDebt:{units:{USD:[I('2026-06-30',600)]}},ShortTermBorrowings:{units:{USD:[I('2026-06-30',60)]}}}}};
  const rev=ttmOf(factRows(facts,['Revenues']));
  assert.equal(rev.v,1150,'the year plus this half minus the same half last year'); assert.equal(rev.end,'2026-06-30'); assert.ok(Math.abs(rev.g-(600/450-1))<1e-9);
  const x=secFigures(facts,48);
  assert.equal(x.pm,Math.round(240/1150*1e4)/100); assert.equal(x.roe,20); assert.equal(x.de,0.55); assert.equal(x.pe,20,'48 / 2.4'); assert.equal(x.dy,1.04); assert.equal(x.revg,33.33);
  // a beta: a share that moves twice the index each week
  const idx=[], bars=[]; let a=100,b=50; for(let i=0;i<300;i++){const d=new Date(Date.UTC(2025,0,1)+i*864e5).toISOString().slice(0,10); const r=Math.sin(i/3)*0.004; a*=1+r; b*=1+2*r; idx.push({d,c:a}); bars.push({d,c:b})}
  const be=betaOf(bars,idx); assert.ok(be>1.8&&be<2.2,'beta '+be);
  assert.equal(betaOf(bars.slice(0,40),idx),null,'too few weeks: no beta');
  assert.deepEqual(finnhubFigures({metric:{netProfitMarginTTM:25.1,roeTTM:30,'totalDebt/totalEquityQuarterly':0.4,revenueGrowthQuarterlyYoy:12,peTTM:22,dividendYieldIndicatedAnnual:1.1,beta:1.2}}),{pm:25.1,roe:30,de:0.4,revg:12,pe:22,dy:1.1,beta:1.2});
  // the fill: Yahoo gave nothing; the SEC and the closes give the rest
  const s=new Store(':memory:'), got={}, seen=[];
  const f=async u=>{u=String(u); seen.push(u);
    if(u.includes('company_tickers'))return new Response(JSON.stringify({0:{cik_str:123,ticker:'ACME',title:'Acme'}}));
    if(u.includes('companyfacts/CIK0000000123'))return new Response(JSON.stringify(facts));
    if(u.includes('/v8/finance/chart/')){const t=decodeURIComponent(u.split('/chart/')[1].split('?')[0]), B=t==='^GSPC'?idx:bars; return new Response(JSON.stringify({chart:{result:[{meta:{gmtoffset:0},timestamp:B.map(x=>Date.parse(x.d+'T20:00:00Z')/1000),indicators:{quote:[{close:B.map(x=>x.c)}]}}]}}))}
    return new Response('',{status:404})};
  const st=await fillFundamentals(s,['ACME'],got,{fetch:f,pause:0,now:new Date('2026-10-25T01:00:00Z')});
  assert.equal(st.filled,1); assert.equal(st.sec,1); assert.ok(got.ACME.beta>1.8); assert.ok(got.ACME.pe>0); assert.equal(got.ACME.roe,20); assert.match(got.ACME.src2,/SEC/);
  assert.ok(seen.some(u=>u.includes('data.sec.gov')),'asked the SEC');
  // a figure Yahoo did give is not replaced
  const got2={ACME:{pm:1,roe:2,de:3,revg:4,pe:5,dy:6,beta:7}}; const st2=await fillFundamentals(s,['ACME'],got2,{fetch:f,pause:0}); assert.equal(st2.tried,0); assert.equal(got2.ACME.pe,5);
});

// 25.10: Finnhub with the owner's key: the figures, the analysts, the coming reports, the earnings, the news
test('finnhub: parsing, the paced client, and the pass that fills what Yahoo did not give',async()=>{
  const F=await import('../server/finnhub.js'); const {finnhubPass,newsFor}=await import('../server/research.js');
  assert.deepEqual(F.fhRating([{period:'2026-09-01',strongBuy:1,buy:1,hold:1,sell:0,strongSell:0},{period:'2026-10-01',strongBuy:10,buy:20,hold:5,sell:1,strongSell:0}]),{rating:'Buy',analysts:36,votes:{buy:30,hold:5,sell:1},votes5:{sb:10,b:20,h:5,s:1,ss:0},recHist:[{p:'2026-09',sb:1,b:1,h:1,s:0,ss:0},{p:'2026-10',sb:10,b:20,h:5,s:1,ss:0}],recAt:'2026-10-01'});   // 5.11: the five levels and the months
  assert.deepEqual(F.fhEps([{period:'2026-06-30',actual:1.2,estimate:1.1,surprisePercent:9.09},{period:'2026-03-31',actual:1,estimate:1,surprisePercent:0}]).map(x=>x.q),['2026-03-31','2026-06-30']);
  assert.deepEqual(F.fhCalendar({earningsCalendar:[{symbol:'acme',date:'2026-11-05',epsEstimate:1.3,revenueEstimate:5e9,hour:'amc'}]}),{ACME:{date:'2026-11-05',eps:1.3,rev:5e9,hour:'amc'}});
  const N=F.fhNews([{headline:'A',url:'https://x.com/a',source:'X',datetime:1761300000,related:'ACME'},{headline:'B',url:'javascript:x'}]); assert.equal(N.length,1); assert.equal(N[0].pub,'X');
  F._resetFh(); process.env.FINNHUB_API_KEY='k';
  const seen=[]; const f=async u=>{u=String(u); seen.push(u); const p=new URL(u).pathname.replace('/api/v1','');
    if(p==='/calendar/earnings')return Response.json({earningsCalendar:[{symbol:'ACME',date:'2026-11-05',epsEstimate:1.3,revenueEstimate:5e9}]});
    if(p==='/stock/metric')return Response.json({metric:{netProfitMarginTTM:20,roeTTM:30,'totalDebt/totalEquityQuarterly':0.5,revenueGrowthQuarterlyYoy:12,peTTM:25,dividendYieldIndicatedAnnual:1,beta:1.1,'52WeekPriceReturnDaily':15}});
    if(p==='/stock/recommendation')return Response.json([{period:'2026-10-01',strongBuy:5,buy:5,hold:2,sell:0,strongSell:0}]);
    if(p==='/stock/earnings')return Response.json([{period:'2026-06-30',actual:1.2,estimate:1.1,surprisePercent:9.09}]);
    if(p==='/stock/price-target')return new Response('',{status:403});
    if(p==='/company-news')return Response.json([{headline:'Acme wins',url:'https://n.com/1',source:'N',datetime:1761300000}]);
    return new Response('',{status:404})};
  const s=new Store(':memory:'), got={};
  const st=await finnhubPass(s,['ACME','TLV:ABC'],got,{fetch:f,now:new Date('2026-10-25T01:00:00Z'),held:new Set(['ACME']),gap:0});
  assert.equal(st.filled,1); assert.equal(got.ACME.pe,25); assert.equal(got.ACME.rating,'Buy'); assert.equal(got.ACME.next,'2026-11-05'); assert.equal(got.ACME.rep.eps.a,1.2); assert.ok(got.ACME.rep.init);
  assert.ok(!seen.some(u=>u.includes('ABC')),'Tel Aviv is not asked');
  assert.ok(!got.ACME.target,'a call the plan does not include is skipped');
  // 9.11: an old stored report (its quarter ended 150 days ago) is asked again, and replaced by the newer quarter, not as a
  // first sight (init false); a security asked for by name (force) counts as followed; a newer stored one is kept
  s.setDoc('research/s_OLDCO',{rep:{q:'2026-03-31',label:'Q1 2026'},fhAt:'2026-10-24T00:00:00Z',recAt:'2026-10-20T00:00:00Z'});
  const got2={}; await finnhubPass(s,['OLDCO'],got2,{fetch:f,now:new Date('2026-10-25T01:00:00Z'),force:new Set(['OLDCO']),gap:0,cal:false});
  assert.equal(got2.OLDCO.rep.q,'2026-06-30'); assert.equal(got2.OLDCO.rep.init,false,'a newer quarter: an event');
  s.setDoc('research/s_NEWCO',{rep:{q:'2026-09-30',label:'Q3 2026',at:'2026-10-20'},recAt:new Date('2026-10-24T00:00:00Z').toISOString()});
  const got3={}; await finnhubPass(s,['NEWCO'],got3,{fetch:f,now:new Date('2026-10-25T01:00:00Z'),force:new Set(['NEWCO']),gap:0,cal:false});
  assert.ok(!(got3.NEWCO&&got3.NEWCO.rep),'a fresh report is not replaced by an older one');
  const items=await newsFor('ACME',{fetch:f,now:new Date('2026-10-25T01:00:00Z')}); assert.equal(items[0].title,'Acme wins');
  delete process.env.FINNHUB_API_KEY;
});

test('jobs: the prices have a lane of their own: a long research run does not hold them back',async()=>{
  const {startJobs}=await import('../server/jobs.js'); const ran=[];
  const J=startJobs(new Store(':memory:'),{log:()=>{},every:1e9,limits:{research:5000},schedule:[
    {name:'research',when:()=>false,run:()=>new Promise(r=>setTimeout(r,800))},{name:'prices',lane:'px',when:()=>false,run:async()=>{ran.push('prices')}},{name:'other',when:()=>false,run:async()=>{ran.push('other')}}]});
  try{J.run('research'); J.run('other'); J.run('prices'); await new Promise(r=>setTimeout(r,200));
    assert.deepEqual(ran,['prices'],'the prices ran while the research still runs; the other job waits its turn');
    await new Promise(r=>setTimeout(r,900)); assert.deepEqual(ran,['prices','other'])}
  finally{J.stop()}
});

// 28.10: the news feed behind "חדשות"
test('news feed: the articles of everybody\'s securities, merged by link, kept a week, a partner sees only their own',async()=>{
  const {newsTask,newsSyms}=await import('../server/newsfeed.js'); const {partnerView}=await import('../server/store.js');
  const s=new Store(':memory:'); s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:1},{sym:'TLV:TEVA',qty:1}]},{silent:true});
  s.setDoc('data/users/u2/portfolio',{positions:[{sym:'KO',qty:1}]},{silent:true}); s.setDoc('watch/u2',{marks:['MSFT']},{silent:true});
  assert.deepEqual(newsSyms(s),['KO','MSFT','NVDA'],'US securities of the owner, the guests and the watch lists; Tel Aviv has no article source');
  process.env.FINNHUB_API_KEY='k'; const {_resetFh}=await import('../server/finnhub.js'); _resetFh();
  const now=new Date('2026-10-28T10:00:00Z'), f=async u=>{u=String(u); const m=u.match(/symbol=([A-Z]+)/); const k=m?m[1]:'';
    if(u.includes('/company-news'))return Response.json([{headline:k+' rises',url:'https://n.com/'+k,source:'N',datetime:Date.parse('2026-10-28T08:00:00Z')/1000,summary:'why'},{headline:'Market wrap',url:'https://n.com/wrap',source:'W',datetime:Date.parse('2026-10-20T08:00:00Z')/1000}]);
    return new Response('',{status:404})};
  const st=await newsTask(s,{fetch:f,now,budgetMs:60e3,market:[]}); assert.equal(st.ok,3); assert.equal(st.items,3,'three of the day, the old wrap dropped');
  const d=s.getDoc('research/news').data; const wrap=d.items.find(x=>x.link==='https://n.com/wrap'); assert.ok(!wrap,'older than a week: gone');
  assert.deepEqual(d.items.map(x=>x.link).sort(),['https://n.com/KO','https://n.com/MSFT','https://n.com/NVDA']); assert.equal(d.items.find(x=>x.link==='https://n.com/KO').sum,'why');
  // the same article about two securities: one item, both symbols
  const f2=async u=>{u=String(u); if(u.includes('/company-news'))return Response.json([{headline:'Big tech',url:'https://n.com/tech',source:'T',datetime:Date.parse('2026-10-28T09:00:00Z')/1000}]); return new Response('',{status:404})};
  await newsTask(s,{fetch:f2,now,budgetMs:60e3,market:[]}); const d2=s.getDoc('research/news').data, tech=d2.items.find(x=>x.link==='https://n.com/tech'); assert.deepEqual(tech.syms.sort(),['KO','MSFT','NVDA']); assert.equal(d2.items.length,4,'the earlier ones stay');
  // a partner (u2: KO and MSFT) does not see NVDA's article
  s.setDoc('data/users/u2/settings',{},{silent:true});
  const pv=partnerView(s,{id:'u2',role:'partner'},'research/news',d2); assert.deepEqual(pv.items.map(x=>x.link).sort(),['https://n.com/KO','https://n.com/MSFT','https://n.com/tech']); assert.deepEqual(pv.items.find(x=>x.link==='https://n.com/tech').syms.sort(),['KO','MSFT']);
  delete process.env.FINNHUB_API_KEY;
});

// 30.10: Globes for the Tel Aviv shares: the feed read in its own encoding, the Hebrew names (an everyday word only in its
// full form), a fund left out, the key of the holding itself, headline and link only, a partner's own, and off by IL_NEWS=0
test('Globes for the Tel Aviv shares: headlines matched by the Hebrew names to the holding itself, never the text',async()=>{
  const {parseRss,rssText,ilAliases,ilMatcher,ilTargets,ilNews,IL_FEEDS}=await import('../server/ilnews.js'); const {newsTask}=await import('../server/newsfeed.js');
  const it=(t,id,d,desc='')=>`<item><title><![CDATA[${t}]]></title><link>https://www.globes.co.il/news/article.aspx?did=${id}#utm_source=RSS</link><description><![CDATA[${desc}]]></description><pubDate>${d}</pubDate></item>`;
  const xml=`<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>גלובס</title>${it('הפניקס מדווחת על רווח שיא','1','Thu, 29 Oct 2026 10:00:00 GMT','<p>החברה &quot;עקפה&quot; את התחזיות</p>')}${it('הטבע הישראלי בסכנה: מחקר חדש','2','Thu, 29 Oct 2026 11:00:00 GMT')}${it('בפניקס מסכמים רבעון; ובלאומי מתכוננים','3','Thu, 29 Oct 2026 12:00:00 GMT')}${it('בנק לאומי: הרווח עלה','4','Thu, 29 Oct 2026 13:00:00 GMT')}${it('הראל מחקה ת"א 125 גייסה','5','Thu, 29 Oct 2026 13:00:00 GMT')}${it('אלביט מערכות: חוזה ישן','6','Thu, 01 Oct 2026 13:00:00 GMT')}</channel></rss>`;
  const L=parseRss(xml); assert.equal(L.length,6); assert.equal(L[0].link,'https://www.globes.co.il/news/article.aspx?did=1','no tracking fragment'); assert.equal(L[0].desc,'החברה "עקפה" את התחזיות'); assert.equal(L[0].at,'2026-10-29T10:00:00.000Z');
  // a feed in windows-1255 is read as Hebrew
  {const enc=new Uint8Array([...Buffer.from('<?xml version="1.0" encoding="windows-1255"?><rss><channel><item><title>'),0xE4,0xF4,0xF0,0xE9,0xF7,0xF1,...Buffer.from('</title><link>https://www.globes.co.il/a</link></item></channel></rss>')]);
    assert.equal(parseRss(await rssText(new Response(enc))).at(0).title,'הפניקס')}
  assert.deepEqual(ilAliases(['הפניקס אחזקות בע"מ']),['הפניקס אחזקות','הפניקס']); assert.deepEqual(ilAliases(['בנק לאומי לישראל בע"מ','לאומי']),['בנק לאומי לישראל','בנק לאומי'],'"לאומי" alone is an everyday word');
  assert.deepEqual(ilAliases(['טבע']),[],'nor "טבע"'); assert.deepEqual(ilAliases(['Phoenix Holdings']),[],'Hebrew names only');
  assert.ok(ilMatcher('הפניקס').test('בפניקס מסכמים') && ilMatcher('הפניקס').test('ובהפניקס') && !ilMatcher('הפניקס').test('הפניקסית'),'the letters before a name, a whole word');
  // the targets: the holding's own key; a fund (a number not in the exchange's shares) left out
  const s=new Store(':memory:'); s.setDoc('research/ilsyms',{stocks:[['PHOE','הפניקס','הפניקס אחזקות בע"מ','',767012],['LUMI','לאומי','בנק לאומי לישראל בע"מ','',604611]]},{silent:true});
  s.setDoc('portfolio/main',{positions:[{sym:'767012',qty:1,ccy:'ILS'},{sym:'5124573',qty:1,ccy:'ILS',name:'הראל מחקה ת"א 125'},{sym:'NVDA',qty:1}]},{silent:true});
  s.setDoc('data/users/u2/portfolio',{positions:[{sym:'TLV:LUMI',qty:1}]},{silent:true}); s.setDoc('data/users/u2/settings',{},{silent:true});
  assert.deepEqual(ilTargets(s).map(t=>t.sym),['767012','TLV:LUMI']);
  const urls=[], f=async u=>{u=String(u); urls.push(u); if(/globes\.co\.il\/webservice\/rss/.test(u))return new Response(xml,{headers:{'content-type':'text/xml; charset=utf-8'}}); if(u.includes('/company-news'))return Response.json([]); return new Response('',{status:404})};
  const now=new Date('2026-10-30T08:00:00Z'), r=await ilNews(s,{fetch:f,now});
  assert.equal(r.ok,IL_FEEDS.length); assert.deepEqual(r.items.map(x=>[x.title,x.syms]),[['הפניקס מדווחת על רווח שיא',['767012']],['בפניקס מסכמים רבעון; ובלאומי מתכוננים',['767012']],['בנק לאומי: הרווח עלה',['TLV:LUMI']]],'nature, the fund\'s manager, and the old one: none');
  assert.ok(r.items.every(x=>x.pub==='גלובס'&&x.sum===null&&!('desc' in x)),'the headline and the link, never the text');
  // into the news, merged with the rest; a partner sees their own share's headline only
  await newsTask(s,{fetch:f,now,budgetMs:60e3,market:[]}); const d=s.getDoc('research/news').data;
  assert.equal(d.items.filter(x=>x.pub==='גלובס').length,3); assert.match(d.source,/גלובס/);
  assert.deepEqual(partnerView(s,{id:'u2',role:'partner'},'research/news',d).items.map(x=>x.title),['בנק לאומי: הרווח עלה']);
  // off
  process.env.IL_NEWS='0'; urls.length=0; const off=await ilNews(s,{fetch:f,now}); delete process.env.IL_NEWS; assert.ok(off.off&&!urls.length);
});

// 31.10: more sources, only reliable ones: the companies' own SEC reports, the trusted publishers through Google News
// (a headline that names the company, from a publisher on the list), and the Federal Reserve's monetary releases
test('more sources: SEC filings, Google News from trusted publishers only, the Fed; once an hour',async()=>{
  const S=await import('../server/sources.js'); const {newsTask}=await import('../server/newsfeed.js'); const {kindOf}=await import('../server/newsx.js');
  const now=new Date('2026-10-30T12:00:00Z'), d=h=>new Date(now.getTime()-h*3600e3).toUTCString();
  const gi=(t,src,url,h,link)=>`<item><title>${t} - ${src}</title><link>${link}</link><guid isPermaLink="false">x</guid><pubDate>${d(h)}</pubDate><description>&lt;a href="x"&gt;${t}&lt;/a&gt;</description><source url="${url}">${src}</source></item>`;
  const gx=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"NVIDIA" - Google News</title>${gi('Nvidia beats estimates as data center sales soar','Reuters','https://www.reuters.com',3,'https://news.google.com/rss/articles/A1?oc=5')}${gi('Is Nvidia stock a buy now?','The Motley Fool','https://www.fool.com',2,'https://news.google.com/rss/articles/A2?oc=5')}${gi('Chip stocks rally; markets climb','CNBC','https://www.cnbc.com',4,'https://news.google.com/rss/articles/A3?oc=5')}${gi('Nvidia supplier TSMC lifts guidance','Bloomberg.com','https://www.bloomberg.com',90,'https://news.google.com/rss/articles/A4?oc=5')}</channel></rss>`;
  const F=S.parseFeed(gx); assert.equal(F.length,4); assert.equal(F[0].src,'Reuters'); assert.equal(F[0].srcUrl,'https://www.reuters.com');
  const P=S.gnPick(F,{sym:'NVDA',name:'NVIDIA',aliases:['NVIDIA'],now}); assert.deepEqual(P.map(x=>[x.title,x.pub]),[['Nvidia beats estimates as data center sales soar','Reuters']],'the Fool: not on the list; CNBC: not about the company; Bloomberg: too old');
  assert.deepEqual(S.aliasesOf(S.shortName('Meta Platforms, Inc. - Class A Common Stock')),['Meta Platforms','Meta']); assert.deepEqual(S.aliasesOf('American Express'),['American Express']);
  // SEC: an 8-K with results, a 10-Q, an old one, one with only exhibits
  const sub={name:'NVIDIA CORP',filings:{recent:{form:['8-K','10-Q','8-K','8-K','4'],items:['2.02,9.01','','9.01','5.02','',],accessionNumber:['0001045810-26-000101','0001045810-26-000100','0001045810-26-000099','0001045810-26-000050','x'],
    primaryDocument:['nvda-8k.htm','nvda-10q.htm','x.htm','y.htm','z'],acceptanceDateTime:[new Date(now-5*3600e3).toISOString(),new Date(now-30*3600e3).toISOString(),new Date(now-6*3600e3).toISOString(),new Date(now-20*864e5).toISOString(),new Date(now).toISOString()]}}};
  const E=S.secPick(sub,{sym:'NVDA',cik:1045810,now}); assert.deepEqual(E.map(x=>x.title),['NVIDIA filed a report with the SEC (form 8-K): Results of Operations and Financial Condition','NVIDIA filed its quarterly report with the SEC (form 10-Q)']);
  assert.equal(E[0].link,'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000101/nvda-8k.htm'); assert.equal(E[0].pub,'SEC EDGAR'); assert.equal(kindOf(E[0]),'pr','the company\'s own word');
  // into the news, once an hour; the Fed into everybody's news
  const s2=new Store(':memory:'); s2.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:1,name:'NVIDIA Corporation'}]},{silent:true}); s2.setDoc('research/secmap',{map:{NVDA:1045810},updatedAt:now.toISOString()},{silent:true});
  const fx=`<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261029a.htm</link><pubDate>${d(20)}</pubDate></item></channel></rss>`;
  const urls=[], f=async u=>{u=String(u); urls.push(u); if(u.includes('news.google.com'))return new Response(gx); if(u.includes('data.sec.gov/submissions'))return Response.json(sub); if(u.includes('federalreserve.gov'))return new Response(fx); return new Response('',{status:404})};
  const {_resetCiks}=await import('../server/fundamentals.js'); _resetCiks();
  const st=await newsTask(s2,{fetch:f,now,budgetMs:60e3,market:[],il:null}); const L=s2.getDoc('research/news').data.items;
  assert.ok(L.some(x=>x.pub==='Reuters'&&x.syms[0]==='NVDA')&&L.some(x=>x.pub==='SEC EDGAR'),JSON.stringify(L.map(x=>x.pub))); assert.ok(!L.some(x=>/Motley/.test(x.pub)));
  assert.equal(st.more.sec.items,2); assert.equal(st.more.gnews.items,1); assert.match(s2.getDoc('research/news').data.source,/SEC EDGAR.*Google News/);
  urls.length=0; await newsTask(s2,{fetch:f,now:new Date(now.getTime()+20*60e3),budgetMs:60e3,market:[],il:null}); assert.ok(!urls.some(u=>/news\.google|data\.sec/.test(u)),'not again within the hour');
  const Fd=await S.fedNews({fetch:f,now}); assert.equal(Fd.length,1); assert.equal(Fd[0].pub,'Federal Reserve'); assert.equal(kindOf(Fd[0]),'pr');
  process.env.GNEWS='0'; assert.ok((await S.gnewsTask(s2,{syms:['NVDA'],fetch:f,now})).off); delete process.env.GNEWS;
});

test('report days from the SEC: the earnings release (8-K, item 2.02) or the quarterly report, and a stored report redated by them',async()=>{
  const {secRepDates,_resetCiks}=await import('../server/fundamentals.js'); _resetCiks();
  const sub={filings:{recent:{form:['8-K','10-Q','8-K','4','8-K','10-K'],filingDate:['2026-08-27','2026-08-29','2026-07-02','2026-06-01','2026-05-28','2026-03-14'],items:['2.02,9.01','','5.07','','2.02','',''],reportDate:['','2026-07-27','','','','2026-01-26']}}};
  assert.deepEqual(secRepDates(sub).map(x=>[x.date,x.src]),[['2026-08-29','10-Q'],['2026-08-27','8-K'],['2026-05-28','8-K'],['2026-03-14','10-K']],'the 8-K about a vote (5.07) and the form 4 are not reports');
  assert.deepEqual(secRepDates(null),[]);
  // the research run: NVDA's stored report was dated by the day it was first read (25.10, estimated); the SEC's release
  // day after the quarter's end replaces it, in its document and in the copy the page reads, the earlier report too
  const {researchTask}=await import('../server/research.js'); const s=new Store(':memory:');
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'}]});
  s.setDoc('research/s_NVDA',{sym:'NVDA',rep:{q:'2026-07-26',label:'Q2 2026',at:'2026-10-25',atEst:true,ccy:'USD'},reps:[{q:'2026-04-26',label:'Q1 2026',at:'2026-10-25',atEst:true}]});
  s.setDoc('research/latest',{companies:{NVDA:{rep:{q:'2026-07-26',at:'2026-10-25',atEst:true}}},events:[{sym:'NVDA',q:'2026-07-26',date:'2026-10-25',atEst:true}],updatedAt:'2026-10-25T00:00:00Z'});
  const Y=fakeYahoo({crumbFail:true}), f=async(u,o)=>{u=String(u);
    if(u.endsWith('/files/company_tickers.json'))return new Response(JSON.stringify({0:{cik_str:1045810,ticker:'NVDA',title:'NVIDIA'}}));
    if(u.includes('/submissions/CIK0001045810.json'))return new Response(JSON.stringify(sub));
    return Y.f(u,o)};
  const st=await researchTask(s,{fetch:f,pause:0,noFh:true,divs:null,fill:async()=>({})});
  assert.equal(st.dates.dated,1);
  const d=s.getDoc('research/s_NVDA').data; assert.equal(d.rep.at,'2026-08-27','the release, not the 10-Q two days later'); assert.equal(d.rep.atSrc,'cal'); assert.ok(!d.rep.atEst);
  assert.equal(d.reps[0].at,'2026-05-28','the earlier report as well');
  const L=s.getDoc('research/latest').data; assert.equal(L.companies.NVDA.rep.at,'2026-08-27'); assert.equal(L.events[0].date,'2026-08-27');
});

test('dividends ahead: Nasdaq\'s declared ones, Yahoo\'s past ones, and the next ones by the rhythm (estimated)',async()=>{
  const {nasdaqDivParse,yahooDivParse,divPlan}=await import('../server/divs.js');
  const N=nasdaqDivParse({data:{dividends:{rows:[{exOrEffDate:'11/28/2026',type:'Cash',amount:'$0.51',declarationDate:'10/20/2026',recordDate:'11/28/2026',paymentDate:'12/15/2026'},
    {exOrEffDate:'09/12/2026',type:'Cash',amount:'$0.51',declarationDate:'07/20/2026',recordDate:'09/12/2026',paymentDate:'10/01/2026'},
    {exOrEffDate:'06/13/2026',type:'Cash',amount:'$0.51',declarationDate:'',recordDate:'',paymentDate:'07/01/2026'},
    {exOrEffDate:'03/14/2026',type:'Cash',amount:'$0.485',declarationDate:'',recordDate:'',paymentDate:'04/01/2026'},{exOrEffDate:'01/02/2026',type:'Stock',amount:'',paymentDate:'N/A'}]}}});
  assert.deepEqual(N.map(x=>x.ex),['2026-11-28','2026-09-12','2026-06-13','2026-03-14'],'cash only, newest first'); assert.equal(N[0].pay,'2026-12-15'); assert.equal(N[0].amt,0.51);
  const P=divPlan(N,{now:new Date('2026-10-28T10:00:00Z')});
  assert.equal(P.freq,'quarterly'); assert.deepEqual(P.next[0],{ex:'2026-11-28',pay:'2026-12-15',amt:0.51,est:false},'the declared one as it is');
  assert.ok(P.next.slice(1).every(x=>x.est&&x.ex>'2026-11-28'&&x.ex<='2027-10-28'),'then the estimated ones, within a year'); assert.equal(P.next.length,4);
  assert.ok(P.next[1].ex>='2027-02-20'&&P.next[1].ex<='2027-03-10','about three months after the last: '+P.next[1].ex); assert.ok(P.next[1].pay>P.next[1].ex,'the usual gap to the payment');
  // Yahoo's past dividends; a company that stopped paying is not projected
  const Yd=yahooDivParse({chart:{result:[{events:{dividends:{a:{amount:0.25,date:Date.parse('2026-08-10T13:30:00Z')/1000},b:{amount:0.25,date:Date.parse('2026-05-11T13:30:00Z')/1000}}}}]}});
  assert.deepEqual(Yd.map(x=>x.ex),['2026-08-10','2026-05-11']);
  const old=divPlan([{ex:'2024-08-10',amt:0.2},{ex:'2024-05-10',amt:0.2},{ex:'2024-02-10',amt:0.2}],{now:new Date('2026-10-28T10:00:00Z')});
  assert.deepEqual(old.next,[],'stopped: nothing ahead'); assert.equal(divPlan([],{}),null);
});

test('dividends ahead in the research run: Nasdaq for a US share, Yahoo for a Tel Aviv one (the days, not the agorot)',async()=>{
  const {divsPass}=await import('../server/research.js'); const s=new Store(':memory:'), now=new Date('2026-10-28T10:00:00Z'), seen=[];
  const ts=d=>Date.parse(d+'T07:00:00Z')/1000;
  const f=async u=>{u=String(u); seen.push(u);
    if(u.includes('api.nasdaq.com/api/quote/KO/dividends'))return new Response(JSON.stringify({data:{dividends:{rows:[{exOrEffDate:'11/28/2026',type:'Cash',amount:'$0.51',declarationDate:'10/20/2026',paymentDate:'12/15/2026'},{exOrEffDate:'09/12/2026',type:'Cash',amount:'$0.51',paymentDate:'10/01/2026'},{exOrEffDate:'06/13/2026',type:'Cash',amount:'$0.51',paymentDate:'07/01/2026'}]}}}));
    if(u.includes('/v8/finance/chart/TEVA.TA'))return new Response(JSON.stringify({chart:{result:[{events:{dividends:{a:{amount:25,date:ts('2026-09-01')},b:{amount:25,date:ts('2026-03-02')},c:{amount:20,date:ts('2025-09-01')}}}}]}}));
    return new Response('',{status:500})};
  const got={}; const st=await divsPass(s,['KO','TLV:TEVA','MSFT'],got,{fetch:f,tick:k=>k.startsWith('TLV:')?k.slice(4)+'.TA':k,now,held:new Set(['KO','TLV:TEVA']),pause:0});
  assert.equal(st.planned,2); assert.ok(!seen.some(u=>u.includes('MSFT')),'not held or followed: not asked'); assert.ok(!seen.some(u=>u.includes('nasdaq.com/api/quote/TEVA')),'Nasdaq is not asked about Tel Aviv');
  assert.equal(got.KO.divPlan.src,'Nasdaq'); assert.deepEqual(got.KO.divPlan.next[0],{ex:'2026-11-28',pay:'2026-12-15',amt:0.51,est:false});
  assert.equal(got['TLV:TEVA'].divPlan.freq,'semi'); assert.ok(got['TLV:TEVA'].divPlan.next[0].est&&got['TLV:TEVA'].divPlan.next[0].amt===null&&got['TLV:TEVA'].divPlan.next[0].ex.startsWith('2027-0'),JSON.stringify(got['TLV:TEVA'].divPlan.next));
  // asked again within three days: not again
  s.setDoc('research/s_KO',{sym:'KO',divPlanAt:now.toISOString()}); const g2={}; await divsPass(s,['KO'],g2,{fetch:f,now,held:new Set(['KO']),pause:0}); assert.equal(g2.KO,undefined);
});

test('31.10 the story behind the headline: one per event from its readings, every line with how sure and its sources; by rules without a key; kept until new articles join; a partner only from their own articles',async()=>{
  const {storyOf,storyPrompt,cleanStory,rulesStory,eventArts}=await import('../server/story.js'); const {newsId}=await import('../server/newsx.js'); const {partnerView}=await import('../server/store.js');
  const s=new Store(':memory:'), now=new Date('2026-10-31T10:00:00Z'), iso=now.toISOString();
  const R=(o)=>({he:o.he,what:o.what,type:o.type||'company',level:o.level||'imp',dir:'unclear',cert:'fact',kind:'news',aff:o.aff||[],sectors:o.sectors||[],themes:[],regions:['us'],occ:null,fac:o.fac||[],secx:[],macro:false,unknown:o.unknown||'',more:o.more||'',ev:o.ev,st:o.st||'unknown',at:iso});
  s.setDoc('research/news',{items:[{title:'Nvidia beats estimates',pub:'Reuters',link:'https://x/n1',at:iso,syms:['NVDA'],seen:iso},{title:'Nvidia raises outlook after beat',pub:'Bloomberg',link:'https://x/n2',at:iso,syms:['NVDA'],seen:iso},{title:'Coca-Cola names CFO',pub:'AP',link:'https://x/k1',at:iso,syms:['KO'],seen:iso}]});
  const n1=newsId('https://x/n1'), n2=newsId('https://x/n2'), k1=newsId('https://x/k1');
  s.setDoc('research/newsx',{by:{[n1]:R({he:'אנבידיה היכתה את התחזיות',what:'החברה דיווחה על הכנסות מעל הצפי.',type:'earnings',ev:'nvda-q3-report',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:'הדוח שלה'},{sym:'TSM',how:'supplier',dir:'pos',why:'מייצרת את השבבים'}],sectors:['Semiconductors'],fac:[{k:'chips',move:'up',why:'ביקוש'}],unknown:'מה יהיה ברבעון הבא.',more:'אנבידיה מובילה בשבבי AI.',st:'updated'}),
    [n2]:R({he:'אנבידיה העלתה את הצפי',what:'החברה העלתה את הצפי לרבעון הבא.',type:'guidance',ev:'nvda-q3-report'}),[k1]:R({he:'קוקה-קולה מינתה סמנכ"ל כספים',what:'מינוי.',type:'management',ev:'ko-cfo'})},gen:[],updatedAt:iso});
  // the event's articles, newest first, and the prompt with every reading
  const L=eventArts(s,'nvda-q3-report',{now}); assert.deepEqual(L.map(z=>z.a.id).sort(),[n1,n2].sort());
  const pr=storyPrompt('nvda-q3-report',L); assert.match(pr,/מה קרה בפועל|what = /); assert.ok(pr.includes('Nvidia beats estimates')&&pr.includes('מייצרת את השבבים'));
  // the answer cleaned: a fact without a source becomes a reading; an estimate outside bg/why/impl/follow becomes a reading; advice is dropped
  const C=cleanStory({headline:'מה קרה לאנבידיה ברבעון',stage:'updated',what:[{t:'החברה דיווחה על הכנסות מעל הצפי.',c:'fact',s:[0]},{t:'כדאי לקנות עכשיו.',c:'fact',s:[0]},{t:'לפי הערכתי זה רבעון שיא.',c:'est',s:[]}],bg:[{t:'אנבידיה מובילה בשבבי AI.',c:'est',s:[]}],why:[{t:'הכתבות לא אומרות למה.',c:'fact',s:[]}],who:[{t:'אנבידיה.',c:'fact',s:[]}],links:[{t:'TSM מייצרת את השבבים.',c:'interp',s:[0]}],impl:[],unknown:[{t:'מה יהיה ברבעון הבא.',c:'interp',s:[0]}],follow:[{t:'הדוח הבא.',c:'est',s:[]}]},2);
  assert.equal(C.what.length,2,'the advice dropped'); assert.equal(C.what[1].c,'interp','an estimate in "what" is a reading'); assert.equal(C.who[0].c,'interp','a fact with no source is a reading'); assert.equal(C.why[0].c,'fact','"the articles do not say" may be a fact'); assert.equal(C.bg[0].c,'est'); assert.equal(C.stage,'updated');
  // by rules, without a key: the readings' own words, said to be by rules, with the stage from a reading
  const k0=process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try{const r=await storyOf(s,'nvda-q3-report',{now}); assert.equal(r.rules,true); assert.equal(r.model,'rules'); assert.equal(r.stage,'updated'); assert.ok(r.what.some(l=>/מעל הצפי/.test(l.t))); assert.ok(r.links.some(l=>/TSM/.test(l.t))); assert.equal(r.arts.length,2);
    assert.ok(s.getDoc('research/stories').data.by['nvda-q3-report'],'kept')}finally{if(k0!=null)process.env.ANTHROPIC_API_KEY=k0}
  // with צ׳יקו: his story replaces the rules' one; kept while the articles are the same; made again when one joins
  const asked=[]; const ask=async p=>{asked.push(p); return JSON.stringify({headline:'הרבעון של אנבידיה',stage:'updated',what:[{t:'החברה דיווחה על הכנסות מעל הצפי.',c:'fact',s:[0,1]}],bg:[{t:'רקע.',c:'est',s:[]}],why:[{t:'לפי רויטרס, ביקוש לשבבים.',c:'interp',s:[0]}],who:[{t:'אנבידיה.',c:'fact',s:[0]}],links:[{t:'TSM.',c:'interp',s:[0]}],impl:[{t:'הענף עשוי ליהנות.',c:'est',s:[]}],unknown:[{t:'הרבעון הבא.',c:'interp',s:[0]}],follow:[{t:'הדוח הבא.',c:'est',s:[]}]})};
  let r=await storyOf(s,'nvda-q3-report',{now,ask}); assert.equal(r.rules,undefined); assert.equal(r.headline,'הרבעון של אנבידיה'); assert.equal(r.model,'test'); assert.equal(asked.length,1);
  r=await storyOf(s,'nvda-q3-report',{now:new Date(now.getTime()+60e3),ask}); assert.equal(asked.length,1,'the same articles: kept');
  const n3=newsId('https://x/n3'); s.setDoc('research/news',{items:[...s.getDoc('research/news').data.items,{title:'Nvidia shares react',pub:'CNBC',link:'https://x/n3',at:iso,syms:['NVDA'],seen:iso}]});
  s.setDoc('research/newsx',{...s.getDoc('research/newsx').data,by:{...s.getDoc('research/newsx').data.by,[n3]:R({he:'המניה הגיבה',what:'המניה עלתה.',ev:'nvda-q3-report'})}});
  r=await storyOf(s,'nvda-q3-report',{now:new Date(now.getTime()+3*36e5),ask}); assert.equal(asked.length,2,'a new article: written again'); assert.equal(r.arts.length,3);
  // a partner holding KO: the story of KO's event rests on their articles; NVDA's story is not theirs to see
  const f=s.addUser({email:'p@example.com',password:'partner-pass-1',role:'friend'}); s.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'KO',qty:1,ccy:'USD'}]});
  const vis=a=>a.src==='gen'||(a.syms||[]).includes('KO'); assert.equal(await storyOf(s,'nvda-q3-report',{now,ask,visible:vis}),null,'nothing of NVDA for them');
  const pv=partnerView(s,{id:f.id,role:'friend'},'research/stories',s.getDoc('research/stories').data); assert.deepEqual(Object.keys(pv.by),[],'the kept stories: none of theirs yet');
  await storyOf(s,'ko-cfo',{now,visible:vis}); assert.deepEqual(Object.keys(partnerView(s,{id:f.id,role:'friend'},'research/stories',s.getDoc('research/stories').data).by),['ko-cfo']);
  // the endpoint: the event's story, a bad key refused
  const {srv,req,store:st2}=await startApp(); try{st2.setDoc('research/news',s.getDoc('research/news').data); st2.setDoc('research/newsx',s.getDoc('research/newsx').data);
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'}); const k1b=process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try{const r2=await req('o','POST','/api/newsx/story',{ev:'ko-cfo'}); assert.equal(r2.status,200); assert.equal(r2.j.ev,'ko-cfo'); assert.ok(r2.j.what.length);
      assert.equal((await req('o','POST','/api/newsx/story',{ev:'bad key!'})).status,400)}finally{if(k1b!=null)process.env.ANTHROPIC_API_KEY=k1b}}finally{srv.close()}
});

test('1.11 a daily copy: what it holds of my documents, and a restore of the settings and the plans (or the portfolio) from it; an admin only their own',async()=>{
  const {backupNow,backupPeek,backupRestore}=await import('../server/backup.js'); const fs=await import('node:fs'); const os=await import('node:os'); const path=await import('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tcbk-')), s=new Store(':memory:');
  const o=s.addUser({email:'shai@example.com',password:'owner-pass-123',role:'owner'}), a=s.addUser({email:'ori@example.com',password:'friend-pass-1',role:'friend'}); s.setRole(a.id,'admin');
  s.setDoc('settings/main',{profile:{first:'שי'},monthly:800,depDay:10,targets:{tech:50},ui:{tr_view:'full'}}); s.setDoc('plan/main',{items:[{sym:'MSFT'}],idx:{items:[{sym:'TA125'}]},purchases:[]}); s.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:1}]}); s.setDoc('history/main',{accounts:[{id:'exc'}]});
  s.setDoc(`data/users/${a.id}/settings`,{profile:{first:'אורי'}}); s.setDoc(`data/users/${a.id}/plan`,{items:[]});
  const r=backupNow(s,{dataDir:dir,now:new Date('2026-11-01T00:30:00Z')}); const file=path.basename(r.file);
  // the owner's look: the name, the deposit, the plan, the portfolio
  const pk=backupPeek(o,{dataDir:dir,file}); assert.equal(pk.settings.name,'שי'); assert.equal(pk.settings.monthly,800); assert.equal(pk.settings.ui,true); assert.equal(pk.plan.items,1); assert.equal(pk.plan.idx,1); assert.equal(pk.portfolio.positions,1); assert.equal(pk.history.accounts,1);
  // the page wrote defaults over the settings and the plan: restored from the copy, the portfolio untouched
  s.setDoc('settings/main',{monthly:500,targets:{}}); s.setDoc('plan/main',{items:[]}); s.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:2}]});
  const done=backupRestore(s,o,{dataDir:dir,file,set:'settings'}); assert.deepEqual(done.sort(),['plan/main','settings/main']);
  assert.equal(s.getDoc('settings/main').data.profile.first,'שי'); assert.equal(s.getDoc('settings/main').data.monthly,800); assert.equal(s.getDoc('plan/main').data.items.length,1); assert.equal(s.getDoc('portfolio/main').data.positions[0].qty,2,'the portfolio as it is now');
  // the admin: their own documents, never the owner's
  assert.equal(backupPeek(a,{dataDir:dir,file}).settings.name,'אורי'); s.setDoc(`data/users/${a.id}/settings`,{}); assert.deepEqual(backupRestore(s,a,{dataDir:dir,file,set:'settings'}).sort(),[`data/users/${a.id}/plan`,`data/users/${a.id}/settings`]); assert.equal(s.getDoc(`data/users/${a.id}/settings`).data.profile.first,'אורי');
  assert.throws(()=>backupPeek(o,{dataDir:dir,file:'../x.sqlite'}),/bad file/); assert.throws(()=>backupRestore(s,o,{dataDir:dir,file,set:'users'}),/bad set/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('the news understood: one reading per article, shared; the general news; a partner sees the readings of their own securities and the general ones',async()=>{
  const {newsxTask,cleanX,newsId,newsPrompt}=await import('../server/newsx.js'); const {partnerView}=await import('../server/store.js');
  const s=new Store(':memory:'), now=new Date('2026-10-29T08:25:00Z'), iso=now.toISOString();
  s.setDoc('research/news',{items:[{title:'Nvidia beats estimates, raises outlook',pub:'Reuters',link:'https://x/nvda1',at:iso,sum:'Nvidia reported revenue above estimates and raised its outlook',syms:['NVDA'],seen:iso},
    {title:'Coca-Cola names new CFO',pub:'AP',link:'https://x/ko1',at:iso,syms:['KO'],seen:iso},{title:'old one',pub:'x',link:'https://x/old',at:'2026-10-01T00:00:00Z',syms:['KO'],seen:'2026-10-01T00:00:00Z'}],updatedAt:iso});
  // the reading: a fake Claude that answers the batch, and a general feed of one article
  const asked=[]; const ask=async prompt=>{asked.push(prompt); const n=(prompt.match(/"i":\d+/g)||[]).length;
    const A=[{i:0,he:'אנבידיה היכתה את התחזיות והעלתה את התחזית',what:'החברה דיווחה על הכנסות מעל הצפי.',type:'earnings',level:'crit',dir:'pos',cert:'fact',aff:[{sym:'NVDA',how:'direct',dir:'pos',why:'הדוח של החברה עצמה'},{sym:'TSM',how:'supplier',dir:'pos',why:'מייצרת את השבבים'},{sym:'bad sym',how:'x'}],sectors:['Technology','Semiconductors','Nope'],themes:['ai','chips'],macro:false,unknown:'לא ידוע איך השוק יגיב.',more:'רקע.',ev:'NVDA Q3 Report!'},
      {i:1,he:'קוקה-קולה מינתה סמנכ"ל כספים',what:'מינוי.',type:'management',level:'watch',dir:'unclear',cert:'fact',aff:[{sym:'KO',how:'direct',dir:'unclear',why:'החברה עצמה'}],sectors:['Consumer Staples'],themes:[],macro:false,unknown:'',more:'',ev:'ko-cfo'},
      {i:2,he:'הפד הותיר את הריבית',what:'הריבית נשארה.',type:'macro_rates',level:'imp',dir:'mixed',cert:'fact',aff:[],sectors:['Finance','Real Estate'],themes:['rates','usd'],macro:true,unknown:'מה יקרה בהחלטה הבאה.',more:'',ev:'fed-rate-hold-oct'}];
    return JSON.stringify(A.slice(0,n))};
  const general=async()=>[{title:'Fed holds rates steady',pub:'CNBC',link:'https://x/fed',at:iso,sum:'The Fed left rates unchanged',tickers:[]}];
  const st=await newsxTask(s,{now,ask,general,market:[]});
  assert.equal(st.read,3); assert.equal(st.batches,1); assert.equal(st.gen,1); assert.equal(asked.length,1,'one call for the batch');
  assert.ok(!/old one/.test(asked[0]),'a week-old article is not read'); assert.ok(/"listed_under":\["NVDA"\]/.test(asked[0]));
  const d=s.getDoc('research/newsx').data, x=d.by[newsId('https://x/nvda1')];
  assert.equal(x.level,'crit'); assert.deepEqual(x.aff.map(a=>a.sym+':'+a.how),['NVDA:direct','TSM:supplier'],'a bad symbol is dropped'); assert.deepEqual(x.sectors,['Technology','Semiconductors'],'only known sectors'); assert.equal(x.ev,'nvda-q3-report');
  assert.equal(d.gen.length,1); assert.equal(d.by[d.gen[0].id].macro,true); assert.equal(d.n,3);
  // the next run: nothing new to read, nothing asked
  const st2=await newsxTask(s,{now:new Date(now.getTime()+60e3),ask,general,market:[]}); assert.equal(st2.read,0); assert.equal(asked.length,1);
  // a partner holding KO: KO's reading and the general one, not NVDA's
  s.setDoc('data/users/u_b/portfolio',{positions:[{sym:'KO',qty:1}]});
  const v=partnerView(s,{id:'u_b',role:'friend'},'research/newsx',s.getDoc('research/newsx').data);
  assert.deepEqual(Object.keys(v.by).sort(),[newsId('https://x/fed'),newsId('https://x/ko1')].sort()); assert.equal(v.gen.length,1);
  // without Claude: nothing read, said so
  const s2=new Store(':memory:'); s2.setDoc('research/news',{items:[{title:'t',link:'https://x/t',at:iso,syms:['KO'],seen:iso}]}); const k0=process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try{const st3=await newsxTask(s2,{now,general:null}); assert.equal(st3.ai,false); assert.equal(st3.waiting,1); assert.equal(s2.getDoc('research/newsx').data.ai,false)}finally{if(k0)process.env.ANTHROPIC_API_KEY=k0}
  // the cleaner alone
  assert.equal(cleanX({he:'x'}),null,'no what: nothing'); assert.equal(cleanX({he:'a',what:'b',level:'huge',dir:'up'}).level,'info');
  assert.ok(/אין להציג|בלי הסתברות|בלי תחזית מחיר/.test(newsPrompt([{title:'t'}])),'the prompt forbids a price forecast');
});

test('the archive of the readings: every reading kept by month (the owner\'s alone), the share\'s move after it from the closes, and the record per company',async()=>{
  const {newsArchive,arcOutcomes,arcStats,moveAfter,ARC}=await import('../server/newsx.js'); const {access}=await import('../server/store.js');
  const s=new Store(':memory:'), now=new Date('2026-10-29T08:00:00Z'), day=k=>new Date(now.getTime()-k*864e5).toISOString().slice(0,10);
  // the closes of NVDA: a trading day per weekday, 100 then +1 a day
  const d=[], c=[]; for(let k=60;k>=0;k--){const t=new Date(now.getTime()-k*864e5); if([0,6].includes(t.getUTCDay()))continue; d.push(t.toISOString().slice(0,10)); c.push(100+(60-k))}
  s.setDoc('quotes/c_NVDA',{key:'NVDA',d,c});
  const x=(dir,level)=>({he:'h',what:'w',type:'earnings',level,dir,cert:'fact',aff:[{sym:'NVDA',how:'direct',dir,why:''}],sectors:[],themes:[],macro:false,ev:null});
  const pairs=[]; for(let k=1;k<=8;k++)pairs.push({a:{id:'n'+k,at:day(k*5)+'T14:00:00Z',src:'co',pub:'R',syms:['NVDA']},x:x('neg',k%2?'info':'imp')});
  pairs.push({a:{id:'today',at:now.toISOString(),src:'co',syms:['NVDA']},x:x('pos','crit')});
  const r=newsArchive(s,pairs,{now}); assert.equal(r.added,9);
  assert.equal(newsArchive(s,pairs,{now}).added,0,'once each');
  const docs=s.listDocs(ARC).map(r=>r.id).sort(); assert.ok(docs.length>=2&&docs.includes('2026-10'),'by month: '+docs);
  assert.equal(s.getDoc(ARC+'/2026-10').data.items.find(i=>i.id==='today').level,'crit'); assert.ok(!('what' in s.getDoc(ARC+'/2026-10').data.items[0]),'compact: no text beyond the headline');
  // the moves: an article 40 days back has its 1, 5 and 20-day moves; one of five days back only the first; today's none yet
  const o=arcOutcomes(s,{now}); assert.ok(o.filled>=6,'filled: '+o.filled);
  const all=s.listDocs(ARC).flatMap(r=>r.data.items), by=id=>all.find(i=>i.id===id);
  const m40=by('n8').out.NVDA; assert.ok(m40.r1>0&&m40.r5>m40.r1&&m40.r20>m40.r5&&m40.p0>0,JSON.stringify(m40));
  const m5=by('n1').out.NVDA; assert.ok(m5.r1!=null&&m5.r20==null,'twenty days not yet: '+JSON.stringify(m5));
  assert.deepEqual(by('today').out,{},'the article of today waits for a close');
  // moveAfter on its own: the close before the article is the base
  const mv=moveAfter({d:['2026-10-01','2026-10-02','2026-10-05'],c:[10,11,12]},'2026-10-02'); assert.deepEqual(mv,{d0:'2026-10-01',p0:10,r1:10,r5:null,r20:null});
  assert.equal(moveAfter({d:['2026-10-01'],c:[10]},'2026-10-01'),null,'nothing before it');
  // the record: five or more cases with a five-day move
  const st=arcStats(s,{now}); assert.equal(st.n,9); assert.ok(st.done20>=2);
  assert.ok(st.track.NVDA&&st.track.NVDA.neg&&st.track.NVDA.neg.n>=5&&st.track.NVDA.neg.hit5===0&&st.track.NVDA.neg.avg5>0,'rising closes: the negative readings were followed by rises: '+JSON.stringify(st.track));
  assert.equal(st.track.NVDA.pos,undefined,'one positive case: no record');
  // the archive is the owner's alone
  assert.equal(access({id:'u',role:'friend'},ARC+'/2026-10'),''); assert.equal(access({id:'o',role:'owner'},ARC+'/2026-10'),'rw');
});

test('X for the securities: the liked posts with the cashtag, a few securities a run, into the reading as articles; nothing without a token; a partner sees their own',async()=>{
  const {xTask,xParse,xArticles,xSearchUrl}=await import('../server/xfeed.js'); const {newsSyms}=await import('../server/newsfeed.js'); const {partnerView}=await import('../server/store.js');
  const s=new Store(':memory:'), now=new Date('2026-10-29T07:15:00Z'), iso=now.toISOString();
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'},{sym:'KO'},{sym:'TLV:TEVA'}]}); s.setDoc('data/users/u_b/portfolio',{positions:[{sym:'KO',qty:1}]});
  const j=sym=>({data:[{id:'1'+sym.length,text:`$${sym} looks strong into earnings`,author_id:'a1',created_at:iso,public_metrics:{like_count:42,retweet_count:5}},{id:'2'+sym.length,text:'meh',author_id:'a2',created_at:iso,public_metrics:{like_count:1}}],includes:{users:[{id:'a1',username:'trader_jo',name:'Jo'},{id:'a2',username:'x2'}]}});
  assert.deepEqual(xParse(j('NVDA'),'NVDA').map(p=>[p.user,p.likes,p.link]),[['trader_jo',42,'https://x.com/trader_jo/status/14'],['x2',1,'https://x.com/x2/status/24']]);
  // no token: nothing fetched, said
  const t0=process.env.X_BEARER_TOKEN; delete process.env.X_BEARER_TOKEN;
  try{const st=await xTask(s,{now,newsSyms,fetch:async()=>{throw new Error('must not call')}}); assert.equal(st.stopped,'no token'); assert.equal(s.getDoc('research/x').exists,false)}finally{if(t0)process.env.X_BEARER_TOKEN=t0}
  // with a token: the US securities only, the liked posts kept
  process.env.X_BEARER_TOKEN='t-test'; const asked=[];
  try{const f=async(u,o)=>{u=String(u); asked.push(u); assert.equal(o.headers.authorization,'Bearer t-test'); const m=u.match(/query=%24([A-Z.]+)/); return new Response(JSON.stringify(j(m[1])),{status:200})};
    const st=await xTask(s,{now,newsSyms,fetch:f,pause:0});
    assert.equal(st.ok,2,'NVDA and KO, not the Tel Aviv share'); assert.equal(st.kept,2,'the liked ones'); assert.ok(asked.every(u=>/-is%3Aretweet/.test(u)),'no retweets');
    const d=s.getDoc('research/x').data; assert.deepEqual(d.items.map(p=>p.sym).sort(),['KO','NVDA']); assert.equal(d.askedAt.NVDA,iso);
    const A=xArticles(s); assert.equal(A.length,2); assert.equal(A[0].src,'x'); assert.match(A[0].pub,/^@trader_jo ב-X$/); assert.deepEqual(A.find(a=>a.syms[0]==='KO').syms,['KO']);
    // the partner sees KO's post alone
    const v=partnerView(s,{id:'u_b',role:'friend'},'research/x',d); assert.deepEqual(v.items.map(p=>p.sym),['KO']); assert.equal(v.askedAt,undefined);
    // a refused token stops the run and says so
    const st2=await xTask(s,{now:new Date(now.getTime()+3600e3),newsSyms,fetch:async()=>new Response('',{status:403}),pause:0}); assert.equal(st2.stopped,'auth'); assert.match(st2.first,/needs a plan/);
  }finally{if(t0)process.env.X_BEARER_TOKEN=t0; else delete process.env.X_BEARER_TOKEN}
  assert.equal(xSearchUrl('NVDA'),'https://x.com/search?q=%24NVDA&src=cashtag_click&f=live');
});

test('the plain reading by rules: when Claude cannot read, every article still gets a kind, a level and a direction, said to be an estimate, and Claude replaces it later',async()=>{
  const {ruleRead,newsxTask,newsId}=await import('../server/newsx.js');
  const r=ruleRead({title:'Nvidia beats estimates and raises its outlook',pub:'Reuters',syms:['NVDA']});
  assert.equal(r.type,'earnings'); assert.equal(r.dir,'pos'); assert.equal(r.level,'imp'); assert.equal(r.cert,'est'); assert.equal(r.rules,true); assert.match(r.he,/^NVDA: תוצאות כספיות, נראה חיובי$/); assert.deepEqual(r.aff.map(a=>a.sym),['NVDA']);
  const f=ruleRead({title:'Fed holds rates steady',syms:[]}); assert.equal(f.type,'macro_rates'); assert.equal(f.macro,true); assert.equal(f.level,'watch');
  assert.equal(ruleRead({title:'Coca-Cola faces lawsuit over labels',syms:['KO']}).dir,'neg');
  assert.equal(ruleRead({title:'JPMorgan names new head of payments unit',syms:['JPM']}).he,'JPMorgan names new head of payments unit','a headline the rules cannot place stays the article\'s own, not "JPM: אחר"');
  // a run without Claude: read by rules; then with Claude: read again
  const s=new Store(':memory:'), now=new Date('2026-10-29T20:00:00Z'), iso=now.toISOString();
  s.setDoc('research/news',{items:[{title:'Microsoft faces EU antitrust probe',pub:'FT',link:'https://x/m',at:iso,syms:['MSFT'],seen:iso}]});
  const k0=process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try{const st=await newsxTask(s,{now,general:null}); assert.equal(st.rules,1); const x=s.getDoc('research/newsx').data.by[newsId('https://x/m')]; assert.equal(x.rules,true); assert.equal(x.type,'regulation'); assert.equal(x.dir,'neg')}finally{if(k0)process.env.ANTHROPIC_API_KEY=k0}
  const ask=async()=>JSON.stringify([{i:0,he:'האיחוד האירופי חוקר את מיקרוסופט',what:'חקירה.',type:'regulation',level:'imp',dir:'neg',cert:'fact',aff:[{sym:'MSFT',how:'direct',dir:'neg',why:'החברה'}],sectors:[],themes:[],macro:false,unknown:'',more:'',ev:'msft-eu'}]);
  const st2=await newsxTask(s,{now,general:null,ask}); assert.equal(st2.read,1); const y=s.getDoc('research/newsx').data.by[newsId('https://x/m')]; assert.ok(!y.rules); assert.equal(y.cert,'fact');
  const arc=s.listDocs('research/newsarc').flatMap(r=>r.data.items); assert.equal(arc.length,1); assert.equal(arc[0].rules,false,'the archive keeps Claude\'s reading');
});

// 30.10: "חיבור למציאות": the news is a product of its own (four general categories, the market's anchors), and every
// reading says what kind of content it is, where, when it happened, and the chain's middle links with their reasons
test('the news engine: general categories, the market anchors for everyone (only their symbols), the reading\'s new fields, an updated headline',async()=>{
  const {generalNews,newsxTask,cleanX,ruleRead,newsId,MARKET,kindOf,regionsOf}=await import('../server/newsx.js'); const {partnerView}=await import('../server/store.js');
  process.env.FINNHUB_API_KEY='k'; const {_resetFh}=await import('../server/finnhub.js'); _resetFh();
  const now=new Date('2026-10-30T10:00:00Z'), t=Date.parse('2026-10-30T08:00:00Z')/1000, cats=[];
  const f=async u=>{u=String(u); const m=u.match(/category=([a-z]+)/); if(m){cats.push(m[1]); return Response.json([{headline:m[1]+' story',url:'https://g.com/'+m[1],source:'S',datetime:t},{headline:'shared',url:'https://g.com/same',source:'S',datetime:t}])} return new Response('',{status:404})};
  const G=await generalNews({fetch:f,now}); assert.deepEqual(cats,['general','merger','forex','crypto']); assert.equal(G.filter(a=>a.link==='https://g.com/same').length,1,'once'); assert.equal(G.find(a=>a.link==='https://g.com/merger').cat,'merger');
  delete process.env.FINNHUB_API_KEY;
  assert.ok(MARKET.includes('AAPL')&&MARKET.length>=10);
  // the anchors: an article gathered for AAPL and for a small company is everyone's, with AAPL only
  const s=new Store(':memory:'), iso=now.toISOString();
  s.setDoc('research/news',{items:[{title:'Apple and Tiny sign a deal',pub:'Reuters',link:'https://x/a1',at:iso,syms:['AAPL','TINY'],seen:iso},{title:'Tiny alone',pub:'R',link:'https://x/t1',at:iso,syms:['TINY'],seen:iso}]});
  const general=async()=>[{title:'Oil jumps',pub:'CNBC',link:'https://x/oil',at:iso,tickers:[],cat:'general'}];
  const k0=process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try{await newsxTask(s,{now,general});
    const d=s.getDoc('research/newsx').data, a1=d.gen.find(g=>g.link==='https://x/a1'); assert.ok(a1,'the anchor article is general news'); assert.deepEqual(a1.syms,['AAPL'],'never the other security it was gathered for'); assert.equal(a1.cat,'market');
    assert.ok(!d.gen.some(g=>g.link==='https://x/t1')); assert.equal(d.gen.find(g=>g.link==='https://x/oil').cat,'general');
    s.setDoc('data/users/u9/portfolio',{positions:[]}); const v=partnerView(s,{id:'u9',role:'friend'},'research/newsx',d);
    assert.ok(v.by[newsId('https://x/a1')]&&v.by[newsId('https://x/oil')],'a partner without a portfolio still has news'); assert.ok(!v.by[newsId('https://x/t1')]);
    // the same general article with a new headline: updated, not new
    const general2=async()=>[{title:'Oil jumps 5% on supply fears',pub:'CNBC',link:'https://x/oil',at:iso,tickers:[],cat:'general'}];
    const st=await newsxTask(s,{now:new Date(now.getTime()+30*60e3),general:general2}); assert.equal(st.gen,0); const o=s.getDoc('research/newsx').data.gen.find(g=>g.link==='https://x/oil');
    assert.equal(o.title,'Oil jumps 5% on supply fears'); assert.equal(o.prevTitle,'Oil jumps'); assert.ok(o.upd)}finally{if(k0)process.env.ANTHROPIC_API_KEY=k0}
  // the reading's new fields, cleaned
  const x=cleanX({he:'נפט',what:'הנפט עלה.',type:'energy',level:'imp',dir:'neg',cert:'fact',kind:'opinion',regions:['middle_east','mars','us'],occ:'2026-10-29',
    fac:[{k:'oil',move:'up',why:'פגיעה בהיצע'},{k:'nope',move:'up'},{k:'oil',move:'down'}],sectors:['Energy','Transportation'],
    secx:[{g:'Energy',via:'oil',dir:'pos',why:'מחיר גבוה יותר'},{g:'Transportation',via:'gold',dir:'neg',why:'דלק יקר'},{g:'Utilities',via:null}],aff:[{sym:'DAL',how:'sector',dir:'neg',why:'דלק',via:'Transportation'},{sym:'XOM',how:'direct',dir:'pos',via:'Energy'}]});
  assert.equal(x.kind,'opinion'); assert.deepEqual(x.regions,['middle_east','us']); assert.equal(x.occ,'2026-10-29');
  assert.deepEqual(x.fac,[{k:'oil',move:'up',why:'פגיעה בהיצע'}],'a known factor once'); assert.deepEqual(x.secx.map(z=>z.g+':'+z.via),['Energy:oil','Transportation:null'],'a sector of the reading only; an unknown factor is dropped');
  assert.equal(x.aff.find(a=>a.sym==='DAL').via,'Transportation'); assert.ok(!x.aff.find(a=>a.sym==='XOM').via,'the company itself has no path');
  assert.equal(cleanX({he:'a',what:'b',kind:'gossip',occ:'2030-01-01'}).kind,'news'); assert.equal(cleanX({he:'a',what:'b',occ:'2099-01-01'}).occ,null,'no event in the future');
  // by rules: a company's release, an opinion, the places; the factors said to be by rule
  assert.equal(kindOf({title:'Acme announces Q3 results',pub:'Business Wire'}),'pr'); assert.equal(kindOf({title:'Is it time to buy Nvidia?',pub:'X'}),'opinion'); assert.equal(kindOf({title:'Nvidia rises',pub:'Motley Fool'}),'opinion');
  assert.equal(kindOf({title:'Fed decision preview: what to expect',pub:'Reuters'}),'analysis'); assert.equal(kindOf({title:'Fed holds rates',pub:'Reuters'}),'news');
  assert.deepEqual(regionsOf('China tariffs hit European carmakers'),['china','europe']);
  const r=ruleRead({title:'Oil jumps as OPEC cuts output',pub:'Reuters',syms:[]}); assert.equal(r.type,'energy'); assert.ok(r.regions.includes('middle_east')); assert.equal(r.fac[0].k,'oil'); assert.match(r.fac[0].why,/אוטומטית/); assert.equal(r.secx[0].g,'Energy');
});

// 30.10: one event, one key: the reader sees the known events; a new key for the same company's event of the same kind
// within a day and a half (or the same market event in other words) is joined to the earlier one
test('one key per event: the known events reach the reader, and a second key for the same event is joined to the first',async()=>{
  const {unifyEv,knownEvents,newsxTask,newsId}=await import('../server/newsx.js');
  const by={a:{he:'אנבידיה היכתה',type:'earnings',ev:'nvda-q3-report',aff:[{sym:'NVDA',how:'direct'}],at:'2026-10-30T08:00:00Z'},f:{he:'הפד',type:'macro_rates',ev:'fed-rate-hold-oct',aff:[],at:'2026-10-30T08:00:00Z'},r:{he:'x',type:'legal',ev:'old',rules:true,at:'2026-10-30T08:00:00Z'}};
  const at=new Map([['a','2026-10-30T07:00:00Z'],['f','2026-10-30T07:00:00Z'],['b','2026-10-30T12:00:00Z'],['g','2026-10-30T12:00:00Z'],['c','2026-11-02T12:00:00Z']]);
  assert.deepEqual(knownEvents(by,{now:new Date('2026-10-30T12:00:00Z')}).map(k=>k.ev).sort(),['fed-rate-hold-oct','nvda-q3-report'],'not a reading by rules');
  const b=unifyEv({type:'earnings',ev:'nvidia-q3-earnings',aff:[{sym:'NVDA',how:'direct'}]},{id:'b'},by,at); assert.equal(b.ev,'nvda-q3-report'); assert.equal(b.evOrig,'nvidia-q3-earnings');
  assert.equal(unifyEv({type:'earnings',ev:'nvidia-q4',aff:[{sym:'NVDA',how:'direct'}]},{id:'c'},by,at).ev,'nvidia-q4','three days later: another event');
  assert.equal(unifyEv({type:'contract',ev:'nvda-deal',aff:[{sym:'NVDA',how:'direct'}]},{id:'b'},by,at).ev,'nvda-deal','another kind: another event');
  assert.equal(unifyEv({type:'macro_rates',ev:'fed-holds-rates',aff:[]},{id:'g'},by,at).ev,'fed-rate-hold-oct','the same market event in other words');
  assert.equal(unifyEv({type:'macro_rates',ev:'ecb-cut',aff:[]},{id:'g'},by,at).ev,'ecb-cut');
  // in a run: the known events are in the prompt, and the new key is joined
  const s=new Store(':memory:'), now=new Date('2026-10-30T12:00:00Z'), iso=now.toISOString(), id0=newsId('https://x/1'), id1=newsId('https://x/2');
  s.setDoc('research/news',{items:[{title:'Nvidia beats',link:'https://x/1',at:'2026-10-30T07:00:00Z',syms:['NVDA'],seen:'2026-10-30T07:00:00Z'},{title:'Nvidia results lift chips',link:'https://x/2',at:iso,syms:['NVDA'],seen:iso}]});
  s.setDoc('research/newsx',{by:{[id0]:{he:'אנבידיה היכתה',what:'w',type:'earnings',level:'crit',dir:'pos',cert:'fact',aff:[{sym:'NVDA',how:'direct',dir:'pos'}],ev:'nvda-q3-report',at:'2026-10-30T08:00:00Z'}},gen:[]});
  const asked=[]; const ask=async p=>{asked.push(p); return JSON.stringify([{i:0,he:'אנבידיה מושכת את השבבים',what:'w',type:'earnings',level:'imp',dir:'pos',cert:'fact',aff:[{sym:'NVDA',how:'direct',dir:'pos'}],ev:'nvidia-results-chips'}])};
  const st=await newsxTask(s,{now,ask,general:null,market:[]}); assert.ok(/KNOWN_EVENTS/.test(asked[0])&&asked[0].includes('nvda-q3-report')); assert.equal(st.joined,1);
  assert.equal(s.getDoc('research/newsx').data.by[id1].ev,'nvda-q3-report');
});

// 30.10: "מה קורה בשווקים": צ׳יקו's few lines from the general news only; numbers only from the input; no forecast
test('the market brief: from the general news, numbers only from the input, a forecast or a cause dropped, made again only when the events change',async()=>{
  const {newsxTask,newsId,marketText,cleanBrief}=await import('../server/newsx.js');
  const s=new Store(':memory:'), now=new Date('2026-10-30T09:00:00Z'), iso=new Date(now-36e5).toISOString();
  s.setDoc('quotes/latest',{bench:{SPX:{px:101,prev:100,name:'S&P 500',date:'2026-10-29'}},mkts:{BRENT:{px:80,prev:82,name:'נפט ברנט',date:'2026-10-30'}},usdIls:3.7,fxPrev:{rate:3.65}});
  assert.deepEqual(marketText(s.getDoc('quotes/latest').data),['S&P 500: +1.00% (2026-10-29)','נפט ברנט: −2.44% (2026-10-30)','דולר/שקל: 3.700 (+1.37%)']);
  const gen=['fed','opec','ecb','tsmc'].map(k=>({id:newsId('https://x/'+k),title:k,pub:'Reuters',link:'https://x/'+k,at:iso,syms:[],seen:iso,src:'gen',cat:'general'}));
  s.setDoc('research/newsx',{by:Object.fromEntries(gen.map((g,i)=>[g.id,{he:'כותרת '+i,what:'מה קרה '+i,type:'market',level:i?'imp':'crit',dir:'unclear',cert:'fact',kind:'news',aff:[],sectors:[],themes:[],ev:'ev-'+i}])),gen});
  const asked=[]; const ask=async p=>{asked.push(p); return JSON.stringify({lines:[{t:'לפי רויטרס, הפד הותיר את הריבית.',ev:[0]},{t:'אופ״ק קיצצה, והנפט צפוי לעלות.',ev:[1]},{t:'הבנק האירופי הוריד ריבית ב-0.75 נקודות.',ev:[2]},{t:'לפי רויטרס, טייוואן סמי דיווחה על ביקוש.',ev:[3,9]}],mkt:'S&P 500 עלה +1.00%, ונפט ברנט ירד −2.44%.'})};
  await newsxTask(s,{now,general:null,ask,market:[]});
  const b=s.getDoc('research/newsx').data.brief; assert.ok(b,'made');
  assert.deepEqual(b.lines.map(l=>l.t),['לפי רויטרס, הפד הותיר את הריבית.','לפי רויטרס, טייוואן סמי דיווחה על ביקוש.'],'a forecast and an invented number are dropped');
  assert.deepEqual(b.lines[0].ids,[gen[0].id]); assert.equal(b.lines[1].ids.length,1,'an index out of range is dropped'); assert.match(b.mkt,/\+1\.00%/);
  assert.ok(asked.length===1&&/EVENTS/.test(asked[0])&&!/listed_under/.test(asked[0]));
  await newsxTask(s,{now:new Date(now.getTime()+3*36e5),general:null,ask,market:[]}); assert.equal(asked.length,1,'the same events: not made again');
  assert.equal(cleanBrief({lines:[{t:'א',ev:[0]}]},[{id:'a',k:'x'}],'{}'),null,'one line is not a summary');
  // at night: nothing
  const s2=new Store(':memory:'); s2.setDoc('research/newsx',s.getDoc('research/newsx').data); const asked2=[];
  await newsxTask(s2,{now:new Date('2026-10-30T23:30:00Z'),general:null,ask:async p=>{asked2.push(p); return '[]'},market:[]}); assert.ok(!asked2.some(p=>/EVENTS/.test(p)));
});

test('live alerts: a price set, a big day, the dollar, a critical reading; once a day each, one e-mail in 20 minutes, quiet at night',async()=>{
  const {liveTask,liveHits}=await import('../server/livealert.js'); const s=new Store(':memory:');
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'},{sym:'KO'}]}); s.setDoc('quotes/latest',{prices:{NVDA:190,KO:60,MSFT:500},prev:{NVDA:200,KO:59.8},usdIls:3.82,stale:{}});
  s.setDoc('settings/main',{pxAlerts:{MSFT:{above:480}},liveAl:{move:4,usdAbove:3.8}});
  const {createHash}=await import('node:crypto'); const id=createHash('sha1').update('https://x/n').digest('hex').slice(0,12), now=new Date('2026-10-30T13:00:00Z');
  s.setDoc('research/news',{items:[{title:'t',link:'https://x/n',at:new Date(now-36e5).toISOString(),syms:['NVDA']}]});
  s.setDoc('research/newsx',{by:{[id]:{he:'אנבידיה הורידה את התחזית',what:'w',level:'crit',dir:'neg',aff:[{sym:'NVDA',how:'direct',dir:'neg'}],ev:'nvda-cut'}}});
  const H=liveHits(s,{now}); assert.deepEqual(H.map(h=>h.key).sort(),[`move:NVDA:${(s.getDoc('quotes/latest').data.meta||{}).NVDA?.date||now.toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})}:down`,'news:nvda-cut','px:MSFT:up:480','usd:up:3.8']);   // 6.11: a move is keyed by its trading day
  assert.ok(!H.some(h=>/KO/.test(h.key)),'KO moved 0.3%: nothing');
  const sent=[]; const send=async(st,kind,msg)=>{sent.push([kind,msg]); return true};
  let r=await liveTask(s,{now,send}); assert.equal(r.fresh,4); assert.equal(sent.length,1); assert.equal(sent[0][0],'live'); assert.match(sent[0][1].text,/NVDA ירדה היום −5\.0%/); assert.match(sent[0][1].text,/הדולר עבר את 3\.8/);
  r=await liveTask(s,{now:new Date(now.getTime()+30*60e3),send}); assert.equal(r.fresh,0,'once a day each');
  s.setDoc('quotes/latest',{prices:{NVDA:190,KO:55,MSFT:500},prev:{NVDA:200,KO:59.8},usdIls:3.82,stale:{}});
  r=await liveTask(s,{now:new Date(now.getTime()+35*60e3),send}); assert.equal(r.fresh,1); assert.equal(sent.length,2,'a new one, after 20 minutes');
  s.setDoc('quotes/latest',{prices:{NVDA:190,KO:55,MSFT:500,AAA:1},prev:{NVDA:200,KO:59.8},usdIls:3.82,stale:{}}); s.setDoc('settings/main',{pxAlerts:{MSFT:{above:480},NVDA:{below:195}},liveAl:{move:4,usdAbove:3.8}});
  r=await liveTask(s,{now:new Date(now.getTime()+40*60e3),send}); assert.equal(r.waiting,true,'one e-mail in 20 minutes');
  r=await liveTask(s,{now:new Date('2026-10-30T01:00:00Z'),send}); assert.equal(r.quiet,true,'quiet at night');
});

// 30.10: TikChik Pulse: personal alerts only from a link to the portfolio that can be explained, three levels by
// written rules, the three measures apart, one alert per event, again only on a material development
// 30.10: what is on someone's screen and not read yet is read now: Hebrew and the way to the holdings in seconds; only
// what the asker may see; one at a time; the alert made from the headline alone gives way to the read one
test('reading now: the articles on the screen, read at once; only the asker\'s own; the headline-only alert replaced',async()=>{
  const {newsxReadNow,newsId,ruleRead}=await import('../server/newsx.js'); const {pulseUpdate}=await import('../server/pulse.js');
  const s=new Store(':memory:'), now=new Date(), iso=new Date(now.getTime()-3600e3).toISOString();
  s.setDoc('portfolio/main',{positions:[{sym:'JPM',qty:10,cost:100}]},{silent:true}); s.setDoc('quotes/latest',{prices:{JPM:200},usdIls:3.7,updatedAt:now.toISOString()},{silent:true});
  const A={title:'JPMorgan names new head of payments unit',pub:'Reuters',link:'https://x/jpm1',at:iso,syms:['JPM'],seen:iso}, B={title:'Coca-Cola raises dividend',pub:'AP',link:'https://x/ko1',at:iso,syms:['KO'],seen:iso};
  const ia=newsId(A.link), ib=newsId(B.link);
  s.setDoc('research/news',{items:[A,B],updatedAt:iso},{silent:true}); s.setDoc('research/newsx',{by:{[ia]:{...ruleRead(A),at:iso},[ib]:{...ruleRead(B),at:iso}},gen:[],updatedAt:iso},{silent:true});
  // before: an alert from the headline alone, with the article's own headline as its title
  let P=pulseUpdate(s,null,{now}).doc.items; const r0=P.find(a=>(a.arts||[]).some(z=>z.id===ia));
  assert.ok(r0&&r0.rules&&r0.title==='JPMorgan names new head of payments unit',JSON.stringify(P.map(a=>[a.k,a.title,a.rules])));
  const asked=[]; const ask=async prompt=>{asked.push(prompt); return JSON.stringify([{i:0,he:'ג׳יי.פי מורגן מינתה ראש חדש לתחום התשלומים',what:'הבנק מינה מנהל חדש ליחידת התשלומים.',type:'management',level:'imp',dir:'unclear',cert:'fact',kind:'news',
    aff:[{sym:'JPM',how:'direct',dir:'unclear',why:'המינוי בבנק עצמו'}],sectors:['Finance'],themes:[],regions:['us'],occ:null,fac:[],secx:[],macro:false,unknown:'מה ישתנה ביחידה.',more:'',ev:'jpm-payments-head'}])};
  // a partner who holds KO only may not have JPM's article read; bad ids are dropped
  const vis=a=>(a.syms||[]).includes('KO'); const p0=await newsxReadNow(s,[ia,'../x','zz'],{visible:vis,ask,now}); assert.equal(p0.read,0); assert.equal(asked.length,0);
  const r=await newsxReadNow(s,[ia,ia],{ask,now}); assert.equal(r.read,1); assert.equal(asked.length,1); assert.match(asked[0],/JPMorgan names new head/);
  const x=s.getDoc('research/newsx').data.by[ia]; assert.equal(x.he,'ג׳יי.פי מורגן מינתה ראש חדש לתחום התשלומים'); assert.ok(!x.rules); assert.equal(x.ev,'jpm-payments-head');
  assert.equal((await newsxReadNow(s,[ia],{ask,now})).read,0,'read already: nothing again'); assert.equal(asked.length,1);
  // after: one alert, the read one, in Hebrew; the headline-only one gone
  P=pulseUpdate(s,null,{now}).doc.items; const on=P.filter(a=>(a.arts||[]).some(z=>z.id===ia)||a.k===r0.k);
  assert.equal(on.length,1,JSON.stringify(on.map(a=>[a.k,a.title]))); assert.equal(on[0].title,'ג׳יי.פי מורגן מינתה ראש חדש לתחום התשלומים'); assert.ok(!on[0].rules);
  // the daily cap
  s.setDoc('research/newsx',{...s.getDoc('research/newsx').data,by:{...s.getDoc('research/newsx').data.by,[ib]:{...ruleRead(B),at:iso}}},{silent:true});
  assert.ok((await newsxReadNow(s,[ib],{ask,now,dayCap:1})).cap,'the day\'s cap');
});

test('pulse: levels by rules from importance, relevance and confidence; one alert per event; material developments; the person\'s preferences; partners apart',async()=>{
  const {pulseUpdate,pulseCompute,material,inQuiet,pulsePrefs,levelOf,_setSectors,holdingsOf}=await import('../server/pulse.js'); const {newsId}=await import('../server/newsx.js');
  _setSectors({NVDA:'Technology',XOM:'Energy',CVX:'Energy',KO:'Consumer Staples',JPM:'Finance'});
  const s=new Store(':memory:'), now=new Date('2026-10-30T12:00:00Z'), iso=now.toISOString(), h1=new Date(now-36e5).toISOString();
  // the portfolio: NVDA 50%, XOM 20%, CVX 10%, KO 20% (every price known, so weights are used)
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:5,ccy:'USD'},{sym:'XOM',qty:2,ccy:'USD'},{sym:'CVX',qty:1,ccy:'USD'},{sym:'KO',qty:4,ccy:'USD'}]});
  s.setDoc('quotes/latest',{prices:{NVDA:100,XOM:100,CVX:100,KO:50},prev:{},usdIls:3.7,updatedAt:iso});
  const HD=holdingsOf(s.getDoc('portfolio/main').data,s.getDoc('quotes/latest').data); assert.equal(HD.wOk,true); assert.equal(HD.pos.find(h=>h.sym==='NVDA').w,50);
  const art=(link,syms,at=h1)=>({title:link,pub:'Reuters',link:'https://x/'+link,at,syms,seen:at});
  const items=[art('nv1',['NVDA']),art('nv2',['NVDA']),art('oil',[]),art('ko-op',['KO']),art('tiny',['TINY']),art('jpm',['JPM']),art('rule',['KO'])];
  s.setDoc('research/news',{items});
  const R=(o)=>({he:'h',what:'w',type:'company',level:'imp',dir:'unclear',cert:'fact',kind:'news',aff:[],sectors:[],themes:[],macro:false,...o});
  const by={[newsId('https://x/nv1')]:R({he:'אנבידיה הורידה תחזית',type:'guidance',level:'crit',dir:'neg',aff:[{sym:'NVDA',how:'direct',dir:'neg',why:'החברה'}],ev:'nvda-cut'}),
    [newsId('https://x/nv2')]:R({he:'עוד על התחזית',type:'guidance',level:'crit',dir:'neg',aff:[{sym:'NVDA',how:'direct',dir:'neg'}],ev:'nvda-cut'}),
    [newsId('https://x/oil')]:R({he:'אופ״ק קיצצה תפוקה',type:'energy',level:'imp',dir:'mixed',cert:'fact',sectors:['Energy'],themes:['oil'],macro:true,fac:[{k:'oil',move:'up',why:'פחות היצע'}],secx:[{g:'Energy',via:'oil',dir:'pos',why:'מחיר גבוה'}],ev:'opec-cut'}),
    [newsId('https://x/ko-op')]:R({he:'האם לקנות קוקה קולה',type:'company',level:'imp',dir:'pos',cert:'interp',kind:'opinion',aff:[{sym:'KO',how:'direct',dir:'pos'}],ev:'ko-op'}),
    [newsId('https://x/tiny')]:R({he:'חברה קטנה',level:'crit',aff:[{sym:'TINY',how:'direct'}],ev:'tiny'}),
    [newsId('https://x/jpm')]:R({he:'ג׳יי.פי מורגן',level:'imp',aff:[{sym:'JPM',how:'direct'}],ev:'jpm'}),
    [newsId('https://x/rule')]:R({he:'KO: תביעה',type:'legal',level:'imp',dir:'neg',cert:'est',rules:true,aff:[{sym:'KO',how:'direct',dir:'neg'}],ev:null})};
  s.setDoc('research/newsx',{by,gen:[]});
  let r=pulseUpdate(s,null,{now}); const A=Object.fromEntries(r.doc.items.map(a=>[a.k,a]));
  // the critical reading about NVDA (50%), a reported fact: critical; the two articles are one alert with both sources
  assert.equal(A['ev:nvda-cut'].lv,'crit'); assert.equal(A['ev:nvda-cut'].n,2); assert.equal(A['ev:nvda-cut'].imp,'crit'); assert.equal(A['ev:nvda-cut'].rel,'high'); assert.equal(A['ev:nvda-cut'].conf,'high');
  assert.match(A['ev:nvda-cut'].relWhy,/NVDA, 50%/);
  // OPEC, through the energy sector (30% of the portfolio: XOM and CVX are not named), important in itself: a portfolio update, with the sector's share and path
  assert.equal(A['ev:opec-cut'].lv,'upd'); assert.equal(A['ev:opec-cut'].rel,'mid'); assert.equal(A['ev:opec-cut'].conf,'low'); assert.deepEqual(A['ev:opec-cut'].secs.map(x=>x.g+':'+x.w),['Energy:30']); assert.equal(A['ev:opec-cut'].fac[0].k,'oil');
  // an opinion about a holding is never more than a portfolio update; a reading by rules neither
  assert.equal(A['ev:ko-op'].lv,'upd'); assert.equal(A[Object.keys(A).find(k=>k.startsWith('rd:KO:'))].lv,'upd'); assert.equal(A[Object.keys(A).find(k=>k.startsWith('rd:KO:'))].conf,'low');
  // nothing about securities not held, whatever their level
  assert.ok(!A['ev:tiny']&&!A['ev:jpm']); assert.equal(r.fresh.length,r.doc.items.length,'all new');
  assert.ok(A['ev:nvda-cut'].hist[0].why==='new'&&A['ev:nvda-cut'].at===iso);
  // the next run: another article about the same event at the same level: not a new alert
  const later=new Date(now.getTime()+30*60e3);
  items.push(art('nv3',['NVDA'],later.toISOString())); s.setDoc('research/news',{items}); by[newsId('https://x/nv3')]=R({he:'שוב',type:'guidance',level:'crit',dir:'neg',aff:[{sym:'NVDA',how:'direct',dir:'neg'}],ev:'nvda-cut'}); s.setDoc('research/newsx',{by,gen:[]});
  r=pulseUpdate(s,null,{now:later}); assert.equal(r.fresh.length,0,'another article is not a development'); assert.equal(r.doc.items.find(a=>a.k==='ev:nvda-cut').n,3); assert.equal(r.doc.items.find(a=>a.k==='ev:nvda-cut').ver,1);
  // OPEC's direction turns clear and another holding is named: a development, version 2, with the reasons
  by[newsId('https://x/oil')]=R({he:'אופ״ק',type:'energy',level:'imp',dir:'neg',cert:'fact',sectors:['Energy'],themes:['oil'],macro:true,aff:[{sym:'XOM',how:'sector',dir:'neg',why:'מפיקה נפט'}],ev:'opec-cut'}); s.setDoc('research/newsx',{by,gen:[]});
  const later2=new Date(later.getTime()+30*60e3); r=pulseUpdate(s,null,{now:later2}); const op=r.doc.items.find(a=>a.k==='ev:opec-cut');
  assert.equal(r.fresh.length,1); assert.equal(op.ver,2); assert.ok(op.at===iso&&op.up===later2.toISOString(),'made then, developed now'); assert.match(op.hist[1].t,/כיוון|אחזקה/); assert.ok(op.holds.some(h=>h.sym==='XOM'&&h.link==='indirect'));
  assert.deepEqual(material({lv:'imp',dir:'pos',holds:[{sym:'A'}],cert:'fact'},{lv:'imp',dir:'pos',holds:[{sym:'A'}],cert:'fact'}),[],'nothing new');
  assert.deepEqual(material({lv:'upd',dir:'pos',holds:[],cert:'interp'},{lv:'crit',dir:'neg',holds:[{sym:'B'}],cert:'fact'}),['level','dir','hold','fact']);
  assert.equal(levelOf({imp:'crit',rel:'high',conf:'mid'},'analysis').lv,'imp','an analysis is not critical');
  // the person's preferences change what is made: no portfolio updates, a lower sensitivity, the alerts off
  by[newsId('https://x/oil')]=R({he:'אופ״ק',type:'energy',level:'imp',dir:'mixed',cert:'fact',sectors:['Energy'],themes:['oil'],macro:true,ev:'opec-cut'}); s.setDoc('research/newsx',{by,gen:[]});   // back to the sector only
  s.setDoc('settings/main',{pulse:{lv:{upd:false}}}); assert.ok(pulseCompute(s,null,{now}).alerts.every(a=>a.lv!=='upd'));
  s.setDoc('settings/main',{pulse:{sens:'low'}}); assert.ok(!pulseCompute(s,null,{now}).alerts.some(a=>a.k==='ev:opec-cut'),'30% of the portfolio is below the low sensitivity\'s sector share');
  s.setDoc('settings/main',{pulse:{themes:['rates']}}); assert.ok(!pulseCompute(s,null,{now}).alerts.some(a=>a.k==='ev:opec-cut'),'a sector-only event outside the chosen topics');
  s.setDoc('settings/main',{pulse:{on:false}}); assert.equal(pulseCompute(s,null,{now}).alerts.length,0);
  s.setDoc('settings/main',{newsAl:{types:{guidance:false}}}); assert.ok(!pulseCompute(s,null,{now}).alerts.some(a=>a.k==='ev:nvda-cut'),'a kind switched off');
  s.setDoc('settings/main',{});
  // without weights (a price missing): the holding named is still high, said to be without a weight
  s.setDoc('quotes/latest',{prices:{NVDA:100,XOM:100,CVX:100},prev:{},usdIls:3.7,updatedAt:iso}); const c=pulseCompute(s,null,{now}).alerts.find(a=>a.k==='ev:nvda-cut'); assert.equal(c.lv,'crit'); assert.match(c.relWhy,/המשקל בתיק לא ידוע/);
  s.setDoc('quotes/latest',{prices:{NVDA:100,XOM:100,CVX:100,KO:50},prev:{NVDA:90},usdIls:3.7,updatedAt:iso});
  // the measured facts: NVDA's day (+11% over 90), a portfolio fact
  const mv=pulseCompute(s,null,{now}).alerts.find(a=>a.kind==='mkt'); assert.ok(mv&&/NVDA עלתה/.test(mv.title)); assert.equal(mv.lv,'crit','more than twice the 5% threshold, half the portfolio'); assert.equal(mv.conf,'high');
  // a partner: their own holdings, only the articles they may read, their own document
  const f=s.addUser({email:'p@example.com',password:'partner-pass-1',role:'friend'});
  s.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'JPM',qty:1,ccy:'USD'}]}); s.setDoc('quotes/latest',{prices:{NVDA:100,XOM:100,CVX:100,KO:50,JPM:300},prev:{},usdIls:3.7,updatedAt:iso});
  const rp=pulseUpdate(s,f,{now}); assert.deepEqual(rp.doc.items.map(a=>a.k),['ev:jpm'],'JPM only'); assert.ok(s.getDoc(`data/users/${f.id}/pulse`).exists); assert.ok(!s.getDoc('alerts/pulse').data.items.some(a=>a.k==='ev:jpm'),'apart');
  // an article gathered only for someone else's security is not a source for a partner, even if it names their holding
  items.push(art('tsm',['TSM'])); s.setDoc('research/news',{items}); by[newsId('https://x/tsm')]=R({he:'טייוואן סמי',level:'crit',aff:[{sym:'TSM',how:'direct'},{sym:'JPM',how:'customer',why:'x'}],ev:'tsm'}); s.setDoc('research/newsx',{by,gen:[]});
  assert.ok(!pulseCompute(s,f,{now}).alerts.some(a=>a.k==='ev:tsm'));
  // no portfolio: no personal alerts, and nothing pretends to be one
  const g=s.addUser({email:'g@example.com',password:'partner-pass-2',role:'friend'}); assert.equal(pulseCompute(s,g,{now}).alerts.length,0);
  // on the server's matrix: a partner reads their own alerts only; nobody else's, not the owner's
  {const {access}=await import('../server/store.js'); assert.equal(access({id:f.id,role:'friend'},`data/users/${f.id}/pulse`),'rw'); assert.equal(access({id:f.id,role:'friend'},`data/users/${g.id}/pulse`),''); assert.equal(access({id:f.id,role:'friend'},'alerts/pulse'),'');
    assert.equal(access({id:'x',role:'admin'},'alerts/pulse'),'','an admin has their own, not the owner\'s'); assert.equal(access({id:'x',role:'admin'},'data/users/x/pulse'),'rw');
    const {pathsOf}=await import('../server/pulse.js'); assert.deepEqual(pathsOf({id:'x',role:'admin'}),{portfolio:'data/users/x/portfolio',settings:'data/users/x/settings',pulse:'data/users/x/pulse',newsst:'data/users/x/newsst',journal:'data/users/x/journal'},'an admin\'s alerts: from his own portfolio')}
  // the quiet hours, in Israel time
  const pr=pulsePrefs({pulse:{quiet:{from:'22:00',to:'07:00'}}}); assert.equal(inQuiet(pr,new Date('2026-10-30T21:30:00Z')),true,'23:30'); assert.equal(inQuiet(pr,new Date('2026-10-30T08:00:00Z')),false,'10:00');
  assert.equal(inQuiet(pulsePrefs({}),new Date('2026-10-30T04:00:00Z')),true,'06:00, the default quiet until 09:00'); assert.equal(inQuiet(pulsePrefs({pulse:{quiet:{on:false}}}),new Date('2026-10-30T04:00:00Z')),false);
});

test('pulse on the phone: a critical alert in the quiet hours only when allowed; a development is sent again; the important ones only when chosen',async()=>{
  const {liveTask}=await import('../server/livealert.js'); const {newsId}=await import('../server/newsx.js'); const {_setSectors}=await import('../server/pulse.js'); _setSectors({});
  const s=new Store(':memory:'), night=new Date('2026-10-30T23:00:00Z'), at=new Date(night-36e5).toISOString();   // 01:00 in Israel
  const o=s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'});
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:1,ccy:'USD'}]}); s.setDoc('quotes/latest',{prices:{NVDA:100},prev:{},usdIls:3.7,updatedAt:at});
  s.setDoc('research/news',{items:[{title:'t',link:'https://x/a',at,syms:['NVDA'],seen:at}]});
  s.setDoc('research/newsx',{by:{[newsId('https://x/a')]:{he:'אנבידיה',what:'w',type:'guidance',level:'crit',dir:'neg',cert:'fact',kind:'news',aff:[{sym:'NVDA',how:'direct',dir:'neg'}],ev:'nv'}},gen:[]});
  const got=[]; const push=async(st,uid,msg)=>{got.push(msg); return 1}, send=async()=>true;
  let r=await liveTask(s,{now:night,send,push}); assert.equal(r.quiet,true); assert.equal(got.length,0,'quiet by default');
  s.setDoc('settings/main',{pulse:{critQuiet:true}}); r=await liveTask(s,{now:night,send,push}); assert.equal(got.length,1,'a critical one, allowed'); assert.match(got[0].body,/אנבידיה/);
  r=await liveTask(s,{now:new Date(night.getTime()+30*60e3),send,push}); assert.equal(got.length,1,'once');
  // a development: another holding named (version 2), sent again after the gap
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:1,ccy:'USD'},{sym:'TSM',qty:1,ccy:'USD'}]}); s.setDoc('quotes/latest',{prices:{NVDA:100,TSM:100},prev:{},usdIls:3.7,updatedAt:at});
  s.setDoc('research/newsx',{by:{[newsId('https://x/a')]:{he:'אנבידיה',what:'w',type:'guidance',level:'crit',dir:'neg',cert:'fact',kind:'news',aff:[{sym:'NVDA',how:'direct',dir:'neg'},{sym:'TSM',how:'supplier',dir:'neg',why:'מייצרת'}],ev:'nv'}},gen:[]});
  r=await liveTask(s,{now:new Date(night.getTime()+60*60e3),send,push}); assert.equal(got.length,2); assert.match(got[1].body,/עדכון/);
  // an important one: not on the phone unless chosen
  const s2=new Store(':memory:'); s2.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}); const day=new Date('2026-10-30T10:00:00Z'), at2=new Date(day-36e5).toISOString();
  s2.setDoc('portfolio/main',{positions:[{sym:'KO',qty:1,ccy:'USD'}]}); s2.setDoc('quotes/latest',{prices:{KO:60},prev:{},usdIls:3.7,updatedAt:at2});
  s2.setDoc('research/news',{items:[{title:'t',link:'https://x/k',at:at2,syms:['KO'],seen:at2}]});
  s2.setDoc('research/newsx',{by:{[newsId('https://x/k')]:{he:'קוקה קולה',what:'w',type:'contract',level:'imp',dir:'pos',cert:'fact',kind:'news',aff:[{sym:'KO',how:'direct',dir:'pos'}],ev:'ko'}},gen:[]});
  const got2=[]; await liveTask(s2,{now:day,send,push:async(st,uid,msg)=>{got2.push(msg); return 1}}); assert.equal(got2.length,0);
  assert.equal(s2.getDoc('alerts/pulse').data.items[0].lv,'imp','it is in the alert center');
  s2.setDoc('settings/main',{pulse:{push:{imp:true}}}); await liveTask(s2,{now:new Date(day.getTime()+60e3),send,push:async(st,uid,msg)=>{got2.push(msg); return 1}}); assert.equal(got2.length,1);
});

test('the phone: devices kept per person, a gone one dropped; the live alerts reach the owner\'s and a partner\'s phones, each from their own portfolio',async()=>{
  const {cleanSub,addDevice,devices,dropDevice,pushTo,vapid}=await import('../server/push.js'); const {liveTask}=await import('../server/livealert.js');
  const s=new Store(':memory:'), env={};
  const k1=vapid(s,{env}), k2=vapid(s,{env}); assert.ok(k1.publicKey&&k1.privateKey); assert.deepEqual(k1,k2,'made once, then kept');
  assert.equal(cleanSub({endpoint:'http://x/y',keys:{p256dh:'a'.repeat(40),auth:'b'.repeat(16)}}),null,'https only');
  const sub=n=>({endpoint:'https://push.example.test/'+n+'x'.repeat(10),keys:{p256dh:'B'+'a'.repeat(60),auth:'c'.repeat(22)}});
  const o=s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}), f=s.addUser({email:'f@example.com',password:'friend-pass-1',role:'friend'});
  assert.ok(addDevice(s,o.id,sub(1))); assert.ok(addDevice(s,o.id,sub(1)),'the same device again'); assert.equal(devices(s,o.id).length,1,'kept once');
  addDevice(s,o.id,sub(2)); assert.equal(devices(s,o.id).length,2); assert.equal(devices(s,f.id).length,0,'apart per person');
  // a device the push service says is gone is dropped
  const calls=[]; const send=async(d,body,opts)=>{calls.push({d,body:JSON.parse(body),opts}); if(d.endpoint.includes('/2'))throw Object.assign(new Error('gone'),{statusCode:410})};
  assert.equal(await pushTo(s,o.id,{title:'t',body:'b',url:'./?st=1'},{env,send}),1); assert.equal(devices(s,o.id).length,1); assert.equal(calls[0].opts.vapidDetails.publicKey,k1.publicKey); assert.equal(calls[0].body.url,'./?st=1');
  assert.equal(dropDevice(s,o.id,sub(1).endpoint),1); assert.equal(devices(s,o.id).length,0);
  // the live alerts: the owner from portfolio/main, the partner from their own documents; the partner only by phone
  addDevice(s,o.id,sub(3)); addDevice(s,f.id,sub(4));
  s.setDoc('quotes/latest',{prices:{NVDA:190,KO:55},prev:{NVDA:200,KO:60},usdIls:3.7,stale:{}});
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'}]}); s.setDoc('settings/main',{liveAl:{move:4}});
  s.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'KO'}]}); s.setDoc(`data/users/${f.id}/settings`,{liveAl:{move:4}});
  const got=[], mails=[]; const push=async(st,uid,msg)=>{got.push({uid,msg}); return 1};
  const now=new Date('2026-10-30T13:00:00Z'); await liveTask(s,{now,send:async(st,kind,msg)=>{mails.push(msg); return true},push});
  assert.equal(mails.length,1,'one e-mail, the owner\'s'); assert.match(mails[0].text,/NVDA/); assert.ok(!/KO/.test(mails[0].text),'not the partner\'s holdings');
  const byU=Object.fromEntries(got.map(g=>[g.uid,g.msg.body])); assert.match(byU[o.id],/NVDA ירדה/); assert.match(byU[f.id],/KO ירדה/); assert.ok(!/NVDA/.test(byU[f.id]),'the partner\'s own portfolio only');
  assert.equal(got.find(g=>g.uid===o.id).msg.url,'./?st=1','a tap opens the stories');
  // once a day each, for the partner too
  got.length=0; await liveTask(s,{now:new Date(now.getTime()+30*60e3),send:async()=>true,push}); assert.equal(got.length,0);
});

test('the phone through the site: the key and the devices for the signed-in person only; a bad subscription is refused',async()=>{
  const {srv,req}=await startApp();
  try{
    assert.equal((await req('x','GET','/api/push')).status,401,'signed in only');
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'});
    let r=await req('o','GET','/api/push'); assert.equal(r.status,200); assert.ok(r.j.key.length>40); assert.equal(r.j.n,0);
    assert.equal((await req('o','POST','/api/push/sub',{sub:{endpoint:'javascript:alert(1)',keys:{}}})).status,400);
    r=await req('o','POST','/api/push/sub',{sub:{endpoint:'https://push.example.test/abcdefghijk',keys:{p256dh:'B'+'a'.repeat(60),auth:'c'.repeat(22)}}}); assert.equal(r.j.n,1);
    assert.equal((await req('o','GET','/api/push')).j.n,1);
    r=await req('o','POST','/api/push/unsub',{endpoint:'https://push.example.test/abcdefghijk'}); assert.equal(r.j.removed,1);
  }finally{srv.close()}
});

test('a partner\'s own e-mails: only what they switched on, to their own address, noted for their page; Resend\'s test sender is said to be the reason',async()=>{
  const {sendAllowed,mailAllowedFor,mailFromOwnDomain}=await import('../server/mail.js'); const {partnerDocs}=await import('../server/tasks.js');
  const s=new Store(':memory:'), f=s.addUser({email:'ori@example.com',password:'friend-pass-1',role:'friend'}), u=s.users().find(x=>x.id===f.id);
  const env0={k:process.env.RESEND_API_KEY,to:process.env.MAIL_TO,from:process.env.MAIL_FROM}, f0=globalThis.fetch, sent=[]; let code=200;
  globalThis.fetch=async(url,o)=>{if(String(url).includes('api.resend.com')){sent.push(JSON.parse(o.body)); return new Response(code===200?'{"id":"x"}':'{"message":"testing emails only"}',{status:code})} return f0(url,o)};
  try{
    process.env.RESEND_API_KEY='re_test'; process.env.MAIL_TO='owner@example.com'; delete process.env.MAIL_FROM;
    const msg={subject:'s',text:'t',html:'<p>h</p>'}, last=()=>JSON.parse(s.getMeta('mail:'+u.id)||'{}').last||{};
    assert.equal(mailAllowedFor(s,u,'morning'),false); assert.equal(await sendAllowed(s,'morning',msg,()=>{},u),false); assert.equal(sent.length,0); assert.equal(last().morning.result,'off');
    s.setDoc(`data/users/${u.id}/settings`,{mail:{morning:true,backup:true}});
    assert.equal(mailAllowedFor(s,u,'backup'),false,'a partner never has the owner\'s kinds');
    assert.equal(mailFromOwnDomain(),false,'the default sender is Resend\'s test address');
    code=403; assert.equal(await sendAllowed(s,'morning',msg,()=>{},u),false); assert.deepEqual(sent[0].to,['ori@example.com'],'to the partner, not to MAIL_TO');
    assert.equal(last().morning.result,'domain','the reason is said: a sending domain is needed');
    process.env.MAIL_FROM='תיק צ׳יק <alerts@mydomain.co.il>'; code=200; assert.equal(mailFromOwnDomain(),true);
    assert.equal(await sendAllowed(s,'morning',msg,()=>{},u),true); assert.equal(last().morning.result,'sent');
    assert.equal(s.getDoc('system/mail').exists,false,'the owner\'s status is not touched');
    // the page run for a partner: their own documents, and the shared ones only as they see them
    s.setDoc(`data/users/${u.id}/portfolio`,{positions:[{sym:'KO',qty:1}]}); s.setDoc('quotes/latest',{prices:{KO:60,NVDA:190},prev:{},usdIls:3.7});
    const d=partnerDocs(s,u); assert.ok(d[`data/users/${u.id}/portfolio`]); assert.ok(!d['portfolio/main']); assert.deepEqual(Object.keys(d['quotes/latest'].prices),['KO'],'not the owner\'s securities');
  }finally{globalThis.fetch=f0; for(const [k,v] of [['RESEND_API_KEY',env0.k],['MAIL_TO',env0.to],['MAIL_FROM',env0.from]])if(v==null)delete process.env[k]; else process.env[k]=v}
});

test('an admin: runs the site as the owner does (users, roles, health, every security\'s prices) and invests apart, in their own portfolio, never the owner\'s; back to a partner, the same portfolio',async()=>{
  const {store,srv,req}=await startApp();
  try{
    const f=store.addUser({email:'ori@example.com',password:'friend-pass-1',role:'friend'}), g=store.addUser({email:'g@example.com',password:'friend-pass-2',role:'friend'});
    store.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'KO',qty:1}]});
    await req('o','POST','/api/login',{email:'owner@example.com',password:'owner-pass-123'}); await req('f','POST','/api/login',{email:'ori@example.com',password:'friend-pass-1'});
    assert.equal((await req('f','GET','/api/db/doc?path=portfolio/main')).status,403,'a partner: not the owner\'s portfolio');
    assert.equal((await req('f','POST',`/api/users/${g.id}/role`,{role:'admin'})).status,403,'a partner changes no roles');
    assert.equal((await req('o','POST',`/api/users/${f.id}/role`,{role:'owner'})).status,400,'never a second owner');
    let r=await req('o','POST',`/api/users/${f.id}/role`,{role:'admin'}); assert.equal(r.j.role,'admin');
    assert.equal((await req('f','GET','/api/me')).j.me,null,'signed out by the change');
    r=await req('f','POST','/api/login',{email:'ori@example.com',password:'friend-pass-1'}); assert.equal(r.j.me.owner,false,'not the owner: his own documents'); assert.equal(r.j.me.admin,true); assert.equal(r.j.me.manage,true);
    // 31.10: two investors, two portfolios: the owner's is the owner's alone, the admin's is his
    for(const p of ['portfolio/main','settings/main','plan/main','history/main','alerts/pulse','reports/archive/items/x','usage/main','news/state'])assert.equal((await req('f','GET','/api/db/doc?path='+p)).status,403,'not the owner\'s: '+p);
    assert.equal((await req('f','PUT','/api/db/doc?path=portfolio/main',{positions:[]})).status,403,'nor writes it');
    r=await req('f','GET',`/api/db/doc?path=data/users/${f.id}/portfolio`); assert.equal(r.j.data.positions[0].sym,'KO','his own portfolio, the one he had');
    assert.equal((await req('f','PUT',`/api/db/doc?path=data/users/${f.id}/settings`,{profile:{first:'אורי'}})).status,200,'his own settings');
    assert.equal((await req('o','GET',`/api/db/doc?path=data/users/${f.id}/portfolio`)).status,403,'and the owner does not read his');
    // the prices and the research: every security's, as the owner sees them (he runs the site)
    store.setDoc('quotes/latest',{prices:{MSFT:400,KO:60},prev:{},usdIls:3.7}); r=await req('f','GET','/api/db/doc?path=quotes/latest'); assert.deepEqual(Object.keys(r.j.data.prices).sort(),['KO','MSFT']);
    // an export: his own documents and the site's; not the owner's, not another user's
    store.setDoc(`data/users/${g.id}/portfolio`,{positions:[{sym:'JPM',qty:1}]});
    r=await req('f','GET','/api/db/export'); const ks=Object.keys(r.j.docs); assert.ok(ks.includes(`data/users/${f.id}/portfolio`)&&ks.includes('quotes/latest'),'his and the site\'s: '+ks.join(', '));
    assert.ok(!ks.some(p=>p==='portfolio/main'||p==='settings/main'||(p.startsWith('data/users/')&&!p.startsWith(`data/users/${f.id}/`))),'not the owner\'s nor another user\'s: '+ks.join(', '));
    assert.equal((await req('f','GET','/api/users')).status,200,'the users page'); assert.equal((await req('f','GET','/api/health')).status,200,'the system\'s health');
    // 31.10: roles too, as the owner: he makes an admin and removes one; never the owner, never himself
    r=await req('f','POST',`/api/users/${g.id}/role`,{role:'admin'}); assert.equal(r.j.role,'admin','an admin makes an admin');
    assert.equal((await req('f','POST',`/api/users/${(store.users().find(u=>u.role==='owner')).id}/role`,{role:'friend'})).status,400,'the owner stays the owner');
    assert.equal((await req('f','DELETE',`/api/users/${(store.users().find(u=>u.role==='owner')).id}`)).status,400,'nobody removes the owner');
    assert.equal((await req('f','DELETE',`/api/users/${f.id}`)).status,400,'nor himself');
    assert.equal((await req('f','DELETE',`/api/users/${g.id}`)).status,200,'an admin removes an admin'); assert.equal(store.userById(g.id),null);
    assert.equal(store.users().filter(u=>u.role==='owner').length,1,'one owner');
    // back to a partner: their own portfolio again, kept all along
    await req('o','POST',`/api/users/${f.id}/role`,{role:'friend'}); await req('f','POST','/api/login',{email:'ori@example.com',password:'friend-pass-1'});
    assert.equal((await req('f','GET','/api/db/doc?path=portfolio/main')).status,403); assert.equal((await req('f','GET',`/api/db/doc?path=data/users/${f.id}/portfolio`)).j.data.positions[0].sym,'KO');
  }finally{srv.close()}
});

test('the admins get the site\'s alert ("משהו לא מתעדכן"), each a message of its own, once there is a sending domain; not the owner\'s portfolio mails, never the backup',async()=>{
  const {sendAllowed}=await import('../server/mail.js');
  const s=new Store(':memory:'); s.addUser({email:'shai@example.com',password:'owner-pass-123',role:'owner'}); const a=s.addUser({email:'ori@example.com',password:'friend-pass-1',role:'friend'}); s.setRole(a.id,'admin');
  s.setDoc('settings/main',{mail:{morning:true,backup:true,pxalert:true}});
  const env0={k:process.env.RESEND_API_KEY,to:process.env.MAIL_TO,from:process.env.MAIL_FROM}, f0=globalThis.fetch, sent=[];
  globalThis.fetch=async(url,o)=>{if(String(url).includes('api.resend.com')){const b=JSON.parse(o.body); sent.push(b); const ok=!/resend\.dev/.test(b.from)||b.to.includes('shai@example.com'); return new Response(ok?'{"id":"x"}':'{"message":"testing only"}',{status:ok?200:403})} return f0(url,o)};
  try{
    process.env.RESEND_API_KEY='re_test'; process.env.MAIL_TO='shai@example.com'; delete process.env.MAIL_FROM; const msg={subject:'s',text:'t',html:'h'}, last=()=>JSON.parse(s.getMeta('mail:'+a.id)||'{}').last||{};
    // 31.10: the admin chooses for himself, from every kind the owner has
    const {kindsOf,mailAllowedFor}=await import('../server/mail.js'); assert.deepEqual(kindsOf(s.userById(a.id)),['morning','earnings','reports','backup','pxalert','live']);
    sent.length=0; await sendAllowed(s,'pxalert',msg); assert.deepEqual(sent.map(x=>x.to),[['shai@example.com']],'not switched on by him: not sent to him'); assert.equal(last().pxalert.result,'off'); sent.length=0;
    s.setDoc(`data/users/${a.id}/settings`,{mail:{pxalert:true,reports:true}}); assert.equal(mailAllowedFor(s,s.userById(a.id),'reports'),true);
    assert.equal(await sendAllowed(s,'pxalert',msg),true); assert.deepEqual(sent.map(x=>x.to),[['shai@example.com']],'Resend\'s test sender: the owner only, the owner\'s mail not refused');
    assert.equal(last().pxalert.result,'domain');
    process.env.MAIL_FROM='תיק צ׳יק <alerts@mydomain.co.il>'; sent.length=0;
    assert.equal(await sendAllowed(s,'pxalert',msg),true); assert.deepEqual(sent.map(x=>x.to),[['shai@example.com'],['ori@example.com']],'the admin: a message of his own'); assert.equal(last().pxalert.result,'sent');
    // 31.10: the morning mail is about the owner's portfolio: the owner's alone; the admin has his own, if he switches it on
    sent.length=0; await sendAllowed(s,'morning',msg); assert.deepEqual(sent.map(x=>x.to),[['shai@example.com']],'the owner\'s morning: the owner alone');
    sent.length=0; await sendAllowed(s,'morning',msg,()=>{},s.userById(a.id)); assert.deepEqual(sent,[],'his own: off until he switches it on');
    s.setDoc(`data/users/${a.id}/settings`,{mail:{morning:true}}); await sendAllowed(s,'morning',msg,()=>{},s.userById(a.id)); assert.deepEqual(sent.map(x=>x.to),[['ori@example.com']],'his own, to him');
    sent.length=0; await sendAllowed(s,'backup',{...msg,attachments:[]}); assert.deepEqual(sent.map(x=>x.to),[['shai@example.com']],'the backup: the owner alone');
  }finally{globalThis.fetch=f0; for(const [k,v] of [['RESEND_API_KEY',env0.k],['MAIL_TO',env0.to],['MAIL_FROM',env0.from]])if(v==null)delete process.env[k]; else process.env[k]=v}
});

test('an admin\'s daily backup: his own documents and the site\'s; never the owner\'s portfolio nor another user\'s',async()=>{
  const {adminExport}=await import('../server/backup.js');
  const s=new Store(':memory:'); s.addUser({email:'shai@example.com',password:'owner-pass-123',role:'owner'}); const a=s.addUser({email:'ori@example.com',password:'friend-pass-1',role:'friend'}); s.setRole(a.id,'admin'); const f=s.addUser({email:'p@example.com',password:'friend-pass-2',role:'friend'});
  for(const [p,d] of [['portfolio/main',{positions:[{sym:'MSFT'}]}],['settings/main',{}],['quotes/latest',{prices:{}}],['research/latest',{}],['history/prices',{px:{}}],[`data/users/${a.id}/portfolio`,{positions:[{sym:'KO'}]}],[`watch/${a.id}`,{syms:['KO']}],[`data/users/${f.id}/portfolio`,{positions:[{sym:'JPM'}]}],[`watch/${f.id}`,{syms:['JPM']}]])s.setDoc(p,d);
  const ks=Object.keys(adminExport(s,s.userById(a.id)).docs).sort();
  assert.deepEqual(ks,[`data/users/${a.id}/portfolio`,'history/prices','quotes/latest','research/latest',`watch/${a.id}`].sort());
});

test('the morning summary: the last day, the news, the new alerts, the week, the dividends; empty sections left out',async()=>{
  const {morningSections}=await import('../server/tasks.js');
  const G={ready:true,day:{pct:-0.97,ils:-237,top:[{sym:'NVDA',pct:-2.41,ils:-100}]},news:[{level:'crit',he:'אנבידיה הורידה את התחזית',what:'החברה הורידה את התחזית.',who:'NVDA (16% מהתיק)',link:'https://x/n',pub:'Reuters'}],soon:[{d:'2026-11-02',items:['אקס דיבידנד KO']}],divYear:420};
  const S=morningSections(G,[{sev:'crit',cat:'ריכוז',text:'NVDA מעל 10%'}],{SEV:{crit:'חריגה'}});
  assert.deepEqual(S.map(x=>x.t),['ביום המסחר האחרון','ידיעות חשובות על המניות שלך','התראות חדשות','השבוע בתיק','דיבידנדים']);
  assert.equal(S[0].text,'התיק ירד −0.97% (−₪237), בעיקר NVDA −2.41%.'); assert.match(S[1].text,/\[קריטי\] NVDA \(16% מהתיק\): אנבידיה הורידה את התחזית\. החברה הורידה את התחזית\.\n  https:\/\/x\/n/); assert.match(S[3].text,/^02\.11: אקס דיבידנד KO$/);
  assert.deepEqual(morningSections({ready:true,news:[],soon:[]},[]).map(x=>x.t),[],'nothing: nothing');
});

test('the health of the data: each source with the last time it worked; bad only when it has not worked for longer than it may',async()=>{
  const {healthCheck,healthProblems,jobNote}=await import('../server/health.js');
  const s=new Store(':memory:'), env={FINNHUB_API_KEY:'k',ANTHROPIC_API_KEY:'k'}, at=h=>new Date(Date.UTC(2026,9,30,6)+h*36e5);
  s.setDoc('quotes/latest',{updatedAt:at(0).toISOString(),usdIls:3.7,prices:{MSFT:400}});
  s.setMeta('researchStatus',JSON.stringify({at:at(0).toISOString(),ok:40,of:42,fail:2,fh:{filled:30,cal:12},dates:{dated:0,tried:20,fail:20,first:'MSFT: HTTP 403'},divs:{tried:10,nasdaq:8,yahoo:1,fail:1}}));
  s.setMeta('newsStatus',JSON.stringify({at:at(0).toISOString(),ok:0,of:30,items:0,first:'AAPL: HTTP 429'}));
  s.setMeta('newsxStatus',JSON.stringify({at:at(0).toISOString(),ai:true,read:12,fail:0,rules:0,waiting:0}));
  let H=healthCheck(s,{env,now:at(0.1)}); const st=k=>H.items.find(i=>i.key===k).state;
  assert.equal(st('research'),'ok'); assert.equal(st('finnhub'),'ok'); assert.equal(st('newsx'),'ok'); assert.equal(st('prices'),'ok');
  assert.equal(st('sec'),'warn','failing, but only just: not yet "bad"'); assert.equal(st('news'),'warn');
  assert.equal(st('x'),'off','no token: nothing expected of it'); assert.equal(st('backupmail'),'off');
  // eleven hours on, the news still failing: bad (it may go ten hours, the night); the SEC dates may go 80 hours
  s.setMeta('newsxStatus',JSON.stringify({at:at(10.5).toISOString(),ai:true,read:3,fail:0,rules:0,waiting:0}));
  H=healthCheck(s,{env,now:at(11)}); assert.equal(st('news'),'bad'); assert.equal(st('sec'),'warn');
  assert.deepEqual(healthProblems(s,{env,now:at(11)}).map(p=>p.key),['h:news']);
  // it works again: ok, and the "since" is forgotten
  s.setMeta('newsStatus',JSON.stringify({at:at(11.5).toISOString(),ok:28,of:30,items:140}));
  H=healthCheck(s,{env,now:at(11.6)}); assert.equal(st('news'),'ok'); assert.equal(H.items.find(i=>i.key==='news').okAt,at(11.5).toISOString());
  // research that worked and then stopped running: bad after 80 hours, with the last time it worked
  H=healthCheck(s,{env,now:at(81)}); assert.equal(st('research'),'bad'); assert.equal(H.items.find(i=>i.key==='research').okAt,at(0).toISOString());
  // a job that failed the last time: bad at once, with its words; a run that works clears it
  jobNote(s,'nightly',{ok:false,ms:5,err:new Error('boom').message,now:at(1)}); H=healthCheck(s,{env,now:at(1)});
  assert.equal(st('job:nightly'),'bad'); assert.match(H.items.find(i=>i.key==='job:nightly').note,/boom/);
  jobNote(s,'nightly',{ok:true,ms:5,now:at(2)}); H=healthCheck(s,{env,now:at(2)}); assert.ok(!H.items.some(i=>i.key==='job:nightly'));
  // a backup copy that could not be opened is not a backup
  s.setMeta('lastBackup',JSON.stringify({at:at(2).toISOString(),file:'x',size:1,docs:null})); H=healthCheck(s,{env,now:at(2)}); assert.equal(st('backup'),'warn');
  assert.ok(!JSON.stringify(H).includes('MSFT')||JSON.stringify(H).includes('HTTP 403'),'site facts only');
});

test('the scheduler notes each job\'s run for the health page',async()=>{
  const {startJobs}=await import('../server/jobs.js'); const s=new Store(':memory:');
  const J=startJobs(s,{log:()=>{},every:1e9,schedule:[{name:'good',when:()=>false,run:async()=>{}},{name:'bad',when:()=>false,run:async()=>{throw new Error('it broke')}}]});
  J.run('good'); J.run('bad'); await new Promise(r=>setTimeout(r,200)); J.stop();
  const M=JSON.parse(s.getMeta('jobs')); assert.equal(M.good.ok,true); assert.equal(M.bad.ok,false); assert.match(M.bad.err,/it broke/);
  assert.ok(s.getMeta('health'),'the health was read after the runs');
});

test('a share\'s moves around its earnings releases: from the close before to the close after, the last ones, their average size',async()=>{
  const {erxOf,erxPass}=await import('../server/research.js');
  const near=(a,b,eps=1e-9,m)=>assert.ok(Math.abs(a-b)<=eps,(m||'')+` ${a} vs ${b}`);
  const d=[], c=[]; let px=100; for(let i=0;i<60;i++){const day=new Date(Date.UTC(2026,6,1)+i*864e5).toISOString().slice(0,10); const wd=new Date(day).getUTCDay(); if(wd===0||wd===6)continue; d.push(day); c.push(px); px+=0.1}
  // two releases: 2026-07-15 (a Wednesday) and 2026-08-12; moves made around them
  const at=x=>d.indexOf(x); c[at('2026-07-16')]=c[at('2026-07-14')]*1.08; c[at('2026-08-13')]=c[at('2026-08-11')]*0.95;
  const R=[{date:'2026-08-12',src:'8-K'},{date:'2026-07-15',src:'8-K'},{date:'2026-08-20',src:'10-Q'}];
  const e=erxOf(R,{d,c},{today:'2026-09-01'});
  assert.equal(e.n,2); assert.deepEqual(e.moves.map(m=>m.d),['2026-08-12','2026-07-15'],'the newest first, the 10-Q is not a release');
  near(e.moves[0].pct,-5,0.01); near(e.moves[1].pct,8,0.01); near(e.avgAbs,6.5,0.01); assert.equal(e.up,1);
  assert.equal(erxOf(R.slice(0,1),{d,c},{today:'2026-09-01'}),null,'one release is not enough');
  const s=new Store(':memory:'); s.setDoc('research/latest',{companies:{NVDA:{repDates:R}}}); s.setDoc('quotes/c_NVDA',{d,c});
  assert.equal(erxPass(s,['NVDA','MSFT'],{now:new Date('2026-09-01T00:00:00Z')}),1); assert.equal(s.getDoc('research/latest').data.companies.NVDA.erx.n,2);
});

// ---- 1.11 (12): the insiders' filings (form 4) ----
const F4=(o={})=>`<?xml version="1.0"?><ownershipDocument><periodOfReport>${o.date||'2026-10-28'}</periodOfReport><issuer><issuerCik>1045810</issuerCik><issuerName>NVIDIA CORP</issuerName><issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>${o.name||'Huang Jen Hsun'}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>${o.dir?1:0}</isDirector><isOfficer>${o.off===false?0:1}</isOfficer><isTenPercentOwner>0</isTenPercentOwner><officerTitle>${o.title||'President and CEO'}</officerTitle></reportingOwnerRelationship></reportingOwner>
${o.aff?'<aff10b5One>1</aff10b5One>':''}<nonDerivativeTable>${(o.txs||[{code:'S',sh:120000,px:182.5,ad:'D',after:75000000,fn:'F1'}]).map(t=>`<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>${o.date||'2026-10-28'}</value></transactionDate><transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${t.code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved>${t.fn?`<footnoteId id="${t.fn}"/>`:''}</transactionCoding><transactionAmounts><transactionShares><value>${t.sh}</value></transactionShares>${t.px!=null?`<transactionPricePerShare><value>${t.px}</value></transactionPricePerShare>`:'<transactionPricePerShare><footnoteId id="F9"/></transactionPricePerShare>'}<transactionAcquiredDisposedCode><value>${t.ad}</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>${t.after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction>`).join('')}</nonDerivativeTable>
<footnotes><footnote id="F1">Sale under a Rule 10b5-1 trading plan adopted March 2026.</footnote><footnote id="F9">Shares withheld to cover tax.</footnote></footnotes></ownershipDocument>`;
test('1.11 insiders: a form 4 is read (who, role, each transaction told apart, the plan from the footnote), summed up per filing, and marked material by plain thresholds',async()=>{
  const {parseForm4,filingSummary,markFilings,pickForm4,form4Url}=await import('../server/insiders.js');
  const p=parseForm4(F4({})); assert.equal(p.issuer.sym,'NVDA'); assert.equal(p.owners[0].name,'Huang Jen Hsun'); assert.equal(p.owners[0].title,'President and CEO'); assert.equal(p.txs[0].kind,'sell'); assert.equal(p.txs[0].plan,true,'the plan from the footnote'); assert.equal(p.txs[0].after,75000000);
  const f=filingSummary(p,{sym:'NVDA',cik:1045810,acc:'0001-26-1',filedAt:'2026-10-30T20:00:00Z',link:'L'}); assert.equal(f.kind,'sell'); assert.equal(f.value,21900000); assert.equal(f.plan,true); assert.equal(f.top,true); assert.match(f.role,/President and CEO/); assert.equal(f.deliberate,true);
  // pay mechanics: an award and a tax withholding are not a decision; an exercise with a sale leads with the sale
  const q=parseForm4(F4({name:'Kress Colette',title:'EVP and CFO',txs:[{code:'A',sh:5000,px:0,ad:'A',after:500000},{code:'F',sh:2000,px:null,ad:'D',after:498000}]})), g=filingSummary(q,{sym:'NVDA',cik:1,acc:'a2',filedAt:'2026-10-29T00:00:00Z',link:'L'});
  assert.equal(g.kind,'award'); assert.equal(g.deliberate,false); assert.deepEqual(g.kinds.map(k=>k.kind),['award','tax']);
  const r=parseForm4(F4({name:'X',title:'VP',txs:[{code:'M',sh:1000,px:20,ad:'A',after:3000},{code:'S',sh:1000,px:180,ad:'D',after:2000}]})), h=filingSummary(r,{sym:'NVDA',cik:1,acc:'a3',filedAt:'2026-10-29T00:00:00Z',link:'L'});
  assert.equal(h.kind,'sell'); assert.equal(h.value,180000); assert.equal(h.deliberate,true);
  // material: the CEO's planned sale of $21.9M yes; a VP's $180K sale no; three buyers in 30 days: a cluster; one person three times: repeat
  const M=markFilings([f,g,h]); assert.equal(M[0].material,true); assert.match(M[0].why[0],/מכירה בשוק של נושא משרה בכיר.*\$21,900,000.*מתוכננת/); assert.equal(M[1].material,false); assert.equal(M[2].material,false);
  const buy=(n,d)=>({acc:'b'+n+d,owner:n,kind:'buy',deliberate:true,value:30000,top:false,plan:false,txDate:d,filedAt:d+'T00:00:00Z'});
  const C=markFilings([buy('A','2026-10-01'),buy('B','2026-10-10'),buy('C','2026-10-20')]); assert.ok(C.every(x=>x.cluster&&x.material),'a cluster of three buyers');
  const R=markFilings([buy('A','2026-08-01'),buy('A','2026-09-01'),buy('A','2026-10-01')]); assert.ok(R.every(x=>x.repeat),'the same person three times'); assert.equal(R[0].cluster,false);
  // the filings picked from the submissions: form 4 within the days, the xsl prefix dropped from the document
  const sub={filings:{recent:{form:['4','8-K','4/A','4'],accessionNumber:['0001-26-1','0001-26-2','0001-26-3','0001-26-4'],primaryDocument:['xslF345X05/wk-form4_1.xml','x.htm','xslF345X05/f4a.xml','old.xml'],acceptanceDateTime:['2026-10-30T20:00:00.000Z','2026-10-29T20:00:00.000Z','2026-10-28T20:00:00.000Z','2026-01-01T20:00:00.000Z']}}};
  const L=pickForm4(sub,{now:new Date('2026-11-01T00:00:00Z')}); assert.deepEqual(L.map(x=>x.acc),['0001-26-1','0001-26-3']); assert.equal(L[1].amend,true);
  assert.equal(form4Url(1045810,'0001-26-1','xslF345X05/wk-form4_1.xml'),'https://www.sec.gov/Archives/edgar/data/1045810/0001261/wk-form4_1.xml');
  assert.equal(parseForm4('<html>not a form</html>'),null);
});
test('1.11 insiders: the task keeps the filings by symbol (new ones fetched, known ones kept), partners see only their own companies, and the alerts: material as important, a plain open-market trade of a holding as an update, pay mechanics never',async()=>{
  const {insidersTask}=await import('../server/insiders.js'); const {pulseUpdate}=await import('../server/pulse.js'); const {_resetCiks}=await import('../server/fundamentals.js'); _resetCiks();
  const s=new Store(':memory:'), now=new Date('2026-11-01T06:00:00Z'); const calls=[];
  const f=async u=>{calls.push(u); u=String(u);
    if(u.includes('company_tickers'))return new Response(JSON.stringify({0:{cik_str:1045810,ticker:'NVDA'},1:{cik_str:789019,ticker:'MSFT'}}),{status:200});
    if(u.includes('/submissions/CIK0001045810'))return new Response(JSON.stringify({name:'NVIDIA CORP',filings:{recent:{form:['4','4'],accessionNumber:['0001-26-1','0001-26-2'],primaryDocument:['xslF345X05/a.xml','xslF345X05/b.xml'],acceptanceDateTime:['2026-10-30T20:00:00.000Z','2026-10-29T20:00:00.000Z']}}}),{status:200});
    if(u.includes('/submissions/CIK0000789019'))return new Response(JSON.stringify({name:'MICROSOFT',filings:{recent:{form:['4'],accessionNumber:['0002-26-1'],primaryDocument:['xslF345X05/c.xml'],acceptanceDateTime:['2026-10-31T20:00:00.000Z']}}}),{status:200});
    if(u.endsWith('/a.xml'))return new Response(F4({}),{status:200});
    if(u.endsWith('/b.xml'))return new Response(F4({name:'Kress Colette',title:'EVP and CFO',txs:[{code:'A',sh:5000,px:0,ad:'A',after:500000}]}),{status:200});
    if(u.endsWith('/c.xml'))return new Response(F4({name:'Smith John',title:'VP Finance',txs:[{code:'S',sh:300,px:505,ad:'D',after:9000}]}),{status:200});
    return new Response('',{status:404})};
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA',qty:6,ccy:'USD'},{sym:'MSFT',qty:2,ccy:'USD'}]},{silent:true}); s.setDoc('quotes/latest',{prices:{NVDA:182,MSFT:505},usdIls:3.7,updatedAt:now.toISOString()},{silent:true});
  const r=await insidersTask(s,{fetch:f,now,pause:0}); assert.equal(r.got,3); assert.equal(r.ok,2);
  const D=s.getDoc('research/insiders').data; assert.equal(D.by.NVDA.length,2); assert.equal(D.by.NVDA[0].kind,'sell'); assert.equal(D.by.NVDA[0].material,true); assert.equal(D.by.NVDA[1].kind,'award'); assert.equal(D.by.MSFT[0].value,151500); assert.equal(D.by.MSFT[0].material,false);
  // a second run fetches no filing again
  const n0=calls.length; await insidersTask(s,{fetch:f,now,pause:0}); assert.equal(calls.filter(u=>String(u).endsWith('.xml')).length,3,'known filings are not fetched again'); assert.ok(calls.length>n0);
  // a partner who holds MSFT only
  const u=s.addUser({email:'p@x.com',password:'friend-pass-1',role:'friend'}); s.setDoc(`data/users/${u.id}/portfolio`,{positions:[{sym:'MSFT',qty:1,ccy:'USD'}]},{silent:true});
  const pv=partnerView(s,u,'research/insiders',D); assert.deepEqual(Object.keys(pv.by),['MSFT']); assert.equal(pv.checked,undefined);
  // the alerts: the CEO's planned sale (material) as important; a VP's $151K sale of a holding as an update; the award never
  const P=pulseUpdate(s,null,{now}).doc.items, a1=P.find(x=>x.k==='ins:0001-26-1'), a2=P.find(x=>x.k==='ins:0002-26-1'), a3=P.find(x=>x.k==='ins:0001-26-2');
  assert.ok(a1&&a1.lv==='imp'&&a1.kind==='insider'&&a1.ins.plan===true&&/Huang/.test(a1.title),JSON.stringify(a1&&[a1.lv,a1.title])); assert.match(a1.what,/מכירה בשוק של 120,000 מניות בשווי \$21,900,000, בתוכנית מסחר מתוכננת/); assert.equal(a1.cert,'fact');
  assert.ok(a2&&a2.lv==='upd',JSON.stringify(a2&&a2.lv)); assert.equal(a3,undefined,'pay mechanics never alert');
  // the partner: MSFT's only, and only as the holder of it
  const PP=pulseUpdate(s,u,{now}).doc.items; assert.ok(PP.some(x=>x.k==='ins:0002-26-1')); assert.ok(!PP.some(x=>x.k==='ins:0001-26-1'));
});

test('1.11 anomalies: the figures\' changes between research runs are kept on the company (rating, target 7%, growth and margins 5 points, forward multiple 15%), never a change within the noise',async()=>{
  const {figChanges}=await import('../server/research.js');
  const old={rating:'Buy',target:200,revg:20,pm:30,epsg:12,fpe:30}, at='2026-11-01T00:00:00Z';
  assert.deepEqual(figChanges(old,{...old},at),[]);
  assert.deepEqual(figChanges(old,{...old,target:210},at),[],'5% is noise');
  const c=figChanges(old,{rating:'Hold',target:220,revg:14,pm:31,epsg:30,fpe:36},at); assert.deepEqual(c.map(x=>x.f),['rating','target','revg','epsg','fpe']); assert.deepEqual(c[1],{at,f:'target',from:200,to:220});
  assert.deepEqual(figChanges(old,{...old,target:null},at),[],'a missing figure is not a change'); assert.deepEqual(figChanges(null,old,at),[]);
});

test('1.11 dividends: the plan keeps the last paid ones (for a raise or a cut) and says when the rhythm broke',async()=>{
  const {divPlan}=await import('../server/divs.js'); const now=new Date('2026-11-01T00:00:00Z'), d=k=>new Date(now.getTime()+k*864e5).toISOString().slice(0,10);
  const H=[{ex:d(-80),pay:d(-65),amt:0.51},{ex:d(-171),pay:d(-156),amt:0.51},{ex:d(-262),pay:d(-247),amt:0.485},{ex:d(-353),pay:d(-338),amt:0.485}];
  const p=divPlan(H,{now}); assert.equal(p.freq,'quarterly'); assert.equal(p.stopped,false); assert.deepEqual(p.hist.map(x=>x.amt),[0.51,0.51,0.485,0.485]); assert.ok(p.next.length>=1&&p.next[0].est,'the next by rhythm, estimated');
  const q=divPlan(H.map((x,i)=>({...x,ex:d(-280-91*i),pay:d(-265-91*i)})),{now}); assert.equal(q.stopped,true,'well over the rhythm: stopped'); assert.equal(q.next.length,0,'a stopped one is not projected');
});

test('1.11 the readings: an answer cut short by the token budget is used up to the last whole article; a longer budget per article',async()=>{
  const {salvageArray,analyzeBatch}=await import('../server/newsx.js');
  const whole=JSON.stringify([{i:0,he:'א',what:'ב'},{i:1,he:'ג',what:'ד'}]); assert.equal(salvageArray('הנה:\n'+whole).length,2);
  const cut='[{"i":0,"he":"א","what":"ב","aff":[{"sym":"X","why":"a } b"}]},{"i":1,"he":"ג","what":"ד","unknown":"בלי סו'; const a=salvageArray(cut); assert.equal(a.length,1); assert.equal(a[0].aff[0].why,'a } b');
  assert.equal(salvageArray('no json here'),null); assert.equal(salvageArray('[{"i":0,"he":'),null);
  const calls=[]; const f=async(u,o)=>{calls.push(JSON.parse(o.body)); return new Response(JSON.stringify({content:[{type:'text',text:'[{"i":0,"he":"כותרת","what":"מה קרה","type":"company","level":"info","dir":"unclear","cert":"fact"},{"i":1,"he":"כותרת 2","what":"מה'}],stop_reason:'max_tokens'}),{status:200})};
  process.env.ANTHROPIC_API_KEY='sk-test'; const got=await analyzeBatch([{title:'a',link:'https://x/1'},{title:'b',link:'https://x/2'}],{fetch:f}); delete process.env.ANTHROPIC_API_KEY;
  assert.ok(got&&got[0]&&got[0].he==='כותרת','the whole article is kept'); assert.equal(got[1],undefined,'the cut one is not'); assert.equal(calls[0].max_tokens,1400*2+800);
});

test('1.11 alerts: articles read by the rules about the same company on the same day are one event, not one alert each',async()=>{
  const {newsId,ruleRead}=await import('../server/newsx.js'); const {eventsOf,pulseUpdate}=await import('../server/pulse.js');
  const s=new Store(':memory:'), now=new Date(), iso=k=>new Date(now.getTime()-k*3600e3).toISOString();
  s.setDoc('portfolio/main',{positions:[{sym:'META',qty:1,ccy:'USD'}]},{silent:true}); s.setDoc('quotes/latest',{prices:{META:600},usdIls:3.7,updatedAt:now.toISOString()},{silent:true});
  const A=[1,2,3].map(i=>({title:'Meta news '+i,pub:'Yahoo',link:'https://x/meta'+i,at:iso(i),syms:['META'],seen:iso(i)}));
  s.setDoc('research/news',{items:A,updatedAt:iso(0)},{silent:true}); s.setDoc('research/newsx',{by:Object.fromEntries(A.map(a=>[newsId(a.link),{...ruleRead(a),at:iso(0)}])),gen:[],updatedAt:iso(0)},{silent:true});
  const E=eventsOf(s,{now}); assert.equal(E.length,1,'one event for the day'); assert.equal(E[0].arts.length,3); assert.match(E[0].k,/^rd:META:/);
  const P=pulseUpdate(s,null,{now}).doc.items.filter(a=>a.holds.some(h=>h.sym==='META')); assert.equal(P.length,1,'one alert, three sources'); assert.equal(P[0].n,3);
});

test('5.11 while Yahoo refuses the server its company data, it is not asked again for three days; then one try; an answer clears the pause',async()=>{
  const {researchTask}=await import('../server/research.js'); const s=new Store(':memory:');
  s.setDoc('portfolio/main',{positions:[{sym:'NVDA'}]}); s.setDoc('research/universe',{keys:['NVDA','KO']});
  const off=fakeYahoo({crumbFail:true}), noKeys={noFh:true,secDates:null,divs:null,nq:null,fm:null,fill:async()=>null,explain:async()=>null,mail:async()=>true,pause:0};
  let st=await researchTask(s,{...noKeys,fetch:off.f,now:new Date('2026-11-05T23:15:00Z')});
  assert.equal(st.stopped,'session'); assert.ok(st.yhPause,'paused'); assert.ok(off.seen.some(u=>u.includes('getcrumb')));
  const n0=off.seen.filter(u=>/yahoo\.com/.test(u)).length;
  st=await researchTask(s,{...noKeys,fetch:off.f,now:new Date('2026-11-06T23:15:00Z')});
  assert.equal(st.stopped,'paused'); assert.equal(off.seen.filter(u=>/getcrumb|quoteSummary/.test(u)).length,off.seen.slice(0,n0).filter(u=>/getcrumb|quoteSummary/.test(u)).length,'not asked the next night');
  // after three days: one try, and Yahoo answering clears the pause
  const on=fakeYahoo(); st=await researchTask(s,{...noKeys,fetch:on.f,now:new Date('2026-11-09T23:15:00Z')});
  assert.ok(on.seen.some(u=>u.includes('getcrumb')),'asked again after the pause'); assert.ok(st.ok>0); assert.equal(st.yhPause,null); assert.equal(s.getMeta('yhCoPause'),'null');
});

test('5.11 the background figures once in a quarter of an hour: a run between asks the holdings and the index a held fund is carried by, not the other indices, futures and markets',async()=>{
  const asked=[]; const f=async u=>{u=String(u); asked.push(u); const t=decodeURIComponent((u.match(/chart\/([^?]+)/)||[])[1]||'');
    const meta={regularMarketPrice:100,chartPreviousClose:99,currency:'USD',exchangeName:'X',regularMarketTime:Math.floor(Date.now()/1000),gmtoffset:0};
    return new Response(JSON.stringify({chart:{result:[{meta,timestamp:[Math.floor(Date.now()/1000)-86400,Math.floor(Date.now()/1000)],indicators:{quote:[{close:[99,100]}]}}]}}),{headers:{'content-type':'application/json'}})};
  const between=await fetchAll(['MSFT'],{fetch:f,ctx:false}); const yq=asked.map(u=>decodeURIComponent((u.match(/chart\/([^?]+)/)||[])[1]||'')).filter(Boolean);
  assert.ok(yq.includes('MSFT'),'the holding'); assert.ok(!yq.includes('^GSPC')&&!yq.includes('GC=F')&&!yq.includes('BTC-USD')&&!yq.includes('ES=F'),'no background between: '+yq.join(','));
  assert.deepEqual(between.mkts,{});
  asked.length=0; const full=await fetchAll(['MSFT'],{fetch:f,ctx:true}); const yq2=asked.map(u=>decodeURIComponent((u.match(/chart\/([^?]+)/)||[])[1]||'')).filter(Boolean);
  assert.ok(yq2.includes('^GSPC')&&yq2.includes('GC=F'),'the quarter-hour run asks them'); assert.ok(Object.keys(full.mkts).length>0);
});

test('5.11 off Yahoo: a share\'s history from one Stooq request (a year by day with volumes, five years by week, every month), and Yahoo\'s news asked at most once in 12 hours when Finnhub has nothing',async()=>{
  const {stooqHistParse}=await import('../shared/quotes.js');
  const days=[]; const t0=Date.parse('2019-01-01T12:00:00Z'); for(let i=0;i<2600;i++){const d=new Date(t0+i*864e5); if(d.getUTCDay()%6===0)continue; days.push(d.toISOString().slice(0,10))}
  const csv='Date,Open,High,Low,Close,Volume\n'+days.map((d,i)=>`${d},1,1,1,${(100+i/10).toFixed(2)},${1000+i}`).join('\n');
  const h=stooqHistParse(csv,{now:new Date('2026-02-10T00:00:00Z')});
  assert.equal(h.d.length,260); assert.equal(h.d.at(-1),days.at(-1)); assert.equal(h.v.length,260); assert.equal(h.v.at(-1),1000+days.length-1);
  assert.ok(h.w.d.length>=250&&h.w.d.length<=262,'about five years of weeks: '+h.w.d.length); assert.ok(h.w.d[0]>='2021-02','five years back');
  assert.equal(h.m.d[0].slice(0,7),'2019-01'); assert.equal(h.m.d.at(-1),days.at(-1),'each month by its last close');
  assert.throws(()=>stooqHistParse('Date,Open\n'),/no rows/);
  // the news: Finnhub with nothing → Yahoo once, then not again for 12 hours
  const {newsFor}=await import('../server/research.js'); const was=process.env.FINNHUB_API_KEY; process.env.FINNHUB_API_KEY='k';
  try{const asked=[]; const f=async u=>{u=String(u); asked.push(u); return u.includes('finnhub')?new Response('[]',{headers:{'content-type':'application/json'}}):new Response(JSON.stringify({news:[{title:'x',publisher:'p',link:'https://a.b/c',providerPublishTime:1}]}),{headers:{'content-type':'application/json'}})};
    const now=new Date('2026-11-05T10:00:00Z');
    await newsFor('VOOX',{fetch:f,now}); await newsFor('VOOX',{fetch:f,now:new Date(now.getTime()+3600e3)});
    assert.equal(asked.filter(u=>u.includes('yahoo')).length,1,'Yahoo once in 12 hours');
    await newsFor('VOOX',{fetch:f,now:new Date(now.getTime()+13*3600e3)}); assert.equal(asked.filter(u=>u.includes('yahoo')).length,2,'and again after them')}
  finally{if(was==null)delete process.env.FINNHUB_API_KEY; else process.env.FINNHUB_API_KEY=was}
});

test('6.11 the readings\' facts: the names as written in Hebrew, no price move in percent from an article (the site has its own), business numbers kept; the phone gets a summary',async()=>{
  const {factFix}=await import('../server/newsx.js'), {pushBody}=await import('../server/livealert.js');
  assert.equal(factFix('מדד נאסד"ק ירד בכ-4.7%, ונווידיה, מיקרון ו-AMD ירדו בחדות אחרי בחירות הביניים.'),'מדד נאסד"ק ירד, ואנבידיה, מיקרון ו-AMD ירדו בחדות אחרי בחירות הביניים.');
  assert.equal(factFix('מניית רדוויר ירדה בכ-21 אחוזים אחרי שההכנסות פספסו את הציפיות.'),'מניית רדוויר ירדה אחרי שההכנסות פספסו את הציפיות.');
  assert.equal(factFix('AMD ירדה 17.3% במסחר'),'AMD ירדה במסחר'); assert.equal(factFix('מניות השבבים רשמו ירידה חדה של 10% השבוע'),'מניות השבבים רשמו ירידה חדה השבוע');
  for(const t of ['ההכנסות עלו ב-12% ל-109 מיליון דולר','האינפלציה עלתה ב-0.3%','CPI עלה ב-0.3% בספטמבר','דאו ג׳ונס צנח ב-1,833 נקודות'])assert.equal(factFix(t),t,'not a price move: '+t);
  const mk=(k,d)=>({key:`move:${k}:down`,sym:k,d,move:5,text:`${k} ירדה היום`});
  const b=pushBody([mk('SOXX',-12.1),mk('DRAM',-18),mk('MU',-17.5),mk('RKLB',-12.2),mk('RDW',-19.8)]);
  assert.equal(b,'5 ניירות ירדו היום ביותר מ-5%: RDW −19.8%, DRAM −18.0%, MU −17.5% ועוד 2.\nהרשימה המלאה באתר.');
  assert.equal(pushBody([mk('SOXX',-12.1)]),'SOXX ירדה היום','one item as it is');
});

test('6.11 share splits: found from the prices (the kept close against the source\'s adjusted previous close, a clean ratio) and from the saved days against the series; applied once to the units of a statement older than the split, the saved daily prices and the price alerts, for the owner and a partner; a later statement is kept',async()=>{
  const {splitFromQuote,splitRatio,applySplits,reconcileSplits,splitFromSeries}=await import('../shared/splits.js');
  const old={prices:{SOXX:450.42,NVDA:200},meta:{SOXX:{src:'yahoo',date:'2026-11-04'},NVDA:{src:'yahoo',date:'2026-11-04'}}};
  assert.deepEqual(splitFromQuote('SOXX',old,{px:131.9,prev:150.14,closeDate:'2026-11-05',src:'yahoo',ccy:'USD'}),{d:'2026-11-05',r:3,ref:450.42,prev:150.14});
  assert.equal(splitFromQuote('NVDA',old,{px:181.5,prev:200,closeDate:'2026-11-05',src:'yahoo',ccy:'USD'}),null,'a big day is not a split');
  assert.equal(splitFromQuote('SOXX',old,{px:150.14,prev:152,closeDate:'2026-11-04',src:'yahoo',ccy:'USD'}).d,'2026-11-05','an adjusted price before the open: the split is the next trading day');
  assert.equal(splitFromQuote('SOXX',{...old,meta:{SOXX:{src:'maya',date:'2026-11-04'}}},{px:131.9,prev:150.14,closeDate:'2026-11-05',src:'yahoo'}),null,'not a fund priced by Maya');
  assert.equal(splitRatio(1.37),null); assert.equal(splitRatio(2.97),3); assert.equal(splitRatio(0.1003),0.1); assert.equal(splitRatio(1.1),null);
  const doc=buildQuotesDoc({prev:old,fetched:{quotes:{SOXX:{px:131.9,prev:150.14,closeDate:'2026-11-05',src:'yahoo',ccy:'USD'}},index:{},errors:[]},symbols:['SOXX'],now:new Date('2026-11-05T20:00:00Z')});
  assert.equal(doc.splits.SOXX.r,3); assert.equal(doc.prices.SOXX,131.9);
  // applied: the owner's statement is from before the split, the partner's from after it
  const s=new Store(':memory:'); s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}); const f=s.addUser({email:'f@example.com',password:'friend-pass-1',role:'friend'});
  s.setDoc('portfolio/main',{asOf:{exc:'2026-10-31'},positions:[{sym:'SOXX',qty:10,acct:'exc',ccy:'USD',costUsd:4000,px:400},{sym:'NVDA',qty:5,acct:'exc',ccy:'USD'}]});
  s.setDoc('history/daily',{points:{'2026-11-04':{v:1,px:{SOXX:450.42,NVDA:200}},'2026-11-05':{v:1,px:{SOXX:131.9,NVDA:181.5}}}});
  s.setDoc('settings/main',{pxAlerts:{SOXX:{below:400,above:500}}});
  s.setDoc(`data/users/${f.id}/portfolio`,{asOf:{blink:'2026-11-06'},positions:[{sym:'SOXX',qty:30,acct:'blink',ccy:'USD'}]});
  const sp={SOXX:{d:'2026-11-05',r:3}}; const r=applySplits(s,sp,{now:new Date('2026-11-05T20:00:00Z')});
  const P=s.getDoc('portfolio/main').data; assert.equal(P.positions[0].qty,30); assert.equal(P.positions[0].costUsd,4000,'the cost stays'); assert.ok(Math.abs(P.positions[0].px-133.333333)<1e-5); assert.equal(P.positions[1].qty,5);
  assert.deepEqual(P.splits['SOXX:2026-11-05'].rows,[{acct:'exc',q0:10,q1:30}]);
  const D=s.getDoc('history/daily').data.points; assert.ok(Math.abs(D['2026-11-04'].px.SOXX-150.14)<1e-6); assert.equal(D['2026-11-05'].px.SOXX,131.9); assert.equal(D['2026-11-04'].px.NVDA,200);
  assert.deepEqual(s.getDoc('settings/main').data.pxAlerts.SOXX,{below:133.33,above:166.67});
  const FP=s.getDoc(`data/users/${f.id}/portfolio`).data; assert.equal(FP.positions[0].qty,30,'a statement after the split is kept'); assert.equal(FP.splits['SOXX:2026-11-05'].rows[0].kept,true);
  assert.equal(r.length,2); assert.equal(applySplits(s,sp).length,0,'once'); assert.equal(s.getDoc('portfolio/main').data.positions[0].qty,30);
  // a split the live prices missed (SOXX, before this check): the saved days in the old units against the adjusted series
  const ser={d:['2026-10-30','2026-11-02','2026-11-03','2026-11-04','2026-11-05'],c:[153.33,151.67,150.67,150.14,131.9]};
  assert.deepEqual(splitFromSeries('SOXX',{'2026-11-03':{px:{SOXX:452}},'2026-11-04':{px:{SOXX:450.42}},'2026-11-05':{px:{SOXX:131.9}}},ser),{d:'2026-11-05',r:3,ref:450.42,prev:150.14,src:'series'});
  assert.equal(splitFromSeries('SOXX',{'2026-11-04':{px:{SOXX:150.3}}},ser),null);
  const s2=new Store(':memory:'); s2.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'});
  s2.setDoc('quotes/latest',{prices:{SOXX:131.9},meta:{SOXX:{src:'yahoo',date:'2026-11-05'}}}); s2.setDoc('quotes/c_SOXX',{d:ser.d,c:ser.c});
  s2.setDoc('portfolio/main',{asOf:{exc:'2026-10-31'},positions:[{sym:'SOXX',qty:10,acct:'exc',ccy:'USD'}]});
  s2.setDoc('history/daily',{points:{'2026-11-03':{px:{SOXX:452}},'2026-11-04':{px:{SOXX:450.42}}}});
  reconcileSplits(s2,{now:new Date('2026-11-06T08:00:00Z')}); assert.equal(s2.getDoc('portfolio/main').data.positions[0].qty,30); assert.equal(s2.getDoc('quotes/latest').data.splits.SOXX.r,3);
  reconcileSplits(s2,{now:new Date('2026-11-06T09:00:00Z')}); assert.equal(s2.getDoc('portfolio/main').data.positions[0].qty,30,'not twice');
});

test('6.11 a split found late is not applied to units fixed by hand since: with a known cost, only when it brings the cost of a unit nearer to the price',async()=>{
  const {splitPortfolio}=await import('../shared/splits.js');
  const sp={d:'2026-11-05',r:3}, P=q=>({asOf:{exc:'2026-10-31'},positions:[{sym:'SOXX',qty:q,acct:'exc',ccy:'USD',costUsd:4000}]});
  assert.equal(splitPortfolio(P(10),'SOXX',sp,new Date(),{late:true,px:131.9}).P.positions[0].qty,30,'bought at $400 a unit: the split brings it to $133');
  const k=splitPortfolio(P(30),'SOXX',sp,new Date(),{late:true,px:131.9}); assert.equal(k.P.positions[0].qty,30,'already 30 by hand: kept'); assert.equal(k.rows[0].why,'cost');
  assert.equal(splitPortfolio(P(30),'SOXX',sp,new Date(),{late:false,px:131.9}).P.positions[0].qty,90,'found on the day: the statement date decides');
  assert.equal(splitPortfolio({...P(10),positions:[{...P(10).positions[0],qAt:'2026-11-06'}]},'SOXX',sp).P.positions[0].qty,10,'units written by hand after the split are kept');
});

test('6.11 one split is one event: found by two days (the announced one and the saved days) it is applied once; a split applied twice is undone back to its first application, and the saved days divided twice are put back',async()=>{
  const {applySplits,reconcileSplits,splitDaily,splitRepairP}=await import('../shared/splits.js');
  const s=new Store(':memory:'); s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'});
  s.setDoc('quotes/latest',{prices:{SOXX:131.9},meta:{SOXX:{src:'yahoo',date:'2026-11-05'}}});
  s.setDoc('portfolio/main',{asOf:{exc:'2026-10-31'},positions:[{sym:'SOXX',qty:3,acct:'exc',ccy:'USD'}]});
  s.setDoc('history/daily',{points:{'2026-11-03':{px:{SOXX:452}},'2026-11-04':{px:{SOXX:450.42}},'2026-11-05':{px:{SOXX:131.9}}}});
  applySplits(s,{SOXX:{d:'2026-11-06',r:3}},{now:new Date('2026-11-06T07:00:00Z')});   // found by the saved days, a day late
  applySplits(s,{SOXX:{d:'2026-11-05',r:3}},{now:new Date('2026-11-06T07:10:00Z')});   // the announced day: the same split
  assert.equal(s.getDoc('portfolio/main').data.positions[0].qty,9,'once');
  const D=s.getDoc('history/daily').data.points; assert.ok(Math.abs(D['2026-11-04'].px.SOXX-150.14)<1e-6); assert.equal(D['2026-11-05'].px.SOXX,131.9);
  // a portfolio where it was applied twice (before): the later is undone; the saved days divided twice are put back
  const P2={asOf:{exc:'2026-10-31'},positions:[{sym:'SOXX',qty:27,acct:'exc',ccy:'USD'}],splits:{'SOXX:2026-11-06':{sym:'SOXX',d:'2026-11-06',r:3,at:'2026-11-06T07:00:00Z',rows:[{acct:'exc',q0:3,q1:9}]},'SOXX:2026-11-05':{sym:'SOXX',d:'2026-11-05',r:3,at:'2026-11-06T07:10:00Z',rows:[{acct:'exc',q0:9,q1:27}]}}};
  const r=splitRepairP(P2); assert.equal(r.P.positions[0].qty,9); assert.deepEqual(r.fixed,['SOXX:2026-11-05']); assert.equal(r.P.splits['SOXX:2026-11-05'].why,'double');
  const d2=splitDaily({points:{'2026-11-03':{px:{SOXX:452/9}},'2026-11-04':{px:{SOXX:450.42/9}},'2026-11-05':{px:{SOXX:131.9}}}},'SOXX',{d:'2026-11-05',r:3});
  assert.ok(Math.abs(d2.D.points['2026-11-04'].px.SOXX-150.14)<1e-4&&Math.abs(d2.D.points['2026-11-03'].px.SOXX-150.667)<1e-3,'divided twice: put back once');
  assert.equal(splitDaily(d2.D,'SOXX',{d:'2026-11-05',r:3}),null,'right: nothing to change');
  // through the catch-up check: the repair, then nothing applied again
  s.setDoc('portfolio/main',P2); reconcileSplits(s,{now:new Date('2026-11-06T09:00:00Z')}); assert.equal(s.getDoc('portfolio/main').data.positions[0].qty,9);
  reconcileSplits(s,{now:new Date('2026-11-06T10:00:00Z')}); assert.equal(s.getDoc('portfolio/main').data.positions[0].qty,9,'stays');
});

test('6.11 a big day is one alert, on its own trading day: the US close of 5.11 seen on the morning of 6.11 says "ב-5.11", keeps its key, and is not sent again',async()=>{
  const {liveHits,liveTask}=await import('../server/livealert.js'), {mktAlerts}=await import('../server/pulse.js');
  const s=new Store(':memory:'); s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'});
  s.setDoc('portfolio/main',{positions:[{sym:'SOXX',qty:30,acct:'exc',ccy:'USD'}]});
  s.setDoc('quotes/latest',{prices:{SOXX:131.9},prev:{SOXX:150.14},meta:{SOXX:{src:'yahoo',date:'2026-11-05'}},usdIls:3.2,updatedAt:'2026-11-06T07:00:00Z'});
  const H=liveHits(s,{now:new Date('2026-11-06T07:05:00Z')}); assert.equal(H[0].key,'move:SOXX:2026-11-05:down'); assert.match(H[0].text,/^SOXX ירדה ב-5\.11 −12\.1%/);
  const A=mktAlerts(s,s.getDoc('portfolio/main').data,{},s.getDoc('quotes/latest').data,{pos:[{sym:'SOXX',w:13.1}]},new Date('2026-11-06T07:05:00Z'));
  assert.equal(A[0].k,'mv:SOXX:2026-11-05:d'); assert.equal(A[0].title,'SOXX ירדה ב-5.11 −12.1%'); assert.equal(A[0].occ,'2026-11-05');
  // yesterday's list had it: today it is not sent again
  s.setDoc('alerts/live',{date:'2026-11-05',sent:['move:SOXX:2026-11-05:down'],lastAt:'2026-11-05T21:00:00Z'},{silent:true});
  const sent=[]; await liveTask(s,{now:new Date('2026-11-06T07:05:00Z'),send:async(...a)=>{sent.push(a)},push:async()=>{}});
  assert.equal(sent.length,0,'not again'); assert.deepEqual(s.getDoc('alerts/live').data.sent,['move:SOXX:2026-11-05:down']);
});

test('8.11 the nightly consistency check: the same figure by every path, a gap is a finding; a partner\'s row carries kinds and counts only, and the owner\'s details reach the owner alone', async()=>{
  const {consistDocs,consistPage,consistTask,consistView,KIND_HE}=await import('../server/consist.js');
  const Q={updatedAt:'2026-11-06T21:00:00Z',usdIls:3.2,usDate:'2026-11-06',prices:{SOXX:131.9,NVDA:181.5,OLD:10},prev:{SOXX:130,NVDA:200,OLD:10},
    meta:{SOXX:{ccy:'USD',date:'2026-11-06'},NVDA:{ccy:'USD',date:'2026-11-06'},OLD:{ccy:'USD',date:'2026-10-20'}},splits:{SOXX:{d:'2026-11-05',r:3,conf:'fmp'},NVDA:{d:'2026-11-04',r:10,conf:'nofmp'}}};
  // the owner: a split applied (units follow the record), a stale price, a security without a price, a negative cash row,
  // and a saved day whose value jumped with no price to explain it
  const P={asOf:{exc:'2026-10-31'},positions:[{sym:'SOXX',qty:30,acct:'exc',ccy:'USD'},{sym:'OLD',qty:1,acct:'exc',ccy:'USD'},{sym:'GONE',qty:2,acct:'exc',ccy:'USD'},{sym:'NVDA',qty:5,acct:'exc',ccy:'USD'}],
    cash:[{acct:'exc',ccy:'ILS',amount:-50}],splits:{'SOXX:2026-11-05':{sym:'SOXX',d:'2026-11-05',r:3,at:'2026-11-06T06:00:00Z',rows:[{acct:'exc',q0:10,q1:30}]}}};
  const DY={points:{'2026-11-03':{v:10000,dep:9000,px:{SOXX:450,NVDA:200}},'2026-11-04':{v:30000,dep:9000,px:{SOXX:450,NVDA:200}},'2026-11-06':{v:12000,dep:9000,px:{SOXX:131.9,NVDA:181.5}}}};
  const docs={'portfolio/main':P,'quotes/latest':Q,'history/daily':DY};
  const F=consistDocs(docs,{now:new Date('2026-11-07T00:30:00Z')}), kinds=F.map(x=>x.k).sort();
  assert.deepEqual(kinds,['dailyJump','negCash','noPrice','splitDaily','stalePrice'],JSON.stringify(F));
  assert.ok(F.find(x=>x.k==='noPrice').t.includes('GONE')); assert.ok(F.find(x=>x.k==='stalePrice').t.includes('OLD'));
  assert.ok(F.find(x=>x.k==='dailyJump').t.includes('200%'),'10,000 → 30,000 while the prices stood');
  assert.ok(!kinds.includes('splitMissing'),'SOXX has its record, NVDA\'s was refused by FMP');
  // the units drifted from the record with no newer statement or hand edit: a finding; a hand edit after it: none
  const P2=JSON.parse(JSON.stringify(P)); P2.positions[0].qty=10;
  assert.ok(consistDocs({...docs,'portfolio/main':P2}).some(x=>x.k==='splitUnits'));
  P2.positions[0].qAt='2026-11-07'; assert.ok(!consistDocs({...docs,'portfolio/main':P2}).some(x=>x.k==='splitUnits'));
  // the split's record missing altogether while the prices found it
  const P3=JSON.parse(JSON.stringify(P)); delete P3.splits; assert.ok(consistDocs({...docs,'portfolio/main':P3}).some(x=>x.k==='splitMissing'));
  // the server's own holdings against the page's total: the same here (no savings pots), so no finding; a gap when it is not
  const P4=JSON.parse(JSON.stringify(P)); P4.positions=P4.positions.filter(x=>x.sym!=='GONE'); const docs4={...docs,'portfolio/main':P4};
  assert.ok(!consistDocs(docs4,{pageTotal:(30*131.9+1*10+5*181.5)*3.2-50}).some(x=>x.k==='pulseTotal'));
  assert.ok(consistDocs(docs4,{pageTotal:99999}).some(x=>x.k==='pulseTotal'));
  assert.ok(!consistDocs(docs,{pageTotal:99999}).some(x=>x.k==='pulseTotal'),'with a price missing the server has no total to compare');
  // the page's figures: all in agreement
  const ok={ready:true,total:15000,inv:14000,cash:1000,hasDay:true,dayIls:-320.4,dayPct:-2.1,accts:[{acct:'exc',total:9000,dayIls:-200.4,syms:['NVDA','SOXX']},{acct:'blink',total:6000,dayIls:-120,syms:['OLD']}],
    why:{total:-320.4,parts:-320.1},hero:{total:'₪15,000',day:'▼ ₪320',dayD:'−2.10% היום',hc:'ils'},pos:[{sym:'SOXX',qty:30,w:60,px:131.9,dayPct:1.46},{sym:'NVDA',qty:5,w:30,px:181.5,dayPct:-9.25}],
    pulse:[{k:'mv:NVDA:2026-11-06:d',sym:'NVDA',w:30.2,pct:-9.25,to:181.5}]};
  assert.deepEqual(consistPage(ok),[]);
  // each path disagreeing in turn
  assert.equal(consistPage({...ok,accts:[{...ok.accts[0],total:9500},ok.accts[1]]}).map(x=>x.k).join(),'totalAccounts');
  assert.equal(consistPage({...ok,accts:[{...ok.accts[0],dayIls:-150},ok.accts[1]]}).map(x=>x.k).join(),'dayAccounts');
  assert.ok(consistPage({...ok,accts:[ok.accts[0],{...ok.accts[1],total:9000,dayIls:-200.4}]}).some(x=>x.k==='acctsSame'),'two accounts with different holdings showing one value');
  assert.equal(consistPage({...ok,why:{total:-320.4,parts:-250}}).map(x=>x.k).join(),'dayWhy');
  assert.equal(consistPage({...ok,hero:{...ok.hero,total:'₪15,900'}}).map(x=>x.k).join(),'heroTotal');
  assert.equal(consistPage({...ok,hero:{...ok.hero,day:'▲ ₪1,320'}}).map(x=>x.k).join(),'heroDay');
  assert.equal(consistPage({...ok,pulse:[{...ok.pulse[0],pct:-12.1}]}).map(x=>x.k).join(),'pulsePct');
  assert.equal(consistPage({...ok,pulse:[{...ok.pulse[0],w:35}]}).map(x=>x.k).join(),'pulseW');
  assert.deepEqual(consistPage({...ok,pulse:[{...ok.pulse[0],pct:-12.1,to:170}]}),[],'an alert made on another price is not compared');
  assert.equal(consistPage({ready:false,err:'x'})[0].k,'page');
  // the task: the owner in full, the partner stripped; the view strips the owner's too for an admin
  const s=new Store(':memory:'); const o=s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}), f=s.addUser({email:'f@example.com',password:'friend-pass-1',role:'friend'}), a=s.addUser({email:'a@example.com',password:'admin-pass-12',role:'admin'});
  s.setDoc('portfolio/main',P); s.setDoc('quotes/latest',Q); s.setDoc('history/daily',DY);
  s.setDoc(`data/users/${f.id}/portfolio`,{asOf:{exc:'2026-11-06'},positions:[{sym:'SOXX',qty:3,acct:'exc',ccy:'USD'},{sym:'GONE',qty:1,acct:'exc',ccy:'USD'}]});
  const log=[]; const D=await consistTask(s,{log:m=>log.push(m),now:new Date('2026-11-07T00:30:00Z'),page:async(docs,user)=>({out:{...ok,total:user.owner?15000:1000,pos:[]},errs:[]})});
  assert.equal(D.runs.length,2); const own=D.runs.find(r=>r.owner), fr=D.runs.find(r=>!r.owner);
  assert.ok(own.items.some(x=>x.k==='noPrice'&&x.t.includes('GONE')),'the owner\'s row names the security');
  assert.ok(fr.items.some(x=>x.k==='noPrice'||x.k==='splitMissing'),JSON.stringify(fr.items)); assert.ok(fr.items.every(x=>!x.sym&&x.t===KIND_HE[x.k]&&!/GONE|SOXX/.test(x.t)),'a partner\'s row: kinds only');
  assert.equal(fr.total,undefined);
  assert.ok(consistView(s,{role:'owner'}).runs.find(r=>r.owner).items.some(x=>/GONE/.test(x.t)));
  assert.ok(consistView(s,{role:'admin'}).runs.find(r=>r.owner).items.every(x=>!/GONE/.test(x.t)&&!x.sym),'an admin sees the owner\'s kinds only');
  assert.ok(s.getDoc('system/consist').exists); assert.ok(log.some(m=>/consistency: 2 portfolio/.test(m)),log.join('\n'));
});

test('8.11 the pressure gauge: facts as signals with their numbers, four levels, the base rate, a record kept forward with hits, false alarms and misses; the owner\'s alone', async()=>{
  const {signalsOf,scoreOf,levelOf,baseRate,backtest,poolBacktests,similarOf,pressureBuild,trackUpdate,pressureTask,pressureSection,PRESS_DOC,TRACK_DOC}=await import('../server/pressure.js');
  const now=new Date('2026-11-06T16:00:00Z'), day=i=>new Date(Date.UTC(2026,0,5)+i*864e5).toISOString().slice(0,10);
  // a year of closes: flat at 100, then a slide to 70 over the last 30 days; volumes flat, the last day triple
  const d=[], c=[], v=[]; for(let i=0;i<300;i++){const dt=new Date(Date.UTC(2026,0,5)+i*864e5); if([0,6].includes(dt.getUTCDay()))continue; d.push(dt.toISOString().slice(0,10)); const k=d.length; c.push(k<=180?100:k<=200?100-(k-180)*1.5:70); v.push(1e6)}
  v[v.length-1]=3.2e6; c[c.length-1]=66; c[c.length-2]=67; c[c.length-3]=68; c[c.length-4]=69;
  const series={d,c,v,source:'Stooq',updatedAt:now.toISOString()};
  const Q={updatedAt:now.toISOString(),usDate:'2026-11-06',prices:{ACME:66,PEER:90,PEERB:88},prev:{ACME:72,PEER:95,PEERB:93},meta:{ACME:{date:'2026-11-06',ccy:'USD'},PEER:{date:'2026-11-06'},PEERB:{date:'2026-11-06'}}};
  const company={rep:{q:'2026-09-30',label:'Q3 2026',eps:{a:0.8,e:1.0,s:-20},at:'2026-11-03',src:'Finnhub'},next:'2027-02-02',recHist:[{p:'2026-10',sb:5,b:10,h:5,s:0,ss:0},{p:'2026-11',sb:3,b:7,h:6,s:3,ss:1}],gradesL:[{d:'2026-11-04',firm:'A',act:'downgrade'},{d:'2026-10-20',firm:'B',act:'downgrade'}]};
  const insiders=[{kind:'sell',deliberate:true,plan:false,top:true,value:400000,owner:'CEO',txDate:'2026-10-28',filedAt:'2026-10-30T00:00:00Z'},{kind:'sell',deliberate:true,plan:true,value:9e6,owner:'CFO',txDate:'2026-10-28',filedAt:'2026-10-30T00:00:00Z'}];
  const news=[{id:'a1',syms:['ACME'],at:'2026-11-06T10:00:00Z',title:'ACME recalls product after probe',pub:'Reuters'},{id:'a2',syms:['ACME'],at:'2026-11-05T20:00:00Z',title:'x'},{id:'a3',syms:['ACME'],at:'2026-11-05T12:00:00Z',title:'y'},{id:'a4',syms:['ACME'],at:'2026-10-31T12:00:00Z',title:'old'}];
  const readings={a1:{dir:'neg',level:'crit'},a2:{dir:'neg',level:'imp'},a3:{dir:'neg',level:'imp'},a4:{dir:'pos',level:'imp'}};
  const comove={groups:[{name:'שבבים',syms:['ACME','PEER','PEERB']}]}, ecocal={items:[{cat:'rates',region:'us',d:'2026-11-07',name:'החלטת הריבית של הפד (FOMC)'}]};
  const S=signalsOf('ACME',{Q,series,company,insiders,news,readings,comove,ecocal,now}), K=S.map(s=>s.k).sort();
  assert.deepEqual(K,['analysts','downgrades','drawdown','insiders','macro','miss','move','news','newsCrit','sector','streak','trend','volume'].sort(),JSON.stringify(S.map(s=>[s.k,s.t])));
  // the volatility signal: a calm year, then ten wild days
  {const cj=c.map(()=>100); for(let i=1;i<=10;i++)cj[cj.length-i]=100+(i%2?6:-6); const Sj=signalsOf('ACME',{Q:{...Q,prices:{ACME:100},prev:{ACME:100}},series:{d,c:cj,source:'x'},company:{},now}); assert.ok(Sj.some(x=>x.k==='vol'),JSON.stringify(Sj.map(x=>x.k)))}
  const by=Object.fromEntries(S.map(s=>[s.k,s]));
  assert.match(by.move.t,/−8\.3%/); assert.equal(by.move.w,2); assert.match(by.volume.t,/פי 3\.2/); assert.match(by.drawdown.t,/−34\.0% מהשיא/); assert.match(by.miss.t,/החמצה של 20%/); assert.equal(by.miss.w,3,'a miss in the last ten days weighs most');
  assert.match(by.insiders.t,/נושא משרה בכיר/); assert.match(by.insiders.t,/\$400,000/,'the plan sale is not counted'); assert.match(by.newsCrit.t,/recalls product/); assert.match(by.news.t,/3 ידיעות שליליות/); assert.match(by.sector.t,/−5\.3%/);
  assert.match(by.analysts.t,/"מכירה" 0% → 20%/); assert.match(by.downgrades.t,/2 הורדות דירוג/); assert.match(by.streak.t,/4 ימי ירידה/);
  for(const s of S){assert.ok(s.src,'every signal names its source: '+s.k); assert.ok(!/תחזית|תקרוס|ימכור|למכור|לקנות/.test(s.t),'facts only: '+s.t)}
  const score=scoreOf(S); assert.ok(score>6,'score '+score); assert.equal(levelOf(score),3);
  assert.equal(levelOf(0),0); assert.equal(levelOf(2),1); assert.equal(levelOf(4),2); assert.equal(levelOf(6),2); assert.equal(levelOf(6.5),3);
  // a quiet security: nothing lit
  const quiet=signalsOf('PEER',{Q:{...Q,prices:{PEER:95},prev:{PEER:95}},series:{d,c:c.map(()=>100),v:v.map(()=>1e6),source:'x'},company:{},now}); assert.deepEqual(quiet,[]);
  // the base rate of the slide series: some days were followed by a 10% fall within 20 days
  const b=baseRate(series); assert.ok(b&&b.hit>0&&b.rate>0&&b.rate<100,JSON.stringify(b));
  assert.equal(baseRate({d,c:c.map(()=>100)}).hit,0,'a flat series never fell');
  // the run on a store, and the record: a warning today, its outcomes when the series grow, a miss with no warning
  const s=new Store(':memory:'); const o=s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}); s.addUser({email:'f@example.com',password:'friend-pass-1',role:'friend'});
  s.setDoc('portfolio/main',{positions:[{sym:'ACME',qty:10,acct:'exc',ccy:'USD'},{sym:'PEER',qty:1,acct:'exc',ccy:'USD'}]}); s.setDoc('quotes/latest',{...Q,usdIls:3.2,prices:{ACME:66,PEER:95,PEERB:88},prev:{ACME:72,PEER:95,PEERB:93}});   // PEER quiet
  s.setDoc('quotes/c_ACME',series); s.setDoc('quotes/c_PEER',{d,c:c.map(()=>100),source:'x'}); s.setDoc('research/latest',{companies:{ACME:company}}); s.setDoc('research/insiders',{by:{ACME:insiders}});
  s.setDoc('research/news',{items:news}); s.setDoc('research/newsx',{by:readings}); s.setDoc('research/comove',comove); s.setDoc('research/ecocal',ecocal); s.setDoc('watch/'+o.id,{syms:['PEERB']});
  // the backtest of the slide series: every day has a level, the falls are counted per level and per signal; pooled; "similar cases"
  const bt=backtest(series); assert.ok(bt&&bt.n>50,JSON.stringify(bt&&bt.n)); assert.equal(bt.byLevel.reduce((t,b)=>t+b.n,0),bt.n); assert.ok(bt.base>0&&bt.base<100);
  assert.ok(Object.keys(bt.bySignal).length>=2,'signals lit on some days: '+Object.keys(bt.bySignal)); assert.ok(bt.byLevel[0].n>0,'calm days exist');
  const pool=poolBacktests([bt,backtest({d,c:c.map(()=>100),v:v.map(()=>1e6)})]); assert.equal(pool.syms,2); assert.equal(pool.n,bt.n+backtest({d,c:c.map(()=>100)}).n); assert.ok(pool.base<bt.base,'the flat series dilutes the base');
  assert.deepEqual(similarOf(0,bt,pool).scope,'own'); assert.equal(similarOf(3,{byLevel:[{n:1},{n:1},{n:1},{n:3,rate:50}],base:5},pool),pool.byLevel[3].n>=20?similarOf(3,null,pool):null);
  assert.equal(similarOf(2,null,null),null);
  const pushes=[]; const log=[]; const Pd=await pressureTask(s,{now,log:m=>log.push(m),push:async(st,uid,msg)=>{pushes.push({uid,msg}); return 1}});
  assert.deepEqual(Object.keys(Pd.syms).sort(),['ACME','PEER','PEERB'],'held and followed'); assert.equal(Pd.syms.ACME.level,3); assert.equal(Pd.syms.PEER.level,1,'its group falls and the Fed is ahead: noted, not a warning'); assert.equal(Pd.high,2,'ACME and the followed PEERB (its own fall and its group)'); assert.ok(Pd.syms.ACME.base.rate>0);
  assert.ok(s.getDoc(PRESS_DOC).exists); let T=s.getDoc(TRACK_DOC).data; assert.equal(T.items.length,2); assert.deepEqual([T.items[0].sym,T.items[0].level,T.items[0].px0,T.items[0].out],['ACME',3,66,undefined]); assert.equal(T.stats.pending,2);
  assert.match(log[0],/pressure: 3 securities, 2 high: ACME חריג/); assert.match(log[0],/backtest: \d+ days of 2, base/);
  // the push: once, to the owner, for each rise to high, the two heaviest signals in it, no forecast wording
  assert.equal(pushes.length,2); assert.ok(pushes.every(p=>p.uid===o.id)); const pm=pushes.find(p=>/ACME/.test(p.msg.title)).msg; assert.match(pm.title,/מד לחץ: ACME עלה ל"חריג"/); assert.match(pm.body,/החמצה של 20%|ידיעה קריטית/); assert.match(pm.body,/לא תחזית/); assert.equal(pm.tag,'press:ACME');
  assert.equal(Pd.pushed.ACME,'2026-11-06'); assert.ok(Pd.syms.ACME.test,'the backtest rides with the security'); assert.deepEqual([Pd.syms.PEER.similar.scope,Pd.syms.PEER.similar.rate],['own',0],'the flat PEER: its own calm days, none fell'); assert.ok(Pd.syms.ACME.similar===null||Pd.syms.ACME.similar.n>=20,'a rate only on enough similar days'); assert.equal(Pd.syms.ACME.seriesLevel,levelOf(scoreOf(Pd.syms.ACME.signals.filter(x=>['move','volume','drawdown','trend','vol','streak','leap'].includes(x.k)))));
  // the portfolio as a whole: the weight in the high levels, the heaviest holding, the calendar ahead
  const PV=Pd.portfolio; assert.ok(PV&&PV.wOk,JSON.stringify(PV)); assert.equal(PV.high.length,1); assert.equal(PV.high[0].sym,'ACME'); assert.ok(PV.wHigh>80,'ACME is most of the portfolio: '+PV.wHigh); assert.equal(PV.top.sym,'ACME'); assert.ok(PV.cal.some(e=>e.kind==='macro'&&/FOMC/.test(e.name)));
  // the morning section: the high securities with their numbers; the record on a Sunday only
  const sec=pressureSection(s,{now}); assert.equal(sec.t,'מד לחץ'); assert.match(sec.text,/ACME — חריג \(ציון/); assert.match(sec.text,/לא תחזית/); assert.ok(!/לוח הציונים/.test(sec.text),'Friday: no record line');
  assert.match(pressureSection(s,{now:new Date('2026-11-08T05:00:00Z')}).text,/לוח הציונים מאז/,'Sunday: the record');
  // the next day, still high: not written twice, not pushed twice; 20 trading days on, the series shows the fall: a hit
  const pushes2=[]; await pressureTask(s,{now:new Date('2026-11-07T16:00:00Z'),log(){},push:async()=>{pushes2.push(1); return 1}}); assert.equal(s.getDoc(TRACK_DOC).data.items.length,2); assert.equal(pushes2.length,0,'still high is not a rise');
  const d2=[...d], c2=[...c]; for(let i=1;i<=30;i++){const dt=new Date(Date.parse('2026-11-06T12:00:00Z')+i*864e5); if([0,6].includes(dt.getUTCDay()))continue; d2.push(dt.toISOString().slice(0,10)); c2.push(i<=10?66-i:56)}
  s.setDoc('quotes/c_ACME',{...series,d:d2,c:c2,v:[...v,...d2.slice(d.length).map(()=>1e6)]});
  T=trackUpdate(s,s.getDoc(PRESS_DOC).data,{now:new Date('2026-12-10T16:00:00Z')}); assert.equal(T.items[0].out,'fell10'); assert.ok(T.items[0].d5<0); assert.ok(T.items[0].min20<=-10); assert.equal(T.stats.hits,1); assert.equal(T.stats.pending,T.items.length-1,'the rest (PEERB without a series, the new day\'s warnings) still wait');
  // a fall with no warning (PEER slides after the record began): a miss, counted once
  const c3=c.map(()=>100), d3=[...d]; for(let i=1;i<=45;i++){const dt=new Date(Date.parse('2026-11-06T12:00:00Z')+i*864e5); if([0,6].includes(dt.getUTCDay()))continue; d3.push(dt.toISOString().slice(0,10)); c3.push(i<=3?100:80)}
  s.setDoc('quotes/c_PEER',{d:d3,c:c3,source:'x'}); T=trackUpdate(s,s.getDoc(PRESS_DOC).data,{now:new Date('2026-12-20T16:00:00Z')});
  assert.equal(T.misses.length,1); assert.equal(T.misses[0].sym,'PEER'); assert.ok(T.misses[0].date>=T.since); assert.equal(T.stats.misses,1);
  // the owner's alone
  const {access}=await import('../server/store.js'); const f=s.users().find(u=>u.role==='friend');
  assert.equal(access(f,PRESS_DOC),''); assert.equal(access(f,TRACK_DOC),''); assert.equal(access(o,PRESS_DOC),'rw'); assert.equal(access({id:'a',role:'admin'},PRESS_DOC),'');
});

test('8.11 control that speaks first: a scheduled job that did not run is a bad source and an incident; the smoke test after a deploy checks the site, the version, the lock, the prices and the page; the restore test opens the newest backup copy the way a restore would', async()=>{
  const {silentJobs,sources,healthCheck}=await import('../server/health.js'); const path=await import('node:path'), os=await import('node:os'); const {smokeTask,smokeOnStart,restoreTest,siteVersion}=await import('../server/control.js'); const {backupNow}=await import('../server/backup.js');
  const now=new Date('2026-11-09T10:00:00Z'), s=new Store(':memory:'); const o=s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}); s.addUser({email:'f@example.com',password:'friend-pass-1',role:'friend'});
  // the silence: a server up for three days; nightly ran yesterday (fine), pressure never (silent), live two hours ago (silent: it runs every ten minutes)
  const start=new Date(now.getTime()-3*864e5);
  s.setMeta('jobs',JSON.stringify({nightly:{at:'2026-11-08T21:55:00Z',ok:true},live:{at:'2026-11-09T07:00:00Z',ok:true},morning:{at:'2026-11-09T05:50:00Z',ok:true},consist:{at:'2026-11-08T22:30:00Z',ok:true},backup:{at:'2026-11-09T00:30:00Z',ok:true},research:{at:'2026-11-08T23:15:00Z',ok:true},ecocal:{at:'2026-11-09T04:40:00Z',ok:true},insiders:{at:'2026-11-09T01:40:00Z',ok:true},etf:{at:'2026-11-09T00:50:00Z',ok:true},bench:{at:'2026-11-08T22:35:00Z',ok:true},ilsyms:{at:'2026-11-09T03:10:00Z',ok:true},news:{at:'2026-11-09T09:40:00Z',ok:true},newsx:{at:'2026-11-09T09:45:00Z',ok:true},earnings:{at:'2026-11-09T08:20:00Z',ok:true},weekly:{at:'2026-11-06T11:50:00Z',ok:true},pxwatch:{at:'2026-11-09T09:35:00Z',ok:true}}));
  const L=silentJobs(s,{now,start}); assert.deepEqual(L.map(x=>x.name).sort(),['live','pressure'],JSON.stringify(L)); assert.equal(L.find(x=>x.name==='pressure').last,null); assert.equal(L.find(x=>x.name==='live').age,3);
  // a server that just started: nothing is silent yet
  assert.deepEqual(silentJobs(s,{now,start:new Date(now.getTime()-60e3)}),[]);
  // the smoke test, with the web answered here: all five pass; then the version differs and the admin API opens: two fail
  const site='<html><title>תיק צ׳יק</title>'+'x'.repeat(60000);
  const web=(status,body)=>async(url)=>({status,text:async()=>body,json:async()=>JSON.parse(body)});
  const fetch1=async url=>url.endsWith('/api/version')?web(200,'{"v":"abc123"}')(url):url.includes('/api/admin/')?web(401,'')(url):web(200,site)(url);
  s.setDoc('quotes/latest',{updatedAt:'2026-11-09T09:00:00Z',usdIls:3.2,prices:{MSFT:500},prev:{MSFT:490},meta:{MSFT:{date:'2026-11-06'}}}); s.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:1,acct:'exc',ccy:'USD'}]});
  const log=[]; const r=await smokeTask(s,{port:1,version:'abc123',now,log:m=>log.push(m),fetch:fetch1,page:async()=>({out:{d:{ready:true,total:1600},a:{ready:true,items:[]}},errs:[]})});
  assert.equal(r.ok,true,JSON.stringify(r.checks)); assert.deepEqual(r.checks.map(c=>c.k),['site','version','locked','quotes','page']); assert.match(log[0],/smoke: ok/);
  assert.deepEqual(JSON.parse(s.getMeta('smoke')).version,'abc123');
  const fetch2=async url=>url.endsWith('/api/version')?web(200,'{"v":"old999"}')(url):url.includes('/api/admin/')?web(200,'{}')(url):web(200,site)(url);
  const r2=await smokeTask(s,{port:1,version:'abc123',now,fetch:fetch2,page:async()=>({out:{d:{ready:true,total:1600},a:{ready:true,items:[]}},errs:[]})});
  assert.equal(r2.ok,false); assert.deepEqual(r2.checks.filter(c=>!c.ok).map(c=>c.k),['version','locked']); assert.match(r2.checks[1].note,/השרת עונה old999, הבנייה abc123/); assert.match(r2.checks[2].note,/נפתח בלי כניסה/);
  // the page not computing a value is a failure too; no portfolio is not
  const r3=await smokeTask(s,{port:1,version:'abc123',now,fetch:fetch1,page:async()=>({out:{d:{ready:false},a:null},errs:['TypeError x']})}); assert.equal(r3.checks.find(c=>c.k==='page').ok,false);
  // smokeOnStart: once per build; a failed one is tried again
  {const t=smokeOnStart(s,{version:'abc123'}); assert.ok(t,'the last run of this build failed: tried again'); clearTimeout(t);
    s.setMeta('smoke',JSON.stringify({...r,version:'abc123'})); assert.equal(smokeOnStart(s,{version:'abc123'}),null,'this build already passed: not again'); assert.ok(smokeOnStart(s,{version:'new456',delay:1e6}),'a new build: once'); s.setMeta('smoke',JSON.stringify(r3))}
  // 9.11 recheckOnStart: a consistency result with gaps is run again after a deploy, once per build; a clean one is not
  {const {recheckOnStart}=await import('../server/control.js'); const ran=[], run=n=>ran.push(n);
    assert.equal(recheckOnStart(s,{run,version:'v1'}),null,'no result yet: nothing to run again');
    s.setDoc('system/consist',{at:now.toISOString(),bad:2,n:3,runs:[]});
    const t=recheckOnStart(s,{run,version:'v1',delay:1}); assert.ok(t,'gaps: run again'); await new Promise(ok=>setTimeout(ok,30)); assert.deepEqual(ran,['consist']);
    assert.equal(recheckOnStart(s,{run,version:'v1'}),null,'the same build: not twice'); assert.ok(recheckOnStart(s,{run,version:'v2',delay:1e6}),'a new build: once more');
    s.setDoc('system/consist',{at:now.toISOString(),bad:0,n:3,runs:[]}); assert.equal(recheckOnStart(s,{run,version:'v3'}),null,'clean: nothing to run again'); s.deleteDoc('system/consist')}
  // the health: the failed smoke, the silent jobs and the restore test not yet run are sources; the failed ones are bad
  s.setMeta('serverStart',JSON.stringify(start.toISOString())); const H=healthCheck(s,{now,save:false,env:{}}), by=Object.fromEntries(H.items.map(i=>[i.key,i]));
  assert.equal(by.smoke.state,'bad'); assert.match(by.smoke.note,/מתוך 5/); assert.ok(by['silent:pressure'],'the silent job is a source'); assert.equal(by['silent:pressure'].state,'bad'); assert.ok(by.restore,'the restore test is a source'); assert.match(by.restore.note,/עוד לא רץ/);
  // the restore test on a real copy: integrity ok, every key document found, the encrypted copy opened again
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tcrt-')); s.setDoc('settings/main',{name:'x'}); s.setDoc('history/daily',{points:{}}); const f=s.users().find(u=>u.role==='friend'); s.setDoc(`data/users/${f.id}/portfolio`,{positions:[]});
  backupNow(s,{dataDir:dir,now}); const rt=restoreTest(s,{dataDir:dir,now,pass:'test-pass-phrase',log(){}});
  assert.equal(rt.ok,true,JSON.stringify(rt)); assert.equal(rt.integrity,'ok'); assert.deepEqual(rt.missing,[]); assert.equal(rt.sealed,true); assert.equal(rt.users,2);
  // a document written after the copy is missing from it: the test says which (a partner's by its name only)
  s.setDoc(`data/users/${f.id}/settings`,{a:1}); s.setDoc('quotes/latest',{...s.getDoc('quotes/latest').data,x:1});
  const rt2=restoreTest(s,{dataDir:dir,now:new Date(now.getTime()+60e3),pass:'',log(){}}); assert.equal(rt2.ok,false); assert.deepEqual(rt2.missing,['מסמך של שותף: settings']); assert.equal(rt2.sealed,null,'no passphrase: not tried');
  // a damaged copy
  const files=fs.readdirSync(path.join(dir,'backups')); fs.writeFileSync(path.join(dir,'backups',files[0]),Buffer.from('garbage')); const rt3=restoreTest(s,{dataDir:dir,now,log(){}}); assert.equal(rt3.ok,false); assert.match(rt3.note,/לא נפתח|השלמות/);
  const H2=healthCheck(s,{now,save:false,env:{}}); assert.equal(H2.items.find(i=>i.key==='restore').state,'bad');
  // no backup at all
  const rt4=restoreTest(new Store(':memory:'),{dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'tcrt2-')),now,log(){}}); assert.equal(rt4.ok,false); assert.match(rt4.note,/אין קובץ גיבוי/);
  assert.equal(typeof siteVersion(),'string');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('8.11 live US prices: the stream\'s symbols, its trades written as prices with a stamp, a bad tick dropped, the session\'s hours kept, and the delayed run keeping a fresher live price', async()=>{
  const {rtSymbols,rtApply,startRt,finnhubSym}=await import('../server/rt.js');
  const Q={updatedAt:'2026-11-09T14:40:00Z',usDate:'2026-11-06',usdIls:3.2,prices:{NVDA:181.5,'BRK-B':480,'TLV:1159235':12.3,'1159235':12.3,TA125:2500,SPY:600,KO:70},prev:{NVDA:180,'BRK-B':478,SPY:598,KO:69},
    meta:{NVDA:{date:'2026-11-06',src:'yahoo'},'BRK-B':{date:'2026-11-06',src:'yahoo'},TA125:{src:'index',ccy:'ILS'},'1159235':{src:'maya',ccy:'ILS'},SPY:{date:'2026-11-06',src:'yahoo'},KO:{date:'2026-11-06',src:'stooq'}},stale:{KO:'סגירה 6.11'}};
  assert.deepEqual(rtSymbols(Q),['BRK-B','KO','NVDA','SPY']); assert.equal(finnhubSym('BRK-B'),'BRK.B');
  const s=new Store(':memory:'); s.setDoc('quotes/latest',Q);
  // Monday 10:00 New York: the session is open
  const open=new Date('2026-11-09T15:00:00Z');
  const n=rtApply(s,{NVDA:{p:185.25,t:1},KO:{p:70.4,t:1},SPY:{p:900,t:1}},{now:open});
  assert.equal(n,2,'SPY at +50% is a bad tick'); const Q2=s.getDoc('quotes/latest').data;
  assert.equal(Q2.prices.NVDA,185.25); assert.equal(Q2.prices.SPY,600); assert.equal(Q2.meta.NVDA.date,'2026-11-09'); assert.equal(Q2.meta.NVDA.rt,open.toISOString()); assert.equal(Q2.prev.NVDA,180,'the previous close is not touched');
  assert.equal(Q2.usDate,'2026-11-09'); assert.equal(Q2.updatedAt,open.toISOString()); assert.ok(!Q2.stale.KO,'a live price is not stale'); assert.deepEqual(Q2.rt,{at:open.toISOString(),n:3});
  assert.equal(rtApply(s,{NVDA:{p:185.25,t:2}},{now:open}),0,'the same price again is not a write');
  // the stream with a stand-in socket: connects in the session, subscribes to the symbols, takes trades, flushes, closes after the bell
  const made=[]; class FakeWS{constructor(u){this.url=u; this.readyState=0; this.sent=[]; this.L={}; made.push(this); setTimeout(()=>{this.readyState=1; this.emit('open',{})},0)} addEventListener(k,f){(this.L[k]=this.L[k]||[]).push(f)} emit(k,ev){for(const f of this.L[k]||[])f(ev)} send(x){this.sent.push(JSON.parse(x))} close(){this.readyState=3; this.emit('close',{})}}
  let NOW=open; const log=[]; const rt=startRt(s,{key:'test-key',WS:FakeWS,now:()=>NOW,every:1e6,flush:1e6,log:m=>log.push(m)});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(made.length,1); assert.match(made[0].url,/^wss:\/\/ws\.finnhub\.io\?token=test-key$/); assert.deepEqual(made[0].sent.map(x=>x.symbol).sort(),['BRK.B','KO','NVDA','SPY']); assert.ok(made[0].sent.every(x=>x.type==='subscribe'));
  made[0].emit('message',{data:JSON.stringify({type:'trade',data:[{s:'NVDA',p:186.1,t:1,v:10},{s:'BRK.B',p:481.2,t:1,v:1},{s:'ZZZ',p:1,t:1}]})});
  assert.equal(rt.state().trades,2,'an unsubscribed symbol is ignored'); rt.flush();
  const Q3=s.getDoc('quotes/latest').data; assert.equal(Q3.prices.NVDA,186.1); assert.equal(Q3.prices['BRK-B'],481.2,'Finnhub\'s dot is our dash'); assert.ok(rt.state().flushed);
  assert.equal(JSON.parse(s.getMeta('rtStatus')).on,true);
  // 16:30 New York: the bell rang; the tick closes the socket and does not reconnect
  NOW=new Date('2026-11-09T21:30:00Z'); rt.tick(); assert.equal(rt.state().on,false); assert.equal(made.length,1); assert.ok(log.some(m=>/the session is over/.test(m)));
  assert.equal(JSON.parse(s.getMeta('rtStatus')).open,false); rt.stop();
  // no key: off, quietly
  assert.deepEqual(startRt(new Store(':memory:'),{key:'',WS:FakeWS,log(){}}).state(),{off:true});
  // the delayed run: a live price from two minutes ago on the same day is kept, with its stamp; an old one is replaced; a split is not blocked
  const old={prices:{NVDA:186.1},prev:{NVDA:180},meta:{NVDA:{date:'2026-11-09',src:'yahoo',rt:'2026-11-09T15:28:00Z'}},usdIls:3.2,updatedAt:'2026-11-09T15:28:00Z'};
  const q=(px,prev,date)=>({px,prev,closeDate:date,ccy:'USD',src:'yahoo',time:'t'});
  let d=buildQuotesDoc({prev:old,fetched:{quotes:{NVDA:q(185.9,180,'2026-11-09')},index:{},errors:[]},symbols:['NVDA'],now:new Date('2026-11-09T15:30:00Z'),usOpen:true});
  assert.equal(d.prices.NVDA,186.1,'the stream\'s price stands'); assert.equal(d.meta.NVDA.rt,'2026-11-09T15:28:00Z'); assert.equal(d.prev.NVDA,180);
  d=buildQuotesDoc({prev:old,fetched:{quotes:{NVDA:q(185.9,180,'2026-11-09')},index:{},errors:[]},symbols:['NVDA'],now:new Date('2026-11-09T15:40:00Z'),usOpen:true});
  assert.equal(d.prices.NVDA,185.9,'twelve minutes old: the source\'s price'); assert.ok(!d.meta.NVDA.rt);
  d=buildQuotesDoc({prev:old,fetched:{quotes:{NVDA:q(185.9,180,'2026-11-10')},index:{},errors:[]},symbols:['NVDA'],now:new Date('2026-11-09T15:30:00Z'),usOpen:true});
  assert.equal(d.prices.NVDA,185.9,'another day: the source\'s price');
});

test('8.11 the security headers and the API ceiling: every answer carries the headers and a report-only content policy; a report is kept once; an address past the ceiling gets 429 until the minute passes, the stream excepted', async()=>{
  const {createApp}=await import('../server/index.js'); const store=new Store(':memory:'); store.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'});
  const saved=process.env.API_RPM; process.env.API_RPM='5';
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false}); const srv=http.createServer(app); await new Promise(r=>srv.listen(0,r)); const base='http://127.0.0.1:'+srv.address().port;
  try{const r=await fetch(base+'/api/version'); assert.equal(r.status,200);
    assert.equal(r.headers.get('x-content-type-options'),'nosniff'); assert.equal(r.headers.get('x-frame-options'),'DENY'); assert.match(r.headers.get('permissions-policy'),/camera=\(\)/);
    assert.match(r.headers.get('content-security-policy-report-only'),/default-src 'self'.*frame-ancestors 'none'.*report-uri \/api\/csp-report/); assert.equal(r.headers.get('content-security-policy'),null,'report-only until CSP_ENFORCE=1');
    assert.equal(r.headers.get('strict-transport-security'),null,'HSTS only in production');
    // a browser's report, kept once per directive and target, without the host of the page
    for(let i=0;i<2;i++){const p=await fetch(base+'/api/csp-report',{method:'POST',headers:{'content-type':'application/csp-report','x-tc':'1'},body:JSON.stringify({'csp-report':{'violated-directive':'script-src','blocked-uri':'https://evil.example/x.js','document-uri':'https://tickchik.example/#risk'}})}); assert.equal(p.status,204)}
    const L=JSON.parse(store.getMeta('cspReports')); assert.equal(L.length,1); assert.equal(L[0].blocked,'https://evil.example/x.js'); assert.equal(L[0].doc,'/#risk');
    // the ceiling: five a minute here, then 429
    let last=0; for(let i=0;i<5;i++){last=(await fetch(base+'/api/version')).status} assert.equal(last,429,'the sixth request and on (the reports are not counted: they come from the browser on their own)');
    const j=await (await fetch(base+'/api/version')).json(); assert.equal(j.error.code,'rate_limited');
    assert.equal((await fetch(base+'/api/csp-report',{method:'POST',headers:{'content-type':'application/csp-report','x-tc':'1'},body:'{}'})).status,204,'a report still lands past the ceiling')}
  finally{process.env.API_RPM=saved; srv.closeAllConnections(); srv.close()}
});

test('8.11 a partner deletes their own account: the password first, then their documents, watch list, devices, sessions and the user row go; the owner cannot', async()=>{
  const {createApp}=await import('../server/index.js'); const store=new Store(':memory:'); const o=store.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}), f=store.addUser({email:'f@example.com',password:'friend-pass-1',role:'friend'});
  store.setDoc(`data/users/${f.id}/portfolio`,{positions:[{sym:'KO',qty:1}]}); store.setDoc(`data/users/${f.id}/settings`,{a:1}); store.setDoc('watch/'+f.id,{syms:['KO']}); store.setMeta('push:'+f.id,JSON.stringify([{endpoint:'https://x/1',keys:{}}]));
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false}); const srv=http.createServer(app); await new Promise(r=>srv.listen(0,r)); const base='http://127.0.0.1:'+srv.address().port;
  try{const login=async(email,password)=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-tc':'1'},body:JSON.stringify({email,password})}); return (r.headers.get('set-cookie')||'').split(';')[0]};
    const post=(cookie,body)=>fetch(base+'/api/me/delete',{method:'POST',headers:{'content-type':'application/json','x-tc':'1',cookie},body:JSON.stringify(body)});
    const ck=await login('f@example.com','friend-pass-1'); assert.ok(ck,'signed in');
    let r=await post(ck,{password:'wrong-pass-123'}); assert.equal(r.status,401); assert.ok(store.userById(f.id),'still there after a wrong password');
    r=await post(ck,{password:'friend-pass-1'}); assert.equal(r.status,200); assert.match(r.headers.get('set-cookie')||'',/Max-Age=0/,'the session cookie is cleared');
    assert.ok(!store.userById(f.id),'the user row is gone'); assert.equal(store.pathsUnder('data/users/'+f.id).length,0); assert.equal(store.getDoc('watch/'+f.id).exists,false); assert.deepEqual(JSON.parse(store.getMeta('push:'+f.id)),[]);
    assert.ok(store.db.prepare("select 1 from audit where action='user.selfdelete' and target='f@example.com'").get(),'audited');
    assert.equal((await fetch(base+'/api/me',{headers:{cookie:ck}}).then(r=>r.json())).me,null,'the session is gone');
    const ok2=await login('o@example.com','owner-pass-123'); r=await post(ok2,{password:'owner-pass-123'}); assert.equal(r.status,403); assert.ok(store.userById(o.id),'the owner stays');
  }finally{srv.closeAllConnections(); srv.close()}
});

test('8.11 the morning e-mail\'s control line for the owner: the consistency check, the sources not working, the smoke and restore tests, in counts; "quiet" when all is well', async()=>{
  const {controlSection}=await import('../server/tasks.js'); const s=new Store(':memory:'); s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'});
  const now=new Date('2026-11-09T05:50:00Z'); s.setMeta('serverStart',JSON.stringify(now.toISOString()));
  let c=controlSection(s,{now}); assert.equal(c.t,'בקרה'); assert.match(c.text,/בדיקת העקביות עוד לא רצה/); assert.ok(!/שקט/.test(c.text),'not quiet before the first check');
  s.setDoc('system/consist',{at:'2026-11-08T22:30:00Z',n:0,bad:0,runs:[]}); s.setMeta('smoke',JSON.stringify({at:now.toISOString(),version:'abc1234567',ok:true,checks:[{k:'site',name:'הדף נטען',ok:true}]})); s.setMeta('restoreTest',JSON.stringify({at:'2026-11-07T01:10:00Z',ok:true}));
  c=controlSection(s,{now,env:{}}); assert.match(c.text,/אותם מספרים בכל מקום/); assert.match(c.text,/בדיקת העשן אחרי הפריסה \(abc1234\): תקין/); assert.match(c.text,/שחזור הגיבוי לבדיקה: תקין/);
  s.setDoc('system/consist',{at:'2026-11-08T22:30:00Z',n:3,bad:1,runs:[]}); s.setMeta('smoke',JSON.stringify({at:now.toISOString(),version:'abc1234567',ok:false,checks:[{k:'page',name:'הדף מחשב תיק',ok:false,note:'x'}]}));
  c=controlSection(s,{now}); assert.match(c.text,/3 ממצאים, 1 חמורים/); assert.match(c.text,/נכשלה: הדף מחשב תיק/); assert.ok(!/שקט/.test(c.text));
});

test('9.11 an incident knows where its details live: the notification opens them (the owner\'s body names the owner\'s own gaps), and the list carries the link', async()=>{
  const {checkIncidents,incidents,incLink}=await import('../server/admin/ops.js'); const {adminSchema}=await import('../server/admin/core.js'); const {ensureCounters}=await import('../server/admin/counter.js');
  assert.equal(incLink('consist','data'),'#health/consist'); assert.equal(incLink('src:prices','source'),'#health'); assert.equal(incLink('smoke','uptime'),'#health'); assert.equal(incLink('push','alerts'),'#health'); assert.equal(incLink('x','other'),'#incidents');
  const s=new Store(':memory:'); const o=s.addUser({email:'o@example.com',password:'owner-pass-123',role:'owner'}); const a=s.addUser({email:'a@example.com',password:'admin-pass-12',role:'admin'});
  adminSchema(s); ensureCounters(s); s.setMeta('serverStart',JSON.stringify(new Date().toISOString()));
  s.setDoc('system/consist',{at:new Date().toISOString(),n:4,bad:4,runs:[{uid:o.id,owner:true,n:3,bad:3,items:[{k:'noPrice',sev:'bad',sym:'GONE',t:'אין מחיר ל-GONE: הנייר לא נספר בשווי התיק'},{k:'acctsSame',sev:'bad',t:'החשבונות exc ו-blink מציגים אותם מספרים'},{k:'dayWhy',sev:'bad',t:'x'}]},{uid:'p',owner:false,n:1,bad:1,items:[{k:'noPrice',sev:'bad',t:'נייר בלי מחיר, לא נספר בשווי'}]}]});
  const pushes=[]; const opened=checkIncidents(s,{push:async(st,uid,msg)=>{pushes.push({uid,msg}); return 1},now:new Date()});
  const inc=opened.find(x=>x.key==='consist'); assert.ok(inc,'the consistency incident opened: '+opened.map(x=>x.key));
  const po=pushes.find(p=>p.uid===o.id), pa=pushes.find(p=>p.uid===a.id); assert.ok(po&&pa,'both notified');
  assert.match(po.msg.body,/אצלך: אין מחיר ל-GONE/,'the owner sees their own gaps'); assert.ok(!/GONE/.test(pa.msg.body),'the admin sees counts only');
  assert.equal(po.msg.url,pushes.length&&opened.filter(x=>x.sev==='bad').length===1?'/admin#health/consist':'/admin#incidents');
  const L=incidents(s); assert.equal(L.find(i=>i.key==='consist').link,'#health/consist');
});

// 9.11: the content-security policy decides by itself: a clean week enforces it, a block on our pages while enforced
// reverts it (and says so), an extension's own script does not count, and the environment overrides both ways
test('9.11 the content-security policy: report-only, enforced after a clean week, back to report-only on a block',async()=>{
  const {cspState,cspReport,CSP_CLEAN_DAYS}=await import('../server/csp.js');
  const M=new Map(), store={getMeta:k=>M.get(k)??null,setMeta:(k,v)=>M.set(k,v)}, env={}, D=864e5, t0=Date.parse('2026-11-09T10:00:00Z'), at=d=>new Date(t0+d*D);
  assert.equal(cspState(store,{env,now:at(0)}).mode,'report');
  assert.equal(cspState(store,{env,now:at(3)}).left,CSP_CLEAN_DAYS-3);
  // an extension's block does not count; our own page's block restarts the week
  cspReport(store,{directive:'script-src',blocked:'chrome-extension://abc/x.js',doc:'/'},{env,now:at(4)});
  assert.equal(cspState(store,{env,now:at(7.1)}).mode,'enforce','a clean week (the extension ignored)');
  M.delete('cspAuto'); cspState(store,{env,now:at(0)});
  cspReport(store,{directive:'img-src',blocked:'https://x.example/a.png',doc:'/'},{env,now:at(5)});
  assert.equal(cspState(store,{env,now:at(8)}).mode,'report','a block of ours on day 5: the week starts again');
  assert.equal(cspState(store,{env,now:at(12.1)}).mode,'enforce');
  let told=null; const rev=cspReport(store,{directive:'connect-src',blocked:'https://api.example',doc:'/admin'},{env,now:at(13),onRevert:it=>{told=it}});
  assert.ok(rev&&told&&told.directive==='connect-src'); assert.equal(cspState(store,{env,now:at(13.5)}).mode,'report','reverted, and said');
  // the same report twice: one line with a count
  cspReport(store,{directive:'connect-src',blocked:'https://api.example',doc:'/admin'},{env,now:at(14)});
  const L=JSON.parse(M.get('cspReports')); assert.equal(L.filter(x=>x.directive==='connect-src').length,1); assert.equal(L.find(x=>x.directive==='connect-src').n,2);
  assert.equal(cspState(store,{env:{CSP_ENFORCE:'1'},now:at(14)}).mode,'enforce'); assert.equal(cspState(store,{env:{CSP_ENFORCE:'0'},now:at(30)}).mode,'report');
});
