// 1.11 TikChik Management Center, stage C: the operations. What the server measures about itself (the time and the
// errors of its own requests, a heartbeat a minute, the downtime between two heartbeats, the memory, the disk), the
// incidents (opened when something stops, closed when it works again, with an owner and a resolution), the alerts to
// the management, and the figures of the news system, the AI engines and the security posture. Facts about the site,
// never about anybody's portfolio; the personal alerts are counted, never read out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ilParts} from '../../shared/market.js';
import {bump, countersSince} from './counter.js';
import {healthCheck} from '../health.js';
import {audit, auditVerify, permsOf, can} from './core.js';
import {aiPrices} from './metrics.js';
import {CONSIST_DOC} from '../consist.js';

const meta=(store,k,d=null)=>{try{return JSON.parse(store.getMeta(k)||'null')??d}catch(e){return d}};
const today=()=>ilParts(new Date()).iso;
const sum=L=>L.reduce((a,r)=>a+(+r.n||0),0);

export function opsSchema(store){
  store.db.exec(`create table if not exists incidents(id integer primary key autoincrement, key text not null, kind text not null, name text not null, sev text not null,
      opened_at text not null, closed_at text, status text not null default 'open', note text, owner text, resolution text, auto integer not null default 1, updated_at text not null);
    create index if not exists inc_open on incidents(status, key);`)}

// ---- every API request: how long it took and whether the server failed it (5xx), per area (the path's first part) ----
export function reqMeter(app){
  app.use('/api',(req,res,next)=>{if(req.path==='/db/stream')return next(); const t0=process.hrtime.bigint(), g=(req.path.split('/')[1]||'root').slice(0,16).replace(/[^a-z0-9_-]/gi,'');   // the area now: after the answer the path is the full one again
    res.on('finish',()=>{const ms=Number(process.hrtime.bigint()-t0)/1e6;
      bump('rt_n',g,1); bump('rt_ms',g,Math.round(ms)); if(res.statusCode>=500)bump('rt_5xx',g,1); if(ms>5000)bump('rt_slow',g,1)});
    next()})}

// ---- the server's own pulse: a heartbeat a minute; a gap between two (a deploy, a crash, a restart) is downtime ----
export function startOps(store,{log=()=>{},send=null,push=null,users=null,everyMs=60e3,checkMs=5*60e3}={}){
  opsSchema(store);
  const last=meta(store,'hbAt'), now=Date.now();
  const boots=meta(store,'boots',[]); boots.unshift(new Date(now).toISOString()); store.setMeta('boots',JSON.stringify(boots.slice(0,50)));
  if(last){const gap=(now-Date.parse(last))/6e4; if(gap>3){const min=Math.round(gap);
    store.db.prepare("insert into incidents(key,kind,name,sev,opened_at,closed_at,status,note,resolution,auto,updated_at) values('downtime','uptime','השרת לא היה זמין',?,?,?,'closed',?,?,1,?)")
      .run(min>=15?'bad':'warn',last,new Date(now).toISOString(),`${min} דקות בלי דופק (עדכון גרסה, הפעלה מחדש או נפילה)`,'השרת עלה מחדש',new Date(now).toISOString());
    bump('down_min','',min); log(`ops: ${min} minutes without a heartbeat before this start`)}}
  const beat=()=>{bump('hb','',1); store.setMeta('hbAt',JSON.stringify(new Date().toISOString()))};
  beat(); const t1=setInterval(beat,everyMs); t1.unref&&t1.unref();
  const t2=setInterval(()=>{try{checkIncidents(store,{send,push,users,log})}catch(e){log('ops: incidents check failed: '+e.message)}},checkMs); t2.unref&&t2.unref();
  setTimeout(()=>{try{checkIncidents(store,{send,push,users,log})}catch(e){}},30e3).unref();
  return ()=>{clearInterval(t1);clearInterval(t2)};
}

