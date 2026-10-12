// Unit tests for the shared code and the server functions, with fetch mocked. Run: node --test tests/
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeDoc, decodeDoc} from '../shared/docenc.js';
import {toFields, fromFields, firestore, signInPassword} from '../shared/fsrest.js';
import {yahooChart, boiUsd, fetchAll, buildQuotesDoc, tickerFor} from '../shared/quotes.js';
import {ilOpen, usOpen, inPxWindow, ilParts} from '../shared/market.js';
import {verifyIdToken, requireUser} from '../shared/webauth.js';
import {onRequestPost as ask} from '../functions/api/ask.js';
import {onRequestPost as prices} from '../functions/api/prices.js';
import {refreshQuotes} from '../shared/pxjob.js';

const res=(status,body,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});

test('docenc: scalars flat, structures in _j, round trip with nested arrays and dotted keys',()=>{
  const d={createdAt:'2026-10-11',n:3,ok:true,nil:null,R:{strip:[['a','b']],blocks:[{rows:[[1,2],[3,4]]}]},px:{'BRK.B':1.5},und:undefined};
  const e=encodeDoc(d);
  assert.deepEqual(Object.keys(e).sort(),['_j','createdAt','n','nil','ok']);
  assert.deepEqual(decodeDoc(e),{createdAt:'2026-10-11',n:3,ok:true,nil:null,R:d.R,px:d.px});
  assert.deepEqual(decodeDoc({a:1}),{a:1});
  assert.deepEqual(encodeDoc({x:NaN}),{x:null});
});

test('fsrest: Firestore value encoding round trip',()=>{
  const d={s:'x',i:7,f:1.25,b:false,nil:null,at:'2026-10-11T00:00:00Z',R:{a:[1,'two',{b:[[1]]}]}};
  const f=toFields(d);
  assert.equal(f.i.integerValue,'7'); assert.equal(f.f.doubleValue,1.25); assert.ok(f._j.stringValue);
  assert.deepEqual(fromFields(f),d);
});

test('fsrest: get/set/list/batch speak the REST API',async()=>{
  const calls=[];
  const f=async(url,o={})=>{calls.push([o.method||'GET',url,o.body&&JSON.parse(o.body)]);
    if(url.endsWith('/documents/quotes/latest'))return o.method==='GET'?res(200,{name:'projects/p/databases/(default)/documents/quotes/latest',fields:toFields({usdIls:3.07,prices:{MSFT:1}})}):res(200,{});
    if(url.includes('/documents/nope'))return res(404,{error:{status:'NOT_FOUND'}});
    if(url.includes('/documents/watch?'))return res(200,{documents:[{name:'x/watch/u1',fields:toFields({syms:['A']})}]});
    if(url.endsWith(':commit'))return res(200,{});
    return res(403,{error:{status:'PERMISSION_DENIED',message:'no'}});
  };
  const fs=firestore({projectId:'p',idToken:'t',fetch:f});
  const g=await fs.getDoc('quotes/latest'); assert.equal(g.exists,true); assert.deepEqual(g.data,{usdIls:3.07,prices:{MSFT:1}});
  assert.equal((await fs.getDoc('nope/x')).exists,false);
  await fs.setDoc('quotes/latest',{a:1}); assert.equal(calls[calls.length-1][0],'PATCH'); assert.equal(calls[calls.length-1][2].fields.a.integerValue,'1');
  await fs.updateDoc('quotes/latest',{prices:{KO:2}}); const last=calls[calls.length-1][2].fields; assert.deepEqual(JSON.parse(last._j.stringValue),{prices:{MSFT:1,KO:2}});
  const L=await fs.listDocs('watch'); assert.deepEqual(L,[{id:'u1',data:{syms:['A']},updateTime:undefined}]);
  await fs.batch([{path:'a/b',data:{x:1}},{path:'a/c',delete:true}]); const c=calls[calls.length-1]; assert.ok(c[1].endsWith('documents:commit')); assert.equal(c[2].writes.length,2); assert.ok(c[2].writes[1].delete.endsWith('/a/c'));
  await assert.rejects(()=>fs.getDoc('secret/x'),e=>e.code==='permission_denied'&&e.status===403);
  assert.equal(calls[0][1],'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/quotes/latest');
});

