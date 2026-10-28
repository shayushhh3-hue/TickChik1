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
  assert.deepEqual(F.fhRating([{period:'2026-09-01',strongBuy:1,buy:1,hold:1,sell:0,strongSell:0},{period:'2026-10-01',strongBuy:10,buy:20,hold:5,sell:1,strongSell:0}]),{rating:'Buy',analysts:36,votes:{buy:30,hold:5,sell:1},recAt:'2026-10-01'});
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
  const st=await newsTask(s,{fetch:f,now,budgetMs:60e3}); assert.equal(st.ok,3); assert.equal(st.items,3,'three of the day, the old wrap dropped');
  const d=s.getDoc('research/news').data; const wrap=d.items.find(x=>x.link==='https://n.com/wrap'); assert.ok(!wrap,'older than a week: gone');
  assert.deepEqual(d.items.map(x=>x.link).sort(),['https://n.com/KO','https://n.com/MSFT','https://n.com/NVDA']); assert.equal(d.items.find(x=>x.link==='https://n.com/KO').sum,'why');
  // the same article about two securities: one item, both symbols
  const f2=async u=>{u=String(u); if(u.includes('/company-news'))return Response.json([{headline:'Big tech',url:'https://n.com/tech',source:'T',datetime:Date.parse('2026-10-28T09:00:00Z')/1000}]); return new Response('',{status:404})};
  await newsTask(s,{fetch:f2,now,budgetMs:60e3}); const d2=s.getDoc('research/news').data, tech=d2.items.find(x=>x.link==='https://n.com/tech'); assert.deepEqual(tech.syms.sort(),['KO','MSFT','NVDA']); assert.equal(d2.items.length,4,'the earlier ones stay');
  // a partner (u2: KO and MSFT) does not see NVDA's article
  s.setDoc('data/users/u2/settings',{},{silent:true});
  const pv=partnerView(s,{id:'u2',role:'partner'},'research/news',d2); assert.deepEqual(pv.items.map(x=>x.link).sort(),['https://n.com/KO','https://n.com/MSFT','https://n.com/tech']); assert.deepEqual(pv.items.find(x=>x.link==='https://n.com/tech').syms.sort(),['KO','MSFT']);
  delete process.env.FINNHUB_API_KEY;
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
