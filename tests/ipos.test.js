// 24.11: the search beyond the page's own list. The server: the IPO calendars and the exchanges' symbol directory read
// into research/ipos (what is new, what the search gains, what is expected), the first day of trading from the price
// source, the week's one update in everyone's alerts, a security's lookup for its page. The page: the key of a security
// from another market, the rows of the search across markets, a price in its own currency. No network: every source is
// answered here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store, access} from '../server/store.js';
import {ipoTask, ipoFresh, ipoStale, nasdaqIpoParse, fhIpoParse, symDirParse, ipoDate, exLetter, weekOf, isSpac, dirName} from '../server/ipos.js';
import {ipoAlerts, pulseUpdate} from '../server/pulse.js';
import {_resetFh} from '../server/finnhub.js';
import {searchParse, fundByName, yahooChart, tickerFor} from '../shared/quotes.js';
import {SCHEDULE} from '../server/jobs.js';
import {load} from './page-src.js';

process.env.OWNER_EMAIL='owner@example.com'; process.env.OWNER_PASSWORD='owner-pass-123'; process.env.JOBS='0'; process.env.API_RPM='1000000';
// no test reaches the internet: a source a test did not answer is refused
{const real=globalThis.fetch; globalThis.fetch=async(u,o)=>/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(String(u&&u.url||u))?real(u,o):new Response('offline in tests',{status:503})}

const NOW=new Date('2026-11-24T10:00:00Z');
const json=o=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}), text=t=>new Response(t,{status:200});
const NQ=(priced=[],upcoming=[])=>({data:{priced:{rows:priced},upcoming:{upcomingTable:{rows:upcoming}},filed:{rows:[{proposedTickerSymbol:'FILD',companyName:'Filed Only Inc.',filedDate:'11/20/2026'}]}}});
const P=(sym,name,exch,date,price)=>({proposedTickerSymbol:sym,companyName:name,proposedExchange:exch,proposedSharePrice:price,pricedDate:date,dealStatus:'Priced'});
// the directory: 2,100 symbols the page's list already has, and whatever a test adds
const b26=i=>{let s=''; for(let k=0;k<3;k++){s=String.fromCharCode(65+i%26)+s; i=Math.floor(i/26)} return 'F'+s};
const FILL=Array.from({length:2100},(_,i)=>b26(i)), KNOWN=new Set([...FILL,'MSFT','BRK.B']);
const dirN=rows=>['Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares',...FILL.map(s=>`${s}|${s} Corp - Common Stock|Q|N|N|100|N|N`),...rows,'File Creation Time: 1124202603:02|||||||'].join('\r\n');
const dirO=rows=>['ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol','MSFT|Microsoft Corporation Common Stock|N|MSFT|N|100|N|MSFT',...rows,'File Creation Time: 1124202603:02||||||'].join('\n');
const sources=o=>{const asked=[]; const f=async u=>{u=String(u); asked.push(u);
    if(u.includes('api.nasdaq.com/api/ipo/calendar'))return o.nasdaq?json(o.nasdaq(u)):new Response('no',{status:503});
    if(u.includes('nasdaqlisted.txt'))return o.dirN?text(dirN(o.dirN)):new Response('no',{status:503});
    if(u.includes('otherlisted.txt'))return o.dirN?text(dirO(o.dirO||[])):new Response('no',{status:503});
    if(u.includes('finnhub.io/api/v1/calendar/ipo'))return o.finnhub?o.finnhub(u):new Response('{}',{status:404});
    return new Response('{}',{status:404})}; f.asked=asked; return f};
const CHART={ANT:{px:87.64,first:'2026-11-19',xname:'NasdaqGS',name:'Anthropic, PBC'},NEWF:{px:25,first:'2026-11-23'},OLDX:{px:5,first:'2001-03-01'},SPCU:{px:10,first:'2026-11-18'}};
const chart=async t=>{if(CHART[t])return CHART[t]; throw new Error('no data found')};

