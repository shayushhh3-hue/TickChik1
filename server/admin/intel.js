// 1.11 TikChik Management Center, stage E: the management's intelligence.
//   TikChik Radar: detectors over what the site already keeps (the usage, the server's counters, the AI meter, the
//     tickets, the news, the prices). Each finding says what happened, since when, how wide, who or what it touches,
//     where it comes from, how serious, a possible cause (marked as such) and what to check; and whether it is a measured
//     fact or a suspicion. A finding stays open while its condition holds and closes by itself when it is gone, unless a
//     person took it.
//   Voice of Users: the tickets, read for the five main pains of the period, their trend, how many people, how serious,
//     a single complaint apart from a recurring one, the features asked for, the frustration.
//   TikChik Intelligence: an assistant for the management that answers from the figures of the management center only,
//     within the asker's permissions, with its conclusion, the supporting data, the range, the sources, how sure, and an
//     action only when justified. It has no tools: it cannot change, delete or grant anything. A number in its answer
//     that is not in the facts is flagged.
import {ilParts} from '../../shared/market.js';
import {audit, can} from './core.js';
import {countersSince, aiMeter, bump} from './counter.js';
import {executive, product, rangeOf, K_ANON, aiCost} from './metrics.js';
import {incidents, newsOps, aiOps, FEAT_HE} from './ops.js';
import {supportStats, ticketsList, TOPIC_HE, roadmapList, business} from './biz.js';
import {healthCheck} from '../health.js';

const DAY=864e5, now=()=>new Date().toISOString(), today=()=>ilParts(new Date()).iso;
const addD=(d,n)=>ilParts(new Date(Date.parse(d+'T12:00:00Z')+n*DAY)).iso;
const sum=L=>L.reduce((a,r)=>a+(+r.n||0),0);
const meta=(store,k,d=null)=>{try{return JSON.parse(store.getMeta(k)||'null')??d}catch(e){return d}};

export function intelSchema(store){
  store.db.exec(`create table if not exists radar(id integer primary key autoincrement, key text not null, kind text not null, title text not null, sev text not null, verified integer not null default 0,
      started_at text not null, last_seen text not null, scope text, affected text, source text, cause text, action text, data text, status text not null default 'open', owner text, resolution text,
      auto integer not null default 1, closed_at text, updated_at text not null);
    create index if not exists radar_open on radar(status, key);
    create table if not exists intel_log(id integer primary key autoincrement, uid text not null, at text not null, q text not null, a text);`)}