const yahoo=(sym,{px,closes,ccy='USD',off=-14400,lastDay='2026-10-09'})=>{const base=Date.parse(lastDay+'T20:00:00Z')/1000;const ts=closes.map((c,i)=>base-(closes.length-1-i)*86400);return {chart:{result:[{meta:{currency:ccy,symbol:sym,exchangeName:'NMS',regularMarketPrice:px,regularMarketTime:ts[ts.length-1]+60,gmtoffset:off,chartPreviousClose:closes[0]},timestamp:ts,indicators:{quote:[{close:closes}]}}],error:null}}};

test('quotes: Yahoo chart → price, previous close, agorot handled, Stooq fallback, BoI rate',async()=>{
  const f=async(url)=>{
    if(url.includes('/chart/MSFT'))return res(200,yahoo('MSFT',{px:530.5,closes:[500,510,520,529.5]}));
    if(url.includes('/chart/ABRA.TA'))return res(200,yahoo('ABRA.TA',{px:12345,closes:[12000,12100,12345],ccy:'ILA',off:10800}));
    if(url.includes('/chart/BAD'))return res(404,{chart:{result:null,error:{description:'No data found'}}});
    if(url.includes('stooq.com/q/d/l/?s=bad.us'))return res(200,'Date,Open,High,Low,Close,Volume\n2026-10-08,1,1,1,9.5,100\n2026-10-09,1,1,1,10.25,100\n');
    if(url.includes('boi.org.il'))return res(200,{exchangeRates:[{key:'EUR',currentExchangeRate:3.9,unit:1,lastUpdate:'2026-10-09T00:00:00'},{key:'USD',currentExchangeRate:3.074,currentChange:0.1,unit:1,lastUpdate:'2026-10-09T00:00:00'}]});
    if(url.includes('/chart/USDILS'))return res(200,yahoo('USDILS=X',{px:3.081,closes:[3.07,3.075,3.08],ccy:'ILS'}));
    if(url.includes('/chart/%5ETA125.TA'))return res(200,yahoo('^TA125.TA',{px:3100,closes:[3000,3050,3000],ccy:'ILS',off:10800,lastDay:'2026-10-11'}));
    return res(500,'x');
  };
  const q=await yahooChart('MSFT',{fetch:f}); assert.equal(q.px,530.5); assert.equal(q.prev,520); assert.equal(q.closeDate,'2026-10-09'); assert.equal(q.prevDate,'2026-10-08');
  const a=await yahooChart('ABRA.TA',{fetch:f}); assert.equal(a.px,123.45); assert.equal(a.prev,121); assert.equal(a.ccy,'ILS');
  assert.equal(tickerFor('BRK.B'),'BRK-B'); assert.equal(tickerFor('ABRA',{ccy:'ILS'}),'ABRA.TA'); assert.equal(tickerFor('1159250'),'1159250.TA'); assert.equal(tickerFor('TA125',{ccy:'ILS'},{TA125:'X.TA'}),'X.TA');
  const all=await fetchAll(['MSFT','BAD','TA125'],{positions:[{sym:'TA125',ccy:'ILS',px:61.92}],fetch:f});
  assert.equal(all.quotes.MSFT.px,530.5); assert.equal(all.quotes.BAD.src,'stooq'); assert.equal(all.quotes.BAD.px,10.25); assert.ok(all.index.TA125);
  assert.equal(all.fx.boi.rate,3.074); assert.equal(all.fx.live.px,3.081);
  const doc=buildQuotesDoc({prev:{prices:{TA125:61.92,OLD:5},prev:{TA125:61.5},meta:{}},fetched:all,symbols:['MSFT','BAD','TA125','GONE'],positions:[{sym:'TA125',ccy:'ILS',px:61.92}],now:new Date('2026-10-11T08:00:00Z'),usOpen:false,ilOpen:true});
  assert.equal(doc.prices.MSFT,530.5); assert.equal(doc.prev.MSFT,520);
  assert.equal(doc.prices.TA125,Math.round(61.5*3100/3050*1000)/1000); assert.equal(doc.prev.TA125,61.5); assert.equal(doc.stale.TA125,'לפי מדד ת״א 125');
  assert.equal(doc.stale.GONE,undefined); assert.equal(doc.prices.OLD,5);
  assert.equal(doc.usdIls,3.081); assert.match(doc.fxLabel,/יציג בנק ישראל 9\.10/); assert.match(doc.priceLabel,/מסחר חי בתל אביב/); assert.equal(doc.prevLabel,'סגירה 8.10');
  assert.equal(doc.stale.BAD,'סגירה 9.10');
  // a second run the next trading day rolls the index fund's base to the last estimate
  const nextIdx={...all,index:{TA125:{...all.index.TA125,closeDate:'2026-10-12',px:3131,prev:3100}}};
  const doc2=buildQuotesDoc({prev:doc,fetched:{...nextIdx,quotes:{}},symbols:['TA125'],positions:[],now:new Date('2026-10-12T08:00:00Z')});
  assert.equal(doc2.prev.TA125,doc.prices.TA125); assert.equal(doc2.prices.TA125,Math.round(doc.prices.TA125*3131/3100*1000)/1000);
});