test('the calendars and the directory, read: dates, prices, exchanges, what is a share and what is not',()=>{
  assert.equal(ipoDate('11/19/2026'),'2026-11-19'); assert.equal(ipoDate('2026-11-19'),'2026-11-19'); assert.equal(ipoDate('soon'),'');
  assert.deepEqual(['NASDAQ Global Select','NYSE','NYSE MKT','NYSE Arca','Cboe BZX','?'].map(exLetter),['Q','N','A','P','Z','']);
  assert.equal(weekOf('2026-11-19'),'2026-11-16','a Thursday belongs to its Monday'); assert.equal(weekOf('2026-11-22'),'2026-11-16','and so does the Sunday after it'); assert.equal(weekOf('2026-11-23'),'2026-11-23');
  assert.ok(isSpac('Compute AI Acquisition Corp.')&&!isSpac('Anthropic, PBC'));
  const N=nasdaqIpoParse(NQ([P('ANT','Anthropic, PBC','NASDAQ Global Select','11/19/2026','83.00'),P(null,'No Symbol Inc.','NYSE','11/18/2026','10.00'),P('BAD1','Digits Inc.','NYSE','11/18/2026','10.00')],
    [{proposedTickerSymbol:'SOON',companyName:'Soon Corp',proposedExchange:'NYSE',proposedSharePrice:'18.00-20.00',expectedPriceDate:'12/02/2026'}]));
  assert.deepEqual(N.priced,[{sym:'ANT',name:'Anthropic, PBC',exch:'NASDAQ Global Select',date:'2026-11-19',price:83,src:'Nasdaq'}],'a row with no symbol, or one that is not a symbol, is left out');
  assert.deepEqual(N.upcoming,[{sym:'SOON',name:'Soon Corp',exch:'NYSE',date:'2026-12-02',price:null,range:'18.00-20.00',src:'Nasdaq'}]);
  const F=fhIpoParse({ipoCalendar:[{date:'2026-11-19',exchange:'NASDAQ Global Select',name:'Anthropic, PBC',price:'83.00',status:'priced',symbol:'ANT'},{date:'2026-12-03',exchange:'NYSE',name:'Later Inc',price:'12.00-14.00',status:'expected',symbol:'LATR'},{date:'2026-11-10',name:'Gone',status:'withdrawn',symbol:'GONE'},{date:'2026-11-12',name:'Filed',status:'filed',symbol:'FLD'}]});
  assert.deepEqual(F.priced.map(x=>[x.sym,x.price,x.src]),[['ANT',83,'Finnhub']]); assert.deepEqual(F.upcoming.map(x=>[x.sym,x.range,x.price]),[['LATR','12.00-14.00',null]],'a withdrawn or only filed offering is neither');
  const D=symDirParse(dirN(['ANT|Anthropic, PBC - Class A Common Stock|Q|N|N|100|N|N','ANTO|Direxion Daily Anthropic Bull 2X ETF|G|N|N|100|Y|N','AACIW|Armada Acquisition Corp. III - Warrant|S|N|N|100|N|N','AACIU|Armada Acquisition Corp. III - Units|S|N|N|100|N|N',
    'ADAMG|Adamas Trust, Inc. - 9.125% Senior Notes Due 2030|S|N|N|100|N|N','ZTEST|Test Company - Common Stock|Q|Y|N|100|N|N','ACGLN|Arch Capital Group Ltd. - Depositary Shares, each Representing a 1/1000th Interest in a Preferred Share|Q|N|N|100|N|N']),'nasdaq').filter(x=>!KNOWN.has(x.sym));
  assert.deepEqual(D,[{sym:'ANT',name:'Anthropic, PBC',etf:false,ex:'Q'},{sym:'ANTO',name:'Direxion Daily Anthropic Bull 2X ETF',etf:true,ex:'Q'}],'no warrant, unit, note, preferred or test issue');
  const O=symDirParse(dirO(['ANTT|Tradr 2X Long Anthropic Daily ETF|Z|ANTT|Y|100|N|ANTT','AMX|America Movil, S.A.B. de C.V. American Depositary Shares (each representing the right to receive twenty (20) Series B Shares|N|AMX|N|100|N|AMX','AB|AllianceBernstein Holding L.P.  Units|N|AB|N|100|N|AB','ABR$D|Arbor Realty Trust 6.375% Series D Cumulative Redeemable Preferred Stock|N|ABRpD|N|100|N|ABR-D']),'other');
  assert.deepEqual(O.map(x=>[x.sym,x.name,x.etf,x.ex]),[['MSFT','Microsoft Corporation',false,'N'],['ANTT','Tradr 2X Long Anthropic Daily ETF',true,'Z'],['AMX','America Movil, S.A.B. de C.V.',false,'N'],['AB','AllianceBernstein Holding L.P. Units',false,'N']],'a depositary share of a company and a partnership\'s units are shares');
  assert.equal(dirName('Agilent Technologies, Inc. Common Stock'),'Agilent Technologies, Inc.');
  // the search across markets: a fund the source files under shares is a fund; an index stays an index
  assert.ok(fundByName('Direxion Daily Anthropic Bull 2X ETF')&&fundByName('ProShares Ultra Anthropic')&&!fundByName('Anthropic, PBC')&&!fundByName('Netflix, Inc.'));
  assert.deepEqual(searchParse({quotes:[{symbol:'ANT',quoteType:'EQUITY',longname:'Anthropic, PBC',exchDisp:'NASDAQ'},{symbol:'ANTO',quoteType:'EQUITY',longname:'Direxion Daily Anthropic Bull 2X ETF',exchDisp:'NASDAQ'},{symbol:'7203.T',quoteType:'EQUITY',longname:'Toyota Motor Corporation',exchDisp:'Tokyo Stock Exchange'},
    {symbol:'^GSPC',quoteType:'INDEX',shortname:'S&P 500'},{symbol:'BTC-USD',quoteType:'CRYPTOCURRENCY',shortname:'Bitcoin'},{symbol:'VTSAX',quoteType:'MUTUALFUND',longname:'Vanguard Total Stock Market Index Fund'}]}).map(x=>[x.sym,x.type,x.exch]),
    [['ANT','stock','NASDAQ'],['ANTO','etf','NASDAQ'],['7203.T','stock','Tokyo Stock Exchange'],['^GSPC','index',''],['VTSAX','fund','']]);
});

