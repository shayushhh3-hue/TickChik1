// 30.10: the health of the data, for the owner. Every source the site lives on, with the last time it worked: the prices
// and the dollar, the companies' figures (Yahoo, Finnhub, the SEC's report dates, the dividends ahead), the news and its
// reading, X, the e-mail, the backups, and every scheduled job's last run. A source is "bad" when it has not worked for
// longer than it normally may (a day for the nightly ones, a few hours for the ones that run all day), not when one run
// failed: a single failure is "warn" until the next run. The price watch (server/pxwatch.js) mails the bad ones to the
// owner, once in 12 hours each. Facts about the site only: nothing about any portfolio.
import {pxProblems} from './pxwatch.js';
import {mailReady, mailAllowed, MAIL_KINDS, mailAllowedFor, mailFromOwnDomain, kindsOf} from './mail.js';

const H=36e5;
const meta=(store,k)=>{try{return JSON.parse(store.getMeta(k)||'null')}catch(e){return null}};
const doc=(store,k)=>{try{const d=store.getDoc(k); return d.exists?d.data:null}catch(e){return null}};

// each source: its name, how many hours it may go without working, and from the status it last wrote: when it ran, whether
// it worked, and a word on what happened. off: not set up (no key), so nothing is expected of it.
export function sources(store,{env=process.env,now=new Date()}={}){
  const Q=doc(store,'quotes/latest'), R=meta(store,'researchStatus'), N=meta(store,'newsStatus'), NX=meta(store,'newsxStatus'), X=meta(store,'xStatus');
  const B=meta(store,'lastBackup'), BM=store.getMeta('lastBackupMail'), M=doc(store,'system/mail'), J=meta(store,'jobs')||{};
  const out=[];
  {const probs=Q?pxProblems(Q,now):[];
    out.push({key:'prices',name:'מחירי המניות',max:30,ran:Q&&Q.updatedAt,ok:!!(Q&&Q.updatedAt)&&!probs.some(p=>p.key==='late'||p.key==='errors'),
      note:probs.length?probs.map(p=>p.text).join(' '):Q?`${Object.keys(Q.prices||{}).length} ניירות`:'עוד לא הגיעו מחירים'});
    out.push({key:'fx',name:'שער הדולר',max:30,ran:Q&&Q.updatedAt,ok:!!(Q&&+Q.usdIls>0),note:Q&&+Q.usdIls>0?`${(+Q.usdIls).toFixed(3)} ₪`:'אין שער'})}
  // the companies' figures run Tuesday to Saturday at night: up to three days between runs over the weekend
  out.push({key:'research',name:'נתוני החברות (Yahoo)',max:80,ran:R&&R.at,ok:!!(R&&R.ok>0),note:R?`${R.ok} מתוך ${R.of} עודכנו${R.fail?`, ${R.fail} נכשלו`:''}${R.first&&!R.ok?': '+R.first:''}`:'עוד לא רץ'});
  {const fh=R&&R.fh, off=!env.FINNHUB_API_KEY;
    out.push({key:'finnhub',name:'Finnhub: דוחות, תחזיות ואנליסטים',max:80,off,ran:fh?R.at:null,ok:!!(fh&&fh.stopped!=='key'&&((fh.filled||0)+(fh.cal||0)+(fh.recs||0)>0)),
      note:off?'אין מפתח (FINNHUB_API_KEY)':fh?(fh.stopped==='key'?'המפתח נדחה':`${fh.filled||0} חברות, ${fh.cal||0} מועדי דוחות${fh.fail?`, ${fh.fail} נכשלו`:''}`):'עוד לא רץ'})}
  {const d=R&&R.dates; out.push({key:'sec',name:'מועדי הדוחות (SEC)',max:80,ran:d?R.at:null,ok:!!(d&&d.dated>0),note:d?`${d.dated} מתוך ${d.tried}${d.fail?`, ${d.fail} נכשלו`:''}${d.first&&!d.dated?': '+d.first:''}`:'עוד לא רץ'})}
  {const d=R&&R.divs; out.push({key:'divs',name:'דיבידנדים קדימה',max:80,ran:d?R.at:null,ok:!!(d&&(d.nasdaq+d.yahoo>0||(d.tried>0&&!d.fail))),note:d?`Nasdaq ${d.nasdaq}, Yahoo ${d.yahoo} מתוך ${d.tried}${d.fail?`, ${d.fail} בלי תשובה`:''}`:'עוד לא רץ'})}
  // the news runs every half hour from 07:00 to 23:00: the night is the longest gap
  out.push({key:'news',name:'איסוף הכתבות',max:10,ran:N&&N.at,ok:!!(N&&N.ok>0),note:N?`${N.ok} מתוך ${N.of}, ${N.items} כתבות${N.first&&!N.ok?': '+N.first:''}`:'עוד לא רץ'});
  {const off=!env.ANTHROPIC_API_KEY;
    out.push({key:'newsx',name:'קריאת הכתבות (צ׳יקו)',max:10,off,ran:NX&&NX.at,ok:!!(NX&&NX.ai&&!(NX.fail>0&&!NX.read)),
      note:off?'אין מפתח (ANTHROPIC_API_KEY): הכתבות נקראות רק לפי כללים':NX?`${NX.read||0} נקראו, ${NX.rules||0} לפי כללים, ${NX.waiting||0} ממתינות${NX.first?': '+NX.first:''}`:'עוד לא רץ'})}
  {const off=!env.X_BEARER_TOKEN;
    out.push({key:'x',name:'פוסטים מ-X',max:20,off,ran:X&&X.at,ok:!!(X&&X.ok>0&&X.stopped!=='auth'),note:off?'אין מפתח (X_BEARER_TOKEN)':X?(X.stopped==='auth'?'המפתח נדחה: קריאה מ-X דורשת תוכנית בתשלום':`${X.ok} ניירות, ${X.kept} פוסטים נשמרו`):'עוד לא רץ'})}
  out.push({key:'backup',name:'גיבוי יומי בשרת',max:30,ran:B&&B.at,ok:!!(B&&B.at&&B.docs!==null),note:B?`${B.file}, ${(B.size/1e6).toFixed(1)}MB${B.docs?`, נפתח ונבדק: ${B.docs.docs} מסמכים`:B.docs===null?', העותק לא נפתח!':''}`:'עוד לא נשמר גיבוי'});
  {const on=mailAllowed(store,'backup'), ready=mailReady(), last=M&&M.last&&M.last.backup;
    out.push({key:'backupmail',name:'גיבוי במייל, מחוץ לשרת',max:30,off:!on||!ready,ran:last&&last.at,ok:!!(last&&last.result==='sent'),
      note:!ready?'המיילים לא מוגדרים':!on?'כבוי: אפשר להפעיל בהגדרות ← מיילים':last?(last.result==='sent'?(meta(store,'lastBackupMailInfo')||{}).what||'נשלח':'השליחה נכשלה'):'עוד לא נשלח',okAt:BM||null})}
  {const L=(M&&M.last)||{}, failed=Object.entries(L).filter(([k,v])=>v&&v.result==='failed'&&(now-new Date(v.at))/H<48).map(([k])=>k);
    const sent=Object.values(L).filter(v=>v&&v.result==='sent').map(v=>v.at).sort().pop()||null, wanted=MAIL_KINDS.some(k=>mailAllowed(store,k)), good=mailReady()&&!failed.length;
    out.push({key:'mail',name:'שליחת מיילים',max:48,off:!wanted,ran:Object.values(L).map(v=>v&&v.at).filter(Boolean).sort().pop()||null,ok:good,okAt:good?now.toISOString():null,
      note:!mailReady()?(wanted?'לא מוגדר: אין RESEND_API_KEY':'לא מוגדר'):failed.length?`נכשל: ${failed.join(', ')}`:sent?'נשלח':'עוד לא נשלח מייל'})}
  // 30.10: partners and admins who chose e-mails (or admins who get the site's alerts), while the sender is Resend's test
  // address (it sends to the account's owner only)
  {const P=(()=>{try{return store.users().filter(u=>u.role!=='owner'&&kindsOf(u).some(k=>mailAllowedFor(store,u,k)))}catch(e){return []}})();
    if(P.length)out.push({key:'mailp',name:'מיילים למנהלים ולשותפים',max:24,ran:null,ok:mailReady()&&mailFromOwnDomain(),okAt:mailReady()&&mailFromOwnDomain()?now.toISOString():null,
      note:!mailReady()?'המיילים לא מוגדרים':!mailFromOwnDomain()?`${P.length===1?'משתמש אחד אמור לקבל':P.length+' משתמשים אמורים לקבל'} מיילים, אבל הם לא יגיעו: Resend שולח מ-onboarding@resend.dev רק לך. צריך דומיין משלך ו-MAIL_FROM (SETUP.md)`:`${P.length} משתמשים מקבלים מיילים`})}
  // a job that failed the last time it ran (its own words, the first line)
  for(const [name,j] of Object.entries(J)){if(!j||j.ok!==false)continue;
    out.push({key:'job:'+name,name:`משימה מתוזמנת: ${name}`,max:0,ran:j.at,ok:false,note:String(j.err||'נכשלה').split('\n')[0].slice(0,160),job:true})}
  return out;
}

