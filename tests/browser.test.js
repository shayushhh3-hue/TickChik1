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
let claude, seen=[], srv, U, store, browser, docs;
before(async()=>{
  claude=http.createServer(async(req,res)=>{let b='';for await(const c of req)b+=c; const p=JSON.stringify(JSON.parse(b).messages||[]); seen.push(p);
    const text=p.includes('ענה על שאלה')?JSON.stringify({answer:'ביום המסחר האחרון CAT ו-RKLB הזיזו את התיק יותר מכל השאר. כדאי לבדוק את הריכוז בטכנולוגיה מול הכללים שלך.',nav:['risk']}):'{"answer":""}';
    res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({id:'m',type:'message',content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}))});
  await new Promise(r=>claude.listen(0,'127.0.0.1',r));
  Object.assign(process.env,{ANTHROPIC_BASE_URL:'http://127.0.0.1:'+claude.address().port,ANTHROPIC_API_KEY:'sk-test',OWNER_EMAIL:'owner@example.com',OWNER_PASSWORD:'owner-pass-123'});
  const real=globalThis.fetch; globalThis.fetch=async(u,o)=>String(u).startsWith('http://127.0.0.1')?real(u,o):new Response('{}',{status:404});
  const {Store}=await import('../server/store.js'); const {createApp,bootstrap}=await import('../server/index.js'); const {buildSite}=await import('../tools/build.js');
  buildSite(R); store=new Store(':memory:'); bootstrap(store); docs=fixture();
  for(const [p,d] of Object.entries(docs))store.setDoc(p,d,{silent:true}); store.setDoc('quotes/c_NVDA',closes(),{silent:true});
  store.addUser({email:'new@example.com',password:'friend-pass-1',role:'friend'});
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
  const [email,pw]=who==='new'?['new@example.com','friend-pass-1']:['owner@example.com','owner-pass-123'];
  await pg.goto(U); await pg.waitForSelector('#tcLogin'); await pg.fill('#tcEmail',email); await pg.fill('#tcPass',pw); await pg.click('#tcLogin button');
  await pg.waitForFunction(who==='new'?()=>!!document.querySelector('.wrap.nopf'):()=>/₪/.test(document.getElementById('kTotal')?.textContent||''),null,{timeout:20000});
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
  await pg.fill('#listText','MSFT 1 1500'); await pg.click('#btnList'); await pg.click('#btnPfSave'); await pg.waitForTimeout(2000);
  s=await pg.evaluate(()=>({ana:!document.getElementById('anaBox').hidden,dlg:!document.getElementById('profDlg').hidden}));
  assert.ok(s.ana&&!s.dlg,'צ׳יקו explains the new portfolio first');
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
  await pg.fill('#anaQ','למה התיק זז היום?'); await pg.click('#anaForm .chat-send');
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