test('the price source\'s chart says what the security is: its name, kind, exchange, currency and first day of trading; pence are pounds',async()=>{
  const ans=(meta,ts,cl)=>async()=>json({chart:{result:[{meta,timestamp:ts,indicators:{quote:[{close:cl}]}}]}});
  const a=await yahooChart('ANT',{fetch:ans({currency:'USD',exchangeName:'NMS',fullExchangeName:'NasdaqGS',instrumentType:'EQUITY',firstTradeDate:1795098600,gmtoffset:-18000,regularMarketPrice:87.64,regularMarketTime:1795467601,longName:'Anthropic, PBC'},[1795098600,1795185000,1795444200],[97.17,88.91,87.64])});
  assert.deepEqual([a.name,a.type,a.xname,a.first,a.ccy,a.px,a.prev],['Anthropic, PBC','EQUITY','NasdaqGS','2026-11-19','USD',87.64,88.91]);
  const v=await yahooChart('VOD.L',{fetch:ans({currency:'GBp',exchangeName:'LSE',gmtoffset:0,regularMarketPrice:102.875,regularMarketTime:1795514555,shortName:'VODAFONE GROUP'},[1795428000],[102.85])});
  assert.equal(v.ccy,'GBP'); assert.ok(Math.abs(v.px-1.02875)<1e-9,'a London price in pounds'); assert.equal(v.first,undefined,'no first day in the answer: none said');
  assert.deepEqual(['7203.T','0700.HK','SAP.DE','VOD.L','ANT','BRK.B'].map(k=>tickerFor(k,null,{})),['7203.T','0700.HK','SAP.DE','VOD.L','ANT','BRK-B']);
});