// ---- incidents: opened when a source turns bad or a measure crosses its line, closed by itself when it is fine again ----
const RULES=[
  // errors of the server's own requests today: 20 or more is an incident
  {key:'errors',kind:'errors',name:'שגיאות שרת (5xx)',check:s=>{const n=sum(countersSince(s,'rt_5xx',today(),today())); return n>=20?{sev:n>=100?'bad':'warn',note:`${n} בקשות נכשלו בשרת היום`}:null}},
  // Claude failing: at least 5 calls today in a feature and a third or more failed
  {key:'ai',kind:'ai',name:'מנועי ה-AI נכשלים',check:s=>{const R=countersSince(s,'ai_res',today(),today()), by={};
    for(const r of R){const [f,o]=r.key.split('|'); const x=by[f]||(by[f]={ok:0,err:0}); if(o==='ok')x.ok+=r.n; else if(o!=='err:cancelled')x.err+=r.n}
    const bad=Object.entries(by).filter(([,x])=>x.ok+x.err>=5&&x.err/(x.ok+x.err)>=1/3); return bad.length?{sev:bad.some(([,x])=>x.err/(x.ok+x.err)>=.6)?'bad':'warn',note:bad.map(([f,x])=>`${FEAT_HE[f]||f}: ${x.err} מתוך ${x.ok+x.err} נכשלו`).join(' · ')}:null}},
  // the notifications: half or more of the pushes today failed, at least 5
  {key:'push',kind:'alerts',name:'התראות לטלפון נכשלות',check:s=>{const R=countersSince(s,'push',today(),today()), ok=sum(R.filter(r=>r.key==='sent')), f=sum(R.filter(r=>r.key==='fail'));
    return ok+f>=5&&f/(ok+f)>=.5?{sev:'warn',note:`${f} מתוך ${ok+f} התראות לא הגיעו`}:null}},
  // 8.11: the nightly consistency check found the same figure differing between two places (counts only; the details are
  // on the health screen, the owner's own in full, a partner's as kinds)
  {key:'consist',kind:'data',name:'פערים בין מספרים באתר',check:s=>{const d=s.getDoc(CONSIST_DOC); const D=d.exists&&d.data; if(!D||!D.runs)return null;
    const bad=D.runs.filter(r=>r.bad>0), who=bad.length?`ב-${bad.length===1?(bad[0].owner?'התיק של בעל האתר':'תיק של שותף'):bad.length+' תיקים'}`:'';
    return D.bad>0?{sev:'bad',note:`${D.bad} פערים חמורים ${who} (מתוך ${D.n} ממצאים בבדיקה של ${new Date(D.at).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem'})})`}:D.n>0?{sev:'warn',note:`${D.n} ממצאים לבדיקה, אף אחד לא חמור`}:null}}];