test('market: hours in Israel and New York',()=>{
  assert.equal(ilOpen(new Date('2026-10-12T08:00:00Z')),true);   // Monday 11:00 Israel (IDT)
  assert.equal(ilOpen(new Date('2026-10-11T08:00:00Z')),false);  // Sunday
  assert.equal(ilOpen(new Date('2026-10-16T11:30:00Z')),false);  // Friday 14:30
  assert.equal(usOpen(new Date('2026-10-12T14:00:00Z')),true);   // Monday 10:00 New York (EDT)
  assert.equal(usOpen(new Date('2026-10-12T12:00:00Z')),false);
  assert.equal(inPxWindow(new Date('2026-10-12T07:45:00Z')),true); // 10:45 Israel
  assert.equal(inPxWindow(new Date('2026-10-12T06:45:00Z')),false);
  assert.equal(ilParts(new Date('2026-10-12T20:50:00Z')).iso,'2026-10-12');
});

// ---- a signed Firebase token, made here with a fresh key ----
const b64u=buf=>Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function mkToken(claims,kid='k1'){
  const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',kp.publicKey);
  const head=b64u(JSON.stringify({alg:'RS256',kid,typ:'JWT'})), pay=b64u(JSON.stringify(claims));
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(head+'.'+pay));
  return {token:head+'.'+pay+'.'+b64u(sig),jwks:{keys:[{...jwk,kid,alg:'RS256',use:'sig'}]}};
}
const now=Math.floor(Date.now()/1000);
const claims=(o={})=>({iss:'https://securetoken.google.com/test-proj',aud:'test-proj',auth_time:now-10,user_id:'u1',sub:'u1',iat:now-10,exp:now+3600,email:'Friend@Example.com',email_verified:true,...o});

