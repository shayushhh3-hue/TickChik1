// The page's calculations, checked on small portfolios whose answers are known by hand: values, weights, currency,
// missing prices, an empty portfolio, deposits and withdrawals, fees, realized profit, period results, the forecast,
// the peak alert per account, plan marks a later statement covers, and the date in Israel.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './page-src.js';

const near=(a,b,eps=0.005,msg='')=>{if(typeof eps==='string'){msg=eps;eps=0.005} assert.ok(Math.abs(a-b)<=eps,`${a} ≠ ${b} ${msg}`)};
const dayAgo=k=>new Date(Date.now()-k*864e5).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});

// one set of globals, as the page has them; each test sets what it needs
const G={P:null,Q:null,HS:null,DY:null,DRAFT:null,PLD:null,NAMEOF:{},FUNDOF:{},
  acctIds:()=>['exc','blink'], acctCcy:a=>a==='blink'?'USD':'ILS'};
const F=load(['GROUPS','NAMEOF','isFundLike','effGroup','allDep','ilDay','usdRate','depNet','stmtDay','markDay','coveredBy','planOpen','planDepExtra','depTotal','feesOf',
  'planAdj','mAllNow','model','planDeposit','project','ymAdd','resultOf','realizedOf','CR_DAY','crisisInfo','historyWithTx',
  'numOr','ymNow','upMonths','fxOfMonth','savedBefore','upCovers','planCovered','planExtraList','depUp','monthSeries','monRows','seriesMap','depBumps','dailyBumped','dateBack','knownDay','ccyOfPos','rateOf','CCYHE','CCYSYM','fmtPx','pxLag','pxLagInfo','dayOfIso','HDAY',
  'fxAvg','costBasis','realizedIls','divNetIls','decompOf','dollarCost','monthFlow','planActual','DIV_WH','divHistory'],G,['allBuy']);
const plan=(deposits=[],purchases=[])=>{G.PLD={deposits,purchases,idx:{deposits:[],purchases:[]}}};
plan();

test('model: value, weights, dollars, cash, cost, the day', ()=>{
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:2,costIls:600,group:'tech'},{sym:'1159250',acct:'exc',ccy:'ILS',qty:10,costIls:300},{sym:'KO',acct:'blink',ccy:'USD',qty:1,costIls:null,group:'cons'}],
    cash:[{acct:'exc',ccy:'ILS',amount:100},{acct:'blink',ccy:'USD',amount:10}]};
  G.Q={usdIls:3.5,prices:{MSFT:100,'1159250':35,KO:50},prev:{MSFT:95}};
  const m=F.model(G.P,G.Q,'all');
  near(m.total,700+350+175+100+35); near(m.cash,135);
  const ms=m.pos.find(p=>p.sym==='MSFT'); near(ms.val,700); near(ms.w,700/1360*100); near(ms.pnlPct??0,0);
  assert.equal(m.pos.find(p=>p.sym==='1159250').group,'il','an Israeli security number is an Israeli holding');
  near(m.cost,900); near(m.pnl,(700+350)-900); assert.equal(m.missingCost,1,'KO has no cost');
  near(m.dayIls,2*5*3.5); near(m.dayPct,35/(1225-35)*100);
  near(Object.values(m.groups).reduce((t,g)=>t+g.w,0),100,1e-6);
  assert.equal(m.acct,'all');
  const b=F.model(G.P,G.Q,'blink'); near(b.total,175+35); assert.equal(b.acct,'blink');
});

test('prices: which of a portfolio\'s securities stop at an older close than the market\'s last session', ()=>{
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:1,costIls:300},{sym:'1159250',acct:'exc',ccy:'ILS',qty:10,costIls:300},{sym:'5113428',acct:'blink',ccy:'ILS',qty:5,costIls:100}],cash:[]};
  G.Q={usdIls:3.5,prices:{MSFT:100,'1159250':35,'5113428':20},meta:{MSFT:{date:'2026-10-16'},'1159250':{date:'2026-10-15',ccy:'ILS'},'5113428':{date:'2026-10-16',ccy:'ILS'}},
    lag:{il:{have:'2026-10-15',want:'2026-10-16',n:1,of:2}}};
  assert.equal(F.pxLag(),true);
  const g=F.pxLagInfo(F.model(G.P,G.Q,'all'));
  assert.deepEqual(g.map(x=>[x.k,x.name,x.syms]),[['il','תל אביב',['1159250']]],'only the Israeli security without Friday');
  assert.deepEqual(F.pxLagInfo(F.model(G.P,G.Q,'blink')),[],'the other account has Friday for all of its securities');
  assert.equal(F.dayOfIso('2026-10-16'),'יום ו׳');
  G.Q={usdIls:3.5,prices:{MSFT:100},meta:{MSFT:{date:'2026-10-16'}},lag:{}}; assert.equal(F.pxLag(),false); assert.deepEqual(F.pxLagInfo(F.model(G.P,G.Q,'all')),[]);
});

test('model: a security priced in another currency uses that currency\'s rate, or waits for it', ()=>{
  G.P={positions:[{sym:'SAP.DE',acct:'exc',ccy:'USD',qty:2,costIls:800,group:'tech'},{sym:'MSFT',acct:'exc',ccy:'USD',qty:1,costIls:300,group:'tech'}],cash:[]};
  G.Q={usdIls:3.5,prices:{'SAP.DE':100,MSFT:100},prev:{'SAP.DE':98},meta:{'SAP.DE':{ccy:'EUR'}},rates:{EUR:{rate:4}}};
  let m=F.model(G.P,G.Q,'all'); const sap=m.pos.find(p=>p.sym==='SAP.DE');
  near(sap.val,800,1e-6); assert.equal(sap.ccy,'EUR','the quote currency wins over the table'); near(sap.dayIls,2*2*4); near(m.usdPct,100,1e-6,'every foreign currency counts toward the currency cap');
  G.Q={usdIls:3.5,prices:{'SAP.DE':100,MSFT:100},meta:{'SAP.DE':{ccy:'EUR'}}};
  m=F.model(G.P,G.Q,'all'); assert.equal(m.pos.length,1,'no rate yet: left out, never priced as dollars'); assert.deepEqual(m.noRate,['SAP.DE']); near(m.total,350);
});

test('model: a missing price, an empty portfolio, no division by zero', ()=>{
  G.Q={usdIls:3.5,prices:{MSFT:100},prev:{}};
  const m=F.model({positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:1,costIls:300},{sym:'NVDA',acct:'exc',ccy:'USD',qty:5,costIls:2000}],cash:[]},G.Q,'all');
  near(m.total,350); assert.deepEqual(m.pos.map(p=>p.sym),['MSFT'],'a security without a price is left out of the value');
  const e=F.model({positions:[],cash:[]},G.Q,'all');
  assert.equal(e.total,0); assert.equal(e.dayPct,null); assert.equal(e.pnlPct,0); assert.ok(Object.values(e.groups).every(g=>g.w===0));
  assert.equal(e.hasDay,false);
});

test('deposits: a withdrawal comes off the money put in, once', ()=>{
  G.Q={usdIls:3.5,prices:{},prev:{}}; plan();
  G.HS={depIlsNow:1000,accounts:[{acct:'exc',ccy:'ILS',deposits:[{date:'2026-09-01',amount:1000},{date:'2026-09-20',amount:-200}],trades:[]},
    {acct:'blink',ccy:'USD',deposits:[{date:'2026-09-02',amount:-10}],trades:[]}]};
  near(F.depNet(),1000-200-35,1e-9);
  G.HS.accounts[0].deposits[1].inDep=true; G.HS.accounts[1].deposits[0].inDep=true;
  near(F.depNet(),1000,1e-9,'withdrawals already taken off are not taken off again');
  G.HS=null; assert.equal(F.depNet(),0);
});

test('reading a statement twice: deposits, withdrawals, fees and trades counted once', ()=>{
  G.Q={usdIls:3.5,prices:{},prev:{}}; G.HS={depIlsNow:0,accounts:[],monthly:[]};
  G.DRAFT={tx:[{acct:'exc',date:'2026-10-01',side:'deposit',amount:500,ccy:'ILS'},{acct:'exc',date:'2026-10-05',side:'withdraw',amount:200,ccy:'ILS'},
    {acct:'exc',date:'2026-10-06',side:'fee',amount:5,ccy:'ILS'},{acct:'exc',date:'2026-10-02',side:'buy',sym:'MSFT',qty:1,px:100,ccy:'USD',fee:6},
    {acct:'exc',date:'2026-10-03',side:'sell',sym:'MSFT',qty:1,px:120,ccy:'USD',fee:6}]};
  let r=F.historyWithTx(); G.HS=r.H; const A=()=>G.HS.accounts.find(a=>a.acct==='exc');
  near(G.HS.depIlsNow,300); assert.equal(A().deposits.find(d=>d.amount<0).inDep,true); near(F.depNet(),300);
  assert.equal(A().fees.length,1); near(F.feesOf(A(),3.5).ils,5+12*3.5); near(A().realizedUsd,20);
  r=F.historyWithTx(); G.HS=r.H;
  assert.equal(r.added,0,'nothing new'); near(G.HS.depIlsNow,300); near(F.depNet(),300); assert.equal(A().fees.length,1); assert.equal(A().trades.length,2);
  near(F.feesOf(A(),3.5).ils,5+12*3.5,'the same fees after reading it again');
});

test('fees: the trade\'s own fee, else the account\'s fee per US trade, plus fee rows and the note', ()=>{
  const exc={acct:'exc',ccy:'ILS',feeUsdPerTrade:6,feesNote:'ועוד 3 ₪ על קניית ת״א 125',trades:[
    {date:'2026-02-19',sym:'PEP',qty:1,px:163.8},{date:'2026-02-19',sym:'MSFT',qty:1,px:397.66},{date:'2026-03-01',sym:'TA125',qty:2,px:30,ccy:'ILS',feeIls:3},
    {date:'2026-03-02',sym:'KO',qty:-1,px:70,fee:2},{date:'2026-03-03',sym:'KO',qty:0.01,px:70,div:true}]};
  const f=F.feesOf(exc,3);
  near(f.ils,6*3+6*3+3+2*3,'the note describes the ₪3 of the TA-125 trade; it is not added again'); assert.equal(f.trades.length,4,'a dividend is not a trade'); assert.equal(f.own,2);
  assert.equal(f.trades.find(t=>t.ym==='2026-03'&&t.fee===3)!=null,true,'the shekel trade has its own ₪3, not a dollar fee');
  const none=F.feesOf({acct:'blink',ccy:'USD',trades:[{date:'2026-05-27',sym:'NVTS',qty:10,px:31.81}]},3);
  assert.equal(none.ils,0); assert.equal(none.known,false);
  near(F.feesOf({acct:'x',trades:[],fees:[{date:'2026-01-01',amount:4,ccy:'USD'},{date:'2026-01-02',amount:10,ccy:'ILS'}]},3.5).ils,24);
  assert.equal(F.feesOf({acct:'x'},3.5).ils,0);
});