export const FEAT_HE={chat:'צ׳יקו (שיחה)',files:'קריאת דוחות',files_quick:'קריאה מהירה של דוחות',newsx:'קריאת כתבות',brief:'תמונת המצב היומית',story:'הסיפור מאחורי הכותרת',explain:'הסבר דוחות של חברות',intel:'TikChik Intelligence',world:'התקציר העולמי',chico_q:'צ׳יקו: שאלה חופשית',chico_explain:'צ׳יקו: הסבר התיק',chico_analyze:'צ׳יקו: ניתוח התיק',chico_day:'צ׳יקו: סיכום יומי',chico_focus:'צ׳יקו: שאלה על פריט פתוח'};
export function checkIncidents(store,{send=null,push=null,users=null,log=()=>{},now=new Date()}={}){
  opsSchema(store); const iso=now.toISOString(), opened=[];
  const openOf=key=>store.db.prepare("select * from incidents where key=? and status in ('open','ack') order by id desc limit 1").get(key);
  const open=(key,kind,name,sev,note)=>{const o=openOf(key);
    if(o){if(o.sev!==sev||o.note!==note)store.db.prepare('update incidents set sev=?, note=?, updated_at=? where id=?').run(o.sev==='bad'?'bad':sev,note,iso,o.id); return}
    const r=store.db.prepare('insert into incidents(key,kind,name,sev,opened_at,status,note,auto,updated_at) values(?,?,?,?,?,?,?,1,?)').run(key,kind,name,sev,iso,'open',note,iso); opened.push({id:r.lastInsertRowid,key,name,sev,note})};
  const close=(key,res)=>{const o=openOf(key); if(o&&o.auto)store.db.prepare("update incidents set status='closed', closed_at=?, resolution=coalesce(resolution,?), updated_at=? where id=?").run(iso,res,iso,o.id)};
  // the data sources: the same check that mails the owner (server/health.js): bad = an incident, ok again = closed
  const H=healthCheck(store,{now});
  for(const i of H.items){if(i.state==='bad')open('src:'+i.key,'source',i.name,'bad',i.note||''); else if(i.state==='ok')close('src:'+i.key,'חזר לעבוד')}
  for(const R of RULES){const r=R.check(store); if(r)open(R.key,R.kind,R.name,r.sev,r.note); else close(R.key,'חזר לטווח התקין')}
  if(opened.length)notify(store,opened,{send,push,users,log});
  return opened;
}
// the alert to the management: a notification to the phones of everyone with "system" (and an e-mail to the owner when
// the management center's own switch is on and mail is set up). Once in six hours per kind of incident
function notify(store,list,{send,push,users,log}){
  const cfg=meta(store,'mcAlerts',{push:true,mail:false}), sent=meta(store,'mcAlertSent',{}), now=Date.now();
  const due=list.filter(x=>x.sev==='bad'&&!(sent[x.key]&&now-Date.parse(sent[x.key])<6*36e5)); if(!due.length)return;
  for(const x of due)sent[x.key]=new Date(now).toISOString(); store.setMeta('mcAlertSent',JSON.stringify(sent));
  const title='מרכז הניהול: '+(due.length===1?due[0].name:`${due.length} תקלות חדשות`), body=due.map(x=>`${x.name}${x.note?': '+x.note:''}`).join(' · ').slice(0,280);
  const who=(users?users():store.users().map(u=>store.userById(u.id))).filter(u=>u&&can(u,'system'));
  if(cfg.push&&push)for(const u of who)push(store,u.id,{title,body,url:'/admin#incidents',tag:'mc-incident'},{log}).catch(()=>{});
  if(cfg.mail&&send)send({subject:'TikChik – '+title,text:body+'\n\nלפרטים: מרכז הניהול, תקלות.',html:`<p dir="rtl"><b>${title.replace(/</g,'&lt;')}</b></p><p dir="rtl">${body.replace(/</g,'&lt;')}</p><p dir="rtl">לפרטים: מרכז הניהול, תקלות.</p>`}).catch(()=>{});
  log(`ops: management alerted (${due.map(x=>x.key).join(', ')})`);
}
export function incidents(store,{days=30}={}){opsSchema(store); const from=new Date(Date.now()-days*864e5).toISOString();
  return store.db.prepare("select * from incidents where status!='closed' or opened_at>=? order by (status='closed'), opened_at desc limit 300").all(from)}
export function incidentUpdate(store,user,id,{status,owner,note,resolution},ip){opsSchema(store);
  const o=store.db.prepare('select * from incidents where id=?').get(+id); if(!o)throw new Error('not_found');
  const next={status:['open','ack','closed'].includes(status)?status:o.status,owner:owner===undefined?o.owner:(owner||null),note:note===undefined?o.note:String(note).slice(0,500),resolution:resolution===undefined?o.resolution:String(resolution).slice(0,500)};
  if(next.owner&&!store.userById(next.owner))throw new Error('not_found');
  const iso=new Date().toISOString();
  // a person's hand on it: it no longer closes by itself
  store.db.prepare('update incidents set status=?, owner=?, note=?, resolution=?, closed_at=?, auto=0, updated_at=? where id=?').run(next.status,next.owner,next.note,next.resolution,next.status==='closed'?(o.closed_at||iso):null,iso,o.id);
  audit(store,{user,action:'incident.update',target:'inc:'+o.id,detail:{name:o.name,before:{status:o.status,owner:o.owner},after:{status:next.status,owner:next.owner},resolution:next.resolution||undefined},ip});
  return store.db.prepare('select * from incidents where id=?').get(o.id)}

