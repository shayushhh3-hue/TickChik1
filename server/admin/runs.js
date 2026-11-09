// 9.11 "יומן ביצועים" (the owner: to follow in real time what the system did and what it did not): every run of a
// scheduled job (queued, started, done, failed, still running past its limit), every manual run from the management
// center (who asked), and every new version that went up (its commit message: what changed). Kept as the last 500
// entries. The plan of the day: for each job, how many runs were due since midnight (Israel time, from the schedule
// itself) against how many ran, so a run that never happened shows as missing. Alerts by push to the people with the
// "system" permission: a new version, a failure, and (when switched on) the end of each of the big jobs.
import {ilParts} from '../../shared/market.js';

export const JOB_HE={prices:'מחירים',nightly:'ריצת הלילה',morning:'מייל הבוקר',consist:'בדיקת עקביות',pressure:'מד לחץ',monthly:'דוח חודשי',weekly:'סיכום שבועי',backup:'גיבוי',
  restore:'בדיקת שחזור',smoke:'בדיקת עשן',research:'נתוני חברות',ecocal:'לוח כלכלי',insiders:'בעלי עניין',etf:'הרכב קרנות סל',earnings:'דוחות ביום הדוחות',bench:'מדדים להשוואה',
  ilsyms:'ניירות ישראליים',live:'התראות חיות',pxwatch:'בדיקת זרימת מחירים',news:'איסוף חדשות וקריאה',newsx:'קריאת כתבות',x:'פוסטים מ-X',quarterly:'דוח רבעוני','research-new':'נתונים לניירות חדשים'};
// the big ones: their end is worth a notification when the owner asks for it
export const BIG=new Set(['nightly','morning','research','backup','consist','pressure','restore','smoke','weekly','monthly','quarterly']);
const MAX=500;
const meta=(store,k,d)=>{try{const v=JSON.parse(store.getMeta(k)||'null'); return v==null?d:v}catch(e){return d}};
export const runAlerts=store=>({deploy:true,fail:true,done:false,...meta(store,'runAlerts',{})});

let PUSH=null, USERS=null, CANSYS=()=>false;
export function runsSetup({push=null,users=null,canSystem=()=>false}={}){PUSH=push; USERS=users; CANSYS=canSystem}
function alert(store,{title,body,tag}){if(!PUSH)return; try{const who=(USERS?USERS():store.users().map(u=>store.userById(u.id))).filter(u=>u&&CANSYS(u));
  for(const u of who)PUSH(store,u.id,{title,body:String(body||'').slice(0,300),url:'/admin#runs',tag},{log:()=>{}}).catch(()=>{})}catch(e){}}

let SEQ=0;
export function runLog(store,e,{now=new Date()}={}){
  try{const L=meta(store,'runLog',[]); if(!store.getMeta('runLogSince'))store.setMeta('runLogSince',JSON.stringify(now.toISOString())); const x={id:now.getTime().toString(36)+(SEQ++%1296).toString(36),at:now.toISOString(),...e};
    if(x.kind==='job'&&!x.he)x.he=JOB_HE[x.name]||x.name;
    // a job's end replaces its own "started" line, so the feed says once what happened to each run
    if(x.run&&x.state!=='started'&&x.state!=='queued'){const i=L.findIndex(y=>y.run===x.run&&(y.state==='started'||y.state==='queued')); if(i>=0)L.splice(i,1)}
    L.unshift(x); store.setMeta('runLog',JSON.stringify(L.slice(0,MAX)));
    const A=runAlerts(store);
    if(x.kind==='job'&&x.state==='failed'&&A.fail)alert(store,{title:`נכשל: ${x.he}`,body:x.note||'',tag:'mc-run-'+x.name});
    if(x.kind==='job'&&x.state==='late'&&A.fail)alert(store,{title:`עדיין רץ: ${x.he}`,body:x.note||'',tag:'mc-run-'+x.name});
    if(x.kind==='job'&&x.state==='done'&&A.done&&BIG.has(x.name))alert(store,{title:`בוצע: ${x.he}`,body:x.note||(x.ms?`${Math.round(x.ms/1000)} שניות`:''),tag:'mc-run-'+x.name});
    if(x.kind==='deploy'&&A.deploy)alert(store,{title:'גרסה חדשה עלתה',body:x.title+(x.lines&&x.lines.length?' · '+x.lines.slice(0,3).join(' · '):''),tag:'mc-deploy'});
    return x}catch(err){return null}}

