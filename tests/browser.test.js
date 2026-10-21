// The page in a real browser (Chromium through Playwright, which the server already uses for its headless tasks), on the
// made-up portfolio of tests/fixture.js: navigation by screen size, the portfolio editor, a new user's first steps,
// unknown data, the chat's labels, the charts, small screens, and the hard cases (a large portfolio, old prices, a broken
// server answer). Nothing leaves the machine: Claude is a local stand-in and every outside address answers 404.
// Run: npm run test:browser   (the tests are skipped when no browser is installed)
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,closes} from './fixture.js';

const R=new URL('..',import.meta.url).pathname;
let claude, seen=[], bodies=[], srv, U, store, browser, docs, R5;
const TODAY=new Date().toISOString().slice(0,10), dF=iso=>{const d=new Date(iso); return d.getUTCDate()+'.'+(d.getUTCMonth()+1)+'.'+d.getUTCFullYear()};   // statements of today
before(async()=>{
  claude=http.createServer(async(req,res)=>{let b='';for await(const c of req)b+=c; const J=JSON.parse(b), p=JSON.stringify(J.messages||[]); seen.push(p); bodies.push({model:J.model,stream:!!J.stream,max_tokens:J.max_tokens,at:Date.now()});
    if(p.includes('FAILTEST')){res.writeHead(529,{'content-type':'application/json'}); res.end(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'Overloaded'}})); return}
    // reading a file: both reads stream, as the server asks for them. The quick read (Haiku) answers at once; the strongest
    // model's read takes a while (SLOWCHECK: longer). QUICKBAD: the quick read gets MSFT's quantity wrong, sees a security
    // that is not there (ZZZQ) and misses one (NVDA). QUICKSPELL: the quick read spells Alphabet GOOG, the strong one GOOGL.
    // QUICKGROUP: the quick read puts MSFT in another group. QUICKACCT: the quick read takes the file for Blink's.
    // QUICKCUT: a long statement, and the quick read's answer is cut in the middle. OLDREPORT: a statement of 31.12.2025.
    // QUICKFAIL: the quick read fails. NOFABLE: the strongest model is not open to the key. RATE429: every model is at its rate limit.
    const isRead=p.includes('You extract holdings'), bad=p.includes('QUICKBAD'), cutQ=p.includes('QUICKCUT'), old=p.includes('OLDREPORT');
    const txs=cutQ?Array.from({length:12},(_,i)=>({date:`2026-09-${10+i}`,sym:'MSFT',name:'Microsoft',side:'buy',qty:1,px:400+i,amount:400+i,ccy:'USD',fee:1}))
      :old?[{date:'2025-11-02',sym:'MSFT',name:'Microsoft',side:'div',qty:null,px:null,amount:12,ccy:'USD',fee:null},{date:'2025-12-15',sym:'MSFT',name:'Microsoft',side:'buy',qty:1,px:380,amount:380,ccy:'USD',fee:1}]:[];
    // MULTI:mar / jun / sep: three reports of one account, of three dates (the newest is today's)
    const multi=(p.match(/MULTI:(\w+)/)||[])[1], ago=n=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
    const tx=(d,side,qty,amt)=>({date:d,sym:'MSFT',name:'Microsoft',side,qty,px:qty?amt/qty:null,amount:amt,ccy:'USD',fee:null});
    const MULTI={mar:{asOf:ago(200),pos:[{sym:'MSFT',name:'Microsoft',qty:1,ccy:'USD',costIls:1400,group:'tech'}],tx:[tx(ago(210),'buy',1,380)]},
      jun:{asOf:ago(100),pos:[{sym:'MSFT',name:'Microsoft',qty:2,ccy:'USD',costIls:2800,group:'tech'}],tx:[tx(ago(130),'buy',1,400),tx(ago(110),'div',null,5)]},
      sep:{asOf:TODAY,pos:[{sym:'MSFT',name:'Microsoft',qty:3,ccy:'USD',costIls:4200,group:'tech'},{sym:'NVDA',name:'NVIDIA',qty:6,ccy:'USD',costIls:3150,group:'tech'}],tx:[tx(ago(40),'buy',1,420),tx(ago(30),'div',null,6),tx(ago(20),'sell',0.5,215)]}};
    // MULTI2: the same three, all newer than the table, so whichever read ends first replaces the holdings (ORDER: fwd, the
    // oldest read ends first; rev, the newest). DERIVED: a file with transactions only (the holdings worked out from them).
    const m2=(p.match(/MULTI2:(\w+)/)||[])[1], M2D={mar:ago(10),jun:ago(5),sep:TODAY};
    // FLOWSCREEN: a screen of deposits and currency conversions, no holdings. MONTHLY: an app's table of monthly results
    // (no years shown), the last three months and this one, by the month in Israel
    const ilNow=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Jerusalem'})), mo=k=>new Date(ilNow.getFullYear(),ilNow.getMonth()-k,1).getMonth()+1;
    const FLOWS={broker:'exc',asOf:null,cashIls:0,cashUsd:0,positions:[],monthly:[],transactions:[{date:ago(200),side:'deposit',amount:600,ccy:'ILS'},{date:ago(198),side:'fx',amount:94.92,ccy:'ILS',toCcy:'USD',toAmount:null},
      {date:ago(230),side:'fx',amount:187.58,ccy:'USD',toCcy:'ILS',toAmount:690.3},{date:ago(260),side:'deposit',amount:100,ccy:'ILS'}]};
    const MONTHS={broker:'exc',asOf:null,cashIls:0,cashUsd:0,positions:[],transactions:[],monthly:[{month:mo(3),value:10100,ccy:'ILS',returnPct:1,flow:10000},{month:mo(2),value:10302,ccy:'ILS',returnPct:2,flow:0},
      {month:mo(1),value:15000,ccy:'ILS',returnPct:-1.5,flow:5000},{month:mo(0),value:15100,ccy:'ILS',returnPct:0.67,flow:0}]};
    const readOut=q=>{if(p.includes('FLOWSCREEN'))return JSON.stringify(FLOWS); if(p.includes('MONTHLY'))return JSON.stringify(MONTHS);
      if(m2&&MULTI[m2]){const D=MULTI[m2]; return JSON.stringify({broker:'exc',asOf:M2D[m2],cashIls:100,cashUsd:0,positions:D.pos,transactions:D.tx.map((t,i)=>({...t,date:ago(9-i)}))})}
      if(multi&&MULTI[multi]){const D=MULTI[multi]; return JSON.stringify({broker:'exc',asOf:D.asOf,cashIls:100,cashUsd:0,positions:D.pos,transactions:D.tx})}
      if(p.includes('DERIVED'))return JSON.stringify({broker:'exc',asOf:TODAY,cashIls:0,cashUsd:0,derived:true,positions:[{sym:'AMZN',name:'Amazon',qty:4,ccy:'USD',costIls:2600,group:'tech'}],transactions:[tx(ago(3),'buy',4,700)]});
      const pos=q&&bad?[{sym:'MSFT',name:'Microsoft',qty:2,ccy:'USD',costIls:4200,group:'tech'},{sym:'ZZZQ',name:'Phantom',qty:1,ccy:'USD',costIls:50,group:'tech'}]
        :[{sym:'MSFT',name:'Microsoft',qty:3,ccy:'USD',costIls:4200,group:'tech'},...(bad?[{sym:'NVDA',name:'NVIDIA',qty:6,ccy:'USD',costIls:3150,group:'tech'}]:[])];
      if(p.includes('QUICKSPELL'))pos.push({sym:q?'GOOG':'GOOGL',name:'Alphabet Class A',qty:2,ccy:'USD',costIls:1500,group:'tech'});
      if(q&&p.includes('QUICKGROUP'))pos[0]={...pos[0],group:'cons'};
      return JSON.stringify({broker:q&&p.includes('QUICKACCT')?'blink':'exc',asOf:old?'2025-12-31':TODAY,cashIls:100,cashUsd:0,positions:pos,transactions:txs})};
    const stream=(text,stop)=>{res.writeHead(200,{'content-type':'text/event-stream'}); const ev=(t,d)=>res.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
      ev('message_start',{message:{id:'m',type:'message',role:'assistant',model:J.model,content:[],usage:{input_tokens:2000,output_tokens:1}}});
      ev('content_block_start',{index:0,content_block:{type:'text',text:''}}); ev('content_block_delta',{index:0,delta:{type:'text_delta',text}}); ev('content_block_stop',{index:0});
      ev('message_delta',{delta:{stop_reason:stop},usage:{output_tokens:300}}); ev('message_stop',{}); res.end()};
    if(isRead&&!J.stream){res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({id:'m',type:'message',model:J.model,content:[{type:'text',text:readOut(true)}],stop_reason:'end_turn',usage:{input_tokens:2000,output_tokens:200}})); return}
    if(J.stream&&p.includes('RATE429')){res.writeHead(429,{'content-type':'application/json'}); res.end(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'rate limit'}})); return}
    if(J.stream&&J.model==='claude-haiku-5-5'){
      if(p.includes('QUICKFAIL')){res.writeHead(529,{'content-type':'application/json'}); res.end(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'Overloaded'}})); return}
      await new Promise(r=>setTimeout(r,m2?{fwd:{mar:100,jun:500,sep:900},rev:{mar:900,jun:500,sep:100}}[(p.match(/ORDER:(\w+)/)||[])[1]||'fwd'][m2]:100)); const q=readOut(true); stream(cutQ?q.slice(0,Math.floor(q.length*0.7)):q,cutQ?'max_tokens':'end_turn'); return}
    if(J.stream){await new Promise(r=>setTimeout(r,p.includes('SLOWCHECK')?4000:1500));
      if(J.model==='claude-fable-5-1'&&p.includes('NOFABLE')){res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({type:'error',error:{type:'not_found_error',message:'model: claude-fable-5-1'}})); return}
      stream(readOut(false),'end_turn'); return}
    const text=p.includes('ענה על שאלה')?JSON.stringify({answer:'ביום המסחר האחרון CAT ו-RKLB הזיזו את התיק יותר מכל השאר. כדאי לבדוק את הריכוז בטכנולוגיה מול הכללים שלך.',nav:['risk']})
      :p.includes('הסבר את התיק שלי')?JSON.stringify({summary:'בתיק 12 ניירות, ורובו בטכנולוגיה. התיק מאוזן היטב. שלושת הגדולים הם 39.5% ממנו.'}):'{"answer":""}';
    res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({id:'m',type:'message',content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}))});
  await new Promise(r=>claude.listen(0,'127.0.0.1',r));
  Object.assign(process.env,{ANTHROPIC_BASE_URL:'http://127.0.0.1:'+claude.address().port,ANTHROPIC_API_KEY:'sk-test',OWNER_EMAIL:'owner@example.com',OWNER_PASSWORD:'owner-pass-123'});
  const real=globalThis.fetch; globalThis.fetch=async(u,o)=>String(u).startsWith('http://127.0.0.1')?real(u,o):new Response('{}',{status:404});
  const {Store}=await import('../server/store.js'); const {createApp,bootstrap}=await import('../server/index.js'); const {buildSite}=await import('../tools/build.js');
  buildSite(R); store=new Store(':memory:'); bootstrap(store); docs=fixture();
  for(const [p,d] of Object.entries(docs))store.setDoc(p,d,{silent:true}); store.setDoc('quotes/c_NVDA',closes(),{silent:true});
  store.addUser({email:'new@example.com',password:'friend-pass-1',role:'friend'});
  store.addUser({email:'n2@example.com',password:'friend-pass-3',role:'friend'});   // a second new user, for a security nobody held
  store.addUser({email:'r3@example.com',password:'friend-pass-4',role:'friend'});   // a new user who reads statements and saves
  store.addUser({email:'r4@example.com',password:'friend-pass-5',role:'friend'});   // a new user who reads several statements at once
  R5=store.addUser({email:'r5@example.com',password:'friend-pass-6',role:'friend'}).id;   // a new user who keeps deposits and monthly results, no holdings
  // a second partner with a portfolio of their own (one holding, KO), to check that nobody's data reaches another
  const p2=store.addUser({email:'p2@example.com',password:'friend-pass-2',role:'friend'});
  store.setDoc(`data/users/${p2.id}/portfolio`,{positions:[{sym:'KO',name:'Coca-Cola',qty:3,ccy:'USD',acct:'exc',group:'cons',costIls:700}],cash:[],asOf:{}},{silent:true});
  const app=createApp({store,siteDir:R+'site',jobs:false}); srv=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))}); U='http://127.0.0.1:'+srv.address().port+'/';
  try{browser=await (await import('playwright')).chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']})}catch(e){browser=null}
});
after(async()=>{try{await browser?.close()}catch(e){} srv?.close(); claude?.close()});

// a signed-in page; prices are not fetched (the page's "update now" answers at once), the profile and tip prompts wait
async function open(W=390,{who='owner',route=null,prompts=false}={}){
  const ctx=await browser.newContext({viewport:{width:W,height:W<600?844:900},locale:'he-IL',timezoneId:'Asia/Jerusalem'});
  if(!prompts)await ctx.addInitScript(()=>{try{localStorage.setItem('tr_prof_later',new Date().toISOString());localStorage.setItem('tr_bot_tip','x')}catch(e){}});
  await ctx.route('**/*',r=>{const u=r.request().url(); if(route&&route(r,u))return; if(u.includes('/api/prices')){r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"cached":true}'});return} if(u.startsWith(U)||u.startsWith('data:')||u.startsWith('blob:'))r.continue(); else r.abort()});
  const pg=await ctx.newPage(); pg.errs=[]; pg.on('pageerror',e=>pg.errs.push(e.message));
  const [email,pw]=who==='new'?['new@example.com','friend-pass-1']:who==='n2'?['n2@example.com','friend-pass-3']:who==='r3'?['r3@example.com','friend-pass-4']:who==='r4'?['r4@example.com','friend-pass-5']:who==='r5'?['r5@example.com','friend-pass-6']:who==='p2'?['p2@example.com','friend-pass-2']:['owner@example.com','owner-pass-123'];
  await pg.goto(U); await pg.waitForSelector('#tcLogin'); await pg.fill('#tcEmail',email); await pg.fill('#tcPass',pw); await pg.click('#tcLogin button');
  await pg.waitForFunction(who==='new'||who==='n2'||who==='r3'||who==='r4'||who==='r5'?()=>!!document.querySelector('.wrap.nopf'):()=>/₪/.test(document.getElementById('kTotal')?.textContent||''),null,{timeout:20000});
  await pg.waitForTimeout(600); if(!prompts)await pg.evaluate(()=>{const t=document.getElementById('botTip'); if(t)t.hidden=true});
  return {ctx,pg};
}
const tab=(pg,t)=>pg.evaluate(id=>{(document.getElementById('tab_'+id)||document.querySelector('[data-tab="'+id+'"]')).click()},t);
const T={timeout:120000};
const skip=()=>!browser;

test('navigation: a bottom bar on a phone, the menu at the side on a wide screen, the drawer in between',T,async t=>{
  if(skip())return t.skip('no browser');
  const st=pg=>pg.evaluate(()=>{const d=e=>getComputedStyle(e).display, sb=document.getElementById('tabsbar').getBoundingClientRect();
    return {page:document.body.dataset.page,bar:d(document.getElementById('botbar')),edge:d(document.getElementById('navtab')),menu:sb.left>=0&&getComputedStyle(document.getElementById('tabsbar')).visibility==='visible',
      cur:[...document.querySelectorAll('#botbar [aria-current="page"]')].map(x=>x.dataset.bb).join(),more:document.querySelector('#botbar [data-bb="more"]').getAttribute('aria-expanded'),focus:document.activeElement&&(document.activeElement.id||document.activeElement.dataset.bb)}});
  {const {ctx,pg}=await open(390); let s=await st(pg);
    assert.equal(s.bar,'flex'); assert.equal(s.edge,'none'); assert.equal(s.cur,'overview');
    await pg.click('#botbar [data-bb="mine"]'); s=await st(pg); assert.equal(s.page,'mine'); assert.equal(s.cur,'mine');
    await pg.click('#botbar [data-bb="more"]'); await pg.waitForTimeout(300); s=await st(pg); assert.ok(s.menu); assert.equal(s.more,'true');
    await pg.click('#tab_history'); await pg.waitForTimeout(300); s=await st(pg);
    assert.equal(s.page,'history'); assert.equal(s.more,'false'); assert.equal(s.focus,'more','focus goes back to "עוד"');
    const lay=await pg.evaluate(()=>{const bb=document.getElementById('botbar').getBoundingClientRect().top, f=document.getElementById('chatFab').getBoundingClientRect(); return {bb,fab:f.bottom}});
    assert.ok(lay.fab<=lay.bb,'the chat button sits above the bar');
    assert.deepEqual(pg.errs,[]); await ctx.close()}
  {const {ctx,pg}=await open(820); const s=await st(pg); assert.equal(s.bar,'none'); assert.notEqual(s.edge,'none'); assert.ok(!s.menu); await ctx.close()}
  {const {ctx,pg}=await open(1280); let s=await st(pg); assert.ok(s.menu); assert.equal(s.edge,'none'); assert.equal(s.bar,'none');
    const ox=await pg.evaluate(()=>{const sb=document.getElementById('tabsbar').getBoundingClientRect(), h=document.getElementById('hero').getBoundingClientRect(); return h.right<=sb.left&&document.documentElement.scrollWidth<=innerWidth+1});
    assert.ok(ox,'the content sits beside the menu, no sideways scroll'); await ctx.close()}
});

test('the plan: one cash balance for the whole portfolio, the same in the stocks and the funds tracks',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await tab(pg,'plan'); await pg.waitForTimeout(400);
  const bal=async k=>{await pg.evaluate(k=>document.querySelector(`[data-track="${k}"]`).click(),k); await pg.waitForTimeout(400); return pg.evaluate(()=>document.getElementById('pBal').textContent)};
  const a=await bal('stocks'), b=await bal('idx'), c=await bal('stocks');
  assert.match(a,/₪/); assert.equal(a,b,'the same balance in both tracks'); assert.equal(a,c);
  assert.match(await pg.evaluate(()=>document.getElementById('pBalD').textContent),/משותף לשני המסלולים/);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the plan: a fund bought in the stocks track opens for its quantity and price like a share, and both can be open',T,async t=>{
  if(skip())return t.skip('no browser');
  const plan0=store.getDoc('plan/main').data;
  store.setDoc('plan/main',{...plan0,idx:plan0.idx||{start:'',opening:0,mode:'manual',items:[],deposits:[],purchases:[]},mode:'rotate',items:[{sym:'TA125',status:'todo',note:''},...plan0.items],deposits:[...(plan0.deposits||[]),{id:'dx',month:new Date().toISOString().slice(0,7),amount:5000,at:new Date().toISOString()}]});
  const {ctx,pg}=await open(390); await tab(pg,'plan'); await pg.waitForTimeout(400);
  await pg.evaluate(()=>document.querySelector('[data-track="stocks"]').click()); await pg.waitForTimeout(300);
  const r=await pg.evaluate(async()=>{const wait=()=>new Promise(r=>setTimeout(r,350)), q=s=>document.querySelector(s);
    for(const sym of ['TA125','MSFT']){const b=q(`input[data-buy="${sym}"]`); if(b&&!b.disabled&&!b.checked){b.click(); await wait()}}
    for(const sym of ['TA125','MSFT']){const b=q(`[data-pa="editBuy"][data-sym="${sym}"]`); if(b){b.click(); await wait()}}
    const open=[...document.querySelectorAll('[data-ebq]')].map(x=>x.dataset.ebq).sort(), lab=(q('[data-ebp="TA125"]')||{}).closest?q('[data-ebp="TA125"]').closest('label').textContent:'';
    const qi=q('[data-ebq="TA125"]'), pi=q('[data-ebp="TA125"]'); qi.value='2'; pi.value='63.4'; q('[data-pa="saveBuy"][data-sym="TA125"]').click(); await wait();
    const still=[...document.querySelectorAll('[data-ebq]')].map(x=>x.dataset.ebq), line=q('input[data-buy="TA125"]').closest('td').textContent;
    return {open,lab,still,line}});
  assert.deepEqual(r.open,['MSFT','TA125'],'a fund and a share open at the same time');
  assert.match(r.lab,/מחיר ליחידה \(₪\)/,'a shekel fund is priced in shekels');
  assert.deepEqual(r.still,['MSFT'],'saving one closes only that one'); assert.match(r.line,/2\s*יח׳ ב-\s*₪63\.40/);
  await pg.screenshot({path:'/tmp/claude-0/-home-claude/b22281cb-4d7c-579a-92b3-f89ef1145114/scratchpad/plan_ta.png',fullPage:false});
  assert.deepEqual(pg.errs,[]);
  await ctx.close(); store.setDoc('plan/main',plan0);
});

test('a company\'s report: the system message in the home page\'s to-do list, the alert, and on its page the day, the findings and the explanation',T,async t=>{
  if(skip())return t.skip('no browser');
  const L0=store.getDoc('research/latest').data, day=new Date(Date.now()-864e5).toISOString().slice(0,10), dmY=d=>{const [y,m,dd]=d.split('-').map(Number); return `${dd}.${m}.${y}`};
  const ai={findings:['הרווח למניה 3.62, מעל לצפי האנליסטים (3.41).','ההכנסות ברבעון $77.70B.'],explain:'הרבעון היה מעל הצפי ברווח ובהכנסות.',headlines:1};
  const rep={q:'2026-09-30',label:'Q3 2026',at:day,ccy:'USD',eps:{a:3.62,e:3.41,s:6.2},rev:77.7e9,ni:27.1e9,find:['הרווח למניה 3.62, מעל לצפי האנליסטים (3.41), הפתעה של +6.2%.'],ai};
  store.setDoc('research/latest',{...L0,companies:{...L0.companies,MSFT:{...(L0.companies.MSFT||{}),rep,next:'2027-01-27'}},
    events:[{sym:'MSFT',name:'Microsoft',date:day,q:'2026-09-30',label:'Q3 2026',text:'דוח Q3 2026',find:rep.find,ai:{findings:ai.findings,explain:ai.explain}}]});
  try{
    const {ctx,pg}=await open(390,{route:(r,u)=>{if(u.includes('/api/news')){r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{title:'Microsoft beats estimates as cloud grows',pub:'Reuters',link:'https://example.com/a',at:'2026-10-21T01:00:00Z'}]})});return true}return false}});
    // the system message on the home page: one item of the to-do list (the separate banner stays hidden: one place, said once)
    const ban=await pg.evaluate(()=>{const b=document.querySelector('#desk li.rep'); return {on:!!b,txt:b?b.textContent:'',old:!document.getElementById('repBan').hidden}});
    assert.ok(ban.on,'shown'); assert.ok(!ban.old,'not twice'); assert.match(ban.txt,new RegExp('דוח חדש\\s*Microsoft פרסמה ב-'+dmY(day).split('.').slice(0,2).join('\\.')+' את הדוח לרבעון Q3 2026\\. הרווח למניה 3\\.62'));
    // the alert in בקרה, category דוחות
    assert.ok(await pg.evaluate(()=>window.__model&&window.__model.alerts?window.__model.alerts().items.some(i=>i.key==='rep:MSFT:2026-09-30'&&/Microsoft פרסמה/.test(i.text)):true),'an alert with its own key, for the morning message');
    // to its page from the message
    await pg.evaluate(()=>document.querySelector('#desk li.rep [data-gosec="MSFT"]').click()); await pg.waitForTimeout(1200);
    const r=await pg.evaluate(()=>{const b=document.querySelector('#secPage .repbox'); return b?{h:b.querySelector('h3').textContent,f:[...b.querySelectorAll('.repf li')].map(x=>x.textContent),txt:b.textContent,tbl:!!document.querySelector('#secPage .repbox table')}:null});
    assert.ok(r,'the report box is in view on the page'); assert.equal(r.h,`פורסם דוח ב-${dmY(day)} · Q3 2026`);
    assert.deepEqual(r.f,ai.findings,'Chiko\'s findings'); assert.match(r.txt,/הסבר על הדוח\s*הרבעון היה מעל הצפי ברווח ובהכנסות\./); assert.ok(!r.tbl,'no table of the report\'s figures');
    await pg.evaluate(()=>document.querySelector('#secPage [data-repnews="MSFT"]').click()); await pg.waitForTimeout(600);
    assert.ok(await pg.evaluate(()=>[...document.querySelectorAll('#secPage .replinks a')].some(a=>/cloud grows/.test(a.textContent)&&a.target==='_blank')),'the articles, opening outside');
    // "הבנתי" hides that report's message for good
    await tab(pg,'overview'); await pg.waitForTimeout(300); await pg.evaluate(()=>document.querySelector('#desk li.rep [data-repban]').click()); await pg.waitForTimeout(300);
    assert.ok(await pg.evaluate(()=>!document.querySelector('#desk li.rep'))); await pg.reload(); await pg.waitForTimeout(2500);
    assert.ok(await pg.evaluate(()=>!!document.getElementById('desk').textContent&&!document.querySelector('#desk li.rep')),'not shown again');
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('research/latest',L0)}
});