// ---- the system's health, extended ----
export function systemOps(store,{from,to,dataDir,dbFile}){
  const D=countersSince, days=Math.round((Date.parse(to)-Date.parse(from))/864e5)+1;
  const hb=sum(D(store,'hb',from,to)), first=store.db.prepare("select min(day) d from counters where kind='hb'").get().d;
  // availability over the minutes since the first heartbeat in the range (not before the counting began)
  const start=first&&first>from?first:from, mins=Math.max(1,Math.round((Math.min(Date.now(),Date.parse(to+'T23:59:59+02:00'))-Date.parse(start+'T00:00:00+02:00'))/6e4));
  const firstHb=meta(store,'boots',[]).slice(-1)[0]||null;
  const avail=hb?Math.min(100,100*hb/Math.min(mins,(Date.now()-Date.parse(firstHb||start))/6e4||mins)):null;
  const areas={}; for(const [k,f] of [['rt_n','n'],['rt_ms','ms'],['rt_5xx','err'],['rt_slow','slow']])for(const r of D(store,k,from,to)){const a=areas[r.key]||(areas[r.key]={area:r.key,n:0,ms:0,err:0,slow:0}); a[f]+=r.n}
  const A=Object.values(areas).map(a=>({...a,avg:a.n?Math.round(a.ms/a.n):null})).sort((a,b)=>b.n-a.n);
  const byDay={}; for(const k of ['rt_n','rt_5xx'])for(const r of D(store,k,from,to)){const x=byDay[r.day]||(byDay[r.day]={n:0,err:0}); x[k==='rt_n'?'n':'err']+=r.n}
  const mem=process.memoryUsage(); let disk=null, dbSize=null;
  try{const s=fs.statfsSync(dataDir); disk={free:s.bavail*s.bsize,total:s.blocks*s.bsize}}catch(e){}
  try{dbSize=fs.statSync(dbFile).size+(fs.existsSync(dbFile+'-wal')?fs.statSync(dbFile+'-wal').size:0)}catch(e){}
  return {range:{from,to,days},availability:avail==null?null:Math.round(avail*100)/100,hbSince:first,downMin:sum(D(store,'down_min',from,to)),boots:meta(store,'boots',[]).filter(b=>b.slice(0,10)>=from).length,
    lastBoot:meta(store,'boots',[])[0]||null,areas:A,byDay:Object.entries(byDay).map(([day,x])=>({day,...x})).sort((a,b)=>a.day<b.day?-1:1),
    res:{rss:mem.rss,heap:mem.heapUsed,uptime:Math.round(process.uptime()),load:os.loadavg()[0],cpus:os.cpus().length,memTotal:os.totalmem(),disk,dbSize,node:process.version},
    src:'מדידה של השרת עצמו: כל בקשה (זמן ושגיאות), דופק בכל דקה, הפעלות',at:new Date().toISOString()};
}