// a new version: Railway gives the commit of the build (RAILWAY_GIT_COMMIT_SHA, RAILWAY_GIT_COMMIT_MESSAGE); written once per commit
export function deployOnStart(store,{env=process.env,version='',now=new Date()}={}){
  const sha=String(env.RAILWAY_GIT_COMMIT_SHA||'').slice(0,40), key=sha||version; if(!key)return null;
  if(meta(store,'lastDeploy',null)===key)return null; store.setMeta('lastDeploy',JSON.stringify(key));
  const msg=String(env.RAILWAY_GIT_COMMIT_MESSAGE||'').replace(/\r/g,''), parts=msg.split('\n').map(s=>s.trim()).filter(s=>s&&!/^(Co-Authored-By|Claude-Session):/i.test(s));
  const title=(parts[0]||'גרסה '+key.slice(0,7)).slice(0,200), lines=parts.slice(1).filter(s=>/^[-•*]/.test(s)).map(s=>s.replace(/^[-•*]\s*/,'').slice(0,200)).slice(0,12);
  return runLog(store,{kind:'deploy',name:key.slice(0,7),title,lines,branch:env.RAILWAY_GIT_BRANCH||null,state:'done'},{now})}

// the plan of the day: the runs due since midnight (Israel time), the ones that ran, failed or are missing
export function dayPlan(store,schedule,{now=new Date(),running=[]}={}){
  const P0=ilParts(now), L=meta(store,'runLog',[]), today=L.filter(x=>x.kind==='job'&&ilParts(new Date(x.at)).iso===P0.iso);
  const mid=now.getTime()-((P0.h*60+P0.min)*60e3)-now.getUTCSeconds()*1e3, since=Date.parse(meta(store,'runLogSince',''))||0;
  // before the log began nothing is counted as due; a slot of the last 3 minutes may still be in the queue
  const start=new Date(since?Math.max(mid,since+60e3):now.getTime()+60e3), pend=now.getTime()-3*60e3, out=[];
  for(const j of schedule){if(j.when.toString().includes('=>false'))continue;
    let due=0, pending=0, next=null; for(let t=start.getTime();t<=now.getTime()+24*36e5;t+=60e3){const d=new Date(t), p=ilParts(d); let ok=false; try{ok=!!j.when(p,d)}catch(e){} if(!ok)continue; if(t<=now.getTime()){due++; if(t>pend)pending++} else{next=d.toISOString(); break}}
    const mine=today.filter(x=>x.name===j.name&&x.kind==='job'&&!x.by), cnt=s=>mine.filter(x=>x.state===s).length, done=cnt('done'), failed=cnt('failed'), late=cnt('late'), skipped=cnt('skipped');
    const last=today.find(x=>x.name===j.name&&x.kind==='job')||null, run=running.includes(j.name);
    const missing=Math.max(0,due-pending-(done+failed+late+skipped+(run?1:0)));
    out.push({name:j.name,he:JOB_HE[j.name]||j.name,big:BIG.has(j.name),due,done,failed,late,skipped,running:run,missing,last:last?{at:last.at,state:last.state,ms:last.ms||null,note:last.note||null}:null,next})}
  return out.filter(x=>x.due||x.next||x.done||x.failed).sort((a,b)=>(b.failed+b.missing>0)-(a.failed+a.missing>0)||(b.big-a.big)||(a.he<b.he?-1:1))}

export function runsView(store,schedule,{now=new Date(),jobs=null}={}){
  const L=meta(store,'runLog',[]), st=jobs&&jobs.state?jobs.state():{running:[],queued:[]};
  const plan=dayPlan(store,schedule,{now,running:st.running||[]});
  const P0=ilParts(now), today=L.filter(x=>ilParts(new Date(x.at)).iso===P0.iso);
  return {at:now.toISOString(),since:L.length?L[L.length-1].at:null,running:st.running||[],queued:st.queued||[],plan,
    today:{done:today.filter(x=>x.kind==='job'&&x.state==='done').length,failed:today.filter(x=>x.kind==='job'&&x.state==='failed').length,
      missing:plan.reduce((a,x)=>a+x.missing,0),deploys:today.filter(x=>x.kind==='deploy').length,manual:today.filter(x=>x.by).length},
    feed:L.slice(0,200),alerts:runAlerts(store)}}