test('the simple home: one to-do list, the prices\' trust mark, the same total in every view, and the hero on a phone',T,async t=>{
  if(skip())return t.skip('no browser');
  const Q0=store.getDoc('quotes/latest').data, M0=store.getDoc('system/mail'), S0=store.getDoc('settings/main').data;
  try{
    store.setDoc('system/mail',{ready:true,last:{}},{silent:true});
    { // the fixture's two Israeli funds have no source: said once, in the trust row and the hero's chip, and not again in the list
      const {ctx,pg}=await open(390);
      const r=await pg.evaluate(()=>({chip:document.getElementById('kTrust').textContent,chipOn:!document.getElementById('kTrust').hidden,row:document.getElementById('dkTrust').className,txt:document.getElementById('dkTrust').textContent,
        cats:[...document.querySelectorAll('#dkTodo .dk-cat')].map(x=>x.textContent),chk:window.__ux.check(),todo:window.__ux.todo()}));
      assert.ok(r.chipOn); assert.match(r.chip,/חלק מהמחירים לא עדכניים/); assert.match(r.row,/warn/); assert.match(r.txt,/TA125, TA90: לא הגיע מחיר מהבורסה/);
      assert.ok(!r.cats.includes('מחיר'),'the prices are said once, above the list');
      assert.deepEqual(r.chk.bad,[],'no gap between the views'); assert.ok(r.chk.ok.length>=6,'holdings, groups and the exposures add up to the total: '+r.chk.ok.length);
      assert.deepEqual(r.todo.filter(x=>x.sev==='tip').map(x=>x.cat),['מיילים'],'one suggestion at a time: '+JSON.stringify(r.todo));
      assert.ok(r.todo.findIndex(x=>x.sev==='crit')<r.todo.findIndex(x=>x.cat==='מיילים'),'what needs doing comes before the suggestion');
      // a mail kind switched on from the list: the owner's consent, by a click
      await pg.evaluate(()=>document.querySelector('[data-uxmail="earnings"]').click()); await pg.waitForTimeout(1600);
      assert.equal(store.getDoc('settings/main').data.mail.earnings,true,'saved');
      assert.ok(await pg.evaluate(()=>!document.querySelector('[data-uxmail="earnings"]')&&!!document.querySelector('[data-uxmail="backup"]')),'only the one still off is offered');
      await pg.evaluate(()=>document.querySelector('[data-uxx="tr_tipmail"]').click()); await pg.waitForTimeout(300);
      assert.ok(await pg.evaluate(()=>!document.querySelector('[data-uxmail]')),'"לא עכשיו" hides it');
      assert.deepEqual(await pg.evaluate(()=>window.__ux.todo().filter(x=>x.sev==='tip').map(x=>x.cat)),['מה חדש'],'then the next suggestion');
      // one switch for the level of detail: at the end of the home page and in the settings, not above everything
      const vs=await pg.evaluate(()=>{const p=document.querySelector('[data-pane="overview"]'), v=p.querySelector('.viewsw'); return {n:document.querySelectorAll('.viewsw').length,last:!!v&&[...p.children].indexOf(v.closest('.viewwrap'))>[...p.children].indexOf(document.getElementById('holdSec'))}});
      assert.deepEqual(vs,{n:2,last:true});
      await pg.evaluate(()=>document.querySelector('[data-pane="overview"] [data-view="calm"]').click()); await pg.waitForTimeout(300);
      assert.ok(await pg.evaluate(()=>getComputedStyle(document.getElementById('tapeRow')).display==='none'&&getComputedStyle(document.getElementById('sideMore')).display==='none'),'simple: no ticker, two figures');
      await pg.evaluate(()=>document.querySelector('[data-pane="overview"] [data-view="full"]').click()); await pg.waitForTimeout(300);
      // the hero on a phone: two figures, the rest one tap away
      const hv=()=>pg.evaluate(()=>[...document.querySelectorAll('.hero .side>.stat')].filter(x=>getComputedStyle(x).display!=='none').length);
      assert.equal(await hv(),2); await pg.click('#sideMore'); assert.equal(await hv(),6); await pg.click('#sideMore'); assert.equal(await hv(),2);
      // the funds' date, in plain words behind "למה?"
      await pg.evaluate(()=>document.querySelector('#rows [data-term="fundpx"]').click()); await pg.waitForTimeout(200);
      assert.match(await pg.evaluate(()=>document.getElementById('termPop').textContent),/מחיר אחד ביום, אחרי סגירת הבורסה/);
      await pg.evaluate(()=>document.querySelector('[data-termx]').click());
      assert.equal(await pg.evaluate(()=>document.getElementById('hMixH').textContent),'פיזור לפי הקבוצות שלך');
      await pg.evaluate(()=>document.querySelector('.mixnote [data-term="grpsec"]').click()); await pg.waitForTimeout(200);
      assert.match(await pg.evaluate(()=>document.getElementById('termPop').textContent),/קבוצה או ענף\?.*השווי הכולל זהה/);
      assert.ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)); assert.deepEqual(pg.errs,[]); await ctx.close();
    }
    { // every price current: "המחירים עדכניים", and the funds' official date with its reason
      const now=new Date().toISOString(), st={...(Q0.stale||{})}; delete st.TA125; delete st.TA90;
      store.setDoc('quotes/latest',{...Q0,stale:st,lag:{},updatedAt:now,attemptAt:now,meta:{...(Q0.meta||{}),TA125:{src:'maya',ccy:'ILS',date:new Date(Date.now()-864e5).toISOString().slice(0,10)}}},{silent:true});
      const {ctx,pg}=await open(1280);
      const r=await pg.evaluate(()=>({chip:document.getElementById('kTrust').textContent,row:document.getElementById('dkTrust').className,txt:document.getElementById('dkTrust').textContent,side:!!document.getElementById('sideMore').offsetParent}));
      assert.match(r.chip,/המחירים עדכניים/); assert.match(r.row,/ok/); assert.match(r.txt,/קרנות: מחיר רשמי מ-/); assert.ok(!r.side,'all six figures on a wide screen');
      await pg.click('#kTrust'); await pg.waitForTimeout(500);
      assert.ok(await pg.evaluate(()=>document.querySelector('#dkTrust details').open),'the chip opens the details');
      assert.deepEqual(pg.errs,[]); await ctx.close();
    }
  }finally{store.setDoc('quotes/latest',Q0,{silent:true}); if(M0.exists)store.setDoc('system/mail',M0.data,{silent:true}); store.setDoc('settings/main',S0,{silent:true})}
});

test('"האם אני עושה טוב?": the same deposits in S&P 500 and Tel Aviv 125, the yearly return; and the tax if sold today',T,async t=>{
  if(skip())return t.skip('no browser');
  const day=k=>new Date(Date.now()-k*864e5).toISOString().slice(0,10), D=[], C=[], T2=[], X=[];
  for(let k=420;k>=1;k-=3){D.push(day(k)); C.push(+(5000+(420-k)*2).toFixed(2)); T2.push(+(2500+(420-k)*0.5).toFixed(2)); X.push(3.7)}
  store.setDoc('research/bench',{spx:{d:D,c:C},ta125:{d:D,c:T2},fx:{d:D,c:X},names:{spx:'S&P 500',ta125:'ת״א 125'},updatedAt:new Date().toISOString(),source:'בדיקה'},{silent:true});
  try{
    const {ctx,pg}=await open(390);
    // on the home page, one line; the way to the comparison
    const line=await pg.evaluate(()=>document.querySelector('#desk .dk-bench')?.textContent||'');
    assert.match(line,/מול המדד: אותן הפקדות ב-S&P 500 היו שוות היום ₪[\d,]+, ₪[\d,]+ (פחות|יותר) מהתיק שלך/);
    await pg.evaluate(()=>document.querySelector('#desk .dk-bench [data-goto="bench"]').click()); await pg.waitForTimeout(900);
    const r=await pg.evaluate(()=>({page:document.body.dataset.page,top:document.getElementById('hBench').getBoundingClientRect().top,rows:[...document.querySelectorAll('#benchBox .bn-r b')].filter(b=>!b.classList.contains('n')).map(b=>b.textContent),
      lead:document.querySelector('#benchBox .bn-lead').textContent,sub:document.getElementById('benchSub').textContent,note:document.querySelector('#benchBox .note').textContent,vals:[...document.querySelectorAll('#benchBox .bn-v b')].map(b=>b.textContent)}));
    assert.equal(r.page,'history'); assert.ok(r.top>=0&&r.top<500,'in view');
    assert.deepEqual(r.rows,['התיק שלך','S&P 500','ת״א 125']);
    assert.match(r.lead,/אילו אותן הפקדות היו נכנסות ל-S&P 500 באותם ימים, הן היו שוות היום ₪[\d,]+/); assert.match(r.sub,/הפקדות ומשיכות · ₪21,000 · מ-/);
    assert.match(r.note,/פחות משנה, ולכן התשואה היא לכל התקופה/); assert.match(r.note,/בלי הדיבידנדים שלהם, בלי עמלות ובלי מס/); assert.match(r.note,/השוואה עובדתית, לא המלצה/);
    assert.equal(r.vals.length,9); assert.equal(await pg.evaluate(()=>[...document.querySelectorAll('#benchBox .bn-v .k')].filter(k=>k.textContent==='תשואה בתקופה').length),3,'under a year: the return for the period, for all three');
    // the same total of deposits as the hero ("מול ההפקדות")
    assert.match(await pg.evaluate(()=>document.getElementById('kDepD').textContent),/הופקדו ₪21,000/);
    // the tax if sold today
    const x=await pg.evaluate(()=>({txt:document.getElementById('taxBox').textContent,cells:[...document.querySelectorAll('#taxBox .cell .k')].map(k=>k.textContent),sub:document.getElementById('taxSub').textContent}));
    assert.deepEqual(x.cells,['הרווחים','ההפסדים','הרווח אחרי קיזוז','מס משוער']); assert.match(x.sub,/שיעור 25% · הערכה/);
    assert.match(x.txt,/הפסדים שמקזזים את הרווחים: .*RKLB/); assert.match(x.txt,/זה חישוב, לא המלצה למכור/);
    // צ׳יקו has both
    const f=await pg.evaluate(()=>{const F=window.__ux.facts(); return F.err?F:{b:!!F.benchmark,t:!!F.tax}});
    assert.deepEqual(f,{b:true,t:true});
    assert.ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)); assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.deleteDoc('research/bench')}
});