test('auth: a good token passes, a tampered one, a wrong project and an expired one fail; invites decide',async()=>{
  const {token,jwks}=await mkToken(claims());
  const other=await mkToken(claims(),'k1'); // same kid, another key: its signature must not pass against our key
  const f=async url=>{if(url.includes('/jwk/'))return res(200,jwks,{'cache-control':'public, max-age=3600'});
    if(url.includes('/documents/invites/friend%40example.com'))return res(200,{name:'x',fields:{}});
    if(url.includes('/documents/invites/'))return res(403,{error:{status:'PERMISSION_DENIED'}});return res(500,'x')};
  const u=await verifyIdToken(token,'test-proj',f); assert.equal(u.uid,'u1'); assert.equal(u.email,'friend@example.com');
  await assert.rejects(()=>verifyIdToken(other.token,'test-proj',f),e=>e.code==='not_granted');
  await assert.rejects(()=>verifyIdToken(token,'other-proj',f),e=>e.code==='not_granted');
  const exp=await mkToken(claims({exp:now-5}),'k1');
  const f2=async url=>url.includes('/jwk/')?res(200,exp.jwks):res(500,'x');
  await assert.rejects(()=>verifyIdToken(exp.token,'test-proj',f2),e=>e.code==='not_granted');
  const env={FIREBASE_PROJECT_ID:'test-proj',OWNER_EMAIL:'Owner@Example.com'};
  const req=t=>new Request('http://x/api/ask',{method:'POST',headers:{authorization:'Bearer '+t}});
  const fr=await requireUser(req(token),env,async url=>url.includes('/jwk/')?res(200,jwks):f(url)); assert.equal(fr.owner,false);
  const own=await mkToken(claims({email:'owner@example.com'}),'k2');
  const fo=async url=>url.includes('/jwk/')?res(200,own.jwks):res(500,'x');
  // the key cache holds the friend's jwks; an unknown kid makes it fetch the keys again
  const o=await requireUser(req(own.token),env,fo); assert.equal(o.owner,true);
  const nobody=await mkToken(claims({email:'nobody@example.com'}),'k3');
  await assert.rejects(()=>requireUser(req(nobody.token),env,async url=>url.includes('/jwk/')?res(200,nobody.jwks):res(403,{error:{status:'PERMISSION_DENIED'}})),e=>e.status===403);
  await assert.rejects(()=>requireUser(new Request('http://x/api/ask',{method:'POST'}),env,f),e=>e.code==='not_granted');
});