test('the plan: marks a later statement covers are not added again', ()=>{
  G.Q={usdIls:3.5,prices:{MSFT:100,NVDA:200},prev:{}};
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:1,costIls:350}],cash:[{acct:'exc',ccy:'ILS',amount:0}],asOf:{exc:'2026-10-10'}};
  plan([{amount:1000,at:'2026-10-05T09:00:00Z'},{amount:500,at:'2026-10-12T09:00:00Z'},{amount:50}],
       [{sym:'MSFT',paidIls:350,qty:1,at:'2026-10-05T09:00:00Z'},{sym:'NVDA',paidIls:700,qty:1,at:'2026-10-12T09:00:00Z'}]);
  const o=F.planOpen(); assert.deepEqual(o.deps.map(d=>d.amount),[500,50],'the 5.10 deposit is in the 10.10 statement; one without a date stays');
  assert.deepEqual(o.buys.map(b=>b.sym),['NVDA']);
  const adj=F.planAdj(); near(adj.dep,550); assert.equal(adj.buys.length,1);
  near(F.mAllNow().total,350+550,1e-9,'MSFT and the open deposits; NVDA is not held yet, so its purchase stays as cash');
  // the deposits total: the history already has the 5.10 deposit (6.10, same amount), so the plan's copy is not added
  G.HS={depIlsNow:1000,accounts:[{acct:'exc',ccy:'ILS',deposits:[{date:'2026-10-06',amount:1000}],trades:[]}]};
  near(F.planDepExtra(),550); near(F.depTotal(),1550);
  G.HS={depIlsNow:0,accounts:[]}; near(F.planDepExtra(),1550,1e-9,'without it in the history, every plan deposit counts');
  plan();
});

test('the peak alert: one account against its own peak, money moved since counted', ()=>{
  G.Q={usdIls:3.5,prices:{MSFT:100,KO:100},prev:{}}; plan();
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'ILS',qty:50},{sym:'KO',acct:'blink',ccy:'ILS',qty:39}],cash:[],asOf:{}};
  G.DY={points:{[dayAgo(20)]:{v:9000,dep:9000,by:{exc:5500,blink:3500}},[dayAgo(10)]:{v:10000,dep:9000,by:{exc:6000,blink:4000}},[dayAgo(5)]:{v:9800,dep:9000,by:{exc:5900,blink:3900}}}};
  G.HS={depIlsNow:9000,accounts:[{acct:'exc',ccy:'ILS',deposits:[],trades:[]},{acct:'blink',ccy:'ILS',deposits:[],trades:[]}]};
  const bl=F.model(G.P,G.Q,'blink'); near(bl.total,3900);
  assert.equal(F.crisisInfo(bl),null,'blink at 3,900 is 2.5% under its own peak of 4,000, not 61% under all the accounts\' 10,000');
  G.P.positions[0].qty=46; const all=F.model(G.P,G.Q,'all'); near(all.total,8500);
  const cr=F.crisisInfo(all); assert.ok(cr&&cr.peak); near(cr.peak.pct,15);
  // 1,000 withdrawn since the peak: the comparison drops by the same amount
  G.HS.depIlsNow=8000; G.HS.accounts[0].deposits.push({date:dayAgo(2),amount:-1000,inDep:true});
  const cr2=F.crisisInfo(all); assert.ok(!cr2||!cr2.peak||cr2.peak.pct<10,'5.6% under the peak after the withdrawal');
  G.P.positions[1].qty=30; G.HS.accounts[1].deposits.push({date:dayAgo(1),amount:-800,inDep:true});
  assert.equal(F.crisisInfo(F.model(G.P,G.Q,'blink')),null,'3,000 after taking out 800 is 6% under 3,200');
});

test('realized profit: first in, first out', ()=>{
  near(F.realizedOf([{date:'2026-01-01',sym:'A',qty:10,px:10},{date:'2026-02-01',sym:'A',qty:10,px:20},{date:'2026-03-01',sym:'A',qty:-15,px:30}]),10*20+5*10);
  near(F.realizedOf([{date:'2026-03-01',sym:'B',qty:-5,px:30}]),0,'a sale with no known buy adds nothing');
  assert.equal(F.realizedOf([]),0);
});

test('the average buy rate of the dollars: statement totals and saved conversions, a rate under 1 is dollars per shekel', ()=>{
  near(F.fxAvg({accounts:[{acct:'exc',fxIls:9000,fxUsd:2400}]}),3.75,1e-9);
  near(F.fxAvg({accounts:[{acct:'blink',fx:[{date:'2026-07-01',amount:350,ccy:'ILS',toCcy:'USD',toAmount:100},{date:'2026-07-02',amount:700,ccy:'ILS',toCcy:'USD',rate:3.5},
    {date:'2026-07-03',amount:400,ccy:'ILS',toCcy:'USD',rate:0.25},{date:'2026-07-04',amount:100,ccy:'USD',toCcy:'ILS',toAmount:350},{date:'2026-07-05',amount:50,ccy:'ILS',toCcy:'USD'}]}]}),(350+700+400)/(100+200+100),1e-9,
    'a conversion with neither the dollars nor a rate, and a sale of dollars, do not count');
  assert.equal(F.fxAvg({accounts:[]}),null); assert.equal(F.fxAvg(null),null);
});

// the breakdown of the result: a made-up portfolio whose parts are known by hand
const decP=()=>({positions:[
  {sym:'MSFT',acct:'exc',ccy:'USD',qty:2,costIls:600,costUsd:150,group:'tech'},        // the statement gives both costs
  {sym:'KO',acct:'blink',ccy:'USD',qty:4,costIls:null,group:'cons'},                    // only the trades: 4 bought at $40
  {sym:'NVDA',acct:'exc',ccy:'USD',qty:3,costIls:1500,group:'tech'},                    // a shekel cost; the trades cover one unit of three
  {sym:'TA125',acct:'exc',ccy:'ILS',qty:10,costIls:300,group:'il'},
  {sym:'AAPL',acct:'blink',ccy:'USD',qty:1,group:'tech'}],                              // no cost at all
  cash:[{acct:'exc',ccy:'ILS',amount:100}],asOf:{}});
const decQ=()=>({usdIls:3.5,prices:{MSFT:100,KO:50,NVDA:150,TA125:35,AAPL:200},prev:{},meta:{TA125:{ccy:'ILS'}}});
const decH=()=>({depIlsNow:3000,monthly:[],accounts:[
  {acct:'exc',ccy:'ILS',fxIls:9000,fxUsd:2400,realizedUsd:999,fees:[{date:'2026-03-01',amount:10,ccy:'ILS'}],deposits:[],trades:[
    {date:'2026-01-05',sym:'NVDA',qty:1,px:100,ccy:'USD'},{date:'2026-02-01',sym:'TA125',qty:5,px:20,ccy:'ILS'},{date:'2026-03-01',sym:'TA125',qty:-5,px:30,ccy:'ILS'},
    {date:'2026-04-01',sym:'MSFT',qty:0.01,px:100,ccy:'USD',div:true,total:1}]},
  {acct:'blink',ccy:'USD',divGrossUsd:2,divTaxUsd:0.5,deposits:[],trades:[{date:'2026-01-10',sym:'KO',qty:4,px:40}]}]});

test('the cost of each holding: the statement\'s, the lots from the trades, or an estimate at the average buy rate', ()=>{
  const B=F.costBasis(decP(),decQ(),decH()), by=Object.fromEntries(B.rows.map(r=>[r.sym,r]));
  near(B.avg,3.75,1e-9);
  assert.equal(by.MSFT.src,'stmt'); near(by.MSFT.costNat,150); near(by.MSFT.costIls,600); assert.equal(by.MSFT.ilsEst,false);
  assert.equal(by.KO.src,'trades'); near(by.KO.costNat,160); near(by.KO.costIls,600,1e-9,'the dollar cost at the average buy rate'); assert.equal(by.KO.ilsEst,true);
  assert.equal(by.NVDA.src,'est','one unit of three in the trades is not enough'); near(by.NVDA.costNat,400,1e-9); near(by.NVDA.costIls,1500);
  assert.equal(by.TA125.src,'stmt'); near(by.TA125.costNat,300);
  assert.equal(by.AAPL.noCost,true); assert.equal(by.AAPL.costNat,null); near(by.AAPL.val,700);
  // a sale takes the first lots: 3 bought at 10, 2 at 20, 3 sold: the 2 left cost 20 each
  const hs={accounts:[{acct:'exc',ccy:'ILS',trades:[{date:'2026-01-01',sym:'A',qty:3,px:10,ccy:'USD'},{date:'2026-01-02',sym:'A',qty:2,px:20,ccy:'USD'},{date:'2026-01-03',sym:'A',qty:-3,px:50,ccy:'USD'}]}]};
  const a=F.costBasis({positions:[{sym:'A',acct:'exc',ccy:'USD',qty:2}]},{usdIls:3.5,prices:{A:60}},hs).rows[0];
  assert.equal(a.src,'trades'); near(a.costNat,40); near(a.costIls,40*3.5,1e-9,'no buy rate known: today\'s');
  // the same security in another account has its own lots
  assert.equal(F.costBasis({positions:[{sym:'A',acct:'blink',ccy:'USD',qty:2}]},{usdIls:3.5,prices:{A:60}},hs).rows[0].noCost,true);
  // no history at all: the statement's costs only
  assert.equal(F.costBasis({positions:[{sym:'A',acct:'exc',ccy:'USD',qty:2,costIls:700}]},{usdIls:3.5,prices:{A:60}},null).rows[0].costNat,null);
});

test('sales and dividends from the history, in shekels: shekel trades as they are, the rest at today\'s rate', ()=>{
  const [exc,blink]=decH().accounts;
  near(F.realizedIls(exc,3.5),50,1e-9,'TA-125 sold in shekels: 5 × (30 − 20); the statement\'s 999 is not used when the trades are there');
  near(F.realizedIls(blink,3.5),0); near(F.realizedIls({acct:'x',ccy:'USD',realizedUsd:20},3.5),70,1e-9,'no trades: the statement\'s number');
  near(F.divNetIls(exc,3.5),3.5,1e-9,'the dividend row\'s amount'); near(F.divNetIls(blink,3.5),1.5*3.5,1e-9,'no dividend rows: the statement\'s totals');
  near(F.divNetIls({acct:'x',ccy:'USD',trades:[{date:'2026-01-01',sym:'KO',qty:0.5,px:2,div:true}]},3.5),3.5,1e-9,'no amount shown: units times price');
});