test('a lighter page: the PDF and Excel libraries are not loaded at the start, and come when a statement or an export needs them',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); const libs=[]; pg.on('request',r=>{if(/\/lib\//.test(r.url()))libs.push(r.url().split('/lib/')[1])});
  assert.deepEqual(await pg.evaluate(()=>({pdf:!!window.pdfjsLib,x:!!window.XLSX,j:!!window.jspdf})),{pdf:false,x:false,j:false});
  await tab(pg,'mine'); await pg.waitForTimeout(2600);
  assert.deepEqual(await pg.evaluate(()=>({pdf:!!window.pdfjsLib,worker:!!window.pdfjsWorker,x:!!window.XLSX})),{pdf:true,worker:true,x:true},'ready before a statement is picked');
  assert.ok(libs.every(u=>/\.js\?v=[0-9a-f]{10}$/.test(u)),libs.join());
  await pg.evaluate(()=>window.__tcLib('jspdf')); assert.ok(await pg.evaluate(()=>!!(window.jspdf&&window.jspdf.jsPDF)));
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('what is used: screens and the parts seen on the screen, per day, in the viewer\'s own account only; shown in the settings',T,async t=>{
  if(skip())return t.skip('no browser');
  const pid=store.userByEmail('p2@example.com').id;
  try{
    const {ctx,pg}=await open(390);
    await tab(pg,'plan'); await pg.waitForTimeout(400); await tab(pg,'risk'); await pg.waitForTimeout(400); await tab(pg,'overview'); await pg.waitForTimeout(300);
    await pg.evaluate(()=>document.getElementById('deskSec').scrollIntoView({block:'start'}));
    await pg.waitForFunction(()=>{const u=window.__ux.use(), d=u.days&&u.days[Object.keys(u.days).sort().pop()]; return !!(d&&d['s:hDesk'])},null,{timeout:10000}).catch(()=>{});   // a part counts after a second and a half in view
    await pg.evaluate(()=>window.__ux.useSave()); await pg.waitForTimeout(500);
    const d=store.getDoc('usage/main').data, day=Object.keys(d.days).sort().pop(), D=d.days[day];
    assert.ok(D['tab:plan']>=1&&D['tab:risk']>=1&&D['tab:overview']>=1,JSON.stringify(D)); assert.ok(D['s:hDesk']>=1,'a part seen on the screen counts: '+JSON.stringify(D));
    await tab(pg,'settings'); await pg.waitForTimeout(600);
    const u=await pg.evaluate(()=>({txt:document.getElementById('useBox').textContent,rows:document.querySelectorAll('#useBox table.use tbody tr').length}));
    assert.ok(u.rows>=3); assert.match(u.txt,/מה לעשות בהפקדה הבאה/); assert.match(u.txt,/אחרי שבוע של שימוש/); assert.match(u.txt,/נשמר רק בחשבון שלך/);
    assert.ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)); assert.deepEqual(pg.errs,[]); await ctx.close();
    // a partner's count is in the partner's own data, and the owner cannot read it
    const p=await open(390,{who:'p2'}); await tab(p.pg,'plan'); await p.pg.waitForTimeout(400); await p.pg.evaluate(()=>window.__ux.useSave()); await p.pg.waitForTimeout(500); await p.ctx.close();
    assert.ok(store.getDoc(`data/users/${pid}/usage`).exists,'kept in the partner\'s own data');
    const {access}=await import('../server/store.js'); assert.equal(access({id:'owner',role:'owner'},`data/users/${pid}/usage`),'','the owner does not see it');
  }finally{store.deleteDoc('usage/main'); store.deleteDoc(`data/users/${pid}/usage`)}
});

test('two-step sign-in: switched on in its own page, the login asks for the code, a backup code works once',T,async t=>{
  if(skip())return t.skip('no browser');
  const {b32decode,hotp,step}=await import('../server/totp.js'); const code=sec=>hotp(b32decode(sec),step());
  const u=store.userByEmail('r3@example.com');
  try{
    // the page itself: set up, the key, a first code, the backup codes
    const {ctx,pg}=await open(390,{who:'r3'});
    await pg.goto(U+'security.html'); await pg.waitForSelector('#st'); await pg.click('#st'); await pg.waitForSelector('#key');
    const key=(await pg.textContent('#key')).replace(/\s/g,''); assert.match(key,/^[A-Z2-7]{32}$/);
    assert.match(await pg.getAttribute('a[href^="otpauth:"]','href'),/^otpauth:\/\/totp\/.+secret=[A-Z2-7]{32}/);
    await pg.fill('#cd','000000'); await pg.click('#en'); await pg.waitForTimeout(300); assert.match(await pg.textContent('#er'),/הקוד לא נכון/);
    await pg.fill('#cd',code(key)); await pg.click('#en'); await pg.waitForSelector('.codes li');
    const codes=await pg.$$eval('.codes li',L=>L.map(x=>x.textContent)); assert.equal(codes.length,8);
    assert.ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)); await ctx.close();
    // a new sign-in: the password, then the code
    const c2=await browser.newContext({viewport:{width:390,height:844},locale:'he-IL'}); const p2=await c2.newPage();
    await c2.route('**/*',r=>{const x=r.request().url(); if(x.startsWith(U)||x.startsWith('data:'))r.continue(); else r.fulfill({status:404,body:''})});
    await p2.goto(U); await p2.waitForSelector('#tcLogin'); await p2.fill('#tcEmail','r3@example.com'); await p2.fill('#tcPass','friend-pass-4'); await p2.click('#tcLogin button');
    await p2.waitForSelector('#tcCodeBox:not([hidden])'); assert.match(await p2.textContent('#tcErr'),/הקלד את הקוד מאפליקציית האימות/);
    assert.equal(await p2.getAttribute('#tcOtp','autocomplete'),'one-time-code');
    await p2.fill('#tcOtp',codes[0]); await p2.click('#tcLogin button');
    await p2.waitForFunction(()=>!!document.querySelector('.wrap.nopf')||!document.getElementById('tcGate'),null,{timeout:20000});
    await c2.close();
  }finally{store.totpOff(u.id)}
});

test('finding the way: "לאן להגיע?" by the words people type, "מה חדש", and a short tour that points at one thing at a time',T,async t=>{
  if(skip())return t.skip('no browser');
  {const {ctx,pg}=await open(390);
    const f=await pg.evaluate(()=>['עמלות','לוח','מייל','חיסכון לילד','הפקדה חד','מאיה','דולר'].map(q=>(window.__ux.find(q)[0]||{}).id));
    assert.deepEqual(f,['fees','cal','mail','pots','once','src','fx']);
    assert.deepEqual(await pg.evaluate(()=>window.__ux.find('לוח').map(d=>d.id)),['cal'],'a prefix letter is dropped only for a whole word, not to match inside other words');
    // from the drawer: type, Enter, and the page is there
    await pg.click('#botbar [data-bb="more"]'); await pg.waitForTimeout(300); await pg.fill('#goQ','עמלות'); await pg.waitForTimeout(100);
    assert.match(await pg.evaluate(()=>document.getElementById('goRes').textContent),/^עמלות/);
    await pg.press('#goQ','Enter'); await pg.waitForTimeout(900);
    const r=await pg.evaluate(()=>({page:document.body.dataset.page,menu:document.getElementById('tabsbar').classList.contains('open'),top:document.getElementById('hFees').getBoundingClientRect().top}));
    assert.equal(r.page,'history'); assert.ok(!r.menu,'the drawer closes'); assert.ok(r.top>=0&&r.top<500,'the fees in view: '+r.top);
    // a part of the risk screen opens its fold
    await pg.evaluate(()=>window.__ux.go('exp')); await pg.waitForTimeout(900);
    assert.ok(await pg.evaluate(()=>{const h=document.getElementById('hExp'), b=h.getBoundingClientRect(); return document.body.dataset.page==='risk'&&b.top>=0&&b.top<500&&!!document.getElementById('expBox').offsetParent}));
    // "מה חדש": from the list on the home page, then the dot in the drawer goes out
    await tab(pg,'overview'); await pg.waitForTimeout(300);
    assert.ok(await pg.evaluate(()=>!document.getElementById('sbNewsDot').hidden));
    await pg.evaluate(()=>document.querySelector('#desk [data-uxgo="news"]').click()); await pg.waitForTimeout(300);
    const n=await pg.evaluate(()=>({on:!document.getElementById('newsDlg').hidden,items:document.querySelectorAll('#newsList li').length,fresh:document.querySelectorAll('#newsList li.nw').length}));
    assert.ok(n.on&&n.items>=6&&n.fresh>=6,JSON.stringify(n));
    await pg.evaluate(()=>document.querySelector('#newsList [data-newsgo="cal"]').click()); await pg.waitForTimeout(600);
    assert.equal(await pg.evaluate(()=>document.body.dataset.page),'calendar'); assert.ok(await pg.evaluate(()=>document.getElementById('newsDlg').hidden));
    assert.ok(await pg.evaluate(()=>document.getElementById('sbNewsDot').hidden&&!window.__ux.todo().some(x=>x.cat==='מה חדש')),'seen');
    // the tour: one thing at a time, back and forth, and "דלג" ends it for good
    await tab(pg,'overview'); await pg.evaluate(()=>document.querySelector('#desk [data-uxgo="tour"]').click()); await pg.waitForTimeout(500);
    const st=()=>pg.evaluate(()=>({card:!document.getElementById('tourCard').hidden,step:document.querySelector('#tourCard .sub')?.textContent||'',lit:[...document.querySelectorAll('.tourhl')].map(e=>e.id||e.className).join()}));
    let s=await st(); assert.ok(s.card); assert.match(s.step,/^1 מתוך 8$/); assert.match(s.lit,/worth/);
    await pg.click('#tourCard [data-tour="next"]'); s=await st(); assert.match(s.step,/^2 מתוך/); assert.equal(s.lit,'kTrust');
    await pg.click('#tourCard [data-tour="back"]'); s=await st(); assert.match(s.step,/^1 מתוך/);
    for(let i=0;i<3;i++)await pg.click('#tourCard [data-tour="next"]'); s=await st(); assert.match(s.step,/^4 מתוך/); assert.match(await pg.evaluate(()=>document.getElementById('tourCard').textContent),/בבלינק: "ההשקעות שלי"/);
    const ov=await pg.evaluate(()=>{const c=document.getElementById('tourCard').getBoundingClientRect(), b=document.getElementById('botbar').getBoundingClientRect(); return c.bottom<=b.top+1});
    assert.ok(ov,'the card sits above the bottom bar');
    await pg.click('#tourCard [data-tour="end"]'); s=await st(); assert.ok(!s.card); assert.equal(s.lit,'');
    assert.ok(await pg.evaluate(()=>!window.__ux.todo().some(x=>x.cat==='סיור')),'not offered again');
    assert.ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)); assert.deepEqual(pg.errs,[]); await ctx.close()}
  {const {ctx,pg}=await open(1280); // on a wide screen the search is in the menu at the side, and the header's button goes to it
    await pg.click('#btnGo'); await pg.waitForTimeout(200); assert.equal(await pg.evaluate(()=>document.activeElement&&document.activeElement.id),'goQ');
    await pg.fill('#goQ','לוח מסחר'); await pg.click('#goRes [data-goto="cal"]'); await pg.waitForTimeout(400); assert.equal(await pg.evaluate(()=>document.body.dataset.page),'calendar');
    assert.deepEqual(pg.errs,[]); await ctx.close()}
  {const {ctx,pg}=await open(390,{who:'new'}); // before there is a portfolio: the tour skips what is not there yet
    await pg.evaluate(()=>document.querySelector('#welcome [data-uxgo="tour"]').click()); await pg.waitForTimeout(500);
    assert.match(await pg.evaluate(()=>document.querySelector('#tourCard .sub').textContent),/^1 מתוך 5$/); assert.deepEqual(pg.errs,[]); await ctx.close()}
});

test('fees: the table\'s running total ends at the headline, the fees saved apart in their own month',T,async t=>{
  if(skip())return t.skip('no browser');
  const H0=store.getDoc('history/main').data, H=JSON.parse(JSON.stringify(H0)), A=H.accounts.find(a=>a.acct==='exc');
  A.feeUsdPerTrade=1; A.trades=[{date:'2026-08-03',sym:'MSFT',qty:1,px:500,ccy:'USD'},{date:'2026-09-10',sym:'NVDA',qty:2,px:180,ccy:'USD',fee:2.5},{date:'2026-09-21',sym:'TA125',qty:10,px:62,ccy:'ILS',feeIls:3}];
  A.fees=[{date:'2026-09-30',amount:12,ccy:'ILS'},{date:'2026-08-31',amount:1,ccy:'USD'}];
  store.setDoc('history/main',H);
  try{
    const {ctx,pg}=await open(390); await tab(pg,'history'); await pg.waitForTimeout(800);
    const r=await pg.evaluate(()=>{const rows=[...document.querySelectorAll('#feeRows tr')]; return {tot:document.getElementById('feTot').textContent,last:rows.at(-1).lastElementChild.textContent.trim(),n:rows.length,sep:document.getElementById('feeRows').textContent}});
    assert.equal(r.n,2,'two months'); assert.equal(r.last.replace(/[−\s]/g,''),r.tot.replace(/[−\s]/g,''),'the running total ends at the headline: '+JSON.stringify(r));
    assert.match(r.sep,/מתוכן ₪12 שנרשמו בנפרד/);
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('history/main',H0)}
});

test('savings goals: a sub-tab per goal in the plan, holdings copied from the portfolio, nothing counted in the portfolio\'s value',T,async t=>{
  if(skip())return t.skip('no browser');
  const S0=store.getDoc('settings/main').data;
  try{
    const {ctx,pg}=await open(390); const total0=await pg.evaluate(()=>document.getElementById('kTotal').textContent);
    await tab(pg,'plan'); await pg.waitForTimeout(400);
    await pg.evaluate(()=>document.querySelector('.subtabs [data-pot="new"]').click()); await pg.waitForTimeout(400);
    assert.match(await pg.evaluate(()=>document.querySelector('#potBox h3').textContent),/בוא נפתח חיסכון לפי מטרה/);
    await pg.fill('#pf_name','חיסכון לנועה'); await pg.fill('#pf_target','100000'); await pg.fill('#pf_date','2036-09'); await pg.fill('#pf_monthly','500');
    await pg.evaluate(()=>document.querySelector('#potBox [data-potkind="child"]').click()); await pg.waitForTimeout(200);
    assert.equal(await pg.inputValue('#pf_name'),'חיסכון לנועה','what was typed stays after choosing the kind');
    await pg.click('#potCreate'); await pg.waitForTimeout(500);
    let r=await pg.evaluate(()=>({chips:[...document.querySelectorAll('[data-pane="pots"] .subtabs .chip')].map(c=>c.textContent),on:(document.querySelector('[data-pane="pots"] .subtabs .chip[aria-pressed="true"]')||{}).textContent,h:document.querySelector('#potBox .pothead h3').textContent}));
    assert.ok(r.chips.includes('חיסכון לנועה')&&r.chips.includes('+ חיסכון חדש'),'the goal is a sub-tab of its own: '+r.chips); assert.equal(r.on,'חיסכון לנועה'); assert.match(r.h,/חיסכון לנועה/);
    // copy 1 MSFT from the portfolio, and add VOO by its symbol
    await pg.selectOption('#potCopy','MSFT'); await pg.fill('#potCopyQ','1'); await pg.click('#potCopyGo'); await pg.waitForTimeout(400);
    await pg.fill('#potSym','VOO'); await pg.fill('#potSymQ','2'); await pg.click('#potAddGo'); await pg.waitForTimeout(1500);
    r=await pg.evaluate(()=>({rows:[...document.querySelectorAll('#potBox .potit')].map(x=>x.querySelector('.sym').textContent),txt:document.getElementById('potBox').textContent,ox:document.documentElement.scrollWidth<=innerWidth+1}));
    await pg.evaluate(()=>window.scrollTo(0,0)); await pg.screenshot({path:'/tmp/claude-0/-home-claude/b22281cb-4d7c-579a-92b3-f89ef1145114/scratchpad/pots.png',fullPage:true});
    assert.deepEqual(r.rows,['MSFT','VOO']); assert.ok(r.ox,'no sideways scroll on a phone'); assert.match(r.txt,/שווי החיסכון/); assert.match(r.txt,/הועתק מהתיק/); assert.match(r.txt,/לא נספרים בשווי התיק/);
    const sv=store.getDoc('settings/main').data.pots; assert.equal(sv.length,1); assert.equal(sv[0].name,'חיסכון לנועה'); assert.equal(sv[0].target,100000); assert.equal(sv[0].items[0].qty,1); assert.ok(sv[0].items[0].costIls>0,'a share of the cost goes with the copy');
    const me=(store.users().find(u=>u.role==='owner')||{}).id, w=store.getDoc('watch/'+me).data; assert.ok(w&&w.pots.includes('VOO'),'the server will price it');
    await tab(pg,'overview'); await pg.waitForTimeout(300);
    assert.equal(await pg.evaluate(()=>document.getElementById('kTotal').textContent),total0,'the portfolio\'s value is untouched');
    // deleting asks twice
    await tab(pg,'plan'); await pg.waitForTimeout(300); await pg.evaluate(()=>document.querySelector('[data-pane="plan"] .subtabs [data-tab="pots"]:not([data-pot="new"])').click()); await pg.waitForTimeout(300);
    await pg.click('#potDel'); await pg.waitForTimeout(200); assert.match(await pg.textContent('#potDel'),/בטוח/); await pg.click('#potDel'); await pg.waitForTimeout(1500);
    assert.equal((store.getDoc('settings/main').data.pots||[]).length,0);
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('settings/main',S0)}
});

test('funds in the holdings and in the mix: a fund in another group is named, so the two numbers add up',T,async t=>{
  if(skip())return t.skip('no browser');
  const P0=store.getDoc('portfolio/main').data, Q0=store.getDoc('quotes/latest').data;
  store.setDoc('portfolio/main',{...P0,positions:P0.positions.concat([{acct:'exc',sym:'DRAM',name:'Roundhill Memory ETF',qty:12,ccy:'USD',costIls:1700,group:'tech'}])});
  store.setDoc('quotes/latest',{...Q0,prices:{...Q0.prices,DRAM:46.45},prev:{...Q0.prev,DRAM:46}});
  try{
    const {ctx,pg}=await open(390); await pg.click('#botbar [data-bb="mine"]'); await pg.waitForTimeout(400);
    await pg.evaluate(()=>document.querySelector('.hkind:not(.hccy) [data-hv="fund"]').click()); await pg.waitForTimeout(400);
    const line=await pg.evaluate(()=>[...document.querySelectorAll('#rows tr.sec')].map(t=>t.textContent).join('|'));
    assert.match(line,/קרנות: \d+ ניירות/); assert.match(line,/מתוכן ₪[\d,]+ בקרן אחת שבפיזור לפי הקבוצות נספרות בקבוצה אחרת: DRAM \(טכנולוגיה\)/);
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('portfolio/main',P0); store.setDoc('quotes/latest',Q0)}
});

test('a one-time deposit: in the plan\'s balance, in the portfolio\'s value and in the month, apart from the monthly deposit',T,async t=>{
  if(skip())return t.skip('no browser');
  const PL0=store.getDoc('plan/main').data;
  try{
    const {ctx,pg}=await open(390); const num=x=>+String(x).replace(/[^\d.−-]/g,'').replace('−','-');
    const tot0=num(await pg.evaluate(()=>document.getElementById('kTotal').textContent));
    await tab(pg,'plan'); await pg.waitForTimeout(400); await pg.evaluate(()=>document.querySelector('[data-track="stocks"]').click()); await pg.waitForTimeout(300);
    const bal0=num(await pg.textContent('#pBal'));
    await pg.fill('#onceAmt','2000'); await pg.fill('#onceNote','בונוס'); await pg.click('#onceAdd'); await pg.waitForTimeout(1500);
    const r=await pg.evaluate(()=>({bal:document.getElementById('pBal').textContent,list:document.getElementById('onceList').textContent,cur:document.querySelector('#ladRows tr.cur').textContent,st:document.getElementById('onceState').textContent}));
    assert.equal(num(r.bal),bal0+2000,'the plan\'s balance'); assert.match(r.list,/₪2,000.*מניות.*בונוס/); assert.match(r.cur,/\+ ₪2,000 חד פעמית · בונוס/); assert.match(r.st,/נכנסה ליתרה להשקעה ולשווי התיק/);
    const d=(store.getDoc('plan/main').data.deposits||[]).filter(x=>x.once); assert.equal(d.length,1); assert.equal(d[0].amount,2000);
    // the month's regular deposit is its own: ticking and unticking it leaves the one-time deposit
    const ym=await pg.evaluate(()=>document.querySelector('#ladRows tr.cur [data-dep]').dataset.dep);
    await pg.evaluate(ym=>document.getElementById('dep_'+ym).click(),ym); await pg.waitForTimeout(600); await pg.evaluate(ym=>document.getElementById('dep_'+ym).click(),ym); await pg.waitForTimeout(1200);
    assert.equal((store.getDoc('plan/main').data.deposits||[]).filter(x=>x.once).length,1,'still there');
    await tab(pg,'overview'); await pg.waitForTimeout(300);
    assert.equal(num(await pg.evaluate(()=>document.getElementById('kTotal').textContent)),tot0+2000,'the portfolio\'s value, as cash');
    await tab(pg,'plan'); await pg.waitForTimeout(300); await pg.click('#onceList [data-oncedel]'); await pg.waitForTimeout(1500);
    assert.equal((store.getDoc('plan/main').data.deposits||[]).filter(x=>x.once).length,0); assert.equal(num(await pg.textContent('#pBal')),bal0);
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('plan/main',PL0)}
});

