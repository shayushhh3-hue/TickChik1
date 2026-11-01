// 1.11 TikChik Management Center: the figures. Each one is computed here from a table or a document the site really
// keeps, and carries where it came from (src), when that source last changed (at), and a note when it is partial or
// small. A figure with no source is null with the reason, never a number made up.
import fs from 'node:fs';
import {ilParts} from '../../shared/market.js';
import {countersSince} from './counter.js';
import {healthCheck} from '../health.js';

const DAY=864e5;
export const K_ANON=3;   // the fewest people a usage summary may rest on, so that it never shows one person's use
const iso=d=>ilParts(d).iso;
const today=()=>iso(new Date());
const addDays=(day,n)=>iso(new Date(Date.parse(day+'T12:00:00Z')+n*DAY));
export function rangeOf(q={}){
  const t=today(); let from, to=t, key=String(q.range||'30');
  if(key==='custom'&&/^\d{4}-\d{2}-\d{2}$/.test(q.from||'')&&/^\d{4}-\d{2}-\d{2}$/.test(q.to||'')){from=q.from<q.to?q.from:q.to; to=q.from<q.to?q.to:q.from}
  else{const n={today:1,'7':7,'30':30,'90':90}[key]||30; key=String(n===1?'today':n); from=addDays(t,-(n-1))}
  const len=Math.round((Date.parse(to)-Date.parse(from))/DAY)+1;
  return {key,from,to,len,prevFrom:addDays(from,-len),prevTo:addDays(from,-1)};
}
export const daysOf=(from,to)=>{const out=[]; for(let d=from;d<=to;d=addDays(d,1))out.push(d); return out};
const meta=(store,k)=>{try{return JSON.parse(store.getMeta(k)||'null')}catch(e){return null}};
const docOf=(u,name)=>u.role==='owner'?`${name}/main`:`data/users/${u.id}/${name}`;
const nowIso=()=>new Date().toISOString();

function activeIn(store,from,to){return store.db.prepare('select uid, count(*) days from active_days where day>=? and day<=? group by uid').all(from,to)}
function activeFirst(store){const r=store.db.prepare('select min(day) d from active_days').get(); return r&&r.d}

export function portfolioState(store,u){
  const d=store.getDoc(docOf(u,'portfolio')); const pos=d.exists&&d.data&&Array.isArray(d.data.positions)?d.data.positions.filter(p=>p&&p.sym&&+p.qty>0):[];
  return {has:pos.length>0,updatedAt:d.exists?d.updatedAt:null};
}