test('the job: the offerings of the calendar, the symbols the page\'s list lacks, the first day from the price source; a new fund on a later run; a renamed ticker is not new; nothing twice',async()=>{
  const s=new Store(':memory:'), log=[];
  const cal=()=>NQ([P('ANT','Anthropic, PBC','NASDAQ Global Select','11/19/2026','83.00'),P('SPCU','Compute AI Acquisition Corp.','NASDAQ Global','11/18/2026','10.00'),P('OLDIP','Too Long Ago Inc.','NYSE','08/01/2026','5.00'),P('NOTYT','Not Trading Yet Inc.','NYSE','11/23/2026','21.00')],
    [{proposedTickerSymbol:'SOON',companyName:'Soon Corp',proposedExchange:'NYSE',proposedSharePrice:'18.00-20.00',expectedPriceDate:'12/02/2026'},{proposedTickerSymbol:'PAST',companyName:'Past Corp',proposedExchange:'NYSE',proposedSharePrice:'9.00',expectedPriceDate:'11/01/2026'}]);
  const D1=['ANT|Anthropic, PBC - Class A Common Stock|Q|N|N|100|N|N','ANTO|Direxion Daily Anthropic Bull 2X ETF|G|N|N|100|Y|N','AACIW|Armada Acquisition Corp. III - Warrant|S|N|N|100|N|N'];
  assert.equal(ipoStale(s,{now:NOW}),true,'nothing kept yet');
  let f=sources({nasdaq:cal,dirN:D1});
  let r=await ipoTask(s,{fetch:f,now:NOW,known:KNOWN,chart,key:'',log:m=>log.push(m)});
  assert.equal(r.ok,true); assert.deepEqual(r.sources,{finnhub:'nokey',nasdaq:'ok',dir:'ok'}); assert.equal(f.asked.filter(u=>u.includes('finnhub')).length,0,'no key: Finnhub is not asked');
  assert.equal(f.asked.filter(u=>u.includes('api.nasdaq.com')).length,2,'this month and the one before');
  let D=s.getDoc('research/ipos').data;
  assert.deepEqual(D.items.map(x=>x.sym).sort(),['ANT','NOTYT','SPCU'],'the offerings of the last weeks; an old one is not kept, and the first run calls no listed symbol new');
  const ant=D.items.find(x=>x.sym==='ANT'); assert.deepEqual([ant.name,ant.exch,ant.ex,ant.t,ant.date,ant.price,ant.kind,ant.first,ant.listed],['Anthropic, PBC','NASDAQ Global Select','Q','S','2026-11-19',83,'ipo','2026-11-19',true]);
  assert.equal(D.items.find(x=>x.sym==='SPCU').spac,true); assert.equal(D.items.find(x=>x.sym==='NOTYT').first,undefined,'no trade at the price source yet: no first day is written');
  assert.deepEqual(D.syms,[['ANT','Anthropic, PBC','S','Q'],['ANTO','Direxion Daily Anthropic Bull 2X ETF','E','Q'],['NOTYT','Not Trading Yet Inc.','S','N'],['SPCU','Compute AI Acquisition Corp.','S','Q']],'what the search gains: the listed symbols the page lacks, and the offerings; no warrant, nothing the page has');
  assert.deepEqual(D.upcoming.map(x=>[x.sym,x.date,x.range]),[['SOON','2026-12-02','18.00-20.00']],'the expected, from today on');
  assert.match(D.source,/Nasdaq/); assert.doesNotMatch(D.source,/Finnhub/,'only the sources that answered are named'); assert.equal(ipoStale(s,{now:NOW}),false);
  // what is told: the offerings of the last ten days; one not trading yet is an offering all the same
  assert.deepEqual(ipoFresh(D,{now:NOW}).map(x=>[x.sym,x.d]),[['NOTYT','2026-11-23'],['ANT','2026-11-19'],['SPCU','2026-11-18']]);
  // the next day: a new fund and a new symbol are listed; the same offerings are not new again
  const D2=[...D1,'NEWF|Brand New Thematic ETF|G|N|N|100|Y|N','OLDX|Old Company Renamed Inc. - Common Stock|Q|N|N|100|N|N','NOCH|No Chart Yet Inc. - Common Stock|Q|N|N|100|N|N'];
  const now2=new Date(NOW.getTime()+7*36e5); f=sources({nasdaq:cal,dirN:D2});
  r=await ipoTask(s,{fetch:f,now:now2,known:KNOWN,chart,key:'',log:m=>log.push(m)});
  assert.deepEqual(r.fresh.sort(),['NEWF','NOCH','OLDX'],'only what was not listed on the run before');
  D=s.getDoc('research/ipos').data;
  const nf=D.items.find(x=>x.sym==='NEWF'); assert.deepEqual([nf.kind,nf.t,nf.first,nf.src],['etf','E','2026-11-23',['Nasdaq Trader']]);
  assert.equal(D.items.find(x=>x.sym==='OLDX').old,true,'it traded long before: an old security under a new ticker');
  assert.equal(D.items.filter(x=>x.sym==='ANT').length,1); assert.equal(D.items.find(x=>x.sym==='ANT').at,NOW.toISOString(),'kept as it was first seen');
  assert.deepEqual(ipoFresh(D,{now:now2}).map(x=>x.sym),['NOTYT','NEWF','ANT','SPCU'],'the new fund with its first day; the renamed one and the one with no trade yet are not told');
  assert.ok(D.syms.some(x=>x[0]==='OLDX')&&D.syms.some(x=>x[0]==='NOCH'),'they are found by the search all the same');
  // a ticker FMP lists as a rename is not a new security either
  s.setDoc('research/symchg',{items:[{old:'ABCD',new:'NOCH',date:'2026-11-23'}]}); await ipoTask(s,{fetch:sources({nasdaq:cal,dirN:D2}),now:new Date(now2.getTime()+7*36e5),known:KNOWN,chart,key:''});
  assert.equal(s.getDoc('research/ipos').data.items.find(x=>x.sym==='NOCH').old,true);
});