test('the trading calendar: both markets per day, the month\'s special days, the hours in Israel time',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390);
  // from the button at the top of every page, and from the menu
  await pg.click('#btnCal'); await pg.waitForTimeout(300); assert.equal(await pg.evaluate(()=>document.body.dataset.page),'calendar');
  await tab(pg,'overview'); await pg.click('#botbar [data-bb="more"]'); await pg.waitForTimeout(300); await pg.click('#tab_calendar'); await pg.waitForTimeout(300);
  const r=await pg.evaluate(()=>({days:document.querySelectorAll('#calBox [data-calday]').length,flags:document.querySelectorAll('#calBox .calgrid .flg').length,now:document.querySelectorAll('#calBox .calnow .mk').length,ox:document.documentElement.scrollWidth<=innerWidth+1}));
  assert.ok(r.days>=28&&r.flags===r.days*2,'every day has a flag per market'); assert.equal(r.now,2); assert.ok(r.ox,'no sideways scroll on a phone');
  // to September 2026: Yom Kippur closes Tel Aviv, Labor Day New York; Chol HaMoed is a short day
  await pg.evaluate(()=>{for(let i=0;i<24;i++){const d=document.querySelector('#calBox h3').textContent; if(/ספטמבר 2026/.test(d))break; const back=/2027|נובמבר 2026|דצמבר 2026|אוקטובר 2026/.test(d); document.querySelector(`#calBox [data-calmv="${back?-1:1}"]`).click()}});
  const L=await pg.evaluate(()=>document.querySelector('#calBox .callist').textContent);
  assert.match(L,/21\.9 · תל אביב: אין מסחר · יום כיפור/); assert.match(L,/(^|\D)7\.9 · ארה״ב: אין מסחר · יום העבודה/); assert.match(L,/28\.9 · תל אביב: מסחר 10:00–14:30 · חול המועד סוכות/);
  await pg.click('#calBox [data-calday="2026-09-21"]'); const d=await pg.evaluate(()=>document.querySelector('#calBox .calday').textContent);
  assert.match(d,/תל אביב: אין מסחר/); assert.match(d,/ארה״ב: 16:30–23:00/);
  await pg.screenshot({path:'/tmp/claude-0/-home-claude/b22281cb-4d7c-579a-92b3-f89ef1145114/scratchpad/cal.png',fullPage:false});
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('a click on text inside a tab does not move the page',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await tab(pg,'risk'); await pg.waitForTimeout(500);
  const r=await pg.evaluate(async()=>{window.scrollTo(0,1200); await new Promise(r=>setTimeout(r,200)); const y0=scrollY;
    const p=[...document.querySelectorAll('[data-pane="risk"] p,[data-pane="risk"] span')].find(e=>{const b=e.getBoundingClientRect();return b.top>100&&b.bottom<innerHeight-150&&!e.closest('button,a,summary,label,[data-fold]')});
    p.dispatchEvent(new MouseEvent('click',{bubbles:true})); await new Promise(r=>setTimeout(r,200)); return {y0,y1:scrollY}});
  assert.ok(r.y0>0); assert.equal(r.y1,r.y0); await ctx.close();
});

test('my portfolio: cards on a phone, a table on a wide screen; privacy and deletion live in the settings',T,async t=>{
  if(skip())return t.skip('no browser');
  for(const W of [390,1280]){const {ctx,pg}=await open(W); await tab(pg,'mine'); await pg.waitForTimeout(400);
    const e=await pg.evaluate(()=>{const tr=document.querySelector('#pfRows tr'), r=tr.getBoundingClientRect();
      return {disp:getComputedStyle(tr).display,inside:[...tr.children].every(td=>{const c=td.getBoundingClientRect();return c.left>=r.left-1&&c.right<=r.right+1}),
        qty:document.querySelector('#pfRows [data-pf="qty"]').getBoundingClientRect().width,ox:document.documentElement.scrollWidth>innerWidth+1}});
    if(W===390){assert.equal(e.disp,'grid'); assert.ok(e.qty>=90,'quantity is wide enough to read')} else assert.equal(e.disp,'table-row');
    assert.ok(e.inside&&!e.ox);
    const where=await pg.evaluate(()=>['privPanel','srcPanel','princPanel','wipePanel'].map(id=>document.getElementById(id).closest('[data-pane]').dataset.pane));
    assert.deepEqual(where,['settings','settings','settings','settings']); await ctx.close()}
  // an emptied table, saved: the page goes to the same delete confirmation in the settings, and nothing is deleted yet
  const {ctx,pg}=await open(390); await tab(pg,'mine'); await pg.waitForTimeout(300);
  await pg.evaluate(()=>{let x; while((x=document.querySelector('[data-pfdel]')))x.click(); document.getElementById('btnPfSave').click()}); await pg.waitForTimeout(600);
  const s=await pg.evaluate(()=>({page:document.body.dataset.page,ask:!document.getElementById('wipeAsk').hidden}));
  assert.deepEqual(s,{page:'settings',ask:true}); assert.equal(store.getDoc('portfolio/main').data.positions.length,docs['portfolio/main'].positions.length);
  await ctx.close();
});

test('a new user: the portfolio first; the profile comes after it, without e-mail and phone',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390,{who:'new',prompts:true}); await pg.waitForTimeout(3500);
  let s=await pg.evaluate(()=>({dlg:!document.getElementById('profDlg').hidden,fresh:document.getElementById('fresh').textContent,sugg:[...document.querySelectorAll('#anaSugg .sg')].map(x=>x.textContent)}));
  assert.equal(s.dlg,false,'no questions before there is a portfolio'); assert.match(s.fresh,/עוד אין כאן תיק/);
  await pg.evaluate(()=>{const t=document.getElementById('botTip'); if(t)t.hidden=true}); await pg.click('#botbar [data-bb="mine"]');
  await pg.fill('#listText','MSFT 1 1500'); await pg.click('#btnList'); await pg.click('#btnPfSave');
  // the first result is real: the price of the new holding is read again after the save, so the explanation has a value
  await pg.waitForFunction(()=>/מה יש בתיק/.test([...document.querySelectorAll('#anaOut .ana-card')].pop()?.textContent||''),null,{timeout:15000}); await pg.waitForTimeout(300);
  assert.match(await pg.evaluate(()=>[...document.querySelectorAll('#anaOut .ana-card')].pop().textContent),/הכללים עדיין ברירת המחדל של הדף/,'rules nobody chose are named as the default');
  s=await pg.evaluate(()=>({ana:!document.getElementById('anaBox').hidden,dlg:!document.getElementById('profDlg').hidden,card:[...document.querySelectorAll('#anaOut .ana-ch h3')].map(h=>h.textContent).pop(),sys:document.querySelector('#anaOut .msg.sys')?.textContent||''}));
  assert.ok(s.ana&&!s.dlg,'צ׳יקו explains the new portfolio first'); assert.equal(s.card,'הסבר התיק שלך'); assert.match(s.sys,/ההסבר הראשון/);
  await pg.evaluate(()=>document.querySelector('#anaBox .chat-x').click());
  await pg.waitForFunction(()=>{const t=document.getElementById('botTip'); if(t&&!t.hidden){const x=t.querySelector('[data-bottip]:not([data-bottip="go"])'); x&&x.click()} return !document.getElementById('profDlg').hidden},null,{timeout:15000});
  const f=await pg.evaluate(()=>({email:document.getElementById('pfEmail').closest('label').hidden,phone:document.getElementById('pfPhone').closest('label').hidden}));
  assert.deepEqual(f,{email:true,phone:true}); assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the plan chart: the real deposits up to today, the same total as the headline, then the plan from there',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); const dep=await pg.evaluate(()=>document.getElementById('kDepD').textContent.match(/הופקדו (₪[\d,]+)/)?.[1]);
  await tab(pg,'plan'); await pg.waitForFunction(()=>/עד היום/.test(document.getElementById('projNote').textContent),null,{timeout:10000});
  const c=await pg.evaluate(()=>({note:document.getElementById('projNote').textContent,legend:document.querySelector('#chart').closest('.panel').querySelector('.legend').textContent}));
  t.diagnostic(c.note);
  assert.ok(dep&&c.note.includes('הופקדו '+dep),'the chart\'s money in today is the headline\'s: '+dep+' / '+c.note);
  assert.match(c.note,/במניות לפי העלות/); assert.match(c.legend,/מלא: בפועל/);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the look-back: a withdrawal is never "deposited"; more out than in is named as a likely misread',T,async t=>{
  if(skip())return t.skip('no browser');
  let {ctx,pg}=await open(390); await tab(pg,'history'); await pg.waitForTimeout(400);
  const card=()=>pg.evaluate(()=>{const sec=[...document.querySelectorAll('#backWrap section')][0], c=[...sec.querySelectorAll('.cell')];
    const get=k=>c.find(x=>x.querySelector('.k').textContent===k); return {dep:get('הופקד לחשבון').textContent.replace(/\u200E/g,''),res:get('תוצאה מול ההפקדות').textContent,txt:sec.textContent.replace(/\u200E/g,'')}});
  // ₪18,000 and ₪1,200 in the fixture; a withdrawal of ₪500 read from a screen, then one of ₪40,000
  const H0=store.getDoc('history/main').data, put=(...w)=>{const H=JSON.parse(JSON.stringify(H0)); H.accounts[0].deposits.push(...w.map(a=>({date:H.accounts[0].deposits[2].date,amount:-a,inDep:true}))); store.setDoc('history/main',H,{silent:true})};
  try{
    put(500); await ctx.close(); ({ctx,pg}=await open(390)); await tab(pg,'history'); await pg.waitForTimeout(400);
    let c=await card(); assert.match(c.dep,/^הופקד לחשבון₪19,200/,'deposits only: '+c.dep); assert.match(c.dep,/נמשכו ₪500 \(משיכה אחת\), נטו ₪18,700/); assert.match(c.txt,/משיכה מהחשבון/); assert.match(c.res,/על מה שהופקד נטו/);
    // more taken out than put in: no negative "deposited", no percent, and a note that it is probably misread
    put(500,40000); await ctx.close(); ({ctx,pg}=await open(390)); await tab(pg,'history'); await pg.waitForTimeout(400);
    c=await card(); assert.match(c.dep,/^הופקד לחשבון₪19,200/); assert.match(c.dep,/נטו −₪21,300/); assert.match(c.res,/אין אחוז/); assert.match(c.txt,/כנראה הפקדות נקראו כמשיכות/);
  }finally{store.setDoc('history/main',H0,{silent:true})}
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the funds track: a fixed amount for each fund every month, the sum is the track\'s deposit, a purchase per fund per month',T,async t=>{
  if(skip())return t.skip('no browser');
  const plan0=store.getDoc('plan/main').data, set0=store.getDoc('settings/main').data;
  try{
    const {ctx,pg}=await open(390); await tab(pg,'plan'); await pg.click('[data-track="idx"]'); await pg.waitForTimeout(300);
    // build the funds' plan from the funds held (TA125, TA90), then a fixed amount for each
    if(await pg.isVisible('#planOb'))await pg.click('#obGo'); await pg.waitForTimeout(300);
    assert.ok(await pg.isVisible('#kindFix'),'the choice is there in the funds track'); await pg.click('#kindFix'); await pg.waitForTimeout(300);
    const amts=await pg.$$('[data-amt]'); assert.equal(amts.length,2);
    await amts[0].fill('200'); await amts[0].dispatchEvent('change'); await pg.waitForTimeout(200);
    await (await pg.$$('[data-amt]'))[1].fill('150'); await (await pg.$$('[data-amt]'))[1].dispatchEvent('change'); await pg.waitForTimeout(300);
    let s=await pg.evaluate(()=>({trk:document.getElementById('trkI').textContent,tot:document.getElementById('trkTot').textContent,note:document.getElementById('kindNote').textContent,
      inp:document.getElementById('inMonthlyIdx').value,off:document.getElementById('inMonthlyIdx').disabled,end:document.getElementById('pEnd').textContent,
      row:[...document.querySelectorAll('#ladRows tr')][1].textContent,dep:[...document.querySelectorAll('#ladRows tr')][1].querySelector('[data-dep]').nextElementSibling.textContent}));
    assert.match(s.trk,/₪350 בחודש · סכום קבוע ל-2 קרנות/); assert.match(s.tot,/סך ההפקדה החודשית: ₪950, מתוכם ₪600 למניות ו-₪350 למדדים/);
    assert.match(s.note,/₪350/); assert.equal(s.inp,'350'); assert.equal(s.off,true,'the funds\' amount is the sum of the funds'); assert.equal(s.end,'מתמשך');
    assert.match(s.row,/₪200/); assert.match(s.row,/₪150/,'each fund every month, with its own amount'); assert.equal(s.dep,'₪350');
    // a deposit and one fund bought this month: next month the same fund is still to buy
    await pg.evaluate(()=>{const r=document.querySelector('#ladRows tr.cur'); r.querySelector('[data-dep]').click()}); await pg.waitForTimeout(300);
    await pg.evaluate(()=>{const r=document.querySelector('#ladRows tr.cur'); r.querySelector('[data-buy]').click()}); await pg.waitForTimeout(300);
    s=await pg.evaluate(()=>{const rows=[...document.querySelectorAll('#ladRows tr')], i=rows.findIndex(r=>r.classList.contains('cur'));
      return {cur:[...rows[i].querySelectorAll('[data-buy]')].map(x=>x.checked),next:[...rows[i+1].querySelectorAll('[data-buy]')].map(x=>x.checked),done:document.getElementById('pDone').textContent}});
    assert.deepEqual(s.cur,[true,false]); assert.deepEqual(s.next,[false,false],'a purchase belongs to its month'); assert.equal(s.done,'1 קניות');
    await pg.waitForTimeout(900); const saved=store.getDoc('plan/main').data.idx;
    assert.equal(saved.mode,'fixed'); assert.deepEqual(saved.items.map(i=>i.amt).sort(),[150,200]); assert.equal(saved.purchases.length,1); assert.equal(store.getDoc('settings/main').data.monthlyIdx,350);
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('plan/main',plan0,{silent:true}); store.setDoc('settings/main',set0,{silent:true})}
});

test('dividends: the way of a dividend, what came in per security with its tax and where it went, and what the tax costs over the years',T,async t=>{
  if(skip())return t.skip('no browser');
  const H0=store.getDoc('history/main').data, H=JSON.parse(JSON.stringify(H0)), b=H.accounts.find(a=>a.acct==='blink');
  b.trades.push({date:H.accounts[0].deposits[0].date,sym:'KO',qty:0,px:0,ccy:'USD',div:true,total:15,tax:5},{date:H.accounts[0].deposits[1].date,sym:'KO',qty:0.1,px:70,ccy:'USD',div:true,total:7});
  store.setDoc('history/main',H,{silent:true});
  try{
    const {ctx,pg}=await open(390); await tab(pg,'forecast'); await pg.waitForFunction(()=>/₪/.test(document.getElementById('dgNet').textContent),null,{timeout:10000});
    const c=await pg.evaluate(()=>({flow:[...document.querySelectorAll('#dgFlow li b')].map(x=>x.textContent),net:document.getElementById('dgNet').textContent,tax:document.getElementById('dgTax').textContent.replace(/\u200E/g,''),
      where:document.getElementById('dgWhere').textContent+' '+document.getElementById('dgWhereD').textContent,row:document.querySelector('#dgRows tr').textContent,note:document.getElementById('dgNote').textContent,
      th:[...document.querySelectorAll('#divRows')[0].closest('table').querySelectorAll('th')].map(x=>x.textContent),divNote:document.getElementById('divNote').textContent,
      cost:document.getElementById('dcTaxCost').textContent,costD:document.getElementById('dcTaxCostD').textContent,flowC:document.getElementById('dcFlow').textContent}));
    assert.deepEqual(c.flow,['החברה מחלקת','מס במקור, בכל תשלום','הנטו נכנס לחשבון','ובתוך שווי התיק']);
    assert.equal(c.net,'₪81','$22 net at 3.7'); assert.match(c.tax,/^−₪/); assert.match(c.where,/הושקעו.*מזומן/,'part reinvested, part in cash: '+c.where);
    assert.match(c.row,/KO/); assert.match(c.row,/0\.1 יח׳/); assert.match(c.row,/≈/,'the reinvested one had no tax shown: estimated');
    assert.match(c.note,/בשורה "דיבידנדים, נטו" בפירוק התוצאה/); assert.ok(c.th.includes('מס במקור ₪'),'the forecast shows the tax as its own column');
    assert.match(c.divNote,/מכל תשלום בנפרד/); assert.match(c.cost.replace(/\u200E/g,''),/^−₪/); assert.match(c.costD,/שהמס הזה היה מרוויח/); assert.match(c.flowC,/^מכל ₪100 דיבידנד: ₪25 מס במקור/);
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('history/main',H0,{silent:true})}
});