// ---- the executive dashboard ----
export function executive(store,q={}){
  const R=rangeOf(q), users=store.users(), now=nowIso(), t=today();
  const act=(a,b)=>activeIn(store,a,b), A=act(R.from,R.to), Ap=act(R.prevFrom,R.prevTo);
  const since=activeFirst(store), bf=meta(store,'activeBackfill');
  const actSrc={src:'ימי פעילות',how:`טבלת active_days: יום פעילות לכל משתמש, נרשם בשרת בכל בקשה (פעם בדקה לכל היותר).${bf?` הימים שלפני ${String(bf.at).slice(0,10).split('-').reverse().join('.')} שוחזרו מתיעוד השימוש, מצ׳יקו ומהכניסות לאתר.`:''}`,at:now};
  const M=[];
  M.push({k:'users',label:'משתמשים רשומים',value:users.length,src:'טבלת המשתמשים',how:'כל החשבונות באתר, כולל מושעים',at:now,go:'users',
    note:users.filter(u=>u.status==='suspended').length?`${users.filter(u=>u.status==='suspended').length} מושעים`:null});
  M.push({k:'dau',label:'פעילים היום',value:act(t,t).length,...actSrc,go:'users'});
  M.push({k:'wau',label:'פעילים ב-7 ימים',value:act(addDays(t,-6),t).length,...actSrc,go:'users'});
  M.push({k:'mau',label:'פעילים ב-30 ימים',value:act(addDays(t,-29),t).length,...actSrc,go:'users'});
  const created=u=>iso(new Date(u.created_at));
  const nu=users.filter(u=>created(u)>=R.from&&created(u)<=R.to).length, nup=users.filter(u=>created(u)>=R.prevFrom&&created(u)<=R.prevTo).length;
  M.push({k:'new',label:'משתמשים חדשים בטווח',value:nu,prev:nup,src:'תאריך ההרשמה',how:'משתמשים שנרשמו בטווח, מול התקופה הקודמת באותו אורך',at:now,go:'users'});
  const ret=A.filter(r=>r.days>=2).length;
  M.push({k:'returning',label:'חזרו יותר מיום אחד בטווח',value:ret,of:A.length,...actSrc,go:'product'});
  // retention: of the people active in the previous period of the same length, how many were active in this one
  const prevIds=new Set(Ap.map(r=>r.uid)), nowIds=new Set(A.map(r=>r.uid)), kept=[...prevIds].filter(id=>nowIds.has(id)).length;
  M.push({k:'retention',label:'שימור מול התקופה הקודמת',value:prevIds.size?kept:null,of:prevIds.size,unit:'of',...actSrc,
    note:!prevIds.size?'לא היו פעילים בתקופה הקודמת להשוות אליהם':prevIds.size<10?`מעט משתמשים (${prevIds.size}): כדאי לקרוא כמספרים, לא כאחוז`:null,churn:prevIds.size?prevIds.size-kept:null});
  {const S=users.map(u=>portfolioState(store,u)), at=S.map(s=>s.updatedAt).filter(Boolean).sort().pop()||null;
    M.push({k:'portfolios',label:'תיקים שהוזנו',value:S.filter(s=>s.has).length,of:users.length,src:'מסמכי התיק',how:'נבדק רק אם קיים תיק עם ניירות ומתי עודכן. התוכן לא נקרא לכאן',at,go:'users'})}
  {const r=store.db.prepare('select coalesce(sum(calls),0) c, coalesce(sum(quick),0) q from ai_usage where day>=? and day<=?').get(R.from,R.to), p=store.db.prepare('select coalesce(sum(calls),0) c from ai_usage where day>=? and day<=?').get(R.prevFrom,R.prevTo);
    M.push({k:'analyses',label:'פניות לצ׳יקו וקריאות דוחות',value:r.c,prev:p.c,src:'מונה הפניות של צ׳יקו',how:'טבלת ai_usage: כל פנייה לצ׳יקו וכל קריאת דוח נספרות בשרת',at:now,note:r.q?`ועוד ${r.q} קריאות מהירות של דוחות`:null,go:'ai'})}
  {const C=[...countersSince(store,'push',R.from,R.to),...countersSince(store,'mail',R.from,R.to)], first=meta(store,'countersSince');
    M.push({k:'alerts',label:'התראות והודעות שנשלחו',value:C.reduce((a,r)=>a+r.n,0),src:'מונה השליחות',how:'כל התראה לטלפון וכל מייל שיצאו בפועל נספרים בשרת',at:now,note:first?`נספר מ-${String(first).slice(0,10).split('-').reverse().join('.')}; לפני כן לא נשמר מונה`:null,
      parts:{push:C.filter(r=>r.key.startsWith('push')||r.key==='').reduce((a,r)=>a+(r.key.startsWith('fail')?0:r.n),0)}})}
  {const N=meta(store,'newsxStatus'), n=meta(store,'newsStatus');
    M.push({k:'news',label:'כתבות שנאספו בריצה האחרונה',value:n?n.items:null,src:'איסוף החדשות',how:'הסטטוס שהריצה האחרונה של איסוף הכתבות כתבה',at:n&&n.at||null,note:N?`צ׳יקו: ${N.read||0} נקראו, ${N.waiting||0} ממתינות`:null,go:'health'})}
  {const h=healthCheck(store), items=h.items||[], bad=items.filter(i=>i.state==='bad'), warn=items.filter(i=>i.state==='warn');
    M.push({k:'health',label:'מקורות נתונים תקינים',value:items.filter(i=>i.state==='ok').length,of:items.filter(i=>i.state!=='off').length,src:'בדיקת התקינות',how:'אותה בדיקה ששולחת התראה במייל: כל מקור מול הזמן שמותר לו לא לעבוד',at:h.at,go:'health',state:bad.length?'bad':warn.length?'warn':'ok'});
    M.push({k:'issues',label:'תקלות פתוחות',value:bad.length+warn.length,src:'בדיקת התקינות',how:'תקלה: מקור שלא עבד יותר מהזמן המותר לו. אזהרה: ריצה אחת נכשלה',at:h.at,go:'health',
      note:[...bad,...warn].slice(0,3).map(i=>i.name).join(' · ')||null,state:bad.length?'bad':warn.length?'warn':'ok'})}
  {const c=aiCost(store,R.from,R.to);
    M.push({k:'aicost',label:'עלות AI בטווח',value:c.total,unit:'usd',src:'טוקנים × מחירים',how:'הטוקנים של כל מודל (ai_models) כפול המחירים שהוזנו במסך מנועי AI',at:now,note:c.note,go:'ai'});
    M.push({k:'infra',label:'עלות שרתים ותשתית',value:null,src:'החיוב של Railway (לא מחובר)',at:null,note:'לא מחובר: אין חיבור לחיוב של Railway. אפשר להזין ידנית בשלב העסקי'})}
  // the trends: the people active and the AI use per day, the users over time
  const D=daysOf(R.len>120?addDays(R.to,-119):R.from,R.to);
  const actDay=Object.fromEntries(store.db.prepare('select day, count(*) n from active_days where day>=? and day<=? group by day').all(D[0],R.to).map(r=>[r.day,r.n]));
  const aiDay=Object.fromEntries(store.db.prepare('select day, sum(calls) n from ai_usage where day>=? and day<=? group by day').all(D[0],R.to).map(r=>[r.day,r.n]));
  const cum=D.map(d=>users.filter(u=>created(u)<=d).length);
  return {range:R,metrics:M,series:{days:D,active:D.map(d=>actDay[d]||0),ai:D.map(d=>aiDay[d]||0),users:cum},activeSince:since,at:now};
}