test('the job: Finnhub joins when the key is set and the plan has the calendar; a refusal is said and the rest goes on; when nothing answers, what was kept stays',async()=>{
  _resetFh(); const s=new Store(':memory:');
  const fhOk=()=>json({ipoCalendar:[{date:'2026-11-19',exchange:'NASDAQ Global Select',name:'Anthropic, PBC',price:'83.00',status:'priced',symbol:'ANT'},{date:'2026-11-20',exchange:'NYSE',name:'Only At Finnhub Inc',price:'14.00',status:'priced',symbol:'FHX'}]});
  let f=sources({nasdaq:()=>NQ([P('ANT','Anthropic, PBC','NASDAQ Global Select','11/19/2026','83.00')]),dirN:['ANT|Anthropic, PBC - Class A Common Stock|Q|N|N|100|N|N'],finnhub:fhOk});
  let r=await ipoTask(s,{fetch:f,now:NOW,known:KNOWN,chart,key:'k-1',gap:0}); assert.equal(r.sources.finnhub,'ok'); assert.ok(f.asked.some(u=>/finnhub\.io\/api\/v1\/calendar\/ipo\?from=2026-10-10&to=2026-12-24&token=k-1/.test(u)),f.asked.find(u=>u.includes('finnhub')));
  let D=s.getDoc('research/ipos').data; assert.deepEqual(D.items.find(x=>x.sym==='ANT').src.sort(),['Finnhub','Nasdaq'],'one offering, both sources named'); assert.equal(D.items.find(x=>x.sym==='FHX').exch,'NYSE'); assert.match(D.source,/Finnhub/);
  // the plan does not include the calendar (403): said, kept, and Nasdaq's calendar carries on
  _resetFh(); const s2=new Store(':memory:'); f=sources({nasdaq:()=>NQ([P('ANT','Anthropic, PBC','NASDAQ Global Select','11/19/2026','83.00')]),dirN:[],finnhub:()=>new Response('{"error":"You don\'t have access to this resource."}',{status:403})});
  r=await ipoTask(s2,{fetch:f,now:NOW,known:KNOWN,chart,key:'k-1',gap:0}); assert.equal(r.ok,true); assert.equal(r.sources.finnhub,'plan'); assert.match(r.errors.join(' '),/Finnhub/); assert.deepEqual(s2.getDoc('research/ipos').data.items.map(x=>x.sym),['ANT']);
  // every source down: the list of before stays, with the time it was tried and why
  const before=s.getDoc('research/ipos').data; r=await ipoTask(s,{fetch:sources({}),now:new Date(NOW.getTime()+36e5),known:KNOWN,chart,key:''});
  assert.equal(r.ok,false); D=s.getDoc('research/ipos').data; assert.deepEqual(D.items,before.items); assert.deepEqual(D.syms,before.syms); assert.equal(D.updatedAt,before.updatedAt); assert.ok(D.triedAt&&D.errors.length>=2);
  // without the page's own list every listed symbol would look new: the symbols wait, the offerings are kept
  _resetFh(); const s3=new Store(':memory:'); r=await ipoTask(s3,{fetch:sources({nasdaq:()=>NQ([P('ANT','Anthropic, PBC','NASDAQ Global Select','11/19/2026','83.00')]),dirN:[]}),now:NOW,known:null,chart,key:''});
  if(r.dyn>1)assert.ok(r.dyn<6000,'with the built site the list is there'); else assert.deepEqual(s3.getDoc('research/ipos').data.syms.map(x=>x[0]),['ANT']);
});