test('the spread of the portfolio: a bar or a pie at a click, the same shares, kept for next time',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.waitForSelector('#mixHome:not([hidden])');
  const st=()=>pg.evaluate(()=>{const v=e=>!!e.offsetParent||e.getBoundingClientRect().width>0, pie=document.getElementById('mixPie');
    return {bar:v(document.getElementById('mixBar')),pie:!pie.hasAttribute('hidden')&&pie.getBoundingClientRect().width>0,slices:pie.querySelectorAll('path,circle').length,label:pie.getAttribute('aria-label'),
      list:document.querySelectorAll('#mixList li').length,on:[...document.querySelectorAll('[data-mixv]')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.mixv),
      ctr:pie.querySelector('.ctr')?.textContent,total:document.getElementById('kTotal').textContent,ox:document.documentElement.scrollWidth>innerWidth+1}});
  let s=await st(); assert.deepEqual([s.bar,s.pie,s.on],[true,false,['bar']]);
  await pg.click('[data-mixv="pie"]'); await pg.waitForTimeout(300); s=await st();
  assert.deepEqual([s.bar,s.pie,s.on],[false,true,['pie']]); assert.equal(s.slices,s.list,'a slice for every group in the list');
  assert.match(s.label,/טכנולוגיה \d/); assert.equal(s.ctr,s.total,'the total in the middle is the portfolio\'s'); assert.ok(!s.ox);
  await pg.reload(); await pg.waitForSelector('#mixHome:not([hidden])'); await pg.waitForTimeout(500); s=await st(); assert.deepEqual([s.pie,s.on],[true,['pie']],'kept for next time');
  await pg.click('[data-mixv="bar"]'); await pg.waitForTimeout(200); s=await st(); assert.deepEqual([s.bar,s.pie],[true,false]);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('building a portfolio: the steps in words, a search over the logos, the count of what was chosen, skip goes to the upload',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390,{who:'n2'}); await pg.click('#botbar [data-bb="mine"]'); await pg.waitForTimeout(400);
  const txt=()=>pg.evaluate(()=>({h:document.querySelector('#pickBox summary h3').textContent,step:document.getElementById('pickSub').textContent,cnt:document.getElementById('pickCnt').textContent,
    open:document.getElementById('pickBox').open,go:document.getElementById('btnPickAdd').textContent,skip:document.getElementById('btnPickSkip').textContent,ph:document.getElementById('pickQ').placeholder,
    shown:[...document.querySelectorAll('#pickBox .pick')].filter(t=>!t.hidden&&t.offsetParent).map(t=>t.dataset.pick),none:document.getElementById('pickNone').hidden}));
  let s=await txt();
  assert.deepEqual([s.h,s.step,s.cnt,s.go,s.skip],['בוא נבנה את התיק שלך','שלב 1 מתוך 3','המניות שבחרת: 0','המשך עם הבחירה שלי','דלג, אעלה קובץ בהמשך']); assert.ok(s.open,'open for someone with no portfolio');
  assert.match(s.ph,/למשל NVDA/);
  await pg.fill('#pickQ','nvid'); s=await txt(); assert.deepEqual(s.shown,['NVDA'],'by name, any case');
  await pg.click('#pickBox .pick[data-pick="NVDA"]'); await pg.fill('#pickBox .pick[data-pick="NVDA"] input','2');
  await pg.fill('#pickQ','zzzq'); s=await txt(); assert.deepEqual(s.shown,['NVDA'],'a chosen one stays in sight'); assert.equal(s.none,false,'nothing else found: the search of every exchange is offered');
  assert.equal(s.cnt,'המניות שבחרת: 1');
  await pg.fill('#pickQ',''); await pg.click('#btnPickAdd'); await pg.waitForTimeout(300); s=await txt();
  assert.equal(s.step,'שלב 2 מתוך 3'); assert.match(await pg.evaluate(()=>document.getElementById('pickState').textContent),/^שלב 2 מתוך 3: בדוק את הטבלה/);
  assert.ok(await pg.evaluate(()=>[...document.querySelectorAll('#pfRows [data-pf="sym"]')].some(i=>i.value==='NVDA')),'in the table, waiting to be saved');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('a stock typed by hand beside the statement: its own row, and removing it leaves the statement\'s quantity',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.click('#botbar [data-bb="mine"]'); await pg.waitForTimeout(400);
  await pg.evaluate(()=>{const b=document.getElementById('pickBox'); b.open=true; const a=document.getElementById('pickAcct'); a.value='exc'; a.dispatchEvent(new Event('change',{bubbles:true}))});
  // MSFT: 2 in Excellence from the statement; 3 more typed by hand
  await pg.click('#pickBox .pick[data-pick="MSFT"]'); await pg.fill('#pickBox .pick[data-pick="MSFT"] input','3'); await pg.click('#btnPickAdd'); await pg.waitForTimeout(300);
  const rows=()=>pg.evaluate(()=>[...document.querySelectorAll('#pfRows tr')].filter(tr=>tr.querySelector('[data-pf="sym"]')?.value==='MSFT').map(tr=>({acct:tr.querySelector('[data-pf="acct"]').value,qty:+tr.querySelector('[data-pf="qty"]').value,flag:(tr.querySelector('.flag.pick')||{}).textContent||'',del:+tr.querySelector('[data-pfdel]').dataset.pfdel})));
  let r=await rows();
  assert.deepEqual(r.map(x=>[x.acct,x.qty,x.flag]),[['exc',2,''],['exc',3,'נוסף ידנית, בנוסף לדוח']],'the statement\'s row untouched, the typed one beside it');
  assert.match(await pg.evaluate(()=>document.getElementById('pickState').textContent),/בלי לגעת בכמות מהדוח: MSFT \(2 מהדוח \+ 3 ידנית\)/);
  assert.ok(!(await pg.evaluate(()=>document.getElementById('dupBox')?.textContent||'')).includes('MSFT'),'not reported as the same security twice');
  // typed again: the hand row is replaced, never doubled
  await pg.click('#pickBox .pick[data-pick="MSFT"]'); await pg.fill('#pickBox .pick[data-pick="MSFT"] input','4'); await pg.click('#btnPickAdd'); await pg.waitForTimeout(300);
  r=await rows(); assert.deepEqual(r.map(x=>x.qty),[2,4]);
  // removing the hand row: the statement's 2 stay
  await pg.click(`#pfRows [data-pfdel="${r[1].del}"]`); await pg.waitForTimeout(300);
  r=await rows(); assert.deepEqual(r.map(x=>[x.qty,x.flag]),[[2,'']]);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('unknown stays unknown: a missing P/E, holdings without data, dates from another year',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(1280); await tab(pg,'ratings'); await pg.waitForTimeout(800);
  const r=await pg.evaluate(()=>{const cell=sym=>{const tr=[...document.querySelectorAll('#rateRows tr')].find(t=>t.querySelector('.sym')?.textContent.trim()===sym); return tr?tr.children[4].textContent.trim():null};
    return {rklb:cell('RKLB'),unh:cell('UNH'),notes:[...document.querySelectorAll('#rateRows td[colspan]')].map(t=>t.textContent)}});
  assert.match(r.rklb,/^הפסד/,'a company that loses money'); assert.match(r.unh,/^—/,'a P/E the source does not give');
  assert.ok(r.notes.some(x=>/קרנות ותעודות סל: .*TA125/.test(x))&&r.notes.some(x=>/אין כרגע נתונים: PG/.test(x)),JSON.stringify(r.notes));
  await ctx.close();
});

test('the chat: what it answers from; an answer is marked as interpretation, with the time of its data',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.click('#chatFab'); await pg.waitForTimeout(500);
  const h=await pg.evaluate(()=>({hello:document.querySelector('#anaOut .hello-l')?.textContent||'',sugg:[...document.querySelectorAll('#anaSugg .sg')].map(x=>x.textContent),acct:getComputedStyle(document.getElementById('tcAcct')).display}));
  assert.match(h.hello,/על מה אני עונה/); assert.match(h.hello,/לא המלצות/); assert.ok(h.sugg.includes('האם אני עומד בתוכנית?'),'there is a monthly plan');
  assert.equal(h.acct,'none','the account button steps aside while the chat fills the phone');
  await pg.fill('#anaQ','מה הסיכון הכי גדול בתיק שלי?'); await pg.click('#anaForm .chat-send');   // ("why did it move" is answered by the page itself)
  await pg.waitForFunction(()=>!!document.querySelector('#anaOut .ana-basis'),null,{timeout:15000});
  const b=await pg.evaluate(()=>document.querySelector('#anaOut .ana-basis').textContent);
  assert.match(b,/פרשנות/); assert.match(b,/נכון ל-/); assert.match(b,/נבדקו מול הנתונים/); assert.match(b,/לא ייעוץ/);
  const sent=seen.filter(p=>p.includes('ענה על שאלה')).pop()||''; assert.ok(sent&&!/@example\.com/.test(sent),'no e-mail address goes to Claude');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('charts: shapes as well as colors, 12px labels, named axes, gaps and reconstructed months marked',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390);
  for(const [tb,svg] of [['history','svg3'],['forecast','svg2'],['plan','svg']]){await tab(pg,tb); await pg.waitForTimeout(700);
    const c=await pg.evaluate(id=>{const s=document.getElementById(id); return {f11:s.querySelectorAll('[font-size="11"]').length,sq:s.querySelectorAll('rect[fill="var(--s2)"]').length,ci:s.querySelectorAll('circle[fill="var(--s1)"]').length,hollow:s.querySelectorAll('circle[fill="var(--surface)"]').length,
      leg:[getComputedStyle(document.querySelector('[data-pane]:not([hidden]) .legend i.lg-l1'),'::after').borderRadius,getComputedStyle(document.querySelector('[data-pane]:not([hidden]) .legend i.lg-l2'),'::after').borderRadius]}},svg);
    assert.equal(c.f11,0,tb+': labels 12px'); assert.deepEqual(c.leg,['50%','1.5px'],tb+': legend circle and square');
    if(tb!=='plan')assert.ok(c.sq>=1&&c.ci>=1,tb+': lines end in a square and a circle');
    if(tb==='history')assert.ok(c.hollow>=1,'a reconstructed month is a hollow dot')}
  assert.ok(await pg.evaluate(()=>/ציר אופקי: שנים מהיום/.test(document.querySelector('[data-pane="forecast"]').textContent)));
  await tab(pg,'search'); await pg.waitForTimeout(500); await pg.evaluate(()=>window.__srch.open('NVDA')); await pg.waitForTimeout(1500);
  await pg.evaluate(()=>document.querySelector('[data-rng="1y"]').click()); await pg.waitForTimeout(600);
  const n=await pg.evaluate(()=>document.getElementById('secChartNote').textContent);
  assert.match(n,/בדולרים/); assert.match(n,/בלי דיבידנדים/); assert.match(n,/באפור: תקופה בלי נתונים/);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('small screens: nothing important is cut off at 320px, no control under 24px at 390px',T,async t=>{
  if(skip())return t.skip('no browser');
  {const {ctx,pg}=await open(320); const cut=[];
    for(const tb of ['overview','mine','plan','forecast','risk','search','history','settings']){await tab(pg,tb); await pg.waitForTimeout(500);
      cut.push(...await pg.evaluate(()=>[...document.querySelectorAll('[data-pane]:not([hidden]) *, .hero *')].filter(e=>{const c=getComputedStyle(e);return e.tagName!=='INPUT'&&c.textOverflow==='ellipsis'&&e.scrollWidth>e.clientWidth+1&&e.getBoundingClientRect().width>0&&!e.classList.contains('agp')}).map(e=>e.id||e.className)))}
    assert.deepEqual(cut,[]); await ctx.close()}
  {const {ctx,pg}=await open(390); const small=[];
    for(const tb of ['overview','mine','plan','forecast','risk','history','settings']){await tab(pg,tb); await pg.waitForTimeout(500);
      small.push(...await pg.evaluate(()=>[...document.querySelectorAll('[data-pane]:not([hidden]) :is(button,a[href],select,summary,input:not([type=hidden]):not([type=file]))')].filter(e=>{const r=e.getBoundingClientRect(); if(!r.width||!r.height)return false;
        if((e.type==='checkbox'||e.type==='radio')&&e.closest('label')&&e.closest('label').getBoundingClientRect().height>=24)return false; if(e.tagName==='A'&&e.parentElement&&e.parentElement.textContent.trim().length>e.textContent.trim().length+20)return false;
        return r.width<24||r.height<24}).map(e=>(e.id||e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))))}
    assert.deepEqual(small,[]); await ctx.close()}
});

test('hard cases: a large portfolio, prices from yesterday, a broken server answer',T,async t=>{
  if(skip())return t.skip('no browser');
  const P0=store.getDoc('portfolio/main').data, Q0=store.getDoc('quotes/latest').data;
  try{ // 70 more holdings that have only the statement's price
    const P={...P0,positions:[...P0.positions,...Array.from({length:70},(_,i)=>({sym:'Z'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26),name:'Test '+i,qty:1+i%4,ccy:'USD',acct:i%2?'exc':'blink',group:'tech',costIls:300+i,px:80+i}))]};
    store.setDoc('portfolio/main',P,{silent:true});
    const {ctx,pg}=await open(390); const r=await pg.evaluate(()=>({rows:document.querySelectorAll('#rows tr').length,marked:document.querySelectorAll('#rows .pxold').length,ox:document.documentElement.scrollWidth>innerWidth+1}));
    assert.ok(r.rows>=82&&!r.ox,JSON.stringify(r)); assert.ok(r.marked>=70,'a price from the statement is marked'); assert.deepEqual(pg.errs,[]); await ctx.close();
  }finally{store.setDoc('portfolio/main',P0,{silent:true})}
  try{ // the last prices are from yesterday: nothing calls them live
    const old=new Date(Date.now()-30*36e5).toISOString(); store.setDoc('quotes/latest',{...Q0,updatedAt:old,attemptAt:old},{silent:true});
    const {ctx,pg}=await open(390); const r=await pg.evaluate(()=>(document.querySelector('#desk .sub')?.textContent||'')+' | '+document.getElementById('holdSub').textContent);
    assert.doesNotMatch(r,/מסחר חי/); assert.match(r,/המחירים האחרונים שהתקבלו|עודכנו/); await ctx.close();
  }finally{store.setDoc('quotes/latest',Q0,{silent:true})}
  { // the server answers once with an HTML page: the page says so (not "an empty portfolio"), then loads by itself
    const ctx=await browser.newContext({viewport:{width:390,height:844}}); let broken=1;
    await ctx.addInitScript(()=>{try{localStorage.setItem('tr_prof_later',new Date().toISOString());localStorage.setItem('tr_bot_tip','x')}catch(e){}});
    await ctx.route('**/*',r=>{const u=r.request().url(); if(u.includes('/api/db/doc?path=portfolio%2Fmain')&&broken>0){broken--; r.fulfill({status:200,contentType:'text/html',body:'<html>proxy error</html>'});return}
      if(u.includes('/api/prices')){r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});return} if(u.startsWith(U)||u.startsWith('data:'))r.continue(); else r.abort()});
    const pg=await ctx.newPage(); await pg.goto(U); await pg.waitForSelector('#tcLogin'); await pg.fill('#tcEmail','owner@example.com'); await pg.fill('#tcPass','owner-pass-123'); await pg.click('#tcLogin button');
    await pg.waitForFunction(()=>!document.getElementById('loadErr').hidden,null,{timeout:10000});
    const during=await pg.evaluate(()=>({err:document.getElementById('loadErr').textContent,nopf:!!document.querySelector('.wrap.nopf')}));
    assert.match(during.err,/לא תקינה/); assert.equal(during.nopf,false,'a failed load is not shown as an empty portfolio');
    await pg.waitForFunction(()=>/₪/.test(document.getElementById('kTotal').textContent)&&document.getElementById('loadErr').hidden,null,{timeout:20000});
    await ctx.close();
  }
});

test('why it moved: computed by the page in six parts, the parts add up, nothing is sent to Claude',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); const n0=seen.length;
  await pg.click('#kWhy'); await pg.waitForFunction(()=>[...document.querySelectorAll('#anaOut .ana-sec h4')].some(h=>/מה עדיין לא ידוע/.test(h.textContent)),null,{timeout:10000});
  const c=await pg.evaluate(()=>{const card=[...document.querySelectorAll('#anaOut .msg.bot')].pop(); return {h:[...card.querySelectorAll('.ana-sec h4')].map(h=>h.textContent.replace(/^\d+\.\s*/,'')),txt:card.textContent,
    hero:document.getElementById('kDay').textContent, sums:window.__model&&window.__model.why?window.__model.why():null}});
  assert.deepEqual(c.h,['מה קרה?','מה הנתונים מראים?','מה עשוי להסביר את השינוי?','איך התיק מושפע?','מה עדיין לא ידוע?','מה אפשר לבדוק בהמשך?']);
  assert.match(c.txt,/לדף אין מקור כזה/,'no outside cause is named'); assert.match(c.txt,/השפעת שער הדולר על היום/,'the dollar\'s day is unknown in the fixture, and it says so');
  assert.match(c.txt,/נכללו עם מחיר שאינו מהיום: TA125/,'old prices are named'); assert.match(c.txt,/לא המלצה/);
  assert.ok(c.sums&&Math.abs(c.sums.parts-c.sums.total)<0.01,'the holdings\' parts add up to the day\'s change: '+JSON.stringify(c.sums));
  assert.equal(seen.length,n0,'Claude is not asked'); assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('where the result came from: the same bottom line as the headline, six parts that add up to it, the unknowns named',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await tab(pg,'history');
  await pg.waitForFunction(()=>/₪/.test(document.querySelector('#decRows .tot .n')?.textContent||''),null,{timeout:10000});
  const c=await pg.evaluate(()=>{const num=s=>{const m=String(s).replace(/‎/g,'').match(/^([+−-])₪([\d,]+)/); return m?(m[1]==='+'?1:-1)*+m[2].replace(/,/g,''):null};
    return {head:num(document.getElementById('kDep').textContent),tot:num(document.querySelector('#decRows .tot .n').textContent),
      parts:[...document.querySelectorAll('#decRows .drow:not(.tot) .n')].map(e=>num(e.textContent)),note:document.getElementById('decNote').textContent}});
  t.diagnostic('breakdown: '+JSON.stringify({head:c.head,tot:c.tot,parts:c.parts}));
  assert.equal(c.parts.length,6); assert.ok(c.parts.every(x=>x!=null),JSON.stringify(c.parts));
  assert.equal(c.tot,c.head,'the box ends where the headline "מול ההפקדות" is: '+JSON.stringify(c));
  assert.ok(Math.abs(c.parts.reduce((a,b)=>a+b,0)-c.tot)<=3,'the six parts add up to the bottom line (rounding apart): '+JSON.stringify(c));
  assert.match(c.note,/אותו בסיס כמו "מול ההפקדות"/); assert.match(c.note,/מוערכת לפי שער הקנייה הממוצע/,'the fixture has shekel costs and a buy rate, no dollar costs: estimated, and it says so');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the holdings in shekels, in dollars, or both: the chips, the rows, the hero, kept for next time, nothing saved changes',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390);
  const read=async()=>{const o=await pg.evaluate(()=>{const tr=[...document.querySelectorAll('#rows tr')].find(tr=>/MSFT/.test(tr.textContent)), td=tr.querySelectorAll('td'), th=[...document.querySelectorAll('#holdSec thead th')].map(x=>x.textContent);
    return {total:document.getElementById('kTotal').textContent,totalD:document.getElementById('kTotalD').textContent,pnl:document.getElementById('kPnl').textContent,pnlD:document.getElementById('kPnlD').textContent,
      day:document.getElementById('kDay').textContent,val:td[4].textContent,cost:td[6].textContent,row:td[7].textContent,dayRow:td[1].textContent,th:[th[4],th[6]],
      on:[...document.querySelectorAll('.hccy .chip')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.hc),sub:document.getElementById('holdSub').textContent,
      ox:document.documentElement.scrollWidth>innerWidth+1,saved:localStorage.getItem('tr_holdccy')}});
    for(const k in o)if(typeof o[k]==='string')o[k]=o[k].replace(/\u200E/g,''); return o};   // the marks that keep a sign on the left of its number
  let s=await read(); assert.deepEqual(s.on,['ils']); assert.ok(/^₪/.test(s.total)&&/^₪/.test(s.val)&&!/\$/.test(s.row),'shekels to begin with: '+JSON.stringify(s));
  // dollars: the big numbers in dollars, the shekels on the line beneath; MSFT's profit is 2 × (505 − 470), the dollar's move left out
  await pg.click('.hccy [data-hc="usd"]'); await pg.waitForTimeout(300); s=await read();
  assert.deepEqual(s.on,['usd']); assert.equal(s.saved,'usd'); assert.ok(/^\$/.test(s.total)&&/^₪/.test(s.totalD),'the total in dollars, the shekels beneath: '+s.total+' / '+s.totalD);
  assert.ok(/[▲▼] \$/.test(s.day),'the day in dollars: '+s.day); assert.ok(/^\$/.test(s.val)&&/\$940\b/.test(s.cost)&&/\+\$70 \(\+7\.4%\)/.test(s.row),'MSFT: value, cost and profit in dollars: '+JSON.stringify([s.val,s.cost,s.row]));
  assert.ok(/^≈?[+−]\$/.test(s.pnl)&&/בלי שינוי השער/.test(s.pnlD),'the profit in dollars says what it leaves out (≈ when part of it is estimated): '+s.pnl+' / '+s.pnlD);
  assert.deepEqual(s.th,['שווי $','עלות $']); assert.match(s.sub,/בדולרים/); assert.ok(!s.ox);
  // both: shekels first, the dollars on the line beneath, in every money cell
  await pg.click('.hccy [data-hc="both"]'); await pg.waitForTimeout(300); s=await read();
  assert.deepEqual(s.on,['both']); assert.ok(/^₪/.test(s.total)&&/^\$/.test(s.totalD),'both: '+s.total+' / '+s.totalD);
  assert.ok(/₪.*\$/s.test(s.val)&&/₪.*\$940/s.test(s.cost)&&/₪.*\+\$70/s.test(s.row)&&/₪.*\$/s.test(s.dayRow),'each cell shows both: '+JSON.stringify([s.val,s.cost,s.row,s.dayRow]));
  assert.deepEqual(s.th,['שווי ₪ / $','עלות ₪ / $']); assert.match(s.pnlD,/בדולרים/); assert.ok(!s.ox,'nothing pushes the phone sideways');
  assert.equal(store.getDoc('portfolio/main').data.positions.length,docs['portfolio/main'].positions.length,'a view, not a change');
  // the stocks / funds chips still work beside them
  await pg.click('.hkind:not(.hccy) [data-hv="fund"]'); await pg.waitForTimeout(300);
  const hv=await pg.evaluate(()=>({hv:localStorage.getItem('tr_holdv'),hc:localStorage.getItem('tr_holdccy'),rows:document.querySelectorAll('#rows tr:not(.sec)').length}));
  assert.equal(hv.hv,'fund'); assert.equal(hv.hc,'both'); assert.equal(hv.rows,2,'the two index funds');
  assert.deepEqual(pg.errs,[]); await ctx.close();
  // a wide screen: the dollars sit in the table too, and the page opens in the view that was chosen
  const w=await open(1280); const ws=await w.pg.evaluate(()=>({hc:[...document.querySelectorAll('.hccy .chip')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.hc),total:document.getElementById('kTotal').textContent}));
  assert.deepEqual(ws.hc,['ils'],'another browser context starts in shekels'); assert.ok(/^₪/.test(ws.total)); assert.deepEqual(w.pg.errs,[]); await w.ctx.close();
});