test('where the result came from: the same bottom line as the headline, and the parts add up to it', ()=>{
  G.P=decP(); G.Q=decQ(); G.HS=decH(); G.DY=null; plan();
  const m=F.mAllNow(), D=F.decompOf(G.P,G.Q,G.HS,m,F.planOpen().buys,F.depTotal());
  near(m.total,700+700+1575+350+700+100); near(D.total,m.total-3000,1e-9,'the headline\'s result: value today against the money put in');
  near(D.price,175+140+175+50,1e-9,'each holding\'s move in its own currency, at today\'s rate');
  near(D.fx,-75-40-100,1e-9,'the dollar: the dollar cost at today\'s rate against the shekel cost');
  near(D.real,50,1e-9); near(D.div,3.5+5.25,1e-9); near(D.fees,-10,1e-9);
  near(D.price+D.fx+D.real+D.div+D.fees+D.other,D.total,1e-9,'the parts add up to the whole');
  assert.deepEqual(D.est,['KO','NVDA'],'estimated at the average buy rate'); assert.deepEqual(D.none,['AAPL']); near(D.noneVal,700); assert.deepEqual(D.allPx,[]);
  // a deposit and a purchase ticked in the plan: the value and the money in move together, so the result does not
  plan([{amount:500}],[{sym:'MSFT',paidIls:300,qty:1,px:100,fx:3}]);
  const m2=F.mAllNow(), D2=F.decompOf(G.P,G.Q,G.HS,m2,F.planOpen().buys,F.depTotal());
  near(m2.total,m.total+500-300+350,1e-9,'₪500 more cash; ₪300 of cash became one MSFT worth ₪350 today'); near(F.depTotal(),3500);
  near(D2.total,D.total+50,1e-9,'the deposit moves nothing; the purchase is up ₪50'); near(D2.price,D.price,1e-9,'bought at $100, worth $100'); near(D2.fx,D.fx+50,1e-9,'bought at a rate of 3, held at 3.5: $100 × 0.5');
  near(D2.price+D2.fx+D2.real+D2.div+D2.fees+D2.other,D2.total,1e-9);
  // a dollar holding with a shekel cost and nothing to split it by goes under prices, and says so
  G.HS.accounts[0].fxIls=0; G.HS.accounts[0].fxUsd=0; plan();
  const D3=F.decompOf(G.P,G.Q,G.HS,F.mAllNow(),[],F.depTotal());
  assert.deepEqual(D3.allPx,['NVDA']); assert.deepEqual(D3.est,['KO'],'KO\'s dollar cost becomes shekels at today\'s rate, so its shekel cost is an estimate'); near(D3.price+D3.fx+D3.real+D3.div+D3.fees+D3.other,D3.total,1e-9);
  const ko=F.costBasis(G.P,G.Q,G.HS).rows.find(r=>r.sym==='KO'); near(ko.costIls,160*3.5,1e-9); assert.equal(ko.ilsEst,true);
  G.P=null; G.Q=null; G.HS=null; plan();
});

test('the dollar view: each holding\'s dollar cost and the dollar value of the same part, so the profit leaves the rate out', ()=>{
  G.P=decP(); G.Q=decQ(); G.HS=decH(); plan();
  const D=F.dollarCost(G.P,G.Q,G.HS,[]);
  assert.deepEqual(Object.keys(D).sort(),['KO','MSFT','NVDA','TA125'],'a holding with no cost at all is not in it');
  near(D.MSFT.cost,150); near(D.MSFT.val,200); assert.equal(D.MSFT.est,false,'the statement\'s dollar cost');
  near(D.KO.cost,160); near(D.KO.val,200); assert.equal(D.KO.est,false,'the lots from the trades');
  near(D.NVDA.cost,400,1e-9); near(D.NVDA.val,450); assert.equal(D.NVDA.est,true,'estimated at the average buy rate');
  near(D.TA125.cost,300/3.5,1e-9); near(D.TA125.val,350/3.5,1e-9); assert.equal(D.TA125.est,true,'a shekel holding: its own profit, at today\'s rate');
  // a purchase ticked in the plan adds its dollars at the price it marked; one account alone has only its own rows
  const D2=F.dollarCost(G.P,G.Q,G.HS,[{sym:'MSFT',paidIls:300,qty:1,px:100,fx:3}]); near(D2.MSFT.cost,250); near(D2.MSFT.val,300);
  const D3=F.dollarCost(G.P,G.Q,G.HS,[{sym:'MSFT',paidIls:300,qty:1,px:100,fx:3}],'blink'); assert.deepEqual(Object.keys(D3),['KO'],'the plan\'s purchase belongs to the whole portfolio only');
  G.P=null; G.Q=null; G.HS=null;
});

test('the plan chart\'s real part: the money in and the holdings at cost, month by month, ending on today\'s totals', ()=>{
  const cur=F.ymNow(), m=k=>F.ymAdd(cur,-k); plan(); G.DY=null;
  // ₪10,000 three months ago, ₪2,000 last month (read from a screenshot); MSFT bought three months ago ($100 × 20 at 3.5),
  // KO last month ($50 × 10); ₪500 cash today
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:20,costIls:7000},{sym:'KO',acct:'exc',ccy:'USD',qty:10,costIls:1750}],cash:[{acct:'exc',ccy:'ILS',amount:500}]};
  G.Q={usdIls:3.5,prices:{MSFT:120,KO:50},prev:{}};
  G.HS={depIlsNow:12000,monthly:[],accounts:[{acct:'exc',ccy:'ILS',deposits:[{date:m(3)+'-02',amount:10000},{date:m(1)+'-05',amount:2000}],
    trades:[{date:m(3)+'-03',sym:'MSFT',qty:20,px:100,ccy:'USD'},{date:m(1)+'-06',sym:'KO',qty:10,px:50,ccy:'USD'}]}]};
  near(F.monthFlow(m(1)),2000); near(F.monthFlow(m(2)),0);
  const A=F.planActual(F.mAllNow());
  assert.deepEqual(A.map(r=>r.ym),[m(3),m(2),m(1),cur],'from the first month the records know of, to today');
  assert.deepEqual(A.map(r=>r.ad),[10000,10000,12000,12000],'the money in, as the deposits read');
  assert.deepEqual(A.map(r=>r.ai),[7000,7000,8750,8750],'in securities at cost: today\'s holdings, less what was bought after each month');
  near(A[3].ad,F.depTotal(),1e-9,'today is the headline\'s total');
  // a plan that starts earlier shows the months before as well, with nothing in
  const B=F.planActual(F.mAllNow(),m(5)); assert.equal(B[0].ym,m(5)); assert.equal(B[0].ad,0); assert.equal(B[0].ai,0);
  // no history: one point, today, from the portfolio
  G.HS=null; const C=F.planActual(F.mAllNow()); assert.deepEqual(C.map(r=>[r.ym,r.ad,r.ai]),[[cur,0,8750]]);
  G.P=null; G.Q=null;
});

test('dividends received: a cash one is kept, its tax too; per security gross, tax, net and where the net went', ()=>{
  G.Q={usdIls:3.5,prices:{},prev:{}}; G.HS={depIlsNow:0,accounts:[],monthly:[]}; G.DY=null;
  // KO pays $15 net in cash with $5 withheld; MSFT reinvests $7.5 net in 0.02 units ($375 each), tax not shown; read twice
  const tx=[{acct:'blink',date:'2026-07-01',side:'div',sym:'KO',qty:null,px:null,amount:15,tax:5,ccy:'USD'},{acct:'blink',date:'2026-08-01',side:'div',sym:'MSFT',qty:0.02,px:375,amount:7.5,ccy:'USD'}];
  G.DRAFT={tx}; let hx=F.historyWithTx(); G.HS=hx.H; G.DRAFT={tx}; hx=F.historyWithTx(); G.HS=hx.H;
  const B=G.HS.accounts.find(a=>a.acct==='blink'); assert.equal(B.trades.length,2,'the cash dividend is kept, once');
  const ko=B.trades.find(t=>t.sym==='KO'); assert.deepEqual([ko.qty,ko.div,ko.total,ko.tax],[0,true,15,5]);
  const D=F.divHistory(G.HS,3.5), by=Object.fromEntries(D.rows.map(r=>[r.sym,r]));
  near(by.KO.gross,20*3.5); near(by.KO.tax,5*3.5); near(by.KO.net,15*3.5); near(by.KO.cash,15*3.5); assert.equal(by.KO.est,false);
  near(by.MSFT.net,7.5*3.5); near(by.MSFT.tax,7.5/0.75*0.25*3.5,1e-9,'not shown: 25% of the gross'); assert.equal(by.MSFT.est,true); near(by.MSFT.re,7.5*3.5); near(by.MSFT.units,0.02,1e-12);
  near(D.tot.net,22.5*3.5); near(D.tot.gross,D.tot.net+D.tot.tax,1e-9); assert.equal(D.tot.n,2);
  assert.equal(F.realizedOf(B.trades.filter(t=>!t.div)),0,'a dividend is not a sale'); near(F.feesOf(B,3.5).ils,0);
  // an account with only its statement's totals is one row of that account
  const S=F.divHistory({accounts:[{acct:'exc',ccy:'ILS',trades:[],divGrossUsd:10,divTaxUsd:2.5}]},3.5);
  assert.equal(S.rows[0].stmt,true); near(S.tot.gross,35); near(S.tot.tax,8.75); near(S.tot.net,26.25);
  assert.deepEqual(F.divHistory(null,3.5).rows,[]);
  G.HS=null; G.DRAFT=null; G.Q=null;
});

test('a period\'s result: the change in value less the change in deposits; the return counts money in from mid-month', ()=>{
  const S={'2026-01':{val:1000,dep:1000},'2026-02':{val:1300,dep:1200},'2026-03':{val:1100,dep:1200}};
  // February: +100 on 1,000 at the start and 200 put in during the month, counted for half of it (Modified Dietz)
  const r=F.resultOf(S,['2026-02']); near(r.gain,100); near(r.dep,200); near(r.pct,100/(1000+200*0.5)*100);
  // three months from nothing: January's 1,000 is where the period starts (counted in full), February's 200 for 1.5 of 3 months
  const q=F.resultOf(S,['2026-01','2026-02','2026-03']); assert.equal(q.fromZero,true); near(q.gain,-100); near(q.pct,-100/(1000+200*1.5/3)*100);
  // a first month that is not where the money starts: the period starts a month later
  const n=F.resultOf({...S,'2026-01':{val:1000,dep:1000,nostart:true}},['2026-01','2026-02']); assert.equal(n.first,'2026-02'); assert.equal(n.cut,true); near(n.gain,100);
  // one month from a table uploaded from the app keeps the app's own return
  near(F.resultOf({...S,'2026-02':{val:1300,dep:1200,ret:7.5,up:true}},['2026-02']).pct,7.5);
  assert.equal(F.resultOf(S,['2025-05']).ok,false);
});