test('the alerts: one update for a week of new listings, for everyone, whatever they hold; another listing develops it once; the type can be switched off',async()=>{
  const s=new Store(':memory:'), o=s.addUser({email:'owner@example.com',password:'owner-pass-123',role:'owner'}), p=s.addUser({email:'p@x.co',password:'password1',role:'friend'});
  s.setDoc('portfolio/main',{positions:[{sym:'MSFT',qty:2,ccy:'USD'}],cash:[]}); s.setDoc('quotes/latest',{usdIls:3.7,prices:{MSFT:500},prev:{MSFT:499},updatedAt:NOW.toISOString()});
  const it=(sym,name,o2={})=>({sym,name,exch:'NASDAQ Global Select',ex:'Q',t:'S',date:'2026-11-19',price:83,kind:'ipo',src:['Nasdaq'],first:'2026-11-19',at:NOW.toISOString(),...o2});
  s.setDoc('research/ipos',{items:[it('ANT','Anthropic, PBC'),it('WWB','WINDWARD BIO GROUP AG',{date:'2026-11-13',first:'2026-11-13',price:17}),it('OLDX','Old Renamed',{kind:'list',first:'2001-03-01',old:true}),it('NOCH','No Chart',{kind:'list',first:undefined,date:undefined})],syms:[],source:'לוח ההנפקות של Nasdaq',updatedAt:NOW.toISOString()});
  let A=ipoAlerts(s,NOW); assert.equal(A.length,1,'the listing of eleven days ago is past; one week, one update');
  assert.deepEqual([A[0].k,A[0].lv,A[0].kind,A[0].title,A[0].rel,A[0].n],['ipo:2026-11-16','upd','ipo','הנפקה חדשה: Anthropic (ANT)','none',1]); assert.match(A[0].relWhy,/לא נוגע לאחזקות שלך/);
  assert.deepEqual(A[0].ipo.list.map(x=>[x.sym,x.name,x.exch,x.first,x.price,x.kind]),[['ANT','Anthropic, PBC','NASDAQ Global Select','2026-11-19',83,'ipo']],'the name, the symbol, the exchange, the first day, the price');
  // the owner (a portfolio) and a partner without one: each gets it, in their own document, once
  let r=pulseUpdate(s,null,{now:NOW}); assert.deepEqual(r.fresh.map(a=>a.k),['ipo:2026-11-16']); assert.equal(s.getDoc('alerts/pulse').data.items.filter(a=>a.kind==='ipo').length,1);
  r=pulseUpdate(s,p,{now:NOW}); assert.deepEqual(r.doc.items.map(a=>[a.k,a.ver]),[['ipo:2026-11-16',1]]); assert.ok(s.getDoc(`data/users/${p.id}/pulse`).exists);
  r=pulseUpdate(s,null,{now:new Date(NOW.getTime()+36e5)}); assert.equal(r.fresh.length,0,'the same listing an hour later: nothing new'); assert.equal(r.doc.items.filter(a=>a.kind==='ipo')[0].ver,1);
  // another security starts trading in the same week: the same update, developed once, said why
  const D=s.getDoc('research/ipos').data; s.setDoc('research/ipos',{...D,items:[...D.items,it('NEWF','Brand New Thematic ETF',{kind:'etf',t:'E',date:undefined,price:undefined,first:'2026-11-20',src:['Nasdaq Trader']})]});
  r=pulseUpdate(s,null,{now:new Date(NOW.getTime()+2*36e5)}); assert.deepEqual(r.fresh.map(a=>[a.k,a.ver]),[['ipo:2026-11-16',2]]); const a2=r.doc.items.find(a=>a.kind==='ipo');
  assert.equal(a2.title,'2 ניירות חדשים בבורסה: Anthropic (ANT), Brand New Thematic ETF (NEWF)'); assert.equal(a2.hist.at(-1).why,'ipo'); assert.equal(r.doc.items.filter(a=>a.kind==='ipo').length,1,'never a second alert for the week');
  r=pulseUpdate(s,null,{now:new Date(NOW.getTime()+3*36e5)}); assert.equal(r.fresh.length,0);
  // a listing of the week after is another week's update
  s.setDoc('research/ipos',{...D,items:[...D.items,it('NXTW','Next Week Inc',{date:'2026-11-24',first:'2026-11-24'})]}); assert.deepEqual(ipoAlerts(s,new Date('2026-11-25T10:00:00Z')).map(a=>a.k).sort(),['ipo:2026-11-16','ipo:2026-11-23']);
  // switched off by its type, or with the updates' level: none
  s.setDoc('settings/main',{newsAl:{types:{ipo:false}}}); assert.equal(pulseUpdate(s,null,{now:new Date(NOW.getTime()+4*36e5),save:false}).doc.items.filter(a=>a.kind==='ipo'&&(a.up||a.at)>new Date(NOW.getTime()+3.5*36e5).toISOString()).length,0);
  {const s4=new Store(':memory:'); s4.addUser({email:'owner@example.com',password:'owner-pass-123',role:'owner'}); s4.setDoc('research/ipos',s.getDoc('research/ipos').data); s4.setDoc('settings/main',{newsAl:{types:{ipo:false}}});
    assert.equal(pulseUpdate(s4,null,{now:NOW}).doc.items.length,0,'the type switched off: no update at all')}
  // the list is market data: every signed-in person may read it, nobody but the management writes it
  assert.equal(access({id:p.id,role:'friend'},'research/ipos'),'r'); assert.equal(access(null,'research/ipos'),'');
  // the job is on the clock three times a day, in Israel time
  const j=SCHEDULE.find(x=>x.name==='ipos'); assert.ok(j); assert.deepEqual([[6,20],[16,40],[21,40],[12,0]].map(([h,min])=>j.when({h,min,wd:2})),[true,true,true,false]);
});