test('the dollar cost of a holding: typed in "התיק שלי" on a phone, off for a shekel holding, saved, and the breakdown uses it',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await tab(pg,'mine'); await pg.waitForTimeout(400);
  const f=await pg.evaluate(()=>{const rows=[...document.querySelectorAll('#pfRows tr')], of=(tr,k)=>tr.querySelector(`[data-pf="${k}"]`);
    const us=rows.find(tr=>of(tr,'sym').value==='NVDA'), il=rows.find(tr=>of(tr,'ccy').value==='ILS'), r=us.getBoundingClientRect(), c=of(us,'costUsd').getBoundingClientRect();
    return {sym:of(us,'sym').value,usOff:of(us,'costUsd').disabled,ilOff:of(il,'costUsd').disabled,ilPh:of(il,'costUsd').placeholder,inside:c.left>=r.left-1&&c.right<=r.right+1,
      head:[...document.querySelectorAll('table.pf thead th')].map(th=>th.textContent),ox:document.documentElement.scrollWidth>innerWidth+1}});
  assert.equal(f.usOff,false); assert.equal(f.ilOff,true,'a shekel holding has no dollar cost'); assert.equal(f.ilPh,'—'); assert.ok(f.inside&&!f.ox,'the new field fits the card');
  assert.ok(f.head.includes('עלות כוללת ₪')&&f.head.includes('עלות כוללת $'));
  // typed and saved: the position carries it, and the breakdown's note no longer counts that holding as estimated
  const before=await pg.evaluate(()=>document.getElementById('decNote').textContent);
  await pg.evaluate(sym=>{const tr=[...document.querySelectorAll('#pfRows tr')].find(tr=>tr.querySelector('[data-pf="sym"]').value===sym), el=tr.querySelector('[data-pf="costUsd"]');
    el.value='900'; el.dispatchEvent(new Event('input',{bubbles:true}))},f.sym);
  await pg.click('#btnPfSave'); await pg.waitForFunction(()=>/נשמר/.test(document.getElementById('pfSaved').textContent),null,{timeout:10000}); await pg.waitForTimeout(500);
  const saved=store.getDoc('portfolio/main').data.positions.find(p=>p.sym===f.sym); assert.equal(saved.costUsd,900);
  assert.equal(store.getDoc('portfolio/main').data.positions.find(p=>p.ccy==='ILS').costUsd,null,'a shekel holding is saved without one');
  await tab(pg,'history'); await pg.waitForFunction(()=>/₪/.test(document.querySelector('#decRows .tot .n')?.textContent||''),null,{timeout:10000});
  const after=await pg.evaluate(()=>document.getElementById('decNote').textContent);
  assert.match(before,new RegExp('\\b'+f.sym+'\\b'),'estimated before'); assert.doesNotMatch(after,new RegExp('\\b'+f.sym+'\\b'),'not estimated once the statement\'s dollar cost is there');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the chat answers by itself when asked to decide or to know the future, and says when Claude fails',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.click('#chatFab'); await pg.waitForTimeout(300);
  const ask=async q=>{const n=await pg.evaluate(()=>document.querySelectorAll('#anaOut .msg.bot').length); await pg.fill('#anaQ',q); await pg.click('#anaForm .chat-send');
    await pg.waitForFunction(n=>document.querySelectorAll('#anaOut .msg.bot').length>n&&!document.querySelector('#anaOut .ana-wait'),n,{timeout:15000}); await pg.waitForTimeout(200);
    return pg.evaluate(()=>[...document.querySelectorAll('#anaOut .msg.bot')].pop().textContent)};
  const n0=seen.length;
  assert.match(await ask('האם כדאי לקנות NVDA?'),/לא ממליץ לקנות, למכור או להחזיק/);
  assert.match(await ask('האם CAT תעלה מחר?'),/לא יודע מה יקרה/);
  assert.match(await ask('למה התיק ירד היום?'),/מה עדיין לא ידוע/);
  assert.equal(seen.length,n0,'none of these went to Claude');
  assert.match(await ask('FAILTEST מה מצב התיק?'),/עמוס|נסה שוב|לא התקבלה|צ׳יקו/,'a failure of the AI is said plainly');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('a partner\'s question carries only their own portfolio to Claude',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390,{who:'p2'}); await pg.click('#chatFab'); await pg.waitForTimeout(300); const n0=seen.length;
  await pg.fill('#anaQ','מה יש לבעלים של האתר בתיק?'); await pg.click('#anaForm .chat-send');
  await pg.waitForFunction(n0=>true,n0); await pg.waitForTimeout(2500);
  const sent=seen.slice(n0).join(' ');
  assert.ok(sent.includes('KO'),'their own holding is there'); for(const s of ['RKLB','NVDA','CAT','owner@example.com'])assert.ok(!sent.includes(s),s+' must not be sent');
  await ctx.close();
});