test('ask: forwards to Claude with the server key, keeps the model list, maps errors',async()=>{
  const {token,jwks}=await mkToken(claims({email:'owner@example.com'}),'k9');
  const seen=[]; const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,o={})=>{seen.push([url,o]);
    if(String(url).includes('/jwk/'))return res(200,jwks);
    if(String(url).includes('api.anthropic.com')){const b=JSON.parse(o.body);if(b.model==='boom')return res(429,{error:{type:'rate_limit_error',message:'slow down'}});if(b.model==='bad')return res(401,{error:{message:'invalid x-api-key'}});return res(200,{id:'m1',content:[{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn'})}
    return res(500,'x')};
  try{
    const env={ANTHROPIC_API_KEY:'sk-test',FIREBASE_PROJECT_ID:'test-proj',OWNER_EMAIL:'owner@example.com',ALLOWED_MODELS:'claude-sonnet-5-5,boom,bad'};
    const mk=(body,tok=token)=>new Request('http://x/api/ask',{method:'POST',headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:JSON.stringify(body)});
    let r=await ask({request:mk({model:'claude-sonnet-5-5',max_tokens:10,messages:[{role:'user',content:'hi'}]}),env});
    assert.equal(r.status,200); assert.deepEqual((await r.json()).content[0].text,'{"ok":true}');
    const call=seen.find(s=>String(s[0]).includes('anthropic')); assert.equal(call[1].headers['x-api-key'],'sk-test'); assert.equal(call[1].headers['anthropic-version'],'2023-06-01');
    r=await ask({request:mk({model:'gpt-9',messages:[]}),env}); assert.equal(r.status,400);
    r=await ask({request:mk({model:'boom',messages:[]}),env}); assert.equal(r.status,429); assert.equal((await r.json()).error.code,'rate_limited');
    r=await ask({request:mk({model:'bad',messages:[]}),env}); assert.equal(r.status,502); assert.equal((await r.json()).error.code,'upstream_error');
    r=await ask({request:mk({model:'claude-sonnet-5-5'},'nope.nope.nope'),env}); assert.equal(r.status,401);
    r=await ask({request:mk({model:'claude-sonnet-5-5'}),env:{...env,ANTHROPIC_API_KEY:''}}); assert.equal(r.status,503);
  }finally{globalThis.fetch=realFetch}
});

test('prices: signs in as the bot, fetches the portfolio and watch symbols, writes quotes/latest',async()=>{
  const {token,jwks}=await mkToken(claims({email:'owner@example.com'}),'k7');
  const writes=[]; const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,o={})=>{url=String(url);
    if(url.includes('/jwk/'))return res(200,jwks);
    if(url.includes('accounts:signInWithPassword'))return res(200,{idToken:'bot-tok',refreshToken:'r',localId:'bot',email:'bot@example.com',expiresIn:'3600'});
    if(url.endsWith('/documents/portfolio/main'))return res(200,{name:'x',fields:toFields({positions:[{sym:'MSFT',ccy:'USD',qty:1},{sym:'TA125',ccy:'ILS',qty:10,px:61.92}]})});
    if(url.endsWith('/documents/settings/main'))return res(200,{name:'x',fields:toFields({symMap:{}})});
    if(url.endsWith('/documents/quotes/latest')&&(o.method||'GET')==='GET')return res(200,{name:'x',fields:toFields({prices:{MSFT:500,TA125:61.92},prev:{TA125:61.5},usdIls:3.0})});
    if(url.endsWith('/documents/quotes/latest')&&o.method==='PATCH'){writes.push(JSON.parse(o.body));return res(200,{})}
    if(url.includes('/documents/watch?'))return res(200,{documents:[{name:'x/watch/u2',fields:toFields({syms:['KO'],marks:['bad sym']})}]});
    if(url.includes('/chart/MSFT'))return res(200,yahoo('MSFT',{px:530.5,closes:[500,520,529.5]}));
    if(url.includes('/chart/KO'))return res(200,yahoo('KO',{px:86.2,closes:[85,86]}));
    if(url.includes('/chart/%5ETA125.TA'))return res(200,yahoo('^TA125.TA',{px:3100,closes:[3000,3050],ccy:'ILS',off:10800}));
    if(url.includes('/chart/USDILS'))return res(200,yahoo('USDILS=X',{px:3.081,closes:[3.07,3.08],ccy:'ILS'}));
    if(url.includes('boi.org.il'))return res(200,{exchangeRates:[{key:'USD',currentExchangeRate:3.074,unit:1,lastUpdate:'2026-10-09T00:00:00'}]});
    return res(500,'x')};
  try{
    const env={FIREBASE_PROJECT_ID:'test-proj',FIREBASE_API_KEY:'web-key',OWNER_EMAIL:'owner@example.com',BOT_EMAIL:'bot@example.com',BOT_PASSWORD:'pw'};
    const r=await prices({request:new Request('http://x/api/prices',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({reason:'click'})}),env});
    const j=await r.json(); assert.equal(r.status,200,JSON.stringify(j)); assert.equal(j.ok,true); assert.equal(j.symbols,3); assert.equal(j.fetched,3);
    assert.equal(writes.length,1); const d=fromFields(writes[0].fields);
    assert.equal(d.prices.MSFT,530.5); assert.equal(d.prices.KO,86.2); assert.equal(d.prev.MSFT,520); assert.equal(d.usdIls,3.081); assert.equal(d.lastReason,'owner: click');
    assert.ok(Math.abs(d.prices.TA125-61.5*3100/3000)<0.01);
    // a second call within three minutes is answered from the last result, without another fetch
    const r2=await prices({request:new Request('http://x/api/prices',{method:'POST',headers:{authorization:'Bearer '+token}}),env}); assert.equal((await r2.json()).cached,true); assert.equal(writes.length,1);
  }finally{globalThis.fetch=realFetch}
});