test('a monthly table without years: the latest month is the latest one up to today, back one month at a time', ()=>{
  const r=F.monRows([{month:11,value:100,returnPct:1,flow:0},{month:12,value:110,returnPct:2,flow:5},{month:1,value:120,returnPct:3,flow:0},{month:2,value:130,returnPct:-1,flow:-10}],'2026-02-20');
  assert.deepEqual(r.map(x=>x.ym),['2025-11','2025-12','2026-01','2026-02']); assert.equal(r[3].part,true); assert.equal(r[3].asOf,'2026-02-20'); assert.equal(r[0].part,undefined);
  assert.deepEqual([r[3].v,r[3].ret,r[3].flow,r[3].ccy],[130,-1,-10,'ILS']);
  // newest first, as some apps show it; February is over by March
  const d=F.monRows([{month:2,value:130},{month:1,value:120},{month:12,value:110}],'2026-03-05');
  assert.deepEqual(d.map(x=>x.ym),['2025-12','2026-01','2026-02']); assert.equal(d.some(x=>x.part),false);
  // a month after this one is last year's
  assert.deepEqual(F.monRows([{month:11,value:1},{month:12,value:2}],'2026-10-14').map(x=>x.ym),['2025-11','2025-12']);
  // years that are shown are kept; a row without a month or a value is left out
  assert.deepEqual(F.monRows([{month:5,year:2024,value:1},{month:6,year:2024,value:2},{month:0,value:3},{month:7,value:null}],'2026-10-14').map(x=>x.ym),['2024-05','2024-06']);
  assert.deepEqual(F.monRows(null,'2026-10-14'),[]);
  // two screenshots that overlap: a row that shows twice is one month
  assert.deepEqual(F.monRows([7,8,9,8,9,10].map(m=>({month:m,value:m*100})),'2026-10-14').map(x=>x.ym),['2026-07','2026-08','2026-09','2026-10']);
  // thirteen months listed oldest first: October comes twice, a year apart
  assert.deepEqual(F.monRows([10,11,12,1,2,3,4,5,6,7,8,9,10].map((m,i)=>({month:m,value:100+i})),'2026-10-14').map(x=>x.ym).filter(x=>x.endsWith('-10')),['2025-10','2026-10']);
});

test('the months: a table uploaded from an app, its own returns, and the money in counted once', ()=>{
  const cur=F.ymNow(), m=k=>F.ymAdd(cur,-k);
  const up=[{ym:m(3),v:10100,ccy:'ILS',ret:1,flow:10000},{ym:m(2),v:10302,ccy:'ILS',ret:2,flow:0},{ym:m(1),v:15000,ccy:'ILS',ret:-1.5,flow:5000}];
  G.HS={depIlsNow:0,monthly:[],accounts:[{acct:'exc',ccy:'ILS',trades:[],deposits:[],monthly:up}]}; G.P=null; G.Q=null; G.DY=null; plan();
  let S=F.monthSeries();
  assert.deepEqual(S.map(r=>[r.ym,r.src,r.val,r.flow,r.dep]),[[m(3),'up',10100,10000,10000],[m(2),'up',10302,0,10000],[m(1),'up',15000,5000,15000]]);
  assert.equal(S[0].gain,null,'the first month: its start is not known'); assert.equal(S[0].ret,1); assert.equal(S[0].own,true,'the app\'s own return'); near(S[2].gain,15000-10302-5000);
  near(F.depUp(),15000,'all the money in comes from the table');
  // a deposit saved one by one in a month the table covers is not counted again
  G.HS.accounts[0].deposits=[{date:m(1)+'-10',amount:5000,ccy:'ILS'}]; G.HS.depIlsNow=5000;
  near(F.depTotal(),15000);
  // the plan's deposit of such a month is covered by the table too
  plan([{month:m(1),amount:400,at:m(1)+'-12T10:00:00Z'}]); near(F.planDepExtra(),0); near(F.depTotal(),15000); plan();
  // with a portfolio: the current month is today's value, and its money in is what came in since the last month-end
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:50,costIls:15000,group:'tech'}],cash:[]}; G.Q={usdIls:3.5,prices:{MSFT:100},prev:{}};
  S=F.monthSeries(); const now=S[S.length-1]; assert.equal(now.now,true); near(now.val,17500); near(now.flow,0); near(now.gain,2500); near(now.ret,2500/15000*100);
  // a saved month-end (from a statement) wins over the uploaded table for its month, and its money in is not added again
  G.HS.monthly=[{ym:m(2),tot:10400,by:{exc:10400},dep:10000}];
  S=F.monthSeries(); const two=S.find(r=>r.ym===m(2)); assert.equal(two.src,'saved'); assert.equal(two.val,10400); near(F.depUp(),15000-5000,'month -2 is the statement\'s now');
  // another account that holds something today but has no monthly data: those months are only part of the portfolio
  G.HS.monthly=[]; G.P.positions.push({sym:'KO',acct:'blink',ccy:'USD',qty:1,costIls:200,group:'cons'});
  S=F.monthSeries(); assert.deepEqual(S.filter(r=>r.miss).map(r=>r.ym),[m(3),m(2),m(1)]); assert.deepEqual(S[0].miss,['blink']);
  // money put in long before the table (₪50,000 a year ago): it is in the total, but no month of the table and not this
  // month shows it as money in
  G.P.positions=G.P.positions.filter(p=>p.acct==='exc'); G.HS.accounts[0].deposits.push({date:m(12)+'-05',amount:50000,ccy:'ILS'}); G.HS.depIlsNow=55000;
  S=F.monthSeries(); const n2=S[S.length-1]; near(F.depTotal(),65000); near(n2.flow,0); near(n2.gain,2500); near(S.find(r=>r.ym===m(1)).flow,5000); near(S.find(r=>r.ym===m(3)).dep,60000,0.01,'the deposits so far include what came before the table');
  // a month with no row of its own still has its money in: the months before it count it in their deposits so far
  G.HS.accounts[0].deposits=[{date:m(1)+'-10',amount:5000,ccy:'ILS'}]; G.HS.depIlsNow=5000; G.HS.accounts[0].monthly=up.slice(0,2);   // the table ends at month -2
  S=F.monthSeries(); near(S.find(r=>r.ym===m(2)).dep,10000,0.01,'month -1 has no row, but its ₪5,000 is not counted before it'); near(S[S.length-1].flow,0);
  // the reports of someone whose only month is this one: from the start, as before
  G.HS={depIlsNow:0,monthly:[],accounts:[]}; const M=F.seriesMap(); assert.deepEqual(Object.keys(M),[cur]); assert.equal(M[cur].nostart,undefined); assert.equal(F.resultOf(M,[cur]).ok,true);
  G.HS=null; G.P=null; G.Q=null;
});

test('the months of two accounts: one that opened later counts as 0 before; one whose start is not known leaves the month partial', ()=>{
  const cur=F.ymNow(), m=k=>F.ymAdd(cur,-k); G.P=null; G.Q=null; G.DY=null; plan();
  const exc=[{ym:m(4),v:20000,ccy:'ILS',ret:1,flow:0},{ym:m(3),v:20200,ccy:'ILS',ret:1,flow:0},{ym:m(2),v:20400,ccy:'ILS',ret:1,flow:0},{ym:m(1),v:20600,ccy:'ILS',ret:1,flow:0}];
  // Blink opened two months ago: its first month is mostly its own money in
  const blink=[{ym:m(2),v:990,ccy:'ILS',ret:-1,flow:1000},{ym:m(1),v:1010,ccy:'ILS',ret:2,flow:0}];
  G.HS={depIlsNow:0,monthly:[],accounts:[{acct:'exc',ccy:'ILS',monthly:exc},{acct:'blink',ccy:'ILS',monthly:blink}]};
  let S=F.monthSeries(); assert.deepEqual(S.map(r=>[r.ym,!!r.miss]),[[m(4),false],[m(3),false],[m(2),false],[m(1),false]]);
  near(S[2].val,21390); assert.equal(S[2].ret==null||!S[2].own,true,'two accounts: the return is the page\'s, not one app\'s');
  // a Blink table that starts later but not at its opening: the months before it are only Excellence's
  G.HS.accounts[1].monthly=[{ym:m(2),v:5000,ccy:'ILS',ret:1,flow:0},{ym:m(1),v:5050,ccy:'ILS',ret:1,flow:0}];
  S=F.monthSeries(); assert.deepEqual(S.map(r=>[r.ym,(r.miss||[]).join()]),[[m(4),'blink'],[m(3),'blink'],[m(2),''],[m(1),'']]);
  assert.equal(S[0].gain,null); assert.equal(S[2].gain,null,'the month after a partial one has no start to measure from');
  // a plan deposit of a month: covered when its amount is one table's money in that month, or when every account has the
  // month's table; not by another account's table alone
  G.HS.accounts[1].monthly=blink; assert.equal(F.planCovered(m(2)+'-10',600),true,'both accounts have the month\'s table');
  G.HS.accounts[0].monthly=exc.slice(0,2);
  assert.equal(F.planCovered(m(2)+'-10',1000),true); assert.equal(F.planCovered(m(2)+'-10',600),false);
  G.HS=null;
});

