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
    assert.deepEqual(m0,{hidden:false,on:[false,false,false]});
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