// ================= the radar =================
const usageOf=(store,u)=>{const d=store.getDoc(u.role==='owner'?'usage/main':`data/users/${u.id}/usage`); return d.exists&&d.data&&d.data.days||{}};
function activeUsers(store,from,to){return store.db.prepare('select count(distinct uid) n from active_days where day>=? and day<=?').get(from,to).n}
const DETECT=[
  // a part of the site used much less this week than in the three weeks before (needs three active people, or one
  // person's habits would show)
  {kind:'usage',run:(store,ctx)=>{const t=today(), wFrom=addD(t,-6), pFrom=addD(t,-27), pTo=addD(t,-7); if(activeUsers(store,pFrom,t)<K_ANON)return [];
    const cur={}, prev={}; for(const u of store.users()){for(const [d,D] of Object.entries(usageOf(store,u))){const T=d>=wFrom&&d<=t?cur:d>=pFrom&&d<=pTo?prev:null; if(!T)continue; for(const [k,n] of Object.entries(D||{}))T[k]=(T[k]||0)+(+n||0)}}
    const cat=ctx.cat||{tabs:{},secs:{}}; const name=k=>{const [a,b]=[k.slice(0,k.indexOf(':')),k.slice(k.indexOf(':')+1)]; return a==='tab'?(cat.tabs[b]||b):a==='s'?(cat.secs[b]||b):k};
    return Object.keys(prev).filter(k=>prev[k]/3>=10&&(cur[k]||0)<=prev[k]/3*0.5).map(k=>{const was=Math.round(prev[k]/3), is=cur[k]||0, drop=Math.round(100*(1-is/was));
      return {key:'usage:'+k,title:`ירידה חדה בשימוש: ${name(k)}`,sev:drop>=80?'bad':'warn',verified:0,scope:`${is} שימושים השבוע, מול ממוצע ${was} בשבוע בשלושת השבועות הקודמים (ירידה של ${drop}%)`,
        affected:'כל המשתמשים שמשתמשים בחלק הזה',source:'מסמכי השימוש של המשתמשים (סיכום בלי שמות)',cause:'אפשרי: שינוי בגרסה האחרונה שהזיז או הסתיר את החלק, תקלה בו, או שינוי עונתי. לא אומת.',
        action:`לפתוח את החלק באתר ולוודא שהוא עובד; לבדוק במודיעין מוצר אם המעברים אליו ירדו; לבדוק פניות בנושא`,data:{was,is,k}}})}},
  // the server's own errors today against the days before
  {kind:'errors',run:store=>{const t=today(), n=sum(countersSince(store,'rt_5xx',t,t)), base=sum(countersSince(store,'rt_5xx',addD(t,-7),addD(t,-1)))/7; if(n<10||n<3*Math.max(1,base))return [];
    const by={}; for(const r of countersSince(store,'rt_5xx',t,t))by[r.key]=(by[r.key]||0)+r.n; const top=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,3);
    return [{key:'errors',title:'עלייה פתאומית בשגיאות שרת',sev:n>=100?'bad':'warn',verified:1,scope:`${n} בקשות נכשלו היום, מול ממוצע ${Math.round(base)} ביום בשבוע שלפני`,affected:'האזורים: '+top.map(([k,v])=>`${k} (${v})`).join(', '),
      source:'מדידת הבקשות של השרת',cause:'אפשרי: שינוי בגרסה האחרונה, ספק חיצוני שלא עונה, או עומס. לא אומת.',action:'לבדוק את יומן השרת ב-Railway סביב השעה שהתחילו השגיאות; לבדוק במסך התקינות אילו אזורים',data:{n,base:Math.round(base),top}}]}},
  // many people stuck on the same step of a new account (from what is in their accounts)
  {kind:'stuck',run:(store,ctx)=>{if(!ctx.funnel)return []; const F=Object.fromEntries(ctx.funnel.map(s=>[s.k,s]));
    const out=[]; const step=(a,b,l)=>{const A=F[a]&&F[a].n, B=F[b]&&F[b].n; if(A>=3&&(A-B)>=Math.max(3,A*0.5))out.push({key:'stuck:'+b,title:`משתמשים נתקעים: ${l}`,sev:'warn',verified:1,
      scope:`${A-B} מתוך ${A} ש${F[a].l.replace(/^[^ ]+ /,'')} לא ${l}`,affected:`${A-B} משתמשים`,source:'מה שקיים בחשבונות (אותם שלבים שמסך הבית מציע)',cause:'אפשרי: השלב לא ברור, או קשה לבצע בטלפון. לא אומת.',
      action:'לעבור על השלב כמשתמש חדש; לבדוק פניות בנושא; לשקול הסבר או ברירת מחדל טובה יותר',data:{from:A,to:B}})};
    step('acct','pf','הזינו תיק'); step('pf','cost','השלימו מחירי קנייה'); step('pf','targets','קבעו יעדי הקצאה'); return out}},
  // the AI's tokens in the last day against the week before
  {kind:'aicost',run:store=>{const t=today(), y=addD(t,-1), tok=k=>sum(countersSince(store,'ai_in',k[0],k[1]))+sum(countersSince(store,'ai_out',k[0],k[1]));
    const n=tok([t,t]), base=tok([addD(t,-7),y])/7; if(n<200000||n<2*Math.max(1,base))return [];
    const by={}; for(const k of ['ai_in','ai_out'])for(const r of countersSince(store,k,t,t)){const f=r.key.split('|')[0]; by[f]=(by[f]||0)+r.n}
    const top=Object.entries(by).sort((a,b)=>b[1]-a[1])[0]; const c=aiCost(store,t,t);
    return [{key:'aicost',title:'עלייה חדה בצריכת ה-AI',sev:n>=5*base?'bad':'warn',verified:1,scope:`${n.toLocaleString('en-US')} טוקנים היום, מול ממוצע ${Math.round(base).toLocaleString('en-US')} ביום בשבוע שלפני${c.total!=null?` · עלות היום $${c.total.toFixed(2)}`:''}`,
      affected:top?`בעיקר ${FEAT_HE[top[0]]||top[0]}`:'',source:'מונה ה-AI לפי פיצ׳ר',cause:'אפשרי: הרבה כתבות חדשות לקריאה, קובץ גדול, או ניסיונות חוזרים אחרי כשלונות. לא אומת.',
      action:'לבדוק במסך מנועי AI איזה פיצ׳ר עלה ואם יש כשלונות חוזרים; לשקול תקרה יומית',data:{n,base:Math.round(base),top}}]}},
  // the news: the reading falls behind, or most sources fail
  {kind:'news',run:store=>{const N=newsOps(store), out=[], R=N.reading;
    if(R.waiting!=null&&R.waiting>=150)out.push({key:'news:backlog',title:'צ׳יקו לא מספיק לקרוא את הכתבות',sev:R.waiting>=400?'bad':'warn',verified:1,scope:`${R.waiting} כתבות ממתינות לקריאה`,affected:'החדשות המוסברות וההתראות האישיות של כל המשתמשים',
      source:'סטטוס קריאת הכתבות',cause:R.first?`אפשרי, לפי הריצה האחרונה: ${R.first}`:'אפשרי: מכסת AI, כשל בתשובות, או גל כתבות. לא אומת.',action:'לבדוק את מנועי AI (קריאת כתבות) ואת יומן השרת; להריץ קריאה עכשיו מהתקינות',data:{waiting:R.waiting}});
    const S=N.sources[0]; if(S&&S.of>=5&&S.ok!=null&&S.ok/S.of<0.7)out.push({key:'news:source',title:'ירידה בזמינות מקור החדשות',sev:S.ok/S.of<0.4?'bad':'warn',verified:1,scope:`${S.ok} מתוך ${S.of} ניירות קיבלו כתבות בריצה האחרונה`,affected:'החדשות על הניירות בתיקים',source:'סטטוס איסוף החדשות',
      cause:S.first?`לפי הריצה האחרונה: ${S.first}`:'לא ידוע',action:'לבדוק במסך מערכת החדשות; אם חוזר, לבדוק את המפתח והמכסה של הספק',data:{ok:S.ok,of:S.of}});
    return out}},
  // the prices late while a market is open (the same check the health runs)
  {kind:'prices',run:store=>{const H=healthCheck(store,{save:false}), p=(H.items||[]).find(i=>i.key==='prices'); if(!p||p.state==='ok'||p.state==='off')return [];
    return [{key:'prices',title:'עיכוב בעדכון נתוני השוק',sev:p.state==='bad'?'bad':'warn',verified:1,scope:p.note||'המחירים לא התעדכנו בזמן',affected:'כל המסכים שמציגים מחיר ושווי',source:'בדיקת התקינות (מחירי המניות)',
      cause:'אפשרי: מקור המחירים חוסם או איטי, או שהשוק סגור והסגירה טרם פורסמה. לא אומת.',action:'לבדוק במסך התקינות; להריץ עדכון מחירים',data:{state:p.state}}]}},
  // the notifications that do not arrive
  {kind:'push',run:store=>{const t=today(), R=countersSince(store,'push',addD(t,-1),t), ok=sum(R.filter(r=>r.key==='sent')), f=sum(R.filter(r=>r.key==='fail')); if(ok+f<5||f/(ok+f)<0.3)return [];
    return [{key:'push',title:'עלייה בהתראות שנכשלו',sev:f/(ok+f)>=0.6?'bad':'warn',verified:1,scope:`${f} מתוך ${ok+f} התראות לטלפון לא הגיעו ביממה האחרונה`,affected:'משתמשים שהפעילו התראות לטלפון',source:'מונה השליחות',
      cause:'אפשרי: מכשירים שביטלו את ההרשמה, או בעיה במפתחות ההתראות. לא אומת.',action:'לבדוק את יומן השרת (push); לנסות התראת בדיקה',data:{ok,f}}]}},
  // fewer people come back: returning this week against last week
  {kind:'return',run:store=>{const t=today(), q=(a,b)=>store.db.prepare('select count(*) n from (select uid from active_days where day>=? and day<=? group by uid having count(*)>=2)').get(a,b).n;
    const cur=q(addD(t,-6),t), prev=q(addD(t,-13),addD(t,-7)); if(prev<3||cur>prev*0.7)return [];
    return [{key:'return',title:'ירידה בשיעור החזרה של משתמשים',sev:cur<=prev*0.4?'bad':'warn',verified:0,scope:`${cur} משתמשים חזרו ביותר מיום אחד השבוע, מול ${prev} בשבוע שלפני`,affected:'משתמשים חוזרים',source:'ימי הפעילות',
      cause:'אפשרי: חג או חופשה, תקלה שמונעת כניסה, או שהאתר מעניין פחות. לא אומת; עם מעט משתמשים זה יכול להיות מקרי.',action:'לבדוק אם יש תקלה בכניסה (מרכז אבטחה); לבדוק פניות; להשוות לשבוע מקביל',data:{cur,prev}}]}},
  // complaints on one topic, from several people, more than before
  {kind:'complaints',run:store=>{const t=today(), L=ticketsList(store), f7=addD(t,-6), p7=addD(t,-13), by={};
    for(const x of L){const d=x.created_at.slice(0,10), k=x.topic||'other'; const o=by[k]||(by[k]={cur:0,prev:0,people:new Set()}); if(d>=f7){o.cur++; o.people.add(x.uid)} else if(d>=p7)o.prev++}
    return Object.entries(by).filter(([,o])=>o.cur>=3&&o.people.size>=2&&o.cur>o.prev).map(([k,o])=>({key:'complaints:'+k,title:`עלייה בתלונות: ${TOPIC_HE[k]||k}`,sev:o.cur>=6?'bad':'warn',verified:1,
      scope:`${o.cur} פניות השבוע מ-${o.people.size} משתמשים, מול ${o.prev} בשבוע שלפני`,affected:`${o.people.size} משתמשים`,source:'פניות התמיכה',cause:'אפשרי: תקלה חדשה או שינוי לא ברור באזור הזה. לא אומת.',
      action:'לקרוא את הפניות בקול המשתמשים; לבדוק אם יש תקלה פתוחה באותו אזור',data:{cur:o.cur,prev:o.prev,people:o.people.size}}))}}];