// ---- the news system ----
const NOISE=t=>String(t||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function newsOps(store){
  const N=store.getDoc('research/news'), X=store.getDoc('research/newsx'), NS=meta(store,'newsStatus'), XS=meta(store,'newsxStatus'), XT=meta(store,'xStatus');
  const items=(N.data&&N.data.items)||[], gen=(X.data&&X.data.gen)||[], by=(X.data&&X.data.by)||{};
  const all=items.map(a=>({...a,src:'co'})).concat(gen.map(a=>({...a,src:'gen'})));
  // duplicates: the same headline from two links; without a source: no link or no publisher
  const seen=new Map(); let dup=0; for(const a of all){const k=NOISE(a.title); if(!k)continue; if(seen.has(k))dup++; else seen.set(k,1)}
  const noSrc=all.filter(a=>!a.link||!/^https?:\/\//.test(a.link)||!a.pub).length;
  const pubs={}; for(const a of all){const p=a.pub||'(ללא מו״ל)'; pubs[p]=(pubs[p]||0)+1}
  const R=Object.values(by), ai=R.filter(x=>!x.rules), rules=R.filter(x=>x.rules);
  const day3=new Date(Date.now()-3*864e5).toISOString();
  const evs=new Set(R.filter(x=>x.ev&&(x.at||'')>=day3).map(x=>x.ev));
  // a reading that found no company, no sector and no theme: the link from the event to the market was not found
  const unlinked=ai.filter(x=>!(x.aff||[]).length&&!(x.sectors||[]).length&&!(x.themes||[]).length).length;
  const universe=new Set(Object.keys(((store.getDoc('quotes/latest').data)||{}).prices||{}));
  const unknownSym=ai.reduce((a,x)=>a+(x.aff||[]).filter(f=>universe.size&&!universe.has(f.sym)).length,0);
  // the personal alerts: counted over everybody, never shown one by one here
  const users=store.users(); let pa=0, crit=0, imp=0, upd=0, withAl=0, fresh24=0, pulseAt=null; const d1=new Date(Date.now()-864e5).toISOString();
  // 4.11: the news load, by day over two weeks: the alerts made, the important ones, per person who has any (summed over
  // everybody, never one person's), against the two weeks' average
  const LD={}, ilD=t=>{try{return new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})}catch(e){return ''}}, d14=new Date(Date.now()-14*864e5).toISOString();
  for(const u of users){const d=store.getDoc(u.role==='owner'?'alerts/pulse':`data/users/${u.id}/pulse`); if(!d.exists)continue; const L=(d.data&&d.data.items)||[]; if(L.length)withAl++;
    for(const a of L){const t=a.at||a.up||''; if(t<d14)continue; const k=ilD(t), o=LD[k]||(LD[k]={d:k,n:0,imp:0,mkt:0}); o.n++; if(a.lv==='crit'||a.lv==='imp')o.imp++; if(a.kind==='mkt')o.mkt++}
    pa+=L.length; for(const a of L){if(a.lv==='crit')crit++; else if(a.lv==='imp')imp++; else upd++; if((a.up||a.at||'')>=d1)fresh24++} pulseAt=[pulseAt,d.updatedAt].filter(Boolean).sort().pop()}
  const sources=[{k:'yahoo',name:'כתבות על הניירות (Yahoo / Finnhub)',ok:NS?NS.ok:null,of:NS?NS.of:null,fail:NS?NS.fail:null,items:NS?NS.items:null,first:NS&&NS.first,at:NS&&NS.at,stopped:NS&&NS.stopped}];
  if(NS&&NS.il)sources.push({k:'globes',name:'גלובס (מניות תל אביב)',ok:NS.il.ok,of:NS.il.of,fail:NS.il.fail,items:NS.il.items,first:NS.il.first,at:NS.at,off:!!NS.il.off});
  if(NS&&NS.more)for(const [k,v] of Object.entries(NS.more))if(v&&typeof v==='object'&&!Array.isArray(v)&&k!=='first')sources.push({k,name:{sec:'דיווחי החברות ל-SEC',gnews:'מו״לים מובילים (Google News)',fed:'הפדרל ריזרב'}[k]||k,ok:v.ok,fail:v.fail,items:v.items,first:v.first,at:NS.at});
  sources.push({k:'general',name:'חדשות כלליות (Finnhub + הפד)',items:gen.length,at:XS&&XS.at,ok:null,note:XS?`${XS.gen||0} חדשות בריצה האחרונה`:null});
  sources.push({k:'x',name:'פוסטים מ-X',off:!process.env.X_BEARER_TOKEN,ok:XT?XT.ok:null,items:XT?XT.items:null,at:XT&&XT.at,first:XT&&(XT.first||XT.stopped)});
  // 4.11: an error note starts with the ticker that failed ("FORTY: HTTP 429"); a ticker can tell whose portfolio it is
  for(const x of sources)if(x.first)x.first=String(x.first).replace(/^[A-Z0-9.\-^=]{1,12}:\s*/,'נייר אחד: ');
  return {at:new Date().toISOString(),sources,
    articles:{total:all.length,company:items.length,general:gen.length,dup,noSrc,pubs:Object.entries(pubs).map(([p,n])=>({p,n})).sort((a,b)=>b.n-a.n).slice(0,15),newest:all.map(a=>a.at||a.seen).filter(Boolean).sort().pop()||null,updatedAt:N.updatedAt||null},
    reading:{total:R.length,ai:ai.length,rules:rules.length,waiting:XS?XS.waiting:null,read:XS?XS.read:null,fail:XS?XS.fail:null,first:XS&&XS.first,stopped:XS&&XS.stopped,at:XS&&XS.at,seconds:XS&&XS.seconds,keyOff:!process.env.ANTHROPIC_API_KEY},
    impact:{events3:evs.size,withCompanies:ai.filter(x=>(x.aff||[]).length).length,unlinked,unknownSym,crit:R.filter(x=>x.level==='crit').length,imp:R.filter(x=>x.level==='imp').length},
    personal:{alerts:pa,crit,imp,upd,users:withAl,of:users.length,fresh24,at:pulseAt,load:(()=>{const days=[]; for(let i=13;i>=0;i--){const k=ilD(Date.now()-i*864e5), o=LD[k]||{d:k,n:0,imp:0,mkt:0}; days.push({...o,perUser:withAl?Math.round(o.n/withAl*10)/10:null,impPerUser:withAl?Math.round(o.imp/withAl*10)/10:null})}
      const prev=days.slice(0,13), avg=prev.reduce((t,x)=>t+(x.perUser||0),0)/13, now=days[13].perUser||0, r=avg>0?now/avg:now>0?2:1;
      const level=now===0&&avg<0.5?'calm':r<0.6?'calm':r<1.4?'normal':r<2.2?'busy':'storm', flood=(days[13].impPerUser||0)>8;
      return {days,todayPerUser:now,avgPerUser:Math.round(avg*10)/10,ratio:Math.round(r*10)/10,level,flood,note:'התראות שנוצרו בכל יום, מחולקות במספר המשתמשים שיש להם התראות; סיכום של כולם יחד, לא של אדם אחד'}})(),pushSent:sum(countersSince(store,'push',today(),today()).filter(r=>r.key==='sent'))}};
}