// ---- AI cost: the prices are the owner's input (per million tokens), kept in meta; without them there is no cost ----
export function aiPrices(store){return meta(store,'aiPrices')||{}}
export function aiCost(store,from,to){
  const P=aiPrices(store), rows=store.db.prepare('select model, sum(calls) calls, sum(input) input, sum(output) output from ai_models where day>=? and day<=? group by model').all(from,to);
  const by=rows.map(r=>{const p=P[r.model]; const cost=p&&p.in!=null&&p.out!=null?(r.input*p.in+r.output*p.out)/1e6:null; return {...r,cost}});
  const missing=by.filter(r=>r.cost==null&&(r.input||r.output)).map(r=>r.model);
  const total=by.length&&!missing.length?by.reduce((a,r)=>a+(r.cost||0),0):null;
  return {by,total,missing,note:!by.length?'אין שימוש בטווח':missing.length?`חסרים מחירים ל: ${missing.join(', ')} (מזינים במסך "מנועי AI ועלויות")`:null};
}

// ---- the users ----
export function usersList(store){
  const users=store.db.prepare('select id,email,name,role,created_at,must_change,status,status_note,last_seen,perms,totp_on from users order by created_at').all();
  const t=today(), from=addDays(t,-29), act=Object.fromEntries(activeIn(store,from,t).map(r=>[r.uid,r.days]));
  const ai=Object.fromEntries(store.db.prepare('select uid, sum(calls) c from ai_usage where day>=? group by uid').all(from).map(r=>[r.uid,r.c]));
  const login=Object.fromEntries(store.db.prepare('select uid, max(at) at from auth_events where ok=1 group by uid').all().map(r=>[r.uid,r.at]));
  const sess=Object.fromEntries(store.db.prepare('select uid, max(created_at) at from sessions group by uid').all().map(r=>[r.uid,r.at]));
  return users.map(u=>{const pf=portfolioState(store,u); return {id:u.id,email:u.email,name:u.name||'',role:u.role,status:u.status||'active',statusNote:u.status_note||'',created:u.created_at,lastSeen:u.last_seen||null,
    lastLogin:[login[u.id],sess[u.id]].filter(Boolean).sort().pop()||null,twofa:!!u.totp_on,mustChange:!!u.must_change,portfolio:pf,active30:act[u.id]||0,ai30:ai[u.id]||0,perms:u.perms?JSON.parse(u.perms):null}})}

