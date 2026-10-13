// A made-up portfolio for the tests: real tickers, invented quantities, costs, cash, deposits and history. Nothing here is
// anybody's data. Dates are relative to the day the tests run, so the fixture never goes stale.
const DAY=864e5;
const iso=t=>new Date(t).toISOString();
const ymd=t=>new Date(t).toISOString().slice(0,10);
const ym=(t,k=0)=>{const d=new Date(t);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+k);return d.toISOString().slice(0,7)};
const lastOf=m=>{const [y,mm]=m.split('-').map(Number);return new Date(Date.UTC(y,mm,0)).toISOString().slice(0,10)};

// sym, account, quantity, currency, group, cost in shekels, price now, price at the previous close, name
const HOLD=[
  ['MSFT','exc',2,'USD','tech',3300,505,512,'Microsoft'],
  ['NVDA','exc',6,'USD','tech',3150,182,186.5,'NVIDIA'],
  ['AAPL','blink',4,'USD','tech',3220,231,229.4,'Apple'],
  ['CAT','exc',1,'USD','ind',1690,521,540,'Caterpillar'],
  ['JPM','exc',2,'USD','fin',1880,291,289.2,'JPMorgan Chase'],
  ['V','blink',1,'USD','fin',1140,341,339.9,'Visa'],
  ['KO','blink',5,'USD','cons',1260,70.4,70.1,'Coca-Cola'],
  ['PG','exc',2,'USD','cons',1170,158,159.1,'Procter & Gamble'],
  ['UNH','exc',1,'USD','health',1510,352,348,'UnitedHealth'],
  ['RKLB','blink',8,'USD','space',1650,48.2,51,'Rocket Lab'],
  ['TA125','exc',30,'ILS','il',1820,62.5,62.1,'MTF ת״א 125'],
  ['TA90','blink',120,'ILS','il',590,5.1,5.08,'קסם ת״א 90'],
];