// the report: each source with its state; okAt (the last time it worked) is kept between checks in meta 'health', and so is
// the first time a source was seen not working, so "how long" is known even when a source never worked
export function healthCheck(store,{env=process.env,now=new Date(),save=true}={}){
  const st=meta(store,'health')||{okAt:{},badSince:{}}; st.okAt=st.okAt||{}; st.badSince=st.badSince||{};
  const seen=new Set();
  const items=sources(store,{env,now}).map(s=>{
    if(s.ok&&(s.okAt||s.ran))st.okAt[s.key]=[st.okAt[s.key],s.okAt||s.ran].filter(Boolean).sort().pop();
    const okAt=st.okAt[s.key]||null;
    let state;
    if(s.off)state='off';
    else if(s.job)state='bad';
    else{const age=okAt?(now-new Date(okAt))/H:null;
      if(age!=null&&age<=s.max)state=s.ok?'ok':'warn';
      else{if(!st.badSince[s.key])st.badSince[s.key]=now.toISOString(); const since=okAt||st.badSince[s.key]; state=(now-new Date(since))/H>s.max?'bad':'warn'}}
    if(state==='ok'||state==='off')delete st.badSince[s.key];
    seen.add(s.key);
    return {key:s.key,name:s.name,state,okAt,ran:s.ran||null,note:s.note||''}});
  for(const k of Object.keys(st.badSince))if(!seen.has(k))delete st.badSince[k];
  if(save)try{store.setMeta('health',JSON.stringify({...st,at:now.toISOString()}))}catch(e){}
  return {at:now.toISOString(),items,bad:items.filter(i=>i.state==='bad').length,warn:items.filter(i=>i.state==='warn').length};
}

// for the price watch's e-mail: one problem per bad source
const hmAgo=(iso,now)=>{if(!iso)return 'אף פעם'; const h=(now-new Date(iso))/H; return h<48?`לפני ${Math.round(h)} שעות`:`לפני ${Math.round(h/24)} ימים`};
export function healthProblems(store,{env=process.env,now=new Date()}={}){
  // the prices have their own, finer watch (server/pxwatch.js); here the rest
  return healthCheck(store,{env,now}).items.filter(i=>i.state==='bad'&&i.key!=='prices').map(i=>({key:'h:'+i.key,
    text:`${i.name}: לא עבד ${i.okAt?'מאז '+hmAgo(i.okAt,now):'מאז שהתחיל'}${i.note?' ('+i.note+')':''}.`}));
}

// the scheduled jobs: the last run of each, kept in meta 'jobs' by the scheduler
export function jobNote(store,name,{ok,ms,err,now=new Date()}){
  try{const J=meta(store,'jobs')||{}; J[name]={at:now.toISOString(),ok,ms:Math.round(ms||0),...(err?{err:String(err).slice(0,300)}:{})}; store.setMeta('jobs',JSON.stringify(J))}catch(e){}
}