// ---- product intelligence ----
// the parts of the page, read from the page itself: the tabs and the sections that the page counts when they are seen
let CAT=null;
export function catalog(file){
  if(CAT&&CAT.file===file)return CAT; const out={tabs:{},secs:{}}; let h='';
  try{h=fs.readFileSync(file,'utf8')}catch(e){return CAT={file,...out}}
  const txt=s=>s.replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ').trim();
  for(const m of h.matchAll(/<button[^>]*\bdata-tab="([a-z0-9_-]+)"[^>]*>([\s\S]{0,300}?)<\/button>/g)){const t=txt(m[2]); if(t&&!out.tabs[m[1]])out.tabs[m[1]]=t.slice(0,40)}
  for(const m of h.matchAll(/<section[^>]*aria-labelledby="([A-Za-z0-9_-]+)"/g)){const id=m[1], hm=h.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]{0,200}?)</h[1-4]>`)); out.secs[id]=hm?txt(hm[1]).slice(0,60)||id:id}
  return CAT={file,...out};
}
const USE_NAME={chiko:'צ׳יקו',sec:'דף של נייר',news:'מה חדש',tour:'סיור באתר','export:pdf':'הורדת דוח PDF','export:xlsx':'הורדת אקסל','view:calm':'מעבר לתצוגה פשוטה','view:full':'מעבר לתצוגה מלאה'};
export function useLabel(k,cat){const i=k.indexOf(':'), t=k.slice(0,i), id=k.slice(i+1);
  if(t==='tab')return {kind:'screen',name:(cat.tabs[id]||id)}; if(t==='s')return {kind:'part',name:cat.secs[id]||id}; if(t==='go')return {kind:'action',name:'חיפוש "לאן להגיע?": '+id};
  return {kind:'action',name:USE_NAME[k]||k}}

// each person's own usage document (kept by the page, 90 days), summed over everybody: totals and how many people,
// never who. A summary needs K_ANON people active in the range, or it would show one person's use; until then the
// viewer sees only their own
export function product(store,q={},{viewer,pageFile}){
  const R=rangeOf(q), cat=catalog(pageFile), users=store.users();
  const contrib=new Set(activeIn(store,R.from,R.to).map(r=>r.uid));
  const ok=contrib.size>=K_ANON, pool=ok?users:users.filter(u=>u.id===viewer.id);
  const sum=(a,b)=>{const T={}, people={}, daysUsed={}; for(const u of pool){const d=store.getDoc(docOf(u,'usage')); const days=d.exists&&d.data&&d.data.days||{};
      const mine=new Set(); for(const [day,D] of Object.entries(days)){if(day<a||day>b)continue; for(const [k,n] of Object.entries(D||{})){T[k]=(T[k]||0)+(+n||0); mine.add(k); (daysUsed[k]=daysUsed[k]||[]).push(u.id+'|'+day)}}
      for(const k of mine)people[k]=(people[k]||0)+1}
    return {T,people,daysUsed}};
  const C=sum(R.from,R.to), P=sum(R.prevFrom,R.prevTo);
  const rows=Object.keys({...C.T,...P.T}).map(k=>{const L=useLabel(k,cat), du=C.daysUsed[k]||[], perUser={}; for(const x of du){const u=x.split('|')[0]; perUser[u]=(perUser[u]||0)+1}
    const rep=Object.values(perUser).filter(n=>n>=2).length;
    return {k,...L,n:C.T[k]||0,prev:P.T[k]||0,people:ok?C.people[k]||0:null,repeat:ok?rep:null}}).sort((a,b)=>b.n-a.n);
  const seen=new Set(rows.filter(r=>r.n>0).map(r=>r.k));
  const never=[...Object.entries(cat.tabs).map(([id,n])=>({k:'tab:'+id,kind:'screen',name:n})),...Object.entries(cat.secs).map(([id,n])=>({k:'s:'+id,kind:'part',name:n}))].filter(x=>!seen.has(x.k));
  // the moves between the screens and the time on each (counted by the page without any person: a count per cohort)
  const nav=ok?countersSince(store,'nav',R.from,R.to):[], dwell=ok?countersSince(store,'dwell',R.from,R.to):[];
  const moves={}; for(const r of nav)moves[r.key]=(moves[r.key]||0)+r.n;
  const time={}; for(const r of dwell){const T=time[r.key]||(time[r.key]={all:0,new:0,vet:0}); T.all+=r.n; if(r.cohort==='new'||r.cohort==='vet')T[r.cohort]+=r.n}
  const navFirst=store.db.prepare("select min(day) d from counters where kind='nav'").get();
  return {range:R,ok,k:K_ANON,contributors:contrib.size,own:!ok,rows,never,
    moves:Object.entries(moves).map(([k,n])=>{const [a,b]=k.split('>'); return {from:cat.tabs[a]||a,to:cat.tabs[b]||b,n}}).sort((a,b)=>b.n-a.n).slice(0,30),
    time:Object.entries(time).map(([k,v])=>({tab:cat.tabs[k]||k,min:Math.round(v.all/60),newMin:Math.round(v.new/60),vetMin:Math.round(v.vet/60)})).sort((a,b)=>b.min-a.min),
    funnel:ok?funnel(store,users):null, navSince:navFirst&&navFirst.d||null,
    src:'מסמך השימוש של כל משתמש (מסכים וחלקים שנראו בפועל, לכל יום), בסיכום בלי שמות; המעברים והזמן: מונה בלי זהות, לפי ותק',at:nowIso()};
}
// the steps of a new account (the same six the home screen shows), counted over the users: how many reached each
export function funnel(store,users){
  const steps=[{k:'acct',l:'נרשמו'},{k:'pf',l:'הזינו תיק'},{k:'cost',l:'השלימו מחירי קנייה'},{k:'targets',l:'קבעו יעדי הקצאה'},{k:'plan',l:'בנו תוכנית הפקדה'},{k:'goal',l:'קבעו יעד ואופק'},{k:'alerts',l:'הגדירו התראות'}];
  const n=Object.fromEntries(steps.map(s=>[s.k,0]));
  for(const u of users){n.acct++; const P=store.getDoc(docOf(u,'portfolio')).data||{}, S=store.getDoc(docOf(u,'settings')).data||{}, PL=store.getDoc(docOf(u,'plan')).data||{};
    const pos=(P.positions||[]).filter(p=>p&&p.sym&&+p.qty>0); if(!pos.length)continue; n.pf++;
    if(pos.some(p=>+p.costIls>0||+p.cost>0||+p.costEst>0))n.cost++;
    if(Object.values(S.targets||{}).reduce((a,v)=>a+(+v||0),0)>0)n.targets++;
    if((PL.items||[]).length||((PL.idx&&PL.idx.items)||[]).length)n.plan++;
    if(+S.goal>0&&+S.years>0)n.goal++;
    if((S.pulse&&Object.keys(S.pulse).length)||(S.mail&&Object.values(S.mail).some(Boolean))||(S.liveAl&&Object.keys(S.liveAl).length))n.alerts++}
  return steps.map(s=>({...s,n:n[s.k]}));
}
