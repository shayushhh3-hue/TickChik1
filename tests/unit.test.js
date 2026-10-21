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
  assert.ok(Math.abs(d.prices['5129283']-373.6*1.02*0.99)<1e-3); assert.equal(d.prev['5129283'],373.6);
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
  assert.deepEqual(dueReports(s,new Date('2026-10-21T12:20:00Z')),[],'in: not asked again');
  const st2=await researchTask(s,{fetch:f,now:new Date('2026-10-22T04:20:00Z'),pause:0,only:['NFLX'],explain,mail}); assert.equal(st2.reports,0,'the same quarter again is not a new event');
  assert.equal(asked.length,1,'not explained twice'); assert.equal(mailed.length,1,'not mailed twice'); assert.equal(s.getDoc('research/s_NFLX').data.rep.ai.explain,'הרבעון היה מעל הצפי ברווח.','the explanation stays');
  // Claude's text: a sentence with a number it was not given, or with advice, is dropped
  const {cleanText}=await import('../server/explain.js'); const c=cleanText({findings:['הרווח למניה 0.87.','הרווח צפוי לגדול ב-40%.','כדאי לקנות לפני הדוח הבא.'],explain:'ההכנסות $12.87B. המניה תעלה.'},asked[0]);
  assert.deepEqual(c.findings,['הרווח למניה 0.87.']); assert.equal(c.explain,'ההכנסות $12.87B.'); assert.equal(c.dropped,3);
  assert.equal(s.getDoc('research/latest').data.events.length,1); assert.equal(s.getDoc('research/s_NFLX').data.rep.at,'2026-10-20');
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