export function fixture(now=Date.now()){
  const usdIls=3.7, upd=iso(now-20*60e3);
  const positions=HOLD.map(([sym,acct,qty,ccy,group,costIls,,,name])=>({sym,name,qty,ccy,acct,group,costIls}));
  const prices=Object.fromEntries(HOLD.map(h=>[h[0],h[6]])), prev=Object.fromEntries(HOLD.map(h=>[h[0],h[7]]));
  const months=[-6,-5,-4,-3,-2,-1].map(k=>ym(now,k));
  const deposits=[{date:lastOf(months[0]).slice(0,8)+'05',amount:18000},...months.slice(1).map(m=>({date:m+'-10',amount:600}))];
  const depSum=i=>deposits.slice(0,i+1).reduce((t,d)=>t+d.amount,0);
  const monthly=months.map((m,i)=>{const exc=Math.round((12600+i*380)*100)/100, blink=Math.round((6100+i*240)*100)/100;
    return {ym:m,exc,blink,excUsd:null,blinkUsd:Math.round(blink/usdIls*100)/100,dep:depSum(i),fx:usdIls,...(i===1?{excEst:true}:{})}});
  const total=HOLD.reduce((t,h)=>t+h[2]*h[6]*(h[3]==='USD'?usdIls:1),0)+400+5*usdIls;
  return {
    'portfolio/main':{positions,cash:[{acct:'exc',amount:400,ccy:'ILS'},{acct:'blink',amount:5,ccy:'USD'}],
      asOf:{exc:lastOf(months[5]),blink:ymd(now-3*DAY)},sources:{exc:'דוח לדוגמה',blink:'צילומי מסך לדוגמה'},taxShieldIls:0},
    'quotes/latest':{prices,prev,stale:{TA125:'מחיר קודם',TA90:'מחיר קודם'},usdIls,fxLabel:'יציג בנק ישראל',prevLabel:'סגירה קודמת',
      priceLabel:'מסחר חי, עיכוב של עד 15 דקות',source:'בדיקה',updatedAt:upd,attemptAt:upd,live:true},
    'settings/main':{name:'דנה',monthly:600,years:15,ratePct:7,fractional:true,minFeeIls:0,
      policy:'אני מפקיד 600 ₪ בכל חודש, בלי קשר למצב השוק.',
      rules:{maxPos:10,maxGroup:40,stopLoss:15,drift:5,minHoldMonths:12,maxUsd:90},
      targets:{tech:40,fin:15,ind:10,health:8,cons:12,space:5,il:9,cash:1},
      profile:{first:'דנה',last:'',email:'',phone:'',lang:'he',risk:'mid',level:'mid',at:iso(now-30*DAY)}},
    'plan/main':{start:months[5],opening:0,mode:'cheap',items:HOLD.filter(h=>h[3]==='USD').map(h=>({sym:h[0],status:'todo',note:''})),deposits:[],purchases:[]},
    'history/main':{depIlsNow:depSum(months.length-1),monthlyNote:'נתונים לדוגמה',monthly,
      accounts:[{acct:'exc',ccy:'ILS',from:deposits[0].date,through:lastOf(months[5]),deposits:deposits.slice(0,3),trades:[{date:deposits[0].date,sym:'MSFT',qty:2,px:470}],
        snapshots:[{date:lastOf(months[4]),value:monthly[4].exc},{date:lastOf(months[5]),value:monthly[5].exc}],feesUsd:0,feeUsdPerTrade:0,divGrossUsd:0,divTaxUsd:0,realizedUsd:0,tradesCount:1,fxIls:9000,fxUsd:2400,source:'דוח לדוגמה'},
        {acct:'blink',ccy:'USD',from:deposits[0].date,through:ymd(now-3*DAY),deposits:deposits.slice(3),trades:[],snapshots:[],feesUsd:0,feeUsdPerTrade:0,divGrossUsd:0,divTaxUsd:0,realizedUsd:0,tradesCount:0,fxIls:0,fxUsd:0,source:'צילומי מסך לדוגמה'}]},
    'history/daily':{points:{[ymd(now-2*DAY)]:{at:iso(now-2*DAY),v:Math.round(total*0.99),dep:depSum(5),exc:12000,blink:6800},[ymd(now-DAY)]:{at:iso(now-DAY),v:Math.round(total*1.004),dep:depSum(5),exc:12100,blink:6900}}},
    'history/prices':{months,px:Object.fromEntries(HOLD.filter(h=>h[3]==='USD').map(h=>[h[0],months.map((m,i)=>Math.round(h[6]*(0.9+i*0.02)*100)/100)])),source:'בדיקה'},
    'research/latest':{source:'Yahoo Finance',updatedAt:iso(now-DAY),events:[],companies:{
      MSFT:{pe:36,fpe:31,pm:36,roe:33,de:0.3,revg:15,rating:'Buy',target:560,analysts:50,next:ymd(now+20*DAY),beta:0.9},
      NVDA:{pe:52,fpe:30,pm:55,roe:110,de:0.13,revg:60,rating:'Strong Buy',target:220,analysts:58,next:ymd(now+35*DAY),beta:1.9},
      AAPL:{pe:34,fpe:30,pm:24,roe:150,de:1.5,revg:6,rating:'Buy',target:250,analysts:40,beta:1.1},
      CAT:{pe:25,fpe:22,pm:17,roe:50,de:1.9,revg:-2,rating:'Hold',target:530,analysts:25,beta:1.1},
      JPM:{pe:14,fpe:14,pm:34,roe:17,rating:'Buy',target:310,analysts:22,kind:'bank',beta:1.1},
      V:{pe:33,fpe:28,pm:55,roe:50,de:0.5,revg:10,rating:'Buy',target:380,analysts:35,beta:0.9},
      KO:{pe:25,fpe:23,pm:23,roe:40,de:1.6,revg:2,rating:'Buy',target:78,analysts:20,dy:2.9,beta:0.5},
      UNH:{pe:null,fpe:18,pm:null,roe:20,de:0.8,rating:'Hold',target:390,analysts:24,beta:0.6},
      RKLB:{pe:null,fpe:null,pm:-38,roe:-25,de:0.9,revg:45,rating:'Buy',target:55,analysts:12,beta:2.2}}},   // PG: no data on purpose
    'research/candidates':{source:'בדיקה',updatedAt:iso(now-DAY),items:[{sym:'XOM',name:'Exxon Mobil',group:'ind',price:115,pe:14,dy:3.4,beta:0.8},{sym:'COST',name:'Costco',group:'cons',price:900,pe:52,dy:0.5,beta:0.8}]},
    'research/comove':{days:60,from:ymd(now-90*DAY),to:ymd(now-DAY),groups:[],pairs:[],opposite:[],solo:[],nodata:[],whyPairs:{},pairRule:{min:0.7,n:60,pairs:0,sig:0.05},source:'בדיקה',updatedAt:iso(now-DAY)},
    'research/longterm':{count:0,pairs:[],from:ymd(now-365*DAY),to:ymd(now-DAY),source:'בדיקה',updatedAt:iso(now-DAY)},
  };
}
// a price history with a 3-week hole in the middle, for the price chart
export function closes(now=Date.now()){const d=[],c=[]; let v=180;
  for(let k=300;k>=1;k--){const t=new Date(now-k*DAY), wd=t.getUTCDay(); if(wd===0||wd===6||(k>=100&&k<=125))continue; v*=1+Math.sin(k/9)*0.01; d.push(ymd(t)); c.push(Math.round(v*100)/100)}
  return {key:'NVDA',d,c,source:'בדיקה',updatedAt:iso(now)}}