test('exposures and a stress test: the shares, the unknown overlap, a scenario whose bars match its numbers',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.evaluate(()=>{try{localStorage.setItem('tr_fold',JSON.stringify({hExp:true,hStress:true}))}catch(e){}});
  await tab(pg,'risk'); await pg.waitForTimeout(800);
  await pg.evaluate(()=>{for(const id of ['hExp','hStress']){const s=document.querySelector(`section[aria-labelledby="${id}"]`); if(!s.classList.contains('open'))s.querySelector('.fold-t').click()}}); await pg.waitForTimeout(400);
  const e=await pg.evaluate(()=>({txt:document.getElementById('expBox').textContent,ox:document.documentElement.scrollWidth>innerWidth+1}));
  assert.match(e.txt,/הנייר הגדול/); assert.match(e.txt,/חפיפה בין קרנות למניות: לא ידועה/,'fund holdings are unknown, said so'); assert.equal(e.ox,false,'no sideways scroll');
  for(const [k,re] of [['all',/ירידה אחידה של 20%/],['usd',/הדולר יורד ב-10%/],['group',/בקבוצת/]]){
    await pg.click(`#stKind [data-stk="${k}"]`); await pg.waitForTimeout(300);
    const r=await pg.evaluate(()=>{const R=window.__model.stress(), v=[...document.querySelectorAll('#stOut .st-bar [data-v]')].map(b=>+b.dataset.v), d=+document.querySelector('#stOut [data-d]').dataset.d;
      return {R:{before:Math.round(R.before),after:Math.round(R.after),d:Math.round(R.d)},v,d,txt:document.getElementById('stOut').textContent}});
    assert.match(r.txt,re); assert.match(r.txt,/תרחיש, לא תחזית/); assert.match(r.txt,/ההנחות/); assert.match(r.txt,/מה לא נכלל/);
    assert.deepEqual(r.v,[r.R.before,r.R.after],k+': the bars show the computed values'); assert.equal(r.d,r.R.d,k+': the change shown is the computed one');
  }
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('the crisis center: up and down days, old prices, concentration, a missing price, a scenario, the market, no known cause',T,async t=>{
  if(skip())return t.skip('no browser');
  const Q0=store.getDoc('quotes/latest').data, P0=store.getDoc('portfolio/main').data;
  const center=async()=>{const {ctx,pg}=await open(390); await tab(pg,'risk'); await pg.waitForTimeout(300);
    await pg.evaluate(()=>document.querySelector('[data-pane="risk"] .subtabs [data-tab="state"]').click()); await pg.waitForTimeout(700);
    const r=await pg.evaluate(()=>({page:document.body.dataset.page,txt:document.getElementById('stateBody').textContent.replace(/\s+/g,' '),tags:[...document.querySelectorAll('#stateBody .stc h3 .tag')].map(x=>x.textContent),ox:document.documentElement.scrollWidth>innerWidth+1,cur:document.querySelector('#botbar [aria-current="page"]')?.dataset.bb}));
    return {ctx,pg,r}};
  try{
    // a down day (the fixture): the change, who carried it, concentration above the rule, the market, three scenarios
    let {ctx,pg,r}=await center();
    assert.equal(r.page,'state'); assert.equal(r.cur,'risk','the bar marks "בקרה"'); assert.equal(r.ox,false);
    assert.deepEqual([...new Set(r.tags)].sort(),['הסבר','חישוב','נתון','סימולציה'].sort(),'each part says what it is');
    assert.match(r.txt,/השווי זז ב-\u200e?−₪/); assert.match(r.txt,/מעל הכלל שלך/); assert.match(r.txt,/S&P 500/); assert.match(r.txt,/שקלול לפי התיק שלך/);
    assert.match(r.txt,/ירידה אחידה של 20% בכל הניירות/); assert.match(r.txt,/הסיבה לתנועת המחירים \(אין מקור חדשות\)/);
    for(const v of await pg.evaluate(()=>window.__model.stateSim()))assert.ok(r.txt.includes(v),'the scenario shows the computed value '+v);
    assert.deepEqual(pg.errs,[]); await ctx.close();
    // an up day, and no index data: said, not invented
    const up={...Q0,prices:Object.fromEntries(Object.entries(Q0.prices).map(([k,v])=>[k,Q0.prev[k]*1.02])),bench:{}};
    store.setDoc('quotes/latest',up,{silent:true}); ({ctx,pg,r}=await center());
    assert.match(r.txt,/השווי זז ב-\u200e?\+₪/); assert.match(r.txt,/אין כרגע נתוני מדד/); await ctx.close();
    // old prices: the warning says how old, nothing is called live
    const old=new Date(Date.now()-30*36e5).toISOString(); store.setDoc('quotes/latest',{...Q0,updatedAt:old,attemptAt:old},{silent:true}); ({ctx,pg,r}=await center());
    assert.match(r.txt,/מה שמוצג כאן נכון למועד הזה, לא לעכשיו/); assert.doesNotMatch(r.txt,/\(מסחר חי\)/); await ctx.close();
    // a holding without a price: named as missing
    store.setDoc('quotes/latest',Q0,{silent:true}); store.setDoc('portfolio/main',{...P0,positions:[...P0.positions,{sym:'NOPX',name:'No price',qty:1,ccy:'USD',acct:'exc',group:'tech',costIls:100}]},{silent:true});
    ({ctx,pg,r}=await center()); assert.match(r.txt,/NOPX/); await ctx.close();
  }finally{store.setDoc('quotes/latest',Q0,{silent:true}); store.setDoc('portfolio/main',P0,{silent:true})}
});

test('explain my portfolio: six parts from the portfolio, a checked summary, questions that lead to their screen',T,async t=>{
  if(skip())return t.skip('no browser');
  for(const W of [390,1280]){const {ctx,pg}=await open(W); await pg.click('#chatFab'); await pg.waitForTimeout(300); const n0=seen.length;
    assert.equal(await pg.evaluate(()=>document.querySelector('#anaSugg .sg').textContent),'הסבר את התיק שלי','the first suggestion');
    await pg.click('#anaSugg [data-ana="explain"]');
    await pg.waitForFunction(()=>{const c=[...document.querySelectorAll('#anaOut .ana-card')].pop(); return c&&/שאלות שיכולות לעזור/.test(c.textContent)&&!c.querySelector('.ana-wait')},null,{timeout:15000});
    const c=await pg.evaluate(()=>{const card=[...document.querySelectorAll('#anaOut .ana-card')].pop(); return {h:[...card.querySelectorAll('.ana-sec h4')].map(h=>h.textContent.replace(/^\d+\.\s*/,'').replace('?','').trim()),
      sum:card.querySelector('.ana-bl p').textContent,txt:card.textContent,q:[...card.querySelectorAll('.stq dt')].length,go:[...card.querySelectorAll('.stq [data-anav]')].map(b=>b.dataset.anav),
      ox:document.documentElement.scrollWidth>innerWidth+1}});
    assert.deepEqual(c.h,['מה יש בתיק','מה בולט','החשיפות המרכזיות','נקודות ריכוז','מה חסר','שאלות שיכולות לעזור']);
    assert.match(c.sum,/ורובו בטכנולוגיה/,'Claude\'s wording of the summary'); assert.doesNotMatch(c.txt,/מאוזן היטב|39\.5%/,'a judgement and a number not in the data are removed');
    assert.match(c.txt,/2 משפטים של צ׳יקו הוסרו/); assert.match(c.txt,/מחיר שאינו מהמסחר האחרון: TA125/);
    // the fixture's rules are the page's defaults, and nobody said they are theirs: they are named as the default
    assert.match(c.txt,/NVDA הוא 16\.4% מהתיק, מעל ברירת המחדל של הדף לנייר בודד/); assert.match(c.txt,/הכללים עדיין ברירת המחדל של הדף/); assert.doesNotMatch(c.txt,/הכלל שקבעת/);
    assert.match(c.txt,/לא בדיקה אם הוא מתאים לך ולא המלצה/); assert.equal(c.q,4); assert.ok(!c.ox,'nothing sideways');
    const sent=seen.slice(n0).join(' '); assert.ok(sent.includes('by_sector'),'the summary was asked for');
    assert.ok(!/investor_goal\":|goal_after_tax|@example\.com|דנה/.test(sent.split('FACTS:').pop()),'no goal, name or e-mail in the facts sent');
    if(W===1280){await pg.click('#anaOut .ana-card .rl-def [data-rules="mine"]'); await pg.waitForTimeout(1500);
      const t2=await pg.evaluate(()=>[...document.querySelectorAll('#anaOut .ana-card')].pop().textContent);
      assert.match(t2,/מעל הכלל שקבעת לנייר בודד/); assert.doesNotMatch(t2,/הכללים עדיין ברירת המחדל/); assert.ok(store.getDoc('settings/main').data.rulesAt,'saved');
      const d=store.getDoc('settings/main').data; delete d.rulesAt; store.setDoc('settings/main',d,{silent:true})}
    if(W===390){await pg.click('.stq [data-anav="fold:hStress:usd"]'); await pg.waitForTimeout(700);
      const r=await pg.evaluate(()=>({page:document.body.dataset.page,chat:!document.getElementById('anaBox').hidden,kind:document.querySelector('#stKind [aria-pressed="true"]')?.dataset.stk}));
      assert.deepEqual(r,{page:'risk',chat:false,kind:'usd'},'the question opens the dollar scenario')}
    assert.deepEqual(pg.errs,[]); await ctx.close()}
});

test('the level of explanation: chosen in the chat, saved, and the cards say more (or how it is computed)',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.click('#chatFab'); await pg.waitForTimeout(300);
  const pressed=()=>pg.evaluate(()=>[...document.querySelectorAll('#anaOut .hello .lv-ctl [aria-pressed="true"]')].map(b=>b.dataset.lv).join());
  assert.equal(await pressed(),'mid');
  await pg.click('#anaSugg [data-ana="explain"]'); await pg.waitForFunction(()=>{const c=[...document.querySelectorAll('#anaOut .ana-card')].pop(); return c&&/שאלות שיכולות לעזור/.test(c.textContent)&&!c.querySelector('.ana-wait')},null,{timeout:15000});
  const notes=()=>pg.evaluate(()=>{const c=[...document.querySelectorAll('#anaOut .ana-card')].pop(); return [...c.querySelectorAll('.ex-lv b')].map(b=>b.textContent)});
  assert.deepEqual(await notes(),[],'"מכיר את היסודות": no extra notes');
  await pg.click('#anaOut .ana-card .ana-ft .lv-ctl [data-lv="new"]'); await pg.waitForTimeout(300);
  let n=await notes(); assert.ok(n.length>=5&&n.every(x=>/במילים פשוטות/.test(x)),JSON.stringify(n));
  assert.equal(await pressed(),'new','every switch shows the new level');
  assert.equal(await pg.evaluate(()=>document.activeElement&&document.activeElement.dataset.lv),'new','focus stays on the choice after the card is drawn again');
  await pg.click('#anaOut .ana-card .ana-ft .lv-ctl [data-lv="pro"]'); await pg.waitForTimeout(1500);
  n=await notes(); assert.ok(n.length>=5&&n.every(x=>/איך זה מחושב/.test(x)),JSON.stringify(n));
  assert.equal(store.getDoc('settings/main').data.profile.level,'pro','saved in the profile');
  await pg.fill('#anaQ','למה התיק ירד היום?'); await pg.click('#anaForm .chat-send'); await pg.waitForTimeout(800);
  const why=await pg.evaluate(()=>[...document.querySelectorAll('#anaOut .ana-card')].pop().textContent); assert.match(why,/איך זה מחושב: תרומה = כמות/);
  assert.deepEqual(pg.errs,[]); await ctx.close();
  {const d=store.getDoc('settings/main').data; store.setDoc('settings/main',{...d,profile:{...d.profile,level:'mid'}},{silent:true})}
});

test('the weekly summary: how the exposures moved (only from saved prices), what is not known, questions; e-mails need consent',T,async t=>{
  if(skip())return t.skip('no browser');
  const dump=R=>R.R.blocks.map(b=>b.t==='h'?'## '+b.title:b.t==='list'?b.lines.join('\n'):b.text||'').join('\n');
  let {ctx,pg}=await open(1280); await pg.waitForFunction(()=>window.__rep&&window.__rep.ready(),null,{timeout:20000});
  let w=dump(await pg.evaluate(()=>window.__rep.build('week','')));
  assert.match(w,/## שינויים בחשיפות\nלא נשמרו מחירים לתחילת השבוע/,'no saved prices: said, nothing compared'); assert.match(w,/## מה לא ידוע\nהסיבות לתנועות המחירים: לדף אין מקור/);
  assert.match(w,/## שאלות לבדוק/); await ctx.close();
  const d0=store.getDoc('history/daily').data, k=new Date(Date.now()-6*864e5).toISOString().slice(0,10);
  store.setDoc('history/daily',{points:{...d0.points,[k]:{at:new Date(Date.now()-6*864e5).toISOString(),v:24000,dep:19800,fx:3.6,px:{MSFT:470,NVDA:160,AAPL:225,CAT:560,JPM:285,V:340,KO:70,PG:160,UNH:350,RKLB:44,TA125:61}}}},{silent:true});
  try{({ctx,pg}=await open(1280)); await pg.waitForFunction(()=>window.__rep&&window.__rep.ready(),null,{timeout:20000});
    w=dump(await pg.evaluate(()=>window.__rep.build('week','')));
    assert.match(w,/ניירות שנסחרים בדולר: \d+\.\d% ← \d+\.\d%/); assert.match(w,/מהשווי של 11 הניירות שנשמר להם מחיר/); assert.match(w,/לא נשמר מחיר לתחילת השבוע ל-TA90/);
    assert.doesNotMatch(w,/השער בשני הצדדים/,'the rate of that day was saved and used'); assert.match(w,/NVDA זז ‎\+13\.7% השבוע/);
    // the e-mail switches: the owner's, all off until chosen, saved per kind
    await tab(pg,'settings'); await pg.waitForTimeout(600);
    const m0=await pg.evaluate(()=>({hidden:document.getElementById('mailBox').hidden,on:[...document.querySelectorAll('[data-mail]')].map(i=>i.checked)}));
    assert.deepEqual(m0,{hidden:false,on:[false,false,false,false,false]});
    await pg.evaluate(()=>document.getElementById('mail_reports').scrollIntoView({block:'center'})); await pg.click('#mail_reports'); await pg.waitForTimeout(1500);
    assert.deepEqual(store.getDoc('settings/main').data.mail,{reports:true}); assert.deepEqual(pg.errs,[]); await ctx.close();
    ({ctx,pg}=await open(390,{who:'p2'})); assert.equal(await pg.evaluate(()=>document.getElementById('mailBox').hidden),true,'a partner gets no e-mail from the site'); await ctx.close();
  }finally{store.setDoc('history/daily',d0,{silent:true}); const s0=store.getDoc('settings/main').data; delete s0.mail; store.setDoc('settings/main',s0,{silent:true})}
});

test('planned money out and in: entered once, framed in today\'s numbers, asked about, and sent to Claude only when ticked',T,async t=>{
  if(skip())return t.skip('no browser');
  const d=new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+18); const ym=d.toISOString().slice(0,7);
  const {ctx,pg}=await open(390);
  try{
    await tab(pg,'forecast'); await pg.waitForTimeout(400);
    await pg.fill('#flWhen',ym); await pg.selectOption('#flKind','out'); await pg.fill('#flAmt','5000'); await pg.fill('#flNote','מקדמה'); await pg.click('#flAdd'); await pg.waitForTimeout(1500);
    const li=await pg.evaluate(()=>document.getElementById('flowsList').textContent);
    assert.match(li,/משיכה: ₪5,000/); assert.match(li,/בעוד 18 חודשים/); assert.match(li,/מהשווי של התיק היום/); assert.match(li,/לא הערכה של התיק שלך/);
    const sv=store.getDoc('settings/main').data; assert.equal(sv.flows.length,1); assert.equal(sv.flows[0].ym,ym); assert.equal(sv.flowsAI,undefined,'not shared with Claude until ticked');
    await pg.click('#chatFab'); await pg.waitForTimeout(300); await pg.click('#anaSugg [data-ana="explain"]');
    await pg.waitForFunction(()=>{const c=[...document.querySelectorAll('#anaOut .ana-card')].pop(); return c&&/תכננת למשוך/.test(c.textContent)&&!c.querySelector('.ana-wait')},null,{timeout:15000});
    // the rules in the prompt name the field; what matters is whether the facts carry it
    const ask=async()=>{const n0=seen.length; await pg.fill('#anaQ','מה הסיכון הכי גדול בתיק שלי?'); await pg.click('#anaForm .chat-send'); await pg.waitForTimeout(2500); const all=seen.slice(n0).join(' '); assert.ok(all.includes('ענה על שאלה'),'the question was sent'); return all.split('FACTS:').pop()};
    let sent=await ask(); assert.ok(!sent.includes('planned_cash_flows'),'without the tick nothing about it goes');
    await pg.evaluate(()=>document.querySelector('#anaBox .chat-x').click()); await tab(pg,'forecast'); await pg.waitForTimeout(300);
    await pg.evaluate(()=>document.getElementById('flAI').scrollIntoView({block:'center'})); await pg.click('#flAI'); await pg.waitForTimeout(1200);
    assert.equal(store.getDoc('settings/main').data.flowsAI,true);
    await pg.click('#chatFab'); await pg.waitForTimeout(300); sent=await ask();
    assert.ok(sent.includes('planned_cash_flows')&&sent.includes('₪5,000'),'with the tick: date and amount'); assert.ok(!sent.includes('מקדמה'),'never the note');
    await pg.evaluate(()=>document.querySelector('#anaBox .chat-x').click()); await tab(pg,'risk'); await pg.waitForTimeout(300);
    await pg.evaluate(()=>document.querySelector('[data-pane="risk"] .subtabs [data-tab="state"]').click()); await pg.waitForTimeout(700);
    assert.match(await pg.evaluate(()=>document.getElementById('stateBody').textContent),/משיכה של ₪5,000 בעוד 18 חודשים/);
    assert.deepEqual(pg.errs,[]);
  }finally{await ctx.close(); const s0=store.getDoc('settings/main').data; delete s0.flows; delete s0.flowsAI; store.setDoc('settings/main',s0,{silent:true})}
});

test('a security nobody held yet: the first explanation says what it waits for, and appears when the price comes',T,async t=>{
  if(skip())return t.skip('no browser');
  const q0=store.getDoc('quotes/latest').data, {ctx,pg}=await open(390,{who:'n2'});
  try{
    await pg.click('#botbar [data-bb="mine"]'); await pg.fill('#listText','ZZZQ 3 900'); await pg.click('#btnList'); await pg.click('#btnPfSave');
    await pg.waitForFunction(()=>/הסבר התיק שלך/.test(document.getElementById('anaOut')?.textContent||''),null,{timeout:20000}); await pg.waitForTimeout(300);
    const card=()=>pg.evaluate(()=>[...document.querySelectorAll('#anaOut .msg.bot:not(.hello) .ana-card')].map(c=>c.textContent));
    let c=await card(); assert.equal(c.length,1); assert.match(c[0],/המחירים של ZZZQ עוד לא הגיעו/); assert.match(c[0],/כל 5 דקות/);
    await pg.evaluate(()=>document.querySelector('#anaBox .chat-x').click()); await pg.waitForTimeout(200);
    store.setDoc('quotes/latest',{...q0,prices:{...q0.prices,ZZZQ:120},prev:{...q0.prev,ZZZQ:118},updatedAt:new Date().toISOString()});
    await pg.waitForFunction(()=>/מה יש בתיק/.test([...document.querySelectorAll('#anaOut .msg.bot:not(.hello) .ana-card')].pop()?.textContent||''),null,{timeout:15000});
    c=await card(); assert.equal(c.length,1,'the same card, drawn again'); 
    const st=await pg.evaluate(()=>({chat:!document.getElementById('anaBox').hidden,dot:document.getElementById('chatFab').classList.contains('new')}));
    assert.deepEqual(st,{chat:false,dot:true},'the chat does not open by itself; its button shows there is something new');
    assert.deepEqual(pg.errs,[]);
  }finally{await ctx.close(); store.setDoc('quotes/latest',q0,{silent:true})}
});

test('trust: a calculation on the user\'s assumption is never called a forecast; every "תחזית" on screen is a "not"',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(1280); const seen9=[];
  for(const id of ['overview','plan','forecast','risk','settings']){await pg.evaluate(id=>document.querySelector('[data-tab="'+id+'"]').click(),id); await pg.waitForTimeout(400);
    seen9.push(...await pg.evaluate(()=>{const r=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; while(n=w.nextNode()){const e=n.parentElement; if(!e||e.offsetParent===null)continue; for(const m of n.data.matchAll(/(\S+\s+){0,2}תחזית/g))r.push(m[0])} return r}))}
  assert.ok(seen9.length>0,'the page does say what is not a forecast');
  for(const x of seen9)assert.match(x,/(^|\s)ו?לא\s+(\S+\s+)?תחזית/,'"תחזית" only as "not a forecast": '+x);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

// reading a statement: pick the file, then wait for the quick read (the table is filled) and for the check to end
const reader=pg=>{
  const sent=()=>bodies.length, prog=()=>pg.evaluate(()=>document.getElementById('upProg').innerText);
  const rows=()=>pg.evaluate(()=>[...document.querySelectorAll('#pfRows tr')].filter(tr=>tr.querySelector('input[data-pf="sym"]')).map(tr=>({sym:tr.querySelector('input[data-pf="sym"]').value,acct:tr.querySelector('select[data-pf="acct"]').value,qty:+tr.querySelector('input[data-pf="qty"]').value,fixed:tr.classList.contains('fixed'),flag:tr.querySelector('.flag')?.textContent||''})));
  return {
    async pick(name,csv){const n0=sent(); await pg.setInputFiles('#upFile',{name,mimeType:'text/csv',buffer:Buffer.from(csv)});
      // the read starts 1.2 s after the file is picked; until then the previous read's lines are still there
      for(let i=0;i<200&&sent()===n0;i++)await new Promise(r=>setTimeout(r,50)); return n0},
    quick:()=>pg.waitForFunction(()=>/בודק את הקריאה/.test(document.querySelector('#upProg li.now')?.textContent||''),null,{timeout:20000}),
    done:()=>pg.waitForFunction(()=>document.getElementById('btnStop').hidden&&!/צ׳יקו|המנוע/.test(document.querySelector('#upProg li.now')?.textContent||''),null,{timeout:30000}),
    prog,rows,state:()=>pg.evaluate(()=>document.getElementById('upState').textContent)};
};
test('reading a file: a quick read fills the table, the strongest model checks it and corrects it',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(1280); await tab(pg,'mine'); await pg.waitForTimeout(300); const R=reader(pg);
  // the quick read is wrong: the table is filled at once, and the check corrects it
  let n0=await R.pick('statement.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nNVDA,NVIDIA,6,3150\nQUICKBAD,,0,0\n');
  await R.quick(); let rows=await R.rows();
  assert.deepEqual(rows.filter(r=>['MSFT','ZZZQ','NVDA'].includes(r.sym)).map(r=>[r.sym,r.qty]),[['MSFT',2],['ZZZQ',1]],'the quick read is in the table while the check runs');
  assert.deepEqual(bodies.slice(n0).map(b=>[b.model,b.stream,b.max_tokens]).sort(),[['claude-fable-5-1',true,32000],['claude-haiku-5-5',true,32000]],'both reads started together, both with room for a long statement');
  assert.match(await R.state(),/בקריאה מהירה\. המנוע המעמיק של צ׳יקו בודק אותם עכשיו/);
  await R.done(); rows=await R.rows();
  const pick=s=>rows.find(r=>r.sym===s);
  assert.equal(pick('MSFT').qty,3); assert.equal(pick('NVDA').qty,6);
  assert.deepEqual([pick('MSFT').flag,pick('NVDA').flag],['תוקן','תוקן'],'what was corrected is marked');
  assert.equal(pick('ZZZQ').flag,'לבדיקה','what only the quick read saw is kept, for the viewer to check (never removed by itself)');
  let st=await R.state(), pr=await R.prog();
  assert.match(st,/המנוע המעמיק בדק את הדוח ותיקן: MSFT: כמות 3 \(בקריאה המהירה 2\)/); assert.match(st,/NVDA: נוסף/);
  assert.match(st,/לבדיקה שלך: ZZZQ: המנוע המעמיק לא מצא אותו בדוח\. אם הוא לא שלך, הסר אותו/);
  assert.match(pr,/קריאה מהירה עם המנוע המהיר/); assert.match(pr,/בדיקה עם המנוע המעמיק: 2 תיקונים, נייר אחד לבדיקה/);
  // the two reads agree (the group is the model's own guess, so a different one is not a correction): nothing changes
  await R.pick('statement2.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nQUICKGROUP,,0,0\n'); await R.done();
  rows=await R.rows(); assert.ok(!rows.some(r=>r.fixed)); assert.match(await R.prog(),/בדיקה עם המנוע המעמיק: הכול תואם/); assert.match(await R.state(),/מצא אותו דבר כמו הקריאה המהירה/);
  // the same security spelled two ways: one row, the strongest model's spelling
  await R.pick('statement5.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nQUICKSPELL,,0,0\n'); await R.done(); rows=await R.rows();
  assert.ok(rows.some(r=>r.sym==='GOOGL'&&r.flag==='תוקן')&&!rows.some(r=>r.sym==='GOOG')); assert.match(await R.state(),/GOOGL: סימול GOOGL \(בקריאה המהירה GOOG\)/);
  // the quick read takes the file for another account: the strongest model's account wins, and the other account is back as it was
  const blink0=(await R.rows()).filter(r=>r.acct==='blink').map(r=>r.sym+':'+r.qty).sort();
  await R.pick('statement6.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nQUICKACCT,,0,0\n'); await R.quick();
  assert.ok((await R.rows()).some(r=>r.acct==='blink'&&r.sym==='MSFT'),'the quick read put it in Blink');
  await R.done(); rows=await R.rows();
  assert.deepEqual(rows.filter(r=>r.acct==='blink').map(r=>r.sym+':'+r.qty).sort(),blink0,'Blink is as it was');
  assert.ok(rows.some(r=>r.acct==='exc'&&r.sym==='MSFT'&&r.qty===3)); assert.match(await R.state(),/זיהה שהקבצים שייכים לחשבון אקסלנס, ולא לחשבון בלינק כמו בקריאה המהירה, ולכן הקריאה המהירה בוטלה/);
  // the viewer stops the check after its answer has begun (spaces are on the way): the table stays as the quick read left it
  {const k1=process.env.AI_KEEPALIVE_MS; process.env.AI_KEEPALIVE_MS='60';
    try{await R.pick('statement7.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nQUICKBAD SLOWCHECK,,0,0\n'); await R.quick(); await pg.waitForTimeout(800);
      await pg.evaluate(()=>document.getElementById('btnStop').click()); await R.done()}finally{if(k1==null)delete process.env.AI_KEEPALIVE_MS; else process.env.AI_KEEPALIVE_MS=k1}
    assert.match(await R.state(),/עצרת את הבדיקה של המנוע המעמיק\. הטבלה היא מהקריאה המהירה/); assert.equal((await R.rows()).find(r=>r.sym==='MSFT').qty,2)}
  // the strongest model is not open to the key: the next one checks. A long check: spaces keep the request open (Railway
  // closes a quiet one), and the page reads past them
  const k0=process.env.AI_KEEPALIVE_MS; process.env.AI_KEEPALIVE_MS='60'; const raw=[]; const onRes=async q=>{if(/"claude-fable-5-1"/.test(q.request().postData()||''))raw.push(await q.text().catch(()=>''))}; pg.on('response',onRes);
  try{n0=await R.pick('statement3.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nNOFABLE,,0,0\n'); await R.done()}finally{if(k0==null)delete process.env.AI_KEEPALIVE_MS; else process.env.AI_KEEPALIVE_MS=k0; pg.off('response',onRes)}
  assert.deepEqual(bodies.slice(n0).map(b=>b.model).sort(),['claude-fable-5-1','claude-haiku-5-5','claude-opus-5-5']);
  assert.ok(bodies.slice(n0).filter(b=>b.stream).every(b=>b.max_tokens>8192),'room for the strong models\' thinking');
  assert.match(await R.prog(),/בדיקה עם המנוע החזק \(המנוע המעמיק לא היה זמין, ולכן קרא המודל הבא\): הכול תואם/);
  assert.equal(raw.length,1); assert.match(raw[0],/^ {3,}\{/,'spaces kept the request open while Claude was reading');
  // the quick read fails: the strongest model's read fills the table
  await R.pick('statement4.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nQUICKFAIL,,0,0\n'); await R.done();
  rows=await R.rows(); assert.equal(rows.find(r=>r.sym==='MSFT').qty,3); assert.match(await R.state(),/הקריאה המהירה לא הצליחה \(צ׳יקו עמוס כרגע\), והמנוע המעמיק קרא את הדוח/,'it says why');
  // a long statement: the quick read's answer is cut in the middle; the holdings are kept, and the check completes the transactions
  await R.pick('statement8.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nQUICKCUT,,0,0\n'); await R.quick();
  assert.equal((await R.rows()).find(r=>r.sym==='MSFT').qty,3); assert.match(await R.state(),/התשובה של הקריאה המהירה נקטעה כי הדוח ארוך/);
  await R.done(); assert.match(await R.state(),/פעולות: 12 \(בקריאה המהירה \d+\)/);
  // an older statement than the one in the table: the holdings stay, its transactions are added
  const before=(await R.rows()).map(r=>r.acct+':'+r.sym+':'+r.qty).sort();
  await R.pick('statement9.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nOLDREPORT,,0,0\n'); await R.done();
  assert.deepEqual((await R.rows()).map(r=>r.acct+':'+r.sym+':'+r.qty).sort(),before,'the holdings are not replaced');
  assert.ok((await R.state()).includes(`הדוח הזה מ-31.12.2025, ישן יותר מהדוח שכבר בטבלה לחשבון אקסלנס (מ-${dF(TODAY)}), ולכן האחזקות והמזומן לא הוחלפו. נוספו ממנו 2 פעולות`),await R.state());
  // a file with transactions only (its holdings worked out from them): the real holdings stay, its transactions are added
  await R.pick('statement10.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nDERIVED,,0,0\n'); await R.done();
  assert.deepEqual((await R.rows()).map(r=>r.acct+':'+r.sym+':'+r.qty).sort(),before,'worked-out holdings do not replace the real ones');
  assert.match(await R.state(),/בקובץ הזה אין רשימת אחזקות, רק פעולות, ולכן האחזקות והמזומן לא הוחלפו\. נוספה ממנו פעולה אחת/);
  assert.match(await R.prog(),/נקרא עם המנוע המעמיק/);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('reading a file: what the viewer changed or saved meanwhile stays; "quick only" skips the check',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(1280,{who:'r3'}); await tab(pg,'mine'); await pg.waitForTimeout(300); const R=reader(pg);
  const BAD='Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nNVDA,NVIDIA,6,3150\nQUICKBAD,,0,0\n';
  // the viewer corrects MSFT by hand while the check runs: the hand-made change stays, the rest is corrected
  await R.pick('a.csv',BAD); await R.quick();
  await pg.evaluate(()=>{const i=[...document.querySelectorAll('#pfRows tr')].find(tr=>tr.querySelector('input[data-pf="sym"]')?.value==='MSFT').querySelector('input[data-pf="qty"]'); i.value='5'; i.dispatchEvent(new Event('input',{bubbles:true}))});
  await R.done(); let rows=await R.rows();
  assert.equal(rows.find(r=>r.sym==='MSFT').qty,5,'the viewer\'s change is not overwritten'); assert.equal(rows.find(r=>r.sym==='NVDA').qty,6); assert.equal(rows.find(r=>r.sym==='ZZZQ').flag,'לבדיקה');
  assert.match(await R.state(),/לא שיניתי מה שערכת בעצמך \(MSFT\)/);
  // the viewer saves the quick read before the check ends: the check corrects the saved rows, and asks to save again
  await pg.evaluate(()=>document.getElementById('btnPfReset').click()); await R.pick('b.csv',BAD.replace('QUICKBAD','QUICKBAD SLOWCHECK')); await R.quick();
  await pg.evaluate(()=>document.getElementById('btnPfSave').click()); await pg.waitForFunction(()=>/נשמר/.test(document.getElementById('pfSaved').textContent),null,{timeout:15000});
  await R.done(); await pg.waitForTimeout(300); rows=await R.rows();
  assert.equal(await pg.evaluate(()=>document.body.dataset.page),'mine','the first save does not move away from corrections that are not saved');
  assert.equal(rows.find(r=>r.sym==='MSFT').qty,3); assert.equal(rows.find(r=>r.sym==='ZZZQ').flag,'לבדיקה');
  assert.match(await R.state(),/שמרת לפני שהבדיקה הסתיימה, אז לחץ שוב על "שמור את התיק"/);
  assert.match(await pg.evaluate(()=>document.getElementById('pfSaved').textContent),/יש שינויים שלא נשמרו/);
  // the corrections saved: now the first portfolio's explanation comes, as it does after a first save
  await pg.evaluate(()=>document.getElementById('btnPfSave').click());
  await pg.waitForFunction(()=>document.body.dataset.page==='overview'&&/הסבר התיק שלך/.test(document.getElementById('anaOut')?.textContent||''),null,{timeout:20000});
  // the viewer moves to another screen while the check runs: when it ends, a note leads back to the table
  await tab(pg,'mine'); await pg.waitForTimeout(300); await R.pick('d.csv',BAD); await R.quick(); await tab(pg,'overview'); await R.done();
  // (the save's "undo" note is shown first, for 15 seconds; this one waits for it)
  await pg.waitForFunction(()=>!document.getElementById('toast').hidden&&/תיקן/.test(document.getElementById('toastMsg').textContent),null,{timeout:40000});
  assert.match(await pg.evaluate(()=>document.getElementById('toastMsg').textContent),/המנוע המעמיק בדק את הדוח שהעלית ותיקן 2 פרטים בטבלה\. התיקונים עוד לא נשמרו\./);
  await pg.evaluate(()=>document.getElementById('toastUndo').click()); await pg.waitForTimeout(300);
  assert.equal(await pg.evaluate(()=>document.body.dataset.page),'mine'); assert.ok((await R.rows()).some(r=>r.fixed));
  assert.equal(await pg.evaluate(()=>document.getElementById('toast').hidden),true);
  // the viewer is in a field of the table when the check ends: the corrections wait until the field is left
  await R.pick('e.csv',BAD); await R.quick();
  await pg.evaluate(()=>[...document.querySelectorAll('#pfRows tr')].find(tr=>tr.querySelector('input[data-pf="sym"]')?.value==='MSFT').querySelector('input[data-pf="name"]').focus());
  await pg.waitForFunction(()=>/כשתסיים להקליד/.test(document.getElementById('upProg').textContent),null,{timeout:15000});
  assert.equal((await R.rows()).find(r=>r.sym==='MSFT').qty,2,'nothing moves under the cursor');
  await pg.evaluate(()=>document.activeElement.blur()); await R.done();
  assert.equal((await R.rows()).find(r=>r.sym==='MSFT').qty,3);
  // "quick only": one call, no check
  await pg.evaluate(()=>{document.getElementById('btnPfReset').click(); document.getElementById('upQuick').checked=true});
  const n0=await R.pick('c.csv','Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\n');
  await pg.waitForFunction(()=>document.getElementById('btnStop').hidden&&/נקרא עם/.test(document.getElementById('upProg').textContent),null,{timeout:20000});
  assert.deepEqual(bodies.slice(n0).map(b=>b.model),['claude-haiku-5-5']); assert.doesNotMatch(await R.prog(),/בדיקה עם/);
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('reading several reports at once: each on its own and at the same time; the newest holds the holdings, all add their transactions',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(1280); await tab(pg,'mine'); await pg.waitForTimeout(300); const R=reader(pg);
  const n0=bodies.length, csv=x=>({name:x+'.csv',mimeType:'text/csv',buffer:Buffer.from('Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nMULTI:'+x+',,0,0\n')});
  await pg.setInputFiles('#upFile',[csv('mar'),csv('jun'),csv('sep')]);
  // three reads, each with its quick read and its check, sent together
  for(let i=0;i<100&&bodies.length<n0+6;i++)await new Promise(r=>setTimeout(r,50));
  const sent=bodies.slice(n0); assert.equal(sent.length,6); assert.ok(sent[5].at-sent[0].at<1000,'the three reads run at the same time');
  await pg.waitForFunction(()=>document.getElementById('upProg').classList.contains('jobs')&&document.querySelectorAll('#upProg li[data-job]').length===3,null,{timeout:10000});
  await pg.waitForFunction(()=>/הסתיימה הקריאה של 3 קבצים/.test(document.getElementById('upState').textContent),null,{timeout:30000});
  const rows=(await R.rows()).filter(r=>r.acct==='exc');
  assert.deepEqual(rows.map(r=>r.sym+':'+r.qty).sort(),['MSFT:3','NVDA:6'],'the newest report holds the holdings');
  const lines=await pg.evaluate(()=>[...document.querySelectorAll('#upProg li[data-job]')].map(li=>li.textContent));
  for(const x of ['mar','jun'])assert.ok(lines.some(l=>l.includes(x+'.csv')&&/ישן יותר/.test(l)&&/נוספו ממנו|נוספה ממנו/.test(l)),x+': older, so only its transactions');
  assert.ok(lines.some(l=>l.includes('sep.csv')&&/בדיקה עם המנוע המעמיק: הכול תואם/.test(l)&&/מצא אותו דבר/.test(l)),'the newest: checked, and the same');
  assert.ok(lines.some(l=>l.includes('jun.csv')&&/נוספו 2 פעולות/.test(l)),'a finished file shows what it did');
  assert.equal(await pg.evaluate(()=>document.querySelectorAll('#txBox tbody tr').length),6,'the transactions of all three, none twice');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('several reports at once, in any order: the newest holds the holdings, whichever read ends first',T,async t=>{
  if(skip())return t.skip('no browser');
  for(const order of ['fwd','rev']){
    const {ctx,pg}=await open(1280); await tab(pg,'mine'); await pg.waitForTimeout(300); const R=reader(pg);
    const csv=x=>({name:x+'.csv',mimeType:'text/csv',buffer:Buffer.from(`Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nMULTI2:${x} ORDER:${order},,0,0\n`)});
    await pg.setInputFiles('#upFile',[csv('mar'),csv('jun'),csv('sep')]);
    await pg.waitForFunction(()=>/הסתיימה הקריאה של 3 קבצים/.test(document.getElementById('upState').textContent),null,{timeout:30000});
    assert.deepEqual((await R.rows()).filter(r=>r.acct==='exc').map(r=>r.sym+':'+r.qty).sort(),['MSFT:3','NVDA:6'],order+': the newest report holds the holdings');
    assert.equal(await pg.evaluate(()=>document.querySelectorAll('#txBox tbody tr').length),6,order+': the transactions of all three, none twice');
    const lines=await pg.evaluate(()=>[...document.querySelectorAll('#upProg li[data-job]')].map(li=>li.textContent));
    // the older two give only their transactions: read after the newest ("older"), or replaced by it later (only its
    // transactions checked). Which of the two depends on when each answer comes (a browser also opens at most 6
    // connections to one site at a time, so some reads wait for others)
    for(const x of ['mar','jun'])assert.ok(lines.some(l=>l.includes(x+'.csv')&&/ישן יותר|נבדקו רק הפעולות/.test(l)),order+': '+x+' '+JSON.stringify(lines));
    assert.ok(!lines.some(l=>/לא שיניתי מה שערכת/.test(l)),order+': nothing is taken for the viewer\'s own change');
    assert.deepEqual(pg.errs,[]); await ctx.close();
  }
});

test('a partner reads like the owner: several reports at once, prices on request, and a limit is the site\'s, never their own Claude\'s',T,async t=>{
  if(skip())return t.skip('no browser');
  let px=0; const {ctx,pg}=await open(390,{who:'r4',route:(r,u)=>{if(u.includes('/api/prices')){px++; r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"cached":true}'}); return true}}});
  await pg.click('#botbar [data-bb="mine"]'); await pg.waitForTimeout(300); const R=reader(pg);
  // three reports at once: like the owner's, all three reads (each a quick read and a check) go out together, none waits its turn
  const n0=bodies.length, csv=x=>({name:x+'.csv',mimeType:'text/csv',buffer:Buffer.from('Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nMULTI:'+x+',,0,0\n')});
  await pg.setInputFiles('#upFile',[csv('mar'),csv('jun'),csv('sep')]);
  for(let i=0;i<100&&bodies.length<n0+6;i++)await new Promise(r=>setTimeout(r,50));
  const sent=bodies.slice(n0); assert.equal(sent.length,6); assert.ok(sent[5].at-sent[0].at<1000,'the three reads run at the same time, as the owner\'s do');
  assert.equal(await pg.evaluate(()=>/ממתין לתורו/.test(document.getElementById('upProg').textContent)),false,'no file waits for its turn');
  await pg.waitForFunction(()=>/הסתיימה הקריאה של 3 קבצים/.test(document.getElementById('upState').textContent),null,{timeout:30000});
  assert.deepEqual((await R.rows()).filter(r=>r.acct==='exc').map(r=>r.sym+':'+r.qty).sort(),['MSFT:3','NVDA:6'],'the newest report holds the holdings');
  // prices: a partner may ask for a refresh on the site, as the owner may (on open, when the prices are old and a market is open, it is asked for by itself)
  assert.equal(await pg.evaluate(()=>window.__pxd.state().mcp),true);
  if(!await pg.evaluate(()=>!!window.__pxd.state().pxf))assert.equal(await pg.evaluate(()=>window.__pxd.fire('click')),true);
  assert.ok(px>=1,'the partner\'s page asked the site for new prices');
  // the strongest models are all at their rate limit: the site says it is the site's limit, and nothing points to the viewer's own Claude
  await pg.setInputFiles('#upFile',[{name:'busy.csv',mimeType:'text/csv',buffer:Buffer.from('Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nRATE429,,0,0\n')},{name:'ok.csv',mimeType:'text/csv',buffer:Buffer.from('Symbol,Name,Qty,Cost ILS\nMSFT,Microsoft,3,4200\nAAPL,Apple,1,700\n')}]);
  await pg.waitForFunction(()=>[...document.querySelectorAll('#upProg li[data-job]')].some(li=>/busy\.csv/.test(li.textContent)&&/האתר הגיע למגבלת הקצב שלו/.test(li.textContent)),null,{timeout:30000});
  await pg.waitForFunction(()=>/צ׳יקו ביקש להאט\. אפשר להמשיך בעוד/.test(document.getElementById('upState').textContent),null,{timeout:5000});
  assert.doesNotMatch(await pg.evaluate(()=>document.body.innerText),/חשבון Claude|Claude|Anthropic/,'no model name anywhere on the page');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('deposits, conversions and monthly results without holdings: kept in the history, and the monthly table shows them',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390,{who:'r5'}); await pg.click('#botbar [data-bb="mine"]'); await pg.waitForTimeout(300);
  const pick=async(name,csv)=>{const n0=bodies.length; await pg.setInputFiles('#upFile',{name,mimeType:'text/csv',buffer:Buffer.from(csv)}); for(let i=0;i<200&&bodies.length===n0;i++)await new Promise(r=>setTimeout(r,50))};
  const idle=()=>pg.waitForFunction(()=>document.getElementById('btnStop').hidden&&!/צ׳יקו|המנוע/.test(document.querySelector('#upProg li.now')?.textContent||''),null,{timeout:30000});
  // a screen of deposits and conversions: the strongest model's numbers go in; a conversion is not a deposit
  await pick('flows.csv','Date,Action,Amount\n2026-04-01,FLOWSCREEN,600\n'); await idle();
  let st=await pg.evaluate(()=>document.getElementById('upState').textContent);

  assert.match(st,/זוהו 2 הפקדות בחשבון אקסלנס/); assert.match(st,/המרות המט״ח נשמרות בהיסטוריה של חשבון אקסלנס, והן לא נספרות כהפקדה/);
  const tx=await pg.evaluate(()=>document.getElementById('txBox').innerText);
  assert.match(tx,/המרת מט״ח/); assert.match(tx,/₪94\.92 לדולרים/); assert.match(tx,/\$187\.58 לשקלים \(₪690\.3\)/);
  // a table of monthly results
  await pick('returns.csv','Month,Value,Return,Deposits\nMONTHLY,10100,1%,10000\n2,10302,2%,0\n3,15000,-1.5%,5000\n'); await idle();
  st=await pg.evaluate(()=>document.getElementById('upState').textContent);
  assert.match(st,/טבלת התשואות של חשבון אקסלנס \(.+\) תישמר בהיסטוריה/);
  assert.equal(await pg.evaluate(()=>document.querySelectorAll('#monBox tbody tr').length),4,'the table read, before it is saved');
  // saved with no holdings in the table
  await pg.evaluate(()=>document.getElementById('btnPfSave').click());
  await pg.waitForFunction(()=>/נשמר בהיסטוריה/.test(document.getElementById('pfSaved').textContent),null,{timeout:15000});
  assert.match(await pg.evaluate(()=>document.getElementById('pfSaved').textContent),/נוספו 4 פעולות להיסטוריה\. נשמרו 4 חודשים מטבלת התשואות\. עוד אין כאן רשימת אחזקות/);
  const H=store.getDoc(`data/users/${R5}/history`).data, A=H.accounts.find(a=>a.acct==='exc');
  assert.equal(A.deposits.length,2); assert.equal(H.depIlsNow,700,'the two deposits; the conversions are not money in'); assert.equal(A.fx.length,2); assert.equal(A.fx.find(x=>x.ccy==='USD').toAmount,690.3);
  assert.equal(A.monthly.length,4); assert.equal(A.monthly.filter(r=>r.part).length,1,'the current month is only "so far"');
  // the history tab: the monthly table, newest first, with the app's own returns
  await pg.evaluate(()=>{const b=document.querySelector('#botbar [data-bb="more"]'); (document.getElementById('tab_history')||document.querySelector('[data-tab="history"]')).click()}); await pg.waitForTimeout(500);
  const rows=await pg.evaluate(()=>[...document.querySelectorAll('#monRows tr')].map(tr=>tr.innerText.replace(/\s+/g,' ').trim()));
  assert.equal(rows.length,4); assert.match(rows[0],/עד \d/,'the current month, as of the day it was read'); assert.match(rows[1],/₪15,000/); assert.match(rows[1],/\+₪5,000/); assert.match(rows[1],/−1\.50%/);
  assert.match(rows[3],/\+₪10,000/); assert.match(rows[3],/\+1\.00%/); assert.doesNotMatch(rows[3],/\+₪100\b/,'the first month has no result in shekels: its start is not known');
  assert.match(rows[2],/\+₪202/,'the next one has: its value less the month before and the money put in');
  assert.match(await pg.evaluate(()=>document.getElementById('monNote').textContent),/האחוזים של .+ הם של בית ההשקעות, כפי שהופיעו בטבלה שהעלית מהאפליקציה/);
  assert.equal(await pg.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no sideways scroll on a phone');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});

test('picking files: a pick that brings nothing back is said plainly; a file the browser gives with no size is still read',T,async t=>{
  if(skip())return t.skip('no browser');
  const {ctx,pg}=await open(390); await pg.click('#botbar [data-bb="mine"]'); await pg.waitForTimeout(300);
  // the picker was open for a while and closed with no files (some phone browsers do this when several are chosen)
  await pg.evaluate(()=>document.getElementById('upFile').dispatchEvent(new Event('click'))); await pg.waitForTimeout(2700);
  await pg.evaluate(()=>document.getElementById('upFile').dispatchEvent(new Event('cancel')));
  assert.match(await pg.evaluate(()=>document.getElementById('upState').textContent),/לא הגיעו קבצים מהבחירה\. אם בחרת כמה קבצים יחד, הדפדפן הזה כנראה לא מעביר בחירה של כמה קבצים\. אפשר לבחור אותם אחד אחרי השני/);
  // a quick close is just a close: nothing is said
  await pg.evaluate(()=>{document.getElementById('upState').textContent=''; const i=document.getElementById('upFile'); i.dispatchEvent(new Event('click')); i.dispatchEvent(new Event('cancel'))});
  assert.equal(await pg.evaluate(()=>document.getElementById('upState').textContent),'');
  // a file whose size the browser does not report is kept and read (here it really is empty, and the page says so)
  await pg.setInputFiles('#upFile',{name:'nosize.csv',mimeType:'text/csv',buffer:Buffer.alloc(0)});
  await pg.waitForFunction(()=>/הקובץ נראה ריק/.test(document.getElementById('upState').textContent),null,{timeout:10000});
  assert.equal(await pg.evaluate(()=>!!document.querySelector('#staged label.more[for="upFile"]')),true,'"+ עוד קובץ" next to the picked files');
  assert.deepEqual(pg.errs,[]); await ctx.close();
});