// ---- the AI engines ----
const OVER=/בוודאות|בטוח ש|ללא ספק|אין ספק|יזנק|תזנק|תקרוס|יקרוס|ימריא|תמריא|מומלץ לקנות|כדאי לקנות|כדאי למכור|למכור עכשיו|לקנות עכשיו|יעד מחיר של|הזדמנות שאסור לפספס/;
const NUMS=s=>(String(s||'').match(/\d[\d.,]*\d|\d/g)||[]).map(x=>x.replace(/[.,]$/,'')).filter(x=>x.replace(/\D/g,'').length>=2);
export function aiQuality(store,{n=60}={}){
  const X=store.getDoc('research/newsx').data||{}, N=store.getDoc('research/news').data||{};
  const art=new Map(); for(const a of (N.items||[]))if(a&&a.link)art.set(newsKey(a.link),a); for(const a of (X.gen||[]))if(a&&a.id)art.set(a.id,a);
  const R=Object.entries(X.by||{}).filter(([,x])=>x&&!x.rules).sort((a,b)=>String(b[1].at||'')<String(a[1].at||'')?-1:1).slice(0,n);
  const C={source:{l:'מבוסס על כתבה עם מקור (מו״ל וקישור)',ok:0,of:0},reason:{l:'לכל חברה מושפעת יש הסבר',ok:0,of:0},cert:{l:'הבחנה בין עובדה להערכה (פרשנות לא מסומנת כעובדה)',ok:0,of:0},
    numbers:{l:'מספרים רק מתוך הכתבה',ok:0,of:0},over:{l:'בלי ניסוח נחרץ, תחזית או המלצה',ok:0,of:0},direct:{l:'קשר "ישיר" רק לחברה שמוזכרת בכתבה',ok:0,of:0}};
  const flags=[];
  for(const [id,x] of R){const a=art.get(id)||null, src=a?[a.title,a.sum,a.prevTitle].filter(Boolean).join(' '):'', why=[];
    const t=(k,ok,msg)=>{C[k].of++; if(ok)C[k].ok++; else why.push(msg)};
    t('source',!!(a&&a.pub&&a.link),'אין כתבה עם מקור');
    if((x.aff||[]).length)t('reason',(x.aff||[]).every(f=>String(f.why||'').trim().length>=6),'חברה מושפעת בלי הסבר');
    if(x.kind==='opinion'||x.type==='opinion')t('cert',x.cert!=='fact','דעה סומנה כעובדה'); else if(x.cert)t('cert',true,'');
    if(a&&NUMS(x.what).length)t('numbers',NUMS(x.what).every(v=>src.includes(v)||src.replace(/,/g,'').includes(v.replace(/,/g,''))),'מספר שלא מופיע בכותרת או בתקציר');
    t('over',!OVER.test([x.he,x.what,...(x.aff||[]).map(f=>f.why)].join(' ')),'ניסוח נחרץ או המלצה');
    const dir=(x.aff||[]).filter(f=>f.how==='direct'); if(a&&dir.length)t('direct',dir.every(f=>(a.syms||[]).includes(f.sym)||new RegExp('\\b'+f.sym+'\\b').test(src)),'קשר ישיר לחברה שלא מוזכרת');
    if(why.length)flags.push({id,he:x.he,at:x.at,why,pub:a&&a.pub,link:a&&a.link})}
  const crit=Object.entries(C).map(([k,v])=>({k,...v,pct:v.of?Math.round(100*v.ok/v.of):null}));
  const score=crit.filter(c=>c.of).length?Math.round(crit.filter(c=>c.of).reduce((a,c)=>a+c.pct,0)/crit.filter(c=>c.of).length):null;
  return {n:R.length,score,crit,flags:flags.slice(0,25),
    how:'נבדקות ' +R.length+' הקריאות האחרונות של צ׳יקו לכתבות, לפי שישה כללים קבועים. הציון הוא ממוצע אחוז העמידה בכללים שאפשר היה לבדוק.',
    limits:'זו בדיקה לפי כללים, לא קריאה של אדם: היא לא יודעת אם המסקנה נכונה, רק אם יש לה בסיס בכתבה. מספר יכול להופיע בגוף הכתבה (שהשרת לא שומר) ולהיחשב בטעות כחשוד. תשובות צ׳יקו בשיחה לא נשמרות בשרת (פרטיות), ולכן לא נבדקות כאן.'};
}
import {createHash} from 'node:crypto';
const newsKey=link=>createHash('sha1').update(String(link||'')).digest('hex').slice(0,12);
export function aiOps(store,{from,to}){
  const P=aiPrices(store), feats={}, models={};
  for(const [kind,f] of [['ai_calls','calls'],['ai_in','input'],['ai_out','output']])for(const r of countersSince(store,kind,from,to)){const [ft,m]=r.key.split('|');
    const F=feats[ft]||(feats[ft]={feature:ft,name:FEAT_HE[ft]||ft,calls:0,input:0,output:0,ms:0,ok:0,err:0,cost:0,costMissing:false}); F[f]+=r.n;
    const M=models[m]||(models[m]={model:m,calls:0,input:0,output:0,cost:null}); M[f]+=r.n}
  for(const r of countersSince(store,'ai_ms',from,to)){const F=feats[r.key]; if(F)F.ms+=r.n}
  const errs={}; for(const r of countersSince(store,'ai_res',from,to)){const [ft,o]=r.key.split('|'); const F=feats[ft]||(feats[ft]={feature:ft,name:FEAT_HE[ft]||ft,calls:0,input:0,output:0,ms:0,ok:0,err:0,cost:0,costMissing:false});
    if(o==='ok')F.ok+=r.n; else{F.err+=r.n; const c=o.slice(4); errs[c]=(errs[c]||0)+r.n}}
  // the cost per feature and per model, with the prices entered
  for(const r of countersSince(store,'ai_in',from,to).concat(countersSince(store,'ai_out',from,to).map(x=>({...x,out:true})))){const [ft,m]=r.key.split('|'), p=P[m], F=feats[ft];
    if(!p){F.costMissing=true; continue} F.cost+=r.n*(r.out?p.out:p.in)/1e6}
  for(const M of Object.values(models)){const p=P[M.model]; M.cost=p?(M.input*p.in+M.output*p.out)/1e6:null; M.avgOut=M.calls?Math.round(M.output/M.calls):null}
  const F=Object.values(feats).map(f=>({...f,avg:f.ok+f.err?Math.round(f.ms/(f.ok+f.err)):null,errPct:f.ok+f.err?Math.round(1000*f.err/(f.ok+f.err))/10:null,cost:f.costMissing?null:Math.round(f.cost*100)/100})).sort((a,b)=>b.calls-a.calls);
  const first=store.db.prepare("select min(day) d from counters where kind='ai_calls'").get().d;
  return {features:F,models:Object.values(models).sort((a,b)=>b.calls-a.calls),errors:Object.entries(errs).map(([code,n])=>({code,n})).sort((a,b)=>b.n-a.n),
    fails:meta(store,'aiFails',[]).filter(f=>f.at.slice(0,10)>=from),since:first,keyOff:!process.env.ANTHROPIC_API_KEY,
    src:'מונה ה-AI של השרת: כל קריאה לצ׳יקו, בשיחה וברקע, לפי פיצ׳ר ומודל',at:new Date().toISOString()};
}