export function radarScan(store,{cat=null,log=()=>{},push=null}={}){
  intelSchema(store); const iso=now(), seen=new Set(), opened=[];
  let funnel=null; try{const P=product(store,{range:'30'},{viewer:store.users().find(u=>u.role==='owner')||store.users()[0]||{id:''},pageFile:null}); funnel=P.funnel; cat=cat||null}catch(e){}
  for(const D of DETECT){let F=[]; try{F=D.run(store,{cat,funnel})||[]}catch(e){log('radar '+D.kind+': '+e.message)}
    for(const f of F){seen.add(f.key); const o=store.db.prepare("select * from radar where key=? and status not in ('resolved','dismissed') order by id desc limit 1").get(f.key);
      if(o){store.db.prepare('update radar set title=?, sev=?, verified=?, last_seen=?, scope=?, affected=?, source=?, cause=?, action=?, data=?, updated_at=? where id=?')
        .run(f.title,o.sev==='bad'?'bad':f.sev,f.verified,iso,f.scope,f.affected,f.source,f.cause,f.action,JSON.stringify(f.data||{}),iso,o.id); continue}
      const r=store.db.prepare('insert into radar(key,kind,title,sev,verified,started_at,last_seen,scope,affected,source,cause,action,data,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(f.key,D.kind,f.title,f.sev,f.verified,iso,iso,f.scope,f.affected,f.source,f.cause,f.action,JSON.stringify(f.data||{}),iso); opened.push({id:r.lastInsertRowid,...f})}}
  // gone: closed by itself, unless a person has it
  for(const o of store.db.prepare("select * from radar where status not in ('resolved','dismissed')").all())if(!seen.has(o.key)&&o.auto)
    store.db.prepare("update radar set status='resolved', closed_at=?, resolution=coalesce(resolution,'חזר לטווח הרגיל'), updated_at=? where id=?").run(iso,iso,o.id);
  store.setMeta('radarAt',JSON.stringify(iso));
  if(opened.length&&push){const bad=opened.filter(x=>x.sev==='bad'); if(bad.length)for(const u of store.users().map(x=>store.userById(x.id)).filter(u=>can(u,'view')))push(store,u.id,{title:'Radar: '+(bad.length===1?bad[0].title:`${bad.length} ממצאים חדשים`),body:bad.map(x=>x.scope).join(' · ').slice(0,280),url:'/admin#radar',tag:'mc-radar'},{log}).catch(()=>{})}
  return opened;
}
export function radarList(store,{days=30}={}){intelSchema(store); const from=new Date(Date.now()-days*DAY).toISOString(), U=Object.fromEntries(store.users().map(u=>[u.id,u.email]));
  return store.db.prepare("select * from radar where status not in ('resolved','dismissed') or updated_at>=? order by (status in ('resolved','dismissed')), case sev when 'bad' then 0 else 1 end, last_seen desc limit 200").all(from)
    .map(r=>({...r,data:r.data?JSON.parse(r.data):null,ownerEmail:r.owner?U[r.owner]||null:null}))}
export function radarUpdate(store,user,id,b,ip){intelSchema(store); const o=store.db.prepare('select * from radar where id=?').get(+id); if(!o)throw new Error('not_found');
  const status=['open','watch','ack','resolved','dismissed'].includes(b.status)?b.status:o.status, owner=b.owner===undefined?o.owner:(b.owner||null);
  if(owner&&!store.userById(owner))throw new Error('not_found'); const resolution=b.resolution===undefined?o.resolution:String(b.resolution).slice(0,500), iso=now();
  store.db.prepare('update radar set status=?, owner=?, resolution=?, auto=0, closed_at=?, updated_at=? where id=?').run(status,owner,resolution,['resolved','dismissed'].includes(status)?(o.closed_at||iso):null,iso,o.id);
  audit(store,{user,action:'radar.update',target:'radar:'+o.id,detail:{title:o.title,before:{status:o.status,owner:o.owner},after:{status,owner},resolution:resolution||undefined},ip});
  return store.db.prepare('select * from radar where id=?').get(o.id)}

// ================= voice of users =================
const FRUST=/מתסכל|מעצבן|שוב ושוב|עדיין לא|כבר פעם|לא עובד|לא מצליח|נתקע|באג|!!|גרוע|מאוכזב|ויתרתי|אין מענה/;
const IMPROVE={login:'לפשט את הכניסה והשחזור; לבדוק את זרימת האימות הדו-שלבי בטלפון',statement:'לבדוק את סוגי הקבצים שנכשלים; הודעת שגיאה שאומרת מה לעשות',prices:'לבדוק את מקור המחירים ואת התצוגה של "מעודכן ל..."',chiko:'לבדוק תשובות שנשאלו עליהן; לשפר את ההסבר מה צ׳יקו יודע ומה לא',
  news:'לבדוק את רלוונטיות ההתראות ואת ההגדרות שלהן',plan:'הסבר טוב יותר לתוכנית וליעדים',portfolio:'לבדוק את הזנת התיק ואת עריכת ההחזקות',speed:'למדוד את זמני הטעינה במסך התקינות; לבדוק איזה מסך כבד',other:'לקרוא את הפניות ולסווג מחדש'};
export function voice(store,{from,to}){
  const L=ticketsList(store), inR=x=>x.created_at.slice(0,10)>=from&&x.created_at.slice(0,10)<=to, len=Math.round((Date.parse(to)-Date.parse(from))/DAY)+1, pFrom=addD(from,-len), pTo=addD(from,-1);
  const P=L.filter(inR), prev=L.filter(x=>x.created_at.slice(0,10)>=pFrom&&x.created_at.slice(0,10)<=pTo), body=id=>{const m=store.db.prepare("select body from ticket_msgs where ticket_id=? and role='user' order by id").all(id); return m.map(x=>x.body).join(' ')};
  const weeks=[]; for(let d=from;d<=to;d=addD(d,7))weeks.push(d);
  const by={}; for(const t of P){const k=t.topic||'other'; const o=by[k]||(by[k]={k,name:TOPIC_HE[k]||k,n:0,people:new Set(),bugs:0,urgent:0,frust:0,open:0,examples:[],weeks:weeks.map(()=>0)}); o.n++; o.people.add(t.uid);
    if(t.type==='bug')o.bugs++; if(t.priority==='urgent'||t.priority==='high')o.urgent++; if(!['resolved','closed'].includes(t.status))o.open++; if(FRUST.test(t.subject+' '+body(t.id)))o.frust++; if(o.examples.length<3)o.examples.push({id:t.id,subject:t.subject});
    const w=Math.min(weeks.length-1,Math.floor((Date.parse(t.created_at.slice(0,10))-Date.parse(from))/(7*DAY))); if(w>=0)o.weeks[w]++}
  const pv={}; for(const t of prev){const k=t.topic||'other'; pv[k]=(pv[k]||0)+1}
  const T=Object.values(by).map(o=>{const people=o.people.size, sevScore=o.bugs*2+o.urgent*2+o.frust+o.open; return {k:o.k,name:o.name,n:o.n,people,prev:pv[o.k]||0,bugs:o.bugs,urgent:o.urgent,frust:o.frust,open:o.open,examples:o.examples,weeks:o.weeks,
    recurring:people>=2,sev:o.bugs+o.urgent>=Math.max(1,o.n/2)?'high':o.frust||o.open?'mid':'low',score:people*3+o.n+sevScore,improve:IMPROVE[o.k]||IMPROVE.other}}).sort((a,b)=>b.score-a.score);
  const asks=P.filter(t=>t.type==='idea'||t.type==='request').map(t=>({id:t.id,subject:t.subject,topic:TOPIC_HE[t.topic]||t.topic,roadmap:t.roadmap_id||null}));
  const frustration=P.filter(t=>FRUST.test(t.subject+' '+body(t.id))).slice(0,10).map(t=>({id:t.id,subject:t.subject,topic:TOPIC_HE[t.topic]||t.topic}));
  return {range:{from,to,len},n:P.length,people:new Set(P.map(t=>t.uid)).size,prevN:prev.length,top5:T.slice(0,5),topics:T,asks,frustration,weeks,
    how:'הדירוג: כמה משתמשים שונים (פי 3), כמה פניות, וחומרה (תקלות ופניות בעדיפות גבוהה פי 2, תסכול ופניות פתוחות). "חוזר" = אצל שני משתמשים או יותר; "בודד" = משתמש אחד.',
    sources:'פניות התמיכה בלבד: אין עדיין מקור משוב אחר באתר (סקר או דירוג).'}}

// ================= TikChik Intelligence =================
// the facts the assistant may use: the figures of the management center, filtered by the asker's permissions. No
// e-mail, no name, no portfolio content, no sign-in log; a person is a count
export function factsFor(store,user,q={}){
  const R=rangeOf(q), F={range:{from:R.from,to:R.to,days:R.len,prev:{from:R.prevFrom,to:R.prevTo}},generatedAt:now()};
  try{const E=executive(store,q); F.executive=E.metrics.map(m=>({k:m.k,label:m.label,value:m.value,of:m.of??undefined,prev:m.prev??undefined,unit:m.unit||undefined,note:m.note||undefined,source:m.src}));
    F.activePerDay=Object.fromEntries(E.series.days.map((d,i)=>[d,E.series.active[i]])); F.aiCallsPerDay=Object.fromEntries(E.series.days.map((d,i)=>[d,E.series.ai[i]]))}catch(e){F.executive=null}
  try{const P=product(store,q,{viewer:user,pageFile:q.pageFile||null}); F.product=P.own?{hidden:`fewer than ${K_ANON} active users in the range: no summary of everybody`}:{top:P.rows.slice(0,25).map(r=>({name:r.name,kind:r.kind,uses:r.n,prevUses:r.prev,users:r.people,repeatUsers:r.repeat})),neverUsed:P.never.slice(0,40).map(r=>r.name),funnel:P.funnel,timeOnScreens:P.time.slice(0,10)}}catch(e){F.product=null}
  try{const S=supportStats(store,R); F.support={...S,topics:S.topics}}catch(e){}
  try{const V=voice(store,R); F.voiceTop5=V.top5.map(t=>({topic:t.name,tickets:t.n,users:t.people,prevPeriod:t.prev,bugs:t.bugs,recurring:t.recurring,severity:t.sev,examples:t.examples.map(x=>x.subject)}))}catch(e){}
  try{F.radarOpen=radarList(store).filter(r=>!['resolved','dismissed'].includes(r.status)).map(r=>({title:r.title,severity:r.sev,verified:!!r.verified,since:r.started_at,scope:r.scope,cause:r.cause,check:r.action,status:r.status}))}catch(e){}
  try{F.incidents=incidents(store,{days:R.len}).map(i=>({name:i.name,severity:i.sev,status:i.status,opened:i.opened_at,closed:i.closed_at,note:i.note,resolution:i.resolution}))}catch(e){}
  try{const H=healthCheck(store,{save:false}); F.health=(H.items||[]).map(i=>({source:i.name,state:i.state,lastOk:i.okAt,note:i.note}))}catch(e){}
  try{const A=aiOps(store,R); F.ai={features:A.features.map(f=>({feature:f.name,calls:f.calls,avgMs:f.avg,failPct:f.errPct,inputTokens:f.input,outputTokens:f.output,costUsd:f.cost})),models:A.models,errors:A.errors}}catch(e){}
  try{const N=newsOps(store); F.news={articles:N.articles.total,duplicates:N.articles.dup,noSource:N.articles.noSrc,reading:N.reading,impact:N.impact,personalAlerts:N.personal}}catch(e){}
  try{const B=business(store,{months:6,fx:(store.getDoc('quotes/latest').data||{}).usdIls||null}); F.money={months:B.months.map(m=>({month:m.month,costUsd:m.cost,enteredUsd:m.entered,aiUsd:m.ai,revenueUsd:m.revenue,activeUsers:m.active,costPerUser:m.perUser})),forecast:B.forecast,aiByFeature:B.featCost,notes:B.notes}}catch(e){}
  try{F.roadmap=roadmapList(store).map(r=>({title:r.title,status:r.status,priority:r.priority,due:r.due,late:r.late,launched:r.launched_at,tickets:r.tickets}))}catch(e){}
  F.permissions={sensitive:can(user,'sensitive'),note:'no names, e-mails, sign-ins, sessions or portfolio contents are in these facts'};
  return F;
}
const SYS=`אתה TikChik Intelligence, העוזר הפנימי של הנהלת TikChik (אתר לניהול תיקי השקעות). אתה עונה רק מתוך FACTS: נתוני מרכז הניהול של האתר, בטווח שבו. אין לך מידע אחר על האתר, ואסור לך להשלים מהדמיון.
כללים:
1. עברית ברורה ותמציתית, בלי Markdown ובלי אימוג׳י.
2. מספרים: רק מספרים שמופיעים ב-FACTS, כפי שהם. מותר לחשב הפרש או אחוז פשוט משני מספרים שבהם, ואז לכתוב ממה חושב.
3. אם אין ב-FACTS מספיק כדי לענות, אמור זאת במפורש ב-conclusion, הורד את certainty ל-low, וכתוב ב-missing מה חסר. אל תנחש.
4. הבחן בין מה שנמדד לבין השערה. סיבה אפשרית מסומנת כ"אפשרי".
5. action: המלצה רק כשהנתונים מצדיקים אותה, כצעד לבדיקה או לטיפול שמנהל יבצע; אחרת null. אתה לא מבצע שום פעולה, לא משנה הרשאות ולא מוחק.
6. עם מעט משתמשים (פחות מ-10), אמור שהמספרים קטנים ושמגמה עלולה להיות מקרית.
7. sources: שמות החלקים ב-FACTS שעליהם נשענת התשובה (למשל executive, support, radarOpen, ai, money).
החזר JSON בלבד: {"conclusion":"","data":[{"fact":"","value":"","source":""}],"range":"","sources":[""],"certainty":"high|medium|low","certaintyWhy":"","action":null,"missing":""}`;
const nums=s=>(String(s||'').match(/\d[\d,.]*\d|\d/g)||[]).map(x=>x.replace(/[.,]$/,'').replace(/,/g,''));
export async function intelAsk(store,user,question,{ask=null,q={},log=()=>{},env=process.env}={}){
  intelSchema(store); const Q=String(question||'').trim().slice(0,600); if(Q.length<3)throw new Error('short');
  const n=store.db.prepare('select count(*) n from intel_log where uid=? and at>?').get(user.id,new Date(Date.now()-36e5).toISOString()).n; if(n>=20)throw new Error('rate');
  const F=factsFor(store,user,q), facts=JSON.stringify(F);
  if(!ask&&!env.ANTHROPIC_API_KEY)return {unavailable:'TikChik Intelligence צריך את צ׳יקו: חסר ANTHROPIC_API_KEY ב-Railway. הנתונים עצמם זמינים במסכים.',range:F.range};
  const L=String(env.ALLOWED_MODELS||'claude-haiku-5-5,claude-sonnet-5-5').split(',').map(s=>s.trim()).filter(Boolean), model=env.INTEL_MODEL||L.find(m=>/sonnet/.test(m))||L[0];
  const prompt=`FACTS:\n${facts}\n\nשאלת ההנהלה: ${Q}`;
  let text='', t0=Date.now();
  if(ask)text=await ask({system:SYS,prompt,model});
  else{let r; try{r=await fetch((env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages',{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
        body:JSON.stringify({model,max_tokens:2500,system:SYS,messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(120000)})}
      catch(e){aiMeter({feature:'intel',model,ms:Date.now()-t0,ok:false,code:e&&e.name==='TimeoutError'?'timeout':'network'}); throw new Error('upstream')}
    if(!r.ok){aiMeter({feature:'intel',model,ms:Date.now()-t0,ok:false,code:'HTTP '+r.status}); log('intel failed: HTTP '+r.status); throw new Error('upstream')}
    const j=await r.json(); aiMeter({feature:'intel',model:j.model||model,usage:j.usage,ms:Date.now()-t0,ok:true,addModel:true}); text=((j.content||[]).find(x=>x.type==='text')||{}).text||''}
  const m=text.match(/\{[\s\S]*\}/); let A=null; try{A=m?JSON.parse(m[0]):null}catch(e){A=null}
  if(!A||typeof A.conclusion!=='string')throw new Error('no_answer');
  const out={conclusion:String(A.conclusion).slice(0,1500),data:(Array.isArray(A.data)?A.data:[]).slice(0,12).map(d=>({fact:String(d&&d.fact||'').slice(0,200),value:String(d&&d.value||'').slice(0,80),source:String(d&&d.source||'').slice(0,40)})),
    range:String(A.range||`${F.range.from} – ${F.range.to}`).slice(0,80),sources:(Array.isArray(A.sources)?A.sources:[]).map(s=>String(s).slice(0,40)).slice(0,10),
    certainty:['high','medium','low'].includes(A.certainty)?A.certainty:'low',certaintyWhy:String(A.certaintyWhy||'').slice(0,300),action:A.action?String(A.action).slice(0,600):null,missing:String(A.missing||'').slice(0,500)};
  // every number it wrote, checked against the facts it was given
  const have=new Set(nums(facts)), said=[out.conclusion,out.action||'',...out.data.map(d=>d.value+' '+d.fact)].join(' ');
  const unknown=[...new Set(nums(said))].filter(x=>!have.has(x)&&!have.has(x.replace(/\.0+$/,''))&&!(+x<=31&&/^\d{1,2}$/.test(x)));
  out.check=unknown.length?{ok:false,unknown:unknown.slice(0,8),note:'מספרים שלא מופיעים כפי שהם בנתונים: ייתכן שחושבו מהם, וייתכן שלא. כדאי לבדוק במסך המתאים.'}:{ok:true,note:'כל המספרים בתשובה מופיעים בנתונים.'};
  out.model=model; out.at=now();
  store.db.prepare('insert into intel_log(uid,at,q,a) values(?,?,?,?)').run(user.id,out.at,Q,JSON.stringify(out));
  audit(store,{user,action:'intel.ask',target:'intel',detail:{q:Q.slice(0,200),certainty:out.certainty},ip:''});
  return out;
}
export function intelHistory(store,uid){intelSchema(store); return store.db.prepare('select id,at,q,a from intel_log where uid=? order by id desc limit 30').all(uid).map(r=>({id:r.id,at:r.at,q:r.q,a:r.a?JSON.parse(r.a):null}))}
// every half hour (and a minute after the server starts)
export function startRadar(store,{log=()=>{},push=null,cat=null,everyMs=30*60e3}={}){
  const go=()=>{try{const o=radarScan(store,{cat:cat&&cat(),log,push}); if(o.length)log(`radar: ${o.length} new finding(s): ${o.map(x=>x.key).join(', ')}`)}catch(e){log('radar failed: '+e.message)}};
  const t=setInterval(go,everyMs); t.unref&&t.unref(); setTimeout(go,60e3).unref(); return ()=>clearInterval(t)}