test('the history keeps currency conversions and monthly results; a month "so far" never replaces a whole one', ()=>{
  G.HS=null; G.Q={usdIls:3.5,prices:{},prev:{}};
  G.DRAFT={tx:[{acct:'blink',date:'2026-07-17',side:'fx',amount:94.92,ccy:'ILS',toCcy:'USD',toAmount:null},{acct:'blink',date:'2026-07-15',side:'deposit',amount:600,ccy:'ILS'}],
    monthly:{exc:[{ym:'2026-08',v:100,ccy:'ILS',ret:1,flow:0},{ym:'2026-09',v:110,ccy:'ILS',ret:2,flow:5,part:true,asOf:'2026-09-14'}]}};
  let hx=F.historyWithTx(); const B=hx.H.accounts.find(a=>a.acct==='blink'), E=hx.H.accounts.find(a=>a.acct==='exc');
  assert.deepEqual(B.fx,[{date:'2026-07-17',amount:94.92,ccy:'ILS',toCcy:'USD'}]); near(hx.H.depIlsNow,600,0.005,'a conversion is not money in');
  assert.equal(E.monthly.length,2); assert.equal(hx.months,2); assert.equal(hx.added,2);
  // read again: the amount received completes the conversion; September as a whole month replaces "so far"
  G.HS=hx.H; G.DRAFT={tx:[{acct:'blink',date:'2026-07-17',side:'fx',amount:94.92,ccy:'ILS',toCcy:'USD',toAmount:25.61}],monthly:{exc:[{ym:'2026-09',v:111,ccy:'ILS',ret:2.1,flow:5}]}};
  hx=F.historyWithTx(); const B2=hx.H.accounts.find(a=>a.acct==='blink'), E2=hx.H.accounts.find(a=>a.acct==='exc');
  assert.equal(B2.fx.length,1); assert.equal(B2.fx[0].toAmount,25.61); const sep=E2.monthly.find(r=>r.ym==='2026-09'); assert.equal(sep.part,undefined); assert.equal(sep.v,111);
  // a later "so far" of a month that is already whole does not replace it
  G.HS=hx.H; G.DRAFT={tx:[],monthly:{exc:[{ym:'2026-09',v:50,ccy:'ILS',ret:0,flow:0,part:true,asOf:'2026-09-20'}]}};
  hx=F.historyWithTx(); assert.equal(hx.H.accounts.find(a=>a.acct==='exc').monthly.find(r=>r.ym==='2026-09').v,111); assert.equal(hx.months,0);
  // uploaded again: each month keeps the time it was first uploaded (a month-end saved in between still comes after it)
  const at0=hx.H.accounts.find(a=>a.acct==='exc').monthly.find(r=>r.ym==='2026-08').at;
  G.HS=hx.H; G.DRAFT={tx:[],monthly:{exc:[{ym:'2026-08',v:100,ccy:'ILS',ret:1,flow:0}]}}; hx=F.historyWithTx();
  assert.equal(hx.H.accounts.find(a=>a.acct==='exc').monthly.find(r=>r.ym==='2026-08').at,at0);
  G.HS=null; G.DRAFT=null; G.Q=null;
});

test('a deposit read from a screenshot, dated earlier: the saved month-ends and daily points from its month on hold it', ()=>{
  G.Q={usdIls:3.5,prices:{},prev:{}}; plan();
  // month-ends of August and September saved with 1,000 in; a deposit of 600 on 20.9 is read now, with one of 100 on 5.10
  G.HS={depIlsNow:1000,accounts:[{acct:'exc',ccy:'ILS',deposits:[{date:'2026-07-01',amount:1000}],trades:[]}],
    monthly:[{ym:'2026-07',exc:1000,tot:1000,dep:1000,at:'2026-08-01T00:00:00Z'},{ym:'2026-08',exc:1010,tot:1010,dep:1000,at:'2026-09-01T00:00:00Z'},{ym:'2026-09',exc:1020,tot:1020,dep:1000,at:'2026-10-01T00:00:00Z'}]};
  G.DY={exists:true,points:{'2026-09-15':{v:1015,dep:1000},'2026-09-25':{v:1018,dep:1000},'2026-10-03':{v:1130,dep:1000}}};
  G.DRAFT={tx:[{acct:'exc',date:'2026-09-20',side:'deposit',amount:600,ccy:'ILS'},{acct:'exc',date:'2026-10-05',side:'deposit',amount:100,ccy:'ILS'}]};
  const hx=F.historyWithTx(); const dep=ym=>hx.H.monthly.find(r=>r.ym===ym).dep;
  assert.equal(hx.bumps.length,2); near(hx.H.depIlsNow,1700);
  assert.equal(dep('2026-07'),1000,'before the deposit: unchanged'); assert.equal(dep('2026-08'),1000); assert.equal(dep('2026-09'),1600,'September holds the 600 of 20.9; October has no saved row yet');
  const d=F.dailyBumped(G.DY.points,hx.bumps);
  assert.deepEqual(Object.keys(d),['2026-09-25','2026-10-03'],'a point before the deposit stays'); near(d['2026-09-25'].dep,1600); near(d['2026-10-03'].dep,1600,'the 100 of 5.10 is after it');
  // the month flows then: September +600 (its own gain apart), October +100 so far
  G.HS=hx.H; G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:1,group:'tech'}],cash:[{acct:'exc',ccy:'ILS',amount:700}]}; G.Q={usdIls:3.5,prices:{MSFT:200},prev:{}};
  const rows=F.monthSeries(), sep=rows.find(r=>r.ym==='2026-09'), aug=rows.find(r=>r.ym==='2026-08');
  near(sep.flow,600); near(sep.gain,1020-1010-600); near(aug.flow,0);
  // a withdrawal comes off from its day on; one that a ticked plan deposit already stood for moves nothing
  G.DRAFT={tx:[{acct:'exc',date:'2026-08-10',side:'withdraw',amount:50,ccy:'ILS'}]}; const h2=F.historyWithTx();
  assert.equal(h2.bumps.length,1); near(h2.bumps[0].ils,-50); near(h2.H.monthly.find(r=>r.ym==='2026-08').dep,950); near(h2.H.monthly.find(r=>r.ym==='2026-09').dep,1550); near(h2.H.monthly.find(r=>r.ym==='2026-07').dep,1000);
  G.HS=h2.H; plan([{month:'2026-09',amount:300,at:'2026-09-12T10:00:00Z'}]); near(F.planDepExtra(),300,'the ticked deposit is extra until the history holds it');
  G.DRAFT={tx:[{acct:'exc',date:'2026-09-14',side:'deposit',amount:300,ccy:'ILS'}]}; const h3=F.historyWithTx();
  assert.equal(h3.bumps.length,0,'the plan already counted it, so no saved total moves'); near(h3.H.monthly.find(r=>r.ym==='2026-09').dep,1550);
  // a deposit a table's month already stands for moves nothing either, unless a saved month-end held the month before the table
  G.HS=h3.H; plan(); G.HS.accounts[0].monthly=[{ym:'2026-11',v:2000,ccy:'ILS',ret:1,flow:400,at:'2026-12-01T00:00:00Z'}];
  G.DRAFT={tx:[{acct:'exc',date:'2026-11-03',side:'deposit',amount:400,ccy:'ILS'}]}; const h4=F.historyWithTx(); assert.equal(h4.bumps.length,0);
  G.HS=h4.H; G.HS.accounts[0].monthly=[{ym:'2026-09',v:1500,ccy:'ILS',ret:1,flow:200,at:'2026-10-02T00:00:00Z'}];
  G.DRAFT={tx:[{acct:'exc',date:'2026-09-28',side:'deposit',amount:200,ccy:'ILS'}]}; const h5=F.historyWithTx(); assert.equal(h5.bumps.length,1,'the September month-end was saved before the table, so its deposits are its own');
  G.HS=null; G.DY=null; G.DRAFT=null; G.P=null; G.Q=null; plan();
});

test('a transaction dated after today was read a year too late; the day an account is known for', ()=>{
  assert.equal(F.dateBack('2026-10-20','2026-10-15'),'2025-10-20'); assert.equal(F.dateBack('2028-02-29','2026-10-15'),null,'two years off: left out');
  assert.equal(F.dateBack('2028-02-29','2027-03-01'),'2027-02-28'); assert.equal(F.dateBack('2026-10-16','2026-10-15'),'2025-10-16');
  G.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:1}],cash:[],asOf:{exc:'2026-09-30'},updatedAt:'2026-10-12T10:00:00Z'};
  assert.equal(F.knownDay('exc',null),'2026-10-12','the saved portfolio has no seen day: the day it was saved');
  assert.equal(F.knownDay('blink',null),null,'an account with nothing saved');
  assert.equal(F.knownDay('exc',{asOf:{exc:'2026-09-30'},seen:{exc:'2026-10-14'}}),'2026-10-14','read from a screenshot after the statement');
  assert.equal(F.knownDay('exc',{asOf:{exc:'2026-10-20'},seen:{exc:'2026-10-14'}}),'2026-10-20','the statement is the later one');
  G.P.seen={exc:'2026-10-13'}; assert.equal(F.knownDay('exc',null),'2026-10-13');
  G.P=null;
});

test('the forecast and the plan\'s split of a deposit', ()=>{
  near(F.project(1000,0,1,12).at(-1).val,1120,0.01); near(F.project(1000,100,1,0).at(-1).val,2200,1e-9);
  assert.equal(F.project(0,0,2,5).at(-1).val,0);
  const m=F.model({positions:[{sym:'MSFT',acct:'exc',ccy:'ILS',qty:1,group:'tech'}],cash:[]},{usdIls:3.5,prices:{MSFT:1000},prev:{}},'all');
  const z=F.planDeposit(m,{tech:50,fin:50},0); near(z.left,0); assert.ok(z.rows.every(r=>r.alloc===0));
  const d=F.planDeposit(m,{tech:50,fin:50},1000); near(d.rows.reduce((t,r)=>t+r.alloc,0)+d.left,1000,1e-6);
});

test('the date in Israel, not in UTC', ()=>{
  assert.equal(F.ilDay('2026-10-12T22:30:00Z'),'2026-10-13','01:30 in Israel is already the 13th');
  assert.equal(F.ilDay('2026-10-12T20:59:00Z'),'2026-10-12');
});

// ---- what Claude's sentences may not say ----
const A=load(['HEW','ANA_ADVICE','ANA_SOFT','ANA_SOFT_OK','anaAdvice','ANA_MOVE','ANA_CAUSE','ANA_EVENT','anaInvented','ANA_UP','anaWrongWay','ANA_FUTURE','ANA_FUTURE_OK','anaPromise','anaNumSet','anaBad','anaReject'],{});
const FACTS=JSON.stringify({usd_ils:'3.055',holdings:[{sym:'NVDA',weight:'12.0%',last_day:'‎−2.10%',vs_cost:'‎+35.0%'},{sym:'KO',weight:'5.0%',last_day:'‎+1.50%'}],
  movers:['NVDA ‎−2.10% (‎−₪45)','KO ‎+1.50% (‎+₪12)'],last_trading_day:'‎−₪33 (‎−0.20%)'});