// ---- the security posture: each check a fact about the site, with what to do when it fails ----
export function security(store,{env=process.env,persist,dataDir,backup}){
  const users=store.users().map(u=>store.userById(u.id)), mgrs=users.filter(u=>permsOf(u).size>0);
  const owner=users.find(u=>u.role==='owner'), chain=auditVerify(store), inv=meta(store,'invite');
  const B=backup||{}, lastB=B.last||null, bAge=lastB&&lastB.at?(Date.now()-Date.parse(lastB.at))/36e5:null;
  const C=[
    {k:'volume',l:'הנתונים נשמרים בדיסק קבוע (Volume)',ok:!!persist,fix:'לחבר Volume לשירות ב-Railway; בלעדיו כל עדכון גרסה מוחק את הנתונים'},
    {k:'owner2fa',l:'אימות דו-שלבי לבעל המערכת',ok:!!(owner&&owner.totp_on),fix:'להפעיל במסך "אימות דו-שלבי" באתר'},
    {k:'mgr2fa',l:'אימות דו-שלבי לכל מי שיש לו הרשאה במרכז הניהול',ok:mgrs.every(u=>u.totp_on),note:`${mgrs.filter(u=>u.totp_on).length} מתוך ${mgrs.length}`,fix:'לבקש מכל מנהל להפעיל אימות דו-שלבי'},
    {k:'2faOverride',l:'האימות הדו-שלבי לא כובה מהשרת',ok:env.TWOFA_OFF!=='1',fix:'להסיר את המשתנה TWOFA_OFF ב-Railway'},
    {k:'invite',l:'ההרשמה סגורה, או פתוחה בקוד הזמנה',ok:true,note:inv&&inv.code?`פתוחה בקוד מ-${String(inv.setAt||'').slice(0,10)}`:'סגורה'},
    {k:'chain',l:'יומן הפעולות שלם',ok:chain.ok,note:`${chain.n} רשומות`,fix:'שורה ביומן שונתה מחוץ לאתר: לבדוק גישה לקובץ המסד'},
    {k:'backup',l:'גיבוי יומי מהיממה האחרונה',ok:bAge!=null&&bAge<=30,note:lastB?`${lastB.file||''}${B.files?` · ${B.files.length} עותקים בשרת`:''}`:'אין גיבוי',fix:'לבדוק את משימת הגיבוי במסך התקינות'},
    {k:'backupOff',l:'עותק גיבוי מחוץ לשרת (מייל)',ok:!!(env.RESEND_API_KEY||env.MAIL_USER),fix:'להגדיר RESEND_API_KEY ו-MAIL_TO ב-Railway'},
    {k:'secrets',l:'מפתחות ה-API רק בשרת',ok:true,note:'הדף לא מקבל אף מפתח; כל הקריאות לספקים עוברות דרך השרת'},
    {k:'portfolio',l:'תוכן התיקים לא נגיש למרכז הניהול',ok:true,note:'לפי ההבטחה למשתמשים'}];
  const keys=[['ANTHROPIC_API_KEY','צ׳יקו'],['FINNHUB_API_KEY','Finnhub'],['X_BEARER_TOKEN','X'],['RESEND_API_KEY','מייל (Resend)'],['BACKUP_KEY','הצפנת גיבוי'],['VAPID_PRIVATE_KEY','התראות לטלפון (או מפתח שנוצר במסד)']].map(([k,l])=>({k,l,set:!!env[k]||(k==='VAPID_PRIVATE_KEY'&&!!store.getMeta('vapid'))}));
  const sess=store.db.prepare('select uid, count(*) n, max(created_at) last from sessions where expires_at>? group by uid').all(new Date().toISOString());
  return {checks:C,keys,sessions:sess.map(s=>({...s,email:(users.find(u=>u.id===s.uid)||{}).email||'?'})),at:new Date().toISOString()};
}
