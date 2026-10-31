// 31.10: "לוח אירועים כלכלי": the coming events that may matter to the market, in one document (research/ecocal), each
// with where it comes from and whether its day is confirmed or estimated. The sources the site has:
//  - the companies' reports: Finnhub's earnings calendar, as the research run keeps it in research/latest (the day,
//    confirmed or estimated, and before the open / after the close when Finnhub says);
//  - the Fed's rate decisions: the FOMC calendar the Fed published for 2026 (federalreserve.gov/monetarypolicy/
//    fomccalendars.htm), the second day of each meeting; the statement comes at 14:00 New York time by custom;
//  - the US jobs report, the CPI and the GDP's first estimate, and Israel's CPI: by the agencies' usual rhythm (BLS: the
//    jobs report on the first Friday, the CPI around the middle of the month; BEA: the advance GDP near the end of the
//    first month of a quarter; the CBS: the CPI on the 15th, at 18:30), each said to be ESTIMATED, since the agencies'
//    own calendars are not read here.
// What the site has no source for is listed under "missing" (the Bank of Israel's decisions, governors' speeches,
// planned regulatory decisions), never invented. Nothing here forecasts what a number will be.
const DAY=864e5;
export const ECO_DOC='research/ecocal';
export const CATS={earnings:'דוחות חברות',rates:'ריבית',inflation:'אינפלציה',jobs:'תעסוקה',growth:'צמיחה ותמ"ג',speech:'נאומים',regulation:'רגולציה',other:'אחר'};
export const REGIONS={us:'ארה״ב',israel:'ישראל',europe:'אירופה',global:'עולמי'};
export const MISSING=[{k:'boi',name:'החלטות הריבית של בנק ישראל',why:'לוח ההחלטות של בנק ישראל לא נקרא עדיין (אין מקור מובנה); אפשר להוסיף כשיהיה'},{k:'speech',name:'נאומים של נגידי בנקים מרכזיים',why:'אין מקור לוח מאומת'},{k:'regulation',name:'החלטות רגולטוריות מתוכננות',why:'אין מקור לוח מאומת'}];
// the FOMC's 2026 meetings (the decision is on the second day), from the Fed's published calendar
export const FOMC_2026=['2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09'];
const iso=d=>d.toISOString().slice(0,10);
const dow=s=>new Date(s+'T12:00:00Z').getUTCDay();   // 0 Sunday … 5 Friday, 6 Saturday
const shiftOffWeekend=(s,back)=>{let d=new Date(s+'T12:00:00Z'); while([0,6].includes(d.getUTCDay()))d=new Date(d.getTime()+(back?-1:1)*DAY); return iso(d)};
const firstFriday=(y,m)=>{let d=new Date(Date.UTC(y,m-1,1)); while(d.getUTCDay()!==5)d=new Date(d.getTime()+DAY); return iso(d)};
const pad=n=>String(n).padStart(2,'0');
// the macro items of the months ahead, by the agencies' rhythm (estimated), and the Fed's confirmed days
export function macroItems(now=new Date(),months=3){
  const out=[], y0=now.getUTCFullYear(), m0=now.getUTCMonth()+1;
  for(let i=0;i<=months;i++){const y=y0+Math.floor((m0-1+i)/12), m=((m0-1+i)%12)+1, ym=`${y}-${pad(m)}`, prevM=m===1?12:m-1, prevY=m===1?y-1:y;
    out.push({id:`us-jobs-${ym}`,d:firstFriday(y,m),time:'08:30',tz:'America/New_York',region:'us',cat:'jobs',name:`דוח התעסוקה בארה״ב (${pad(prevM)}/${prevY})`,who:'הלשכה לסטטיסטיקה של העבודה (BLS)',imp:3,est:true,
      desc:'משרות חדשות, שיעור האבטלה והשכר הממוצע לחודש הקודם. אחד הנתונים שהשווקים עוקבים אחריהם הכי הרבה.',src:'BLS, לפי הקצב הרגיל (יום שישי הראשון בחודש); המועד המדויק בלוח BLS',url:'https://www.bls.gov/schedule/news_release/empsit.htm'});
    out.push({id:`us-cpi-${ym}`,d:shiftOffWeekend(`${ym}-12`,false),time:'08:30',tz:'America/New_York',region:'us',cat:'inflation',name:`מדד המחירים לצרכן בארה״ב (${pad(prevM)}/${prevY})`,who:'BLS',imp:3,est:true,
      desc:'האינפלציה בארה״ב לחודש הקודם. משפיע על הציפיות לריבית הפד.',src:'BLS, לפי הקצב הרגיל (סביב אמצע החודש); המועד המדויק בלוח BLS',url:'https://www.bls.gov/schedule/news_release/cpi.htm'});
    if([1,4,7,10].includes(m)){const q=m===1?4:m===4?1:m===7?2:3, qy=m===1?y-1:y;
      out.push({id:`us-gdp-${ym}`,d:shiftOffWeekend(`${ym}-28`,true),time:'08:30',tz:'America/New_York',region:'us',cat:'growth',name:`תמ״ג ארה״ב, אומדן ראשון לרבעון ${q}/${qy}`,who:'הלשכה לניתוח כלכלי (BEA)',imp:2,est:true,
        desc:'קצב הצמיחה של הכלכלה האמריקאית ברבעון שהסתיים, באומדן הראשון.',src:'BEA, לפי הקצב הרגיל (סוף החודש הראשון של הרבעון); המועד המדויק בלוח BEA',url:'https://www.bea.gov/news/schedule'})}
    out.push({id:`il-cpi-${ym}`,d:shiftOffWeekend(`${ym}-15`,true),time:'18:30',tz:'Asia/Jerusalem',region:'israel',cat:'inflation',name:`מדד המחירים לצרכן בישראל (${pad(prevM)}/${prevY})`,who:'הלשכה המרכזית לסטטיסטיקה',imp:2,est:true,
      desc:'האינפלציה בישראל לחודש הקודם. נוגע לריבית בנק ישראל ולאג״ח צמודות.',src:'הלמ״ס, לפי הקצב הרגיל (ה-15 בחודש, 18:30; מוקדם יותר כשה-15 בשישי או בשבת)',url:'https://www.cbs.gov.il/he/Pages/default.aspx'})}
  for(const d of FOMC_2026){const m=+d.slice(5,7), y=+d.slice(0,4); if(y<y0||(y===y0&&m<m0)||(y===y0&&m>m0+months))continue;
    out.push({id:`fomc-${d}`,d,time:'14:00',tz:'America/New_York',region:'us',cat:'rates',name:'החלטת הריבית של הפד (FOMC)',who:'הפדרל ריזרב',imp:3,est:false,timeEst:true,
      desc:'הוועדה לשוק הפתוח מפרסמת את החלטת הריבית ואת ההודעה; מסיבת העיתונאים של היו״ר אחריה. המועד מהלוח שהפד פרסם ל-2026; השעה לפי הנוהג.',src:'הלוח הרשמי של הפד ל-2026 (federalreserve.gov)',url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'})}
  return out;
}
// the companies' coming reports, as the research run keeps them (research/latest): every security it knows, with the hour
export function earningsItems(store,now=new Date(),days=75){
  const C=(store.getDoc('research/latest').data||{}).companies||{}, today=iso(now), end=iso(new Date(now.getTime()+days*DAY)), out=[];
  for(const [k,c] of Object.entries(C)){if(!c||!c.next||c.next<today||c.next>end||(c.rep&&c.rep.at&&c.rep.at>=c.next))continue; const h=(c.est&&c.est.hour)||c.nextHour||null;
    const when=h==='bmo'?'לפני פתיחת המסחר':h==='amc'?'אחרי סגירת המסחר':h==='dmh'?'במהלך המסחר':'';
    out.push({id:`rep-${k}-${c.next}`,d:c.next,time:h==='bmo'?'לפני הפתיחה':h==='amc'?'אחרי הסגירה':'',tz:'America/New_York',region:/^TLV:|^\d/.test(k)?'israel':'us',cat:'earnings',name:`דוח כספי: ${c.name||k}`,sym:k,who:c.name||k,imp:2,est:!!c.nextEst,
      desc:`${c.name||k} אמורה לפרסם את הדוח הרבעוני${when?', '+when:''}.${c.est&&c.est.eps!=null?` צפי האנליסטים לרווח למניה: ${c.est.eps}.`:''}`,src:c.nextEst?'מועד משוער (לפי הקצב של הדוחות הקודמים)':'לוח הדוחות של Finnhub',url:c.ir||null})}
  return out;
}
export function ecocalBuild(store,{now=new Date()}={}){
  const from=iso(new Date(now.getTime()-7*DAY));   // the last week stays, so "what was this week" reads too
  const items=[...earningsItems(store,now),...macroItems(now)].filter(i=>i.d>=from).sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:(b.imp-a.imp));
  return {items,updatedAt:now.toISOString(),sources:{earnings:'לוח הדוחות של Finnhub (דרך ריצת המחקר)',fomc:'הלוח הרשמי של הפד ל-2026',us_macro:'BLS ו-BEA, מועדים משוערים לפי הקצב הרגיל',il_cpi:'הלמ״ס, מועד משוער לפי הקצב הרגיל'},missing:MISSING,fomcUntil:FOMC_2026[FOMC_2026.length-1]};
}
export async function ecocalTask(store,{log=()=>{},now=new Date()}={}){
  const doc=ecocalBuild(store,{now}); store.setDoc(ECO_DOC,doc);
  const n=doc.items.length, e=doc.items.filter(i=>i.cat==='earnings').length; log(`ecocal: ${n} events (${e} reports, ${n-e} macro); the Fed's calendar runs to ${doc.fomcUntil}`);
  if(now.toISOString().slice(0,10)>doc.fomcUntil)log('ecocal: the FOMC calendar needs next year\'s dates (server/ecocal.js FOMC_2026)');
  return {n,reports:e};
}