const SET=A.anaNumSet(FACTS);
test('Claude: no buy or sell advice, in any wording', ()=>{
  for(const s of ['כדאי לקנות עוד NVDA.','תמכור את KO.','זו הזדמנות קנייה.','מומלץ לממש רווחים.','אני ממליץ להחזיק את הנייר.','כדאי להקטין את החשיפה.','I recommend that you buy more.','You should sell KO.','שווה לקנות עכשיו.'])
    assert.equal(A.anaAdvice(s),true,s);
  for(const s of ['כדאי לבדוק את הכללים שלך.','האנליסטים ממליצים בממוצע על קנייה.','לפי התוכנית שלך, יש מספיק מזומן לקנות את הבא בתור.','אני לא נותן המלצות לקנות או למכור.','כדאי להוסיף יעד בהגדרות.','הקנייה האחרונה הייתה בספטמבר.'])
    assert.equal(A.anaAdvice(s),false,s);
});
test('Claude: no reason the facts do not give, no move the wrong way, no number of another holding', ()=>{
  for(const s of ['NVDA ירדה בגלל דוח רבעוני חלש.','המניות ירדו על רקע עליית הריבית.','KO עלתה בעקבות הודעה על דיבידנד.'])assert.equal(A.anaReject(s,SET),true,s);
  for(const s of ['התיק ירד בעיקר בגלל הירידה של NVDA.','השווי בשקלים ירד בגלל ירידת הדולר.','זה חשוב בגלל שהתיק ירד מתחת לכלל שקבעת.','NVDA היא חברת שבבים.','NVDA ירדה 2.1% ביום המסחר האחרון.','NVDA ירדה 2% ביום המסחר האחרון.','KO עלתה 1.5%.','NVDA עלתה 35% מאז הקנייה.'])
    assert.equal(A.anaReject(s,SET),false,s);
  assert.equal(A.anaReject('NVDA עלתה 2.1% היום.',SET),true,'NVDA went down 2.1%');
  assert.equal(A.anaReject('NVDA ירדה 1.5% היום.',SET),true,'1.5% is KO\'s move');
  assert.equal(A.anaReject('NVDA ירדה 7.3% היום.',SET),true,'a number that is not in the facts');
});

test('dates: a date from another year carries the year, so old data never reads as current', ()=>{
  const F=load(['dmy','dmyy'],{});
  const y=new Date().getFullYear(), yy=String(y-1).slice(2);
  assert.equal(F.dmy(`${y}-03-09T12:00:00Z`),'9.3');
  assert.equal(F.dmy(`${y-1}-10-09T12:00:00Z`),`9.10.${yy}`);
  assert.equal(F.dmyy(`${y}-03-09T12:00:00Z`),`9.3.${String(y).slice(2)}`);
  assert.equal(F.dmy(''),''); assert.equal(F.dmy('not a date'),'');
});

// "why did the portfolio move today": computed by the page, never by Claude. A made-up day: four holdings, two currencies.
test('why it moved: contributions add up, the movers and the offset are named, the unknowns are listed', ()=>{
  const F=load(['GROUPS','WHY_FLAT','whyMove'],{});
  const pos=[
    {sym:'AAA',name:'A',group:'tech',ccy:'USD',qty:10,px:90,w:30,dayPct:-10,dayIls:-10*10*3.7},   // fell from 100 to 90
    {sym:'BBB',name:'B',group:'tech',ccy:'USD',qty:5,px:50,w:20,dayPct:-2,dayIls:5*(50-50/0.98)*3.7},   // fell 2%
    {sym:'CCC',name:'C',group:'fin',ccy:'ILS',qty:100,px:10.5,w:25,dayPct:5,dayIls:100*0.5},
    {sym:'DDD',name:'D',group:'il',ccy:'ILS',qty:10,px:60,w:20,dayPct:null,dayIls:0}];
  const dayIls=pos.reduce((t,p)=>t+p.dayIls,0), inv=10*90*3.7+5*50*3.7+1050+600;
  const m={pos,dayIls,dayPct:dayIls/(inv-dayIls)*100,hasDay:true};
  const Q={stale:{DDD:'מחיר קודם'},usdIls:3.7,fxPrev:{rate:3.6,now:3.7,date:'2026-10-12'},usDate:'2026-10-13',ilDate:'2026-10-13',prevLabel:'סגירה 12.10'};
  const W=F.whyMove(m,Q,{cash:[{acct:'x',amount:100,ccy:'USD'}]},{maxPos:25});
  assert.equal(W.dir,'down'); near(W.ils,dayIls,1e-9);
  assert.equal(W.top[0].sym,'AAA','the biggest mover first'); near(W.items.reduce((t,x)=>t+x.ils,0),dayIls,1e-9,'the parts add up to the whole');
  assert.ok(W.top.every(x=>x.ils<0),'only holdings that moved with the portfolio carry it');
  assert.deepEqual(W.against.map(x=>x.sym),['CCC']); assert.equal(W.excluded[0].sym,'DDD'); assert.equal(W.excluded[0].why,'מחיר קודם');
  assert.deepEqual({down:W.breadth.down,up:W.breadth.up,n:W.breadth.n},{down:2,up:1,n:3});
  assert.ok(W.patterns.some(p=>p.k==='one'&&p.sym==='AAA'),'one holding made most of it');
  assert.ok(W.patterns.some(p=>p.k==='group'&&p.name==='טכנולוגיה'),'one group made most of it');
  // the dollar: (10×100 + 5×(50/0.98) + 100 cash) × (3.7 − 3.6), at yesterday's prices
  near(W.fx.ils,(10*100+5*50/0.98+100)*0.1,1e-6); near(W.fx.pct,(3.7/3.6-1)*100,1e-9);
  assert.deepEqual(W.heavy.map(h=>h.sym),['AAA'],'a mover above the cap for one holding');
  // no previous close for the dollar from the same source: unknown, not zero
  assert.equal(F.whyMove(m,{...Q,fxPrev:null},{cash:[]},{}).fx.unknown,true);
  // a flat day names no movers; a 40% move is flagged to check
  const flat=F.whyMove({...m,dayPct:0.01,dayIls:0.4},Q,{cash:[]},{}); assert.equal(flat.dir,'flat'); assert.equal(flat.top.length,0);
  assert.deepEqual(flat.patterns.map(p=>p.k),['fx'],'on a flat day only the dollar\'s own move is worth naming');
  assert.equal(F.whyMove({...m,dayPct:0.01,dayIls:0.4},{...Q,fxPrev:null},{cash:[]},{}).patterns.length,0);
  const odd=F.whyMove({...m,pos:[{...pos[0],dayPct:-40}]},Q,{cash:[]},{}); assert.equal(odd.odd[0].sym,'AAA');
});

test('questions the page answers by itself: buy or sell, the future, and why it moved', ()=>{
  const F=load(['Q_WHY','Q_ADVICE','Q_FUTURE','Q_EXPLAIN'],{});
  for(const q of ['הסבר את התיק שלי','תסביר לי את התיק','ספר לי על התיק שלי','מה יש לי בתיק?','explain my portfolio'])assert.ok(F.Q_EXPLAIN.test(q),q);
  for(const q of ['הסבר לי את הנייר הזה','מה הסיכון הכי גדול בתיק שלי?'])assert.ok(!F.Q_EXPLAIN.test(q),q);
  assert.ok(F.Q_WHY.test('תסביר לי למה התיק ירד'),'a "why" question stays a "why" question (it is checked first)');
  for(const q of ['למה התיק ירד היום?','מדוע התיק שלי עלה?','מה הזיז את התיק היום?','למה הייתה ירידה בתיק'])assert.ok(F.Q_WHY.test(q),q);
  for(const q of ['האם כדאי לקנות NVDA?','כדאי למכור את CAT?','תמליץ לי מה לקנות','מה לעשות, למכור?','should I sell MSFT'])assert.ok(F.Q_ADVICE.test(q),q);
  for(const q of ['האם CAT תעלה מחר?','כמה ירוויח התיק בשנה הבאה?','מה יקרה לשוק בשבוע הבא?','תחזה לי את המחיר'])assert.ok(F.Q_FUTURE.test(q),q);
  for(const q of ['מה הסיכון הכי גדול בתיק שלי?','האם התיק עומד בתוכנית שלי?','כמה דולרים יש לי?'])assert.ok(!F.Q_WHY.test(q)&&!F.Q_ADVICE.test(q)&&!F.Q_FUTURE.test(q),q);
});

test('Claude: no forecast said as known, no promise, no alarm, no "the rise proves it was right"', ()=>{
  for(const x of ['המניה תעלה בשבוע הבא.','השוק ימשיך לרדת.','NVDA צפויה לעלות.','זו תשואה מובטחת.','בוודאות זה יחזור.','דחוף לבדוק את התיק עכשיו!','זו קריסה של השוק.','העלייה הוכיחה שההשקעה נכונה.','The stock will rise.'])
    assert.equal(A.anaPromise(x),true,x);
  for(const x of ['אי אפשר לדעת בוודאות מה יקרה.','אף אחד לא יודע אם השוק יעלה.','התיק ירד ב-1.16% היום.','NVDA עלתה 2% ביום המסחר האחרון.','התחזית בדף היא הנחה שלך, לא ידיעה.','כדאי לבדוק את הריכוז מול הכללים שלך.'])
    assert.equal(A.anaPromise(x),false,x);
});

