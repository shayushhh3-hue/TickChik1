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
  'planAdj','mAllNow','model','planDeposit','project','ymAdd','resultOf','realizedOf','CR_DAY','crisisInfo','historyWithTx'],G,['allBuy']);
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

test('a period\'s result: the change in value less the change in deposits', ()=>{
  const S={'2026-01':{val:1000,dep:1000},'2026-02':{val:1300,dep:1200},'2026-03':{val:1100,dep:1200}};
  const r=F.resultOf(S,['2026-02']); near(r.gain,100); near(r.dep,200); near(r.pct,10);
  const q=F.resultOf(S,['2026-01','2026-02','2026-03']); assert.equal(q.fromZero,true); near(q.gain,-100); near(q.pct,-100/1200*100);
  assert.equal(F.resultOf(S,['2025-05']).ok,false);
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
const A=load(['HEW','ANA_ADVICE','ANA_SOFT','ANA_SOFT_OK','anaAdvice','ANA_MOVE','ANA_CAUSE','ANA_EVENT','anaInvented','ANA_UP','anaWrongWay','anaNumSet','anaBad','anaReject'],{});
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