test('the API: a security\'s lookup for its page (signed in only, a symbol only), with what the source said and nothing else',async()=>{
  const {createApp,bootstrap}=await import('../server/index.js');
  const store=new Store(':memory:'); bootstrap(store); store.addUser({email:'p@x.co',password:'password1',role:'friend'});
  const app=createApp({store,siteDir:new URL('../site',import.meta.url).pathname,jobs:false}); const asked=[];
  app.locals.secChart=async t=>{asked.push(t); if(t==='7203.T')return {px:3311,prev:3312,ccy:'JPY',time:1795501800000,closeDate:'2026-11-24',exch:'JPX',name:'Toyota Motor Corporation',type:'EQUITY',xname:'Tokyo',first:'1999-05-06'};
    if(t==='BRK-B')return {px:500,prev:498,ccy:'USD',closeDate:'2026-11-23',exch:'NYQ'}; throw new Error('no data found')};
  const quoted=[]; app.locals.secQuote=async t=>{quoted.push(t); if(t==='NEWX')return {px:21.5,prev:20,ccy:'USD',time:1795467601000,closeDate:'2026-11-23',exch:'NASDAQ-GS',src:'nasdaq'}; throw new Error('no price')};
  const srv=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x))}), base='http://127.0.0.1:'+srv.address().port, jar={};
  const req=async(who,method,url,body)=>{const r=await fetch(base+url,{method,redirect:'manual',headers:{...(jar[who]?{cookie:jar[who]}:{}),'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const sc=r.headers.get('set-cookie'); if(sc)jar[who]=sc.split(';')[0]; const t=await r.text(); let j=null; try{j=JSON.parse(t)}catch(e){} return {status:r.status,j}};
  try{
    assert.equal((await req('x','GET','/api/secinfo?sym=7203.T')).status,401,'signed out: nothing');
    assert.equal((await req('p','POST','/api/login',{email:'p@x.co',password:'password1'})).status,200);
    let r=await req('p','GET','/api/secinfo?sym=7203.t'); assert.equal(r.status,200);
    assert.deepEqual(r.j,{sym:'7203.T',name:'Toyota Motor Corporation',type:'stock',exch:'Tokyo',ccy:'JPY',px:3311,prev:3312,date:'2026-11-24',at:1795501800000,first:'1999-05-06',src:'Yahoo Finance',delayed:true});
    r=await req('p','GET','/api/secinfo?sym=7203.T'); assert.equal(r.j.cached,true); assert.equal(asked.length,1,'asked of the source once in ten minutes');
    r=await req('p','GET','/api/secinfo?sym=BRK.B'); assert.deepEqual([r.j.name,r.j.type,r.j.exch,r.j.first],['','','NYQ',null],'what the source did not say stays empty'); assert.equal(asked[1],'BRK-B','a class share as the source writes it');
    r=await req('p','GET','/api/secinfo?sym=ZZZQ'); assert.equal(r.status,404); assert.match(r.j.error.message,/לא מצאתי נתוני מסחר/);
    // a US security the first source did not answer for: Nasdaq's quote, the price only, named as its source; another exchange has no second source
    r=await req('p','GET','/api/secinfo?sym=NEWX'); assert.deepEqual([r.status,r.j.px,r.j.prev,r.j.ccy,r.j.src,r.j.name,r.j.first,r.j.delayed],[200,21.5,20,'USD','Nasdaq','',null,true]);
    r=await req('p','GET','/api/secinfo?sym=9999.HK'); assert.equal(r.status,404); assert.deepEqual(quoted,['ZZZQ','NEWX'],'only a plain US ticker is asked of Nasdaq');
    for(const bad of ['','1159250','TLV:TEVA','A B','../x','WAYTOOLONGSYMBOL','^GSPC'])assert.equal((await req('p','GET','/api/secinfo?sym='+encodeURIComponent(bad))).status,400,'not a symbol: '+bad);
    // the list of new listings through the documents' API: a partner reads it whole (it names nobody's holdings)
    store.setDoc('research/ipos',{items:[{sym:'ANT',kind:'ipo',date:'2026-11-19'}],syms:[['ANT','Anthropic, PBC','S','Q']],updatedAt:NOW.toISOString()});
    r=await req('p','GET','/api/db/doc?path=research/ipos'); assert.equal(r.status,200); assert.deepEqual(r.j.data.syms,[['ANT','Anthropic, PBC','S','Q']]);
    assert.equal((await req('p','PUT','/api/db/doc?path=research/ipos',{items:[]})).status,403,'and cannot write it');
  }finally{srv.close()}
});

// ---- the page's own code (taken out of page/live.html) ----
test('the page: the key of a security from another market, the rows of the search across markets, what is told as new',()=>{
  const W=load(['WKEY','wsecCan','wsFar','wsKey','wsRows','ipoFreshP','SECKEY'],{});
  assert.deepEqual(['ANT','7203.T','0700.HK','SAP.DE','VOD.L','RELIANCE.NS','NOVO-B.CO','BRK-B','TEVA.TA','1159250.TA','0P00000AWP.L','^GSPC','BTC-USD','EURUSD=X'].map(W.wsKey),
    ['ANT','7203.T','0700.HK','SAP.DE','VOD.L','RELIANCE.NS','NOVO-B.CO','BRK.B','TLV:TEVA','1159250','','','BTC-USD',''],'Tel Aviv as the page keys it, a class share with a dot, what the page cannot price as nothing');
  assert.deepEqual(['7203.T','SAP.DE','VOD.L','ANT','BRK.B','TLV:TEVA','TEVA.TA'].map(W.wsFar),[true,true,true,false,false,false,false],'another exchange by its suffix; a share class is not one');
  assert.ok(W.wsecCan('0700.HK')&&!W.wsecCan('1159250')&&!W.wsecCan('TLV:TEVA')&&!W.wsecCan('WAYTOOLONGSYMBOL'));
  for(const k of ['7203.T','0700.HK','SAP.DE','RELIANCE.NS','MSFT','TLV:TEVA','1159250','IDX:SPX'])assert.ok(W.SECKEY.test(k),'a page for '+k);
  const R=W.wsRows([{sym:'MSFT',name:'Microsoft Corporation',exch:'NASDAQ',type:'stock'},{sym:'MSF.DE',name:'Microsoft Corporation',exch:'XETRA',type:'stock'},{sym:'^GSPC',name:'S&P 500',exch:'SNP',type:'index'},{sym:'MSF.DE',name:'again',exch:'XETRA',type:'stock'},{sym:'0P00000AWP.L',name:'A long fund',exch:'LSE',type:'fund'},{sym:'TEVA.TA',name:'Teva',exch:'Tel Aviv',type:'stock'}],['MSFT']);
  assert.deepEqual(R.map(x=>[x.k,x.sym,x.exch,x.type]),[['MSF.DE','MSF.DE','XETRA','stock'],['TLV:TEVA','TEVA.TA','Tel Aviv','stock']],'no index, nothing the list already shows, nothing twice, nothing the page cannot open');
  const now=NOW.getTime(), D={items:[{sym:'ANT',kind:'ipo',date:'2026-11-19',first:'2026-11-19'},{sym:'NOTYT',kind:'ipo',date:'2026-11-23'},{sym:'NEWF',kind:'etf',first:'2026-11-23'},{sym:'NOCH',kind:'list'},{sym:'OLDX',kind:'list',first:'2001-03-01',old:true},{sym:'WWB',kind:'ipo',date:'2026-11-13',first:'2026-11-13'}]};
  assert.deepEqual(W.ipoFreshP(D,10,now).map(x=>[x.sym,x.d]),[['NOTYT','2026-11-23'],['NEWF','2026-11-23'],['ANT','2026-11-19']],'as the server tells it: the offerings, and a new symbol once its first day is known');
  assert.deepEqual(W.ipoFreshP(D,45,now).map(x=>x.sym),['NOTYT','NEWF','ANT','WWB']);
});

test('the page: a security of another exchange is priced in its own currency; one nobody follows shows the delayed price its lookup gave, said to be delayed',()=>{
  const G={Q:{prices:{'7203.T':3311,MSFT:505},prev:{'7203.T':3312,MSFT:512},meta:{'7203.T':{ccy:'JPY',date:'2026-11-24'}},stale:{},priceLabel:'סגירה 24.11'},ALLQ:null,CLOSES:{},ILF:{},WSEC:{},
    itemOf:k=>k==='MSFT'?{sym:'MSFT',t:'S',ex:'Q'}:k==='SAP.DE'?{sym:'SAP.DE',t:'S',ex:'XETRA',w:1,ccy:'EUR'}:k==='7203.T'?{sym:'7203.T',t:'S',w:1}:null,ilIdx:()=>'',ilIsNum:k=>/^\d{6,9}$/.test(k),dmy:d=>String(d).slice(8,10)+'.'+String(d).slice(5,7),ilDay:()=>'2026-11-24'};
  const F=load(['priceOf'],G);
  assert.deepEqual([F.priceOf('7203.T').ccy,F.priceOf('7203.T').px,F.priceOf('MSFT').ccy],['JPY',3311,'USD'],'the quote\'s own currency; a US share stays in dollars');
  assert.equal(F.priceOf('SAP.DE'),null,'no price anywhere: none shown');
  G.WSEC['SAP.DE']={at:Date.now(),v:{px:210.5,prev:208,ccy:'EUR',date:'2026-11-24'}};
  const p=F.priceOf('SAP.DE'); assert.deepEqual([p.px,p.ccy,p.ws,p.daily],[210.5,'EUR',true,true]); assert.match(p.label,/^מחיר בעיכוב · 24\.11$/); assert.ok(Math.abs(p.chg-(210.5/208-1))<1e-12);
  G.WSEC['ANT']={at:Date.now(),v:{px:87.64,prev:null,ccy:'USD',date:'2026-11-23'}}; G.itemOf=k=>k==='ANT'?{sym:'ANT',t:'S',ex:'Q',dyn:1}:null;
  assert.deepEqual([F.priceOf('ANT').px,F.priceOf('ANT').ccy,F.priceOf('ANT').chg],[87.64,'USD',null],'no previous close from the source: no day\'s change is made up');
});