// stress scenarios: arithmetic on today's values, checked by hand (made-up portfolios)
const FUNDS={}, SR=load(['GROUPS','SEC_HE','isF','CCYHE','exposures','stressRun'],{FUNDOF:FUNDS});
const pos=(sym,val,o={})=>({sym,name:sym,group:'tech',ccy:'ILS',qty:1,px:val,val,w:0,dayPct:null,dayIls:0,...o});
const mOf=(ps,cash=0,acct='all')=>{const total=ps.reduce((t,p)=>t+p.val,0)+cash; for(const p of ps)p.w=p.val/total*100; return {acct,pos:ps,cash,total,groups:{}}};
test('stress: the plan\'s case — 100,000 ₪, a uniform 25% drop: 75,000, −25,000, −25%', ()=>{
  const m=mOf([pos('A',40000),pos('B',35000,{group:'fin'}),pos('C',25000,{group:'health'})]);
  const R=SR.stressRun(m,{positions:[],cash:[]},{usdIls:3.7,prices:{A:1,B:1,C:1}},{kind:'all',pct:-25});
  assert.equal(R.before,100000); assert.equal(R.after,75000); assert.equal(R.d,-25000); assert.equal(R.pct,-25);
});
test('stress: part of the portfolio falls — by weight, not the same percent on everything', ()=>{
  const m=mOf([pos('A',40000),pos('B',35000,{group:'fin'}),pos('C',25000,{group:'health'})]);
  const Q={usdIls:3.7,prices:{A:1,B:1,C:1}}, P={positions:[],cash:[]};
  let R=SR.stressRun(m,P,Q,{kind:'group',group:'tech',pct:-25}); assert.equal(R.d,-10000); assert.equal(R.after,90000); assert.equal(R.pct,-10); assert.deepEqual(R.hit.map(r=>r.sym),['A']);
  R=SR.stressRun(m,P,Q,{kind:'groups',by:{tech:-30,fin:-10}}); assert.equal(R.d,-12000-3500); assert.equal(R.hit.length,2,'health is not in the scenario');
  R=SR.stressRun(m,P,Q,{kind:'co',syms:['B','C'],pct:-20}); assert.equal(R.d,-12000);
});
test('stress: cash keeps its value; a dollar drop hits dollar holdings and dollar cash only', ()=>{
  const m=mOf([pos('US',37000,{ccy:'USD'}),pos('IL',20000)],3700+1000);
  const P={positions:[],cash:[{acct:'x',ccy:'USD',amount:1000},{acct:'x',ccy:'ILS',amount:1000}]}, Q={usdIls:3.7,prices:{US:1,IL:1}};
  let R=SR.stressRun(m,P,Q,{kind:'all',pct:-20}); assert.equal(R.d,-(37000+20000)*0.2,'cash is not in the drop'); assert.equal(R.cash.d,0);
  R=SR.stressRun(m,P,Q,{kind:'usd',pct:-10}); assert.equal(R.d,-3700-370,'10% of the dollar holding and of the 3,700 ₪ of dollars'); assert.deepEqual(R.hit.map(r=>r.sym),['US']);
});
test('stress: a holding without a price is left out and named; an empty portfolio gives nothing', ()=>{
  const m=mOf([pos('A',1000)]); const P={positions:[{sym:'A'},{sym:'NOPX'}],cash:[]};
  const R=SR.stressRun(m,P,{usdIls:3.7,prices:{A:1}},{kind:'all',pct:-40}); assert.deepEqual(R.missing,['NOPX']); assert.equal(R.d,-400);
  assert.equal(SR.stressRun(mOf([]),{positions:[],cash:[]},{usdIls:3.7,prices:{}},{kind:'all',pct:-20}),null);
});
test('exposures: shares add up to the whole, nothing counted twice, unknowns say so', ()=>{
  FUNDS.TA125=true;
  const m=mOf([pos('MSFT',5000,{ccy:'USD'}),pos('KO',3000,{ccy:'USD',group:'cons'}),pos('TA125',2000,{group:'il'}),pos('ZZZ',1000,{ccy:'USD'})],500);
  const E=SR.exposures(m,{cash:[{ccy:'ILS',amount:500}]},{usdIls:3.7},k=>({MSFT:'Technology',KO:'Consumer Staples'}[k]||''));
  for(const k of ['group','sector','ccy','market','kind']){const t=E[k].reduce((s,r)=>s+r.val,0); near(t,11500,1e-6,k+' adds up to the whole'); near(E[k].reduce((s,r)=>s+r.w,0),100,1e-9,k)}
  assert.equal(E.sector.find(r=>r.k==='fund').val,2000,'a fund is a fund, its sectors are not known');
  // a fund outside the Israel group: its own row naming the group, and the Israel row equals the Israel group to the shekel
  {FUNDS.QQQ=true; const m2=mOf([pos('MSFT',5000,{ccy:'USD'}),pos('QQQ',1856,{ccy:'USD',group:'tech'}),pos('TA125',2000,{group:'il'}),pos('5129283',3000,{group:'il'})],0);
    const E2=SR.exposures(m2,{cash:[]},{usdIls:3.7},k=>({MSFT:'Technology'}[k]||''));
    assert.equal(E2.sector.find(r=>r.k==='fund').val,E2.group.find(r=>r.k==='il').val,'the Israeli funds row is the Israel group');
    const o=E2.sector.find(r=>r.k==='fund:tech'); assert.equal(o.val,1856); assert.deepEqual(o.syms,['QQQ']); assert.match(o.label,/קרנות בקבוצת/);
    assert.equal(E2.kind.find(r=>r.k==='fund').val,1856+2000+3000,'the kind view still counts every fund'); delete FUNDS.QQQ}
  assert.deepEqual(E.unknownSector,['ZZZ']); assert.equal(E.overlap.status,'unknown','held funds without their holdings: unknown, not "none"');
  near(E.conc.top1.w,5000/11500*100,1e-9); near(E.conc.nEff,1/((5/11)**2+(3/11)**2+(2/11)**2+(1/11)**2),1e-9);
  assert.equal(E.ccy.find(r=>r.k==='ILS').val,2000+500,'shekel holdings and shekel cash');
  assert.equal(SR.exposures(mOf([]),{cash:[]},{usdIls:3.7},()=>''),null);
});

test('crisis center: the comparison point, the move since then by holding, and the market blend', ()=>{
  const F=load(['stateKey','stateTop','periodMove','stateBench'],{});
  const now=new Date('2026-10-13T12:00:00Z').getTime(), DY={points:{'2026-10-01':{v:1000,dep:900,px:{A:100}},'2026-10-06':{v:1100,dep:900},'2026-10-10':{v:1050,dep:1000}}};
  assert.equal(F.stateKey(DY,7,now),'2026-10-06'); assert.equal(F.stateKey(DY,30,now),null,'no point that old: none, not zero');
  assert.deepEqual(F.stateTop(DY,'all',now),{k:'2026-10-06',v:1100});
  const m={acct:'all',total:1200,pos:[{sym:'A',name:'A',group:'tech',ccy:'ILS',qty:2,px:110,w:20},{sym:'B',name:'B',group:'fin',ccy:'USD',qty:1,px:50,w:15}]};
  const pm=F.periodMove(m,DY,'2026-10-01',3.7,1000);
  assert.equal(pm.change,200); assert.equal(pm.dep,100,'deposits since then'); assert.equal(pm.price,20,'A rose 10 on 2 units'); assert.deepEqual(pm.missing,['B']);
  assert.equal(F.periodMove(m,DY,'2026-10-06',3.7,1000).hasPx,false,'a point without prices cannot be split by holding');
  const B=F.stateBench({dayPct:0.5,pos:[{ccy:'USD',val:600},{ccy:'ILS',val:400}]},{bench:{SPX:{px:101,prev:100,date:'2026-10-12'},TA125:{px:99,prev:100,date:'2026-10-13'}}});
  near(B.us.pct,1,1e-9); near(B.il.pct,-1,1e-9); near(B.blend,0.6*1+0.4*-1,1e-9);
  assert.equal(F.stateBench({dayPct:0,pos:[{ccy:'USD',val:1}]},{bench:{}}).none,true);
  assert.equal(F.stateBench({dayPct:0,pos:[{ccy:'USD',val:1},{ccy:'ILS',val:1}]},{bench:{SPX:{px:1,prev:1}}}).blend,null,'half the portfolio has no index: no blend');
});

// "הסבר את התיק שלי" (stage 7): what is in it, what stands out, concentration against the user's caps, and the questions
const EX=load(['GROUPS','SEC_HE','isF','CCYHE','exposures','pfExplain','flowsView'],{FUNDOF:FUNDS});
const secs=k=>({MSFT:'Technology',KO:'Consumer Staples'}[k]||'');
const exM=()=>mOf([pos('MSFT',5000,{ccy:'USD',cost:4000,costVal:5000}),pos('KO',3000,{ccy:'USD',group:'cons',cost:3500,costVal:3000}),
  pos('TA125',2000,{group:'il',noCost:true,cost:0,costVal:0}),pos('ZZZ',1000,{ccy:'USD',cost:1000,costVal:1000})],500);
test('explain: what is in the portfolio, what stands out, and where it is above the caps the user set', ()=>{
  FUNDS.TA125=true; const m=exM(), E=EX.exposures(m,{cash:[{ccy:'ILS',amount:500}]},{usdIls:3.7},secs);
  const X=EX.pfExplain(m,E,{R:{maxPos:10,maxGroup:40},years:0,goal:0,tsum:0});
  assert.deepEqual([X.what.n,X.what.stocks,X.what.funds,X.what.total],[4,3,1,11500]); near(X.what.cashW,500/11500*100,1e-9);
  assert.deepEqual(X.notable.map(x=>x.k),['group','gain','loss'],'no cash line under 10%'); near(X.notable[0].w,6000/11500*100,1e-9);
  assert.deepEqual([X.notable[1].sym,X.notable[1].ils,X.notable[2].sym,X.notable[2].ils],['MSFT',1000,'KO',-500],'a holding without a cost is not a gain or a loss');
  assert.deepEqual(X.conc.overPos.map(x=>x.sym),['MSFT','KO','TA125']); assert.deepEqual(X.conc.overGroup.map(g=>g.label),['טכנולוגיה']);
  assert.deepEqual(X.expo.unknownSector,['ZZZ']); near(X.expo.usdW,9000/11500*100,1e-9);
  assert.deepEqual(X.questions.map(q=>q.k),['pos','sector','usd','when'],'four at most, the most specific first');
  assert.equal(X.questions[0].sym,'MSFT');
});
test('explain: the questions follow what the user set; no caps, no cost, only cash', ()=>{
  const P={cash:[{ccy:'ILS',amount:500}]}, Qx={usdIls:3.7};
  let X=EX.pfExplain(exM(),EX.exposures(exM(),P,Qx,secs),{R:{},years:2,goal:500000,tsum:100});
  assert.deepEqual(X.conc.overPos,[],'no cap set, nothing is "above" it'); assert.equal(X.questions[0].k,'top','the largest holding is still a question');
  assert.ok(X.questions.some(q=>q.k==='short'&&q.years===2),'a short horizon with most of the money in securities');
  assert.ok(!X.questions.some(q=>q.k==='targets'||q.k==='goal'),'targets and a goal are set');
  const cashOnly=mOf([],1000); X=EX.pfExplain(cashOnly,EX.exposures(cashOnly,{cash:[{ccy:'ILS',amount:1000}]},Qx,()=>''),{R:{maxPos:10},years:0});
  assert.equal(X.what.n,0); assert.deepEqual(X.notable.map(x=>x.k),['cash']); assert.deepEqual(X.questions.map(q=>q.k),['when','cash','targets','goal']);
});

test('the level of explanation: the person\'s choice, else "מכיר את היסודות"; never the size of the portfolio', ()=>{
  const G2={S:{},P:{positions:Array.from({length:80},(_,i)=>({sym:'S'+i,qty:1000}))}}, L=load(['LEVEL','levelOf'],G2);
  assert.equal(L.levelOf(),'mid','a large portfolio does not make an expert');
  G2.S={level:'new'}; assert.equal(L.levelOf(),'new','picked in the chat before there is a profile');
  G2.S={profile:{level:'pro'},level:'new'}; assert.equal(L.levelOf(),'pro','the profile wins');
  G2.S={profile:{level:''},level:'new'}; assert.equal(L.levelOf(),'new');
  G2.S={profile:{level:'expert'}}; assert.equal(L.levelOf(),'mid','an unknown value is not trusted');
});

test('the weekly summary: exposures at the start of the week only from saved prices, the same holdings at both ends', ()=>{
  const W=load(['weekExpo'],{});
  const m={cash:100,pos:[{sym:'US',ccy:'USD',group:'tech',qty:10,val:10*11*3.7},{sym:'IL',ccy:'ILS',group:'il',qty:100,val:100*5},{sym:'NEW',ccy:'USD',group:'tech',qty:1,val:370}]};
  assert.equal(W.weekExpo(m,null,3.6,3.7),null,'nothing saved: no comparison, not a guess');
  const X=W.weekExpo(m,{US:10,IL:5},3.6,3.7);
  assert.deepEqual(X.miss,['NEW'],'a holding without a saved price is left out and named'); assert.equal(X.n,2); assert.equal(X.fxKnown,true);
  const T0=10*10*3.6+500+100, T1=407+500+100; near(X.usd.w0,360/T0*100,1e-9); near(X.usd.w1,407/T1*100,1e-9);
  const Y=W.weekExpo(m,{US:10,IL:5},undefined,3.7); assert.equal(Y.fxKnown,false); near(Y.usd.w0,370/(370+600)*100,1e-9,'without a saved rate: today\'s, and it says so');
});

test('planned money in and out: months left, a share of today\'s value, past dates kept apart; the nearest withdrawal is a question', ()=>{
  const now=Date.UTC(2026,9,14), m={total:200000,cash:5000};
  const V=EX.flowsView([{id:'a',ym:'2027-04',kind:'out',amount:50000,note:'דירה'},{id:'b',ym:'2026-08',kind:'out',amount:1000},{id:'c',ym:'2026-12',kind:'in',amount:20000},{ym:'bad',amount:5},{ym:'2027-01',amount:0}],m,3,now);
  assert.deepEqual(V.rows.map(r=>[r.id,r.months,r.past]),[['b',-2,true],['c',2,false],['a',6,false]],'sorted by date; bad rows dropped');
  near(V.rows[2].share,25,1e-9); assert.equal(V.next.id,'a','the nearest withdrawal still ahead, not a deposit and not a past one'); assert.equal(V.rows[2].inHorizon,true);
  assert.equal(EX.flowsView([{ym:'2031-01',kind:'out',amount:1}],m,3,now).rows[0].inHorizon,false,'after the horizon the user set');
  assert.equal(EX.flowsView(null,m,0,now).next,null);
  FUNDS.TA125=true; const mm=exM(), E=EX.exposures(mm,{cash:[{ccy:'ILS',amount:500}]},{usdIls:3.7},secs);
  const X=EX.pfExplain(mm,E,{R:{maxPos:10,maxGroup:40},years:0,flows:EX.flowsView([{ym:'2027-04',kind:'out',amount:5750}],mm,0,now)});
  assert.deepEqual(X.questions.slice(0,2).map(q=>q.k),['pos','flow']); near(X.questions[1].share,50,1e-9); assert.equal(X.questions[1].months,6);
  const far=EX.pfExplain(mm,E,{R:{},years:0,flows:EX.flowsView([{ym:'2031-04',kind:'out',amount:5750}],mm,0,now)});
  assert.ok(!far.questions.some(q=>q.k==='flow'),'a withdrawal more than 3 years away is not asked about');
});

// ---- 21.10 (2): "האם אני עושה טוב?" and the tax if sold today ----
test('the same deposits in the index: each on its own day, S&P 500 at that day\'s dollar, the yearly return with the timing of the money',()=>{
  const G2={...G,HS:null,PLD:{deposits:[],purchases:[],idx:{deposits:[],purchases:[]}},BENCH_D:null,S:{taxPct:25},DY:null};
  const B=load(['serAt','xirr','depFlows','benchCompare','allDep','usdRate','depNet','markDay','planExtraList','planCovered','upMonths','fxOfMonth','savedBefore','upCovers','depUp','depTotal','planDepExtra','ilDay','acctIds','stmtDay','coveredBy','planOpen'],G2);
  // the close on a day, or the last one before it
  const s={d:['2026-01-02','2026-01-05','2026-01-09'],c:[10,11,12]};
  assert.equal(B.serAt(s,'2026-01-01'),null); assert.deepEqual(B.serAt(s,'2026-01-07'),{d:'2026-01-05',c:11}); assert.deepEqual(B.serAt(s,'2026-02-01'),{d:'2026-01-09',c:12});
  // a yearly rate: 1000 in, 1100 a year later → 10%; two deposits of 1000, a year apart, worth 2100 at the end → 6.6%
  near(B.xirr([{t:0,v:-1000},{t:365,v:1100}]),0.10,1e-6);
  const r2=B.xirr([{t:0,v:-1000},{t:365,v:-1000},{t:730,v:2310}]); near(r2,0.10,1e-6,'10% a year on each');
  // two deposits; the index doubles between them (in shekels); the portfolio is worth 3000
  G2.Q={usdIls:3.5}; G2.HS={depIlsNow:2000,accounts:[{acct:'exc',ccy:'ILS',deposits:[{date:'2025-01-10',amount:1000,ccy:'ILS'},{date:'2026-01-12',amount:1000,ccy:'ILS'}]}]};
  G2.BENCH_D={spx:{d:['2025-01-10','2026-01-12','2026-10-20'],c:[100,200,200]},fx:{d:['2025-01-10','2026-10-20'],c:[3.5,3.5]},ta125:{d:['2025-01-09','2026-01-12','2026-10-20'],c:[1000,1000,1000]},names:{spx:'S&P 500',ta125:'ת״א 125'}};
  const C=B.benchCompare({total:3000});
  assert.equal(C.dep,2000); assert.equal(C.first,'2025-01-10'); assert.equal(C.undated,0);
  const by=Object.fromEntries(C.rows.map(r=>[r.k,r]));
  near(by.spx.val,3000,1e-6,'1000 doubled, then 1000 at the top'); near(by.ta125.val,2000,1e-6,'a flat index keeps the money');
  near(by.me.gain,1000); assert.ok(by.me.ret.yr>0&&by.ta125.ret.yr!=null&&Math.abs(by.ta125.ret.yr)<1e-6,'over a year: a yearly rate; the flat index 0%');
  // the dollar: S&P 500 in shekels moves with the rate even when the index stands still
  G2.BENCH_D={...G2.BENCH_D,spx:{d:['2025-01-10','2026-10-20'],c:[100,100]},fx:{d:['2025-01-10','2026-01-12','2026-10-20'],c:[3.0,3.5,3.6]}};
  near(B.benchCompare({total:3000}).rows.find(r=>r.k==='spx').val,1000*3.6/3.0+1000*3.6/3.5,1e-6);
  // money in with no day (the statements' total is larger than the dated deposits): put on the first day, and said
  G2.HS={...G2.HS,depIlsNow:3000}; const U=B.benchCompare({total:3000}); assert.equal(U.undated,1000); assert.equal(U.dep,3000);
  // a gap of a few percent (a dollar deposit counted at another day's rate) is spread, so the total stays the hero's
  G2.HS={...G2.HS,depIlsNow:2050}; const V=B.benchCompare({total:3000}); assert.equal(V.undated,0); near(V.dep,2050,1e-6);
  // nothing dated yet
  G2.HS={depIlsNow:0,accounts:[]}; assert.deepEqual(B.benchCompare({total:3000}),{none:true});
});

test('the tax if everything were sold today: the gain in shekels, the losses that offset it, the dollar\'s part',()=>{
  const G3={...G,S:{taxPct:25},HS:null,PLD:{deposits:[],purchases:[],idx:{deposits:[],purchases:[]}}};
  G3.P={positions:[{sym:'MSFT',acct:'exc',ccy:'USD',qty:2,costIls:2800,costUsd:800,group:'tech'},{sym:'KO',acct:'blink',ccy:'USD',qty:10,costIls:2500,group:'cons'},{sym:'1159250',acct:'exc',ccy:'ILS',qty:10,costIls:500}],cash:[]};
  G3.Q={usdIls:3.5,prices:{MSFT:500,KO:60,'1159250':40},prev:{}};
  const T=load(['taxNow','model','GROUPS','NAMEOF','isFundLike','effGroup','ccyOfPos','rateOf','CCYHE','CCYSYM','mAllNow','planAdj','planOpen','allDep','usdRate','markDay','stmtDay','coveredBy','acctIds','dollarCost','costBasis','divHistory','fxOfMonth','DIV_WH','ilDay'],G3,['allBuy']);
  const x=T.taxNow(T.model(G3.P,G3.Q,'all'));
  // MSFT 3500 − 2800 = +700; KO 2100 − 2500 = −400; the fund 400 − 500 = −100
  near(x.gains,700); near(x.losses,500); near(x.net,200); near(x.tax,50); near(x.saved,125,'the losses save 25% of 500');
  assert.deepEqual(x.dn.map(r=>r.sym),['KO','1159250'],'the largest loss first');
  assert.equal(T.taxNow(T.model({positions:[],cash:[]},G3.Q,'all')).none,true);
});

test('"מה חדש" and "לאן להגיע?": every item is dated and versioned, and every way to a screen leads somewhere',()=>{
  const W=load(['GO','NEWS','TABS'],{...G,$:()=>null,newsOpen:()=>{},tourStart:()=>{},offerUndo:()=>{},location:{}});
  const ids=new Set(W.GO.map(g=>g.id));
  assert.equal(ids.size,W.GO.length,'no two with one id');
  for(const g of W.GO)assert.ok(g.fn||W.TABS.includes(g.tab),'a screen that exists: '+g.id);
  for(const n of W.NEWS){assert.match(n.at,/^\d{4}-\d\d-\d\d$/,n.t); assert.ok(n.t&&n.d,n.t); if(n.go)assert.ok(ids.has(n.go)||n.go==='goq','"קח אותי לשם" leads somewhere: '+n.t)}
  assert.ok(W.NEWS[0].v&&W.NEWS.every((n,i)=>i===0||(n.v||n.at+'.1')<=(W.NEWS[i-1].v||W.NEWS[i-1].at+'.1')),'the newest first, so the release adds at the top');
});
