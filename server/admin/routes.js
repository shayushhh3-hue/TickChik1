// 1.11 TikChik Management Center: the API (/api/admin/*) and the page (/admin). Every call checks a permission on the
// server; every change is written to the audit log before the answer goes out. Nothing here returns a password, a session,
// a two-step secret, a backup code, a push subscription or the contents of a partner's portfolio.
import fs from 'node:fs';
import zlib from 'node:zlib';
import {PERMS,PERM_HE,permsOf,can,need,setPerms,resetPerms,audit,auditList,auditVerify,authSince,setStatus,PORTFOLIO_ACCESS} from './core.js';
import {executive,usersList,product,aiCost,aiPrices,rangeOf,K_ANON} from './metrics.js';
import {bump} from './counter.js';
import {healthCheck} from '../health.js';
import {createHash} from 'node:crypto';
import {newsOps,aiOps,aiQuality,systemOps,incidents,incidentUpdate,security,checkIncidents,opsSchema} from './ops.js';
import {backupStatus} from '../backup.js';
import {intelSchema,radarScan,radarList,radarUpdate,voice,intelAsk,intelHistory} from './intel.js';
import {catalog} from './metrics.js';
import {worldModel,worldBrief} from './world.js';
import {yahooStatus,marketData, splitsAdmin} from './yahoo.js';
import {keysList,keyTest} from './keys.js';
import {bizSchema,ticketCreate,ticketsOfUser,ticketUserView,ticketUserReply,ticketStaff,ticketGet,ticketsList,supportStats,TOPIC_HE,roadmapSave,roadmapList,roadmapDelete,launchImpact,
  contentSave,contentStatus,contentList,contentFor,ledgerAdd,ledgerDelete,business,CAT_HE} from './biz.js';

const ERR={not_found:'המשתמש לא נמצא.',owner:'אי אפשר לשנות את בעל המערכת.',self:'אי אפשר לשנות את עצמך.',owner_only:'רק בעל המערכת יכול לתת או לקחת את ההרשאה הזאת.',
  permission_denied:'אין הרשאה.',bad_status:'מצב לא מוכר.',bad_role:'תפקיד לא מוכר.'};
const fail=(res,e,st=400)=>res.status(e.message==='permission_denied'?403:st).json({error:{code:e.message,message:ERR[e.message]||e.message}});

export function adminRoutes(app,{store,pageFile,adminFile,setRole,dataDir='/data',dbFile='',persist=true,push=null,log=()=>{}}){
  opsSchema(store); bizSchema(store); intelSchema(store);
  const me=u=>({id:u.id,email:u.email,name:u.name||'',role:u.role,perms:[...permsOf(u)],permNames:PERM_HE});
  app.get('/api/admin/me',need('view'),(req,res)=>res.json({me:me(req.user),perms:PERMS,k:K_ANON,portfolioAccess:PORTFOLIO_ACCESS}));

  // ---- stage B: the dashboard, the users, the product ----
  app.get('/api/admin/exec',need('view'),(req,res)=>{const E=executive(store,req.query);
    // 1.11 stage E: the radar's open findings beside the company's figures
    try{const L=radarList(store).filter(r=>!['resolved','dismissed'].includes(r.status)), bad=L.filter(r=>r.sev==='bad').length; E.metrics.push({k:'radar',label:'ממצאים פתוחים ב-Radar',value:L.length,src:'TikChik Radar',how:'גלאים שרצים כל חצי שעה על השימוש, השגיאות, ה-AI, החדשות, המחירים והפניות',at:(()=>{try{return JSON.parse(store.getMeta('radarAt')||'null')}catch(e){return null}})(),go:'radar',state:bad?'bad':L.length?'warn':null,note:L.slice(0,2).map(r=>r.title).join(' · ')||null})}catch(e){}
    res.json(E)});
  app.get('/api/admin/users',need('view'),(req,res)=>{const L=usersList(store), sens=can(req.user,'sensitive');
    res.json({users:L.map(u=>({...u,perms:u.perms,effective:[...permsOf(store.userById(u.id))]})),sensitive:sens,at:new Date().toISOString()})});
  app.get('/api/admin/users/:id',need('view'),(req,res)=>{const u=store.userById(req.params.id); if(!u)return res.status(404).json({error:{code:'not_found',message:ERR.not_found}});
    const row=usersList(store).find(x=>x.id===u.id), sens=can(req.user,'sensitive');
    const history=auditList(store,{target:u.id,limit:100});
    const days=store.db.prepare('select day, hits, src from active_days where uid=? order by day desc limit 90').all(u.id);
    const ai=store.db.prepare('select day, calls, quick, input, output from ai_usage where uid=? order by day desc limit 60').all(u.id);
    let logins=null; if(sens){logins=store.db.prepare('select at, ok, reason, ip, ua from auth_events where uid=? or email=? order by id desc limit 50').all(u.id,u.email);
      audit(store,{user:req.user,action:'sensitive.view',target:u.id,detail:{what:'sign-in log'},ip:req.ip})}
    res.json({user:{...row,effective:[...permsOf(u)]},history,days,ai,logins,sensitive:sens,
      usage:'לא מוצג: פירוט המסכים של אדם מסוים נשמר באזור הפרטי שלו. במסך "מודיעין מוצר" מוצג רק סיכום של כולם, בלי שמות.',
      portfolioNote:PORTFOLIO_ACCESS?null:'תוכן התיק לא מוצג: האתר מבטיח למשתמשים שאיש, גם לא בעל האתר, לא רואה את התיק שלהם. מוצג רק אם קיים ומתי עודכן.'})});
  // suspend / restore, the role, the permissions: "users", never the owner, never oneself; audited
  app.post('/api/admin/users/:id/status',need('users'),(req,res)=>{try{const {status,note}=req.body||{}; const r=setStatus(store,req.user,req.params.id,status,note);
    audit(store,{user:req.user,action:status==='suspended'?'user.suspend':'user.restore',target:req.params.id,detail:{...r,note:String(note||'').slice(0,200)},ip:req.ip}); res.json({ok:true,...r})}catch(e){fail(res,e)}});
  app.post('/api/admin/users/:id/role',need('users'),(req,res)=>{const t=store.userById(req.params.id); if(t&&t.id===req.user.id)return fail(res,new Error('self'));
    try{const before=t&&t.role, u=setRole(req.params.id,(req.body||{}).role); audit(store,{user:req.user,action:'user.role',target:u.id,detail:{before,after:u.role},ip:req.ip}); res.json({ok:true,role:u.role})}catch(e){fail(res,e)}});
  app.post('/api/admin/users/:id/perms',need('users'),(req,res)=>{try{const b=req.body||{}; let r;
      if(b.reset){const t=store.userById(req.params.id); if(!t)throw new Error('not_found'); if(t.role==='owner')throw new Error('owner'); if(t.id===req.user.id)throw new Error('self');
        if(req.user.role!=='owner')throw new Error('owner_only'); const before=[...permsOf(t)]; resetPerms(store,t.id); r={before,after:[...permsOf(store.userById(t.id))],reset:true}}
      else r=setPerms(store,req.user,req.params.id,b.perms);
      audit(store,{user:req.user,action:'user.perms',target:req.params.id,detail:r,ip:req.ip}); res.json({ok:true,...r})}catch(e){fail(res,e)}});

  app.get('/api/admin/product',need('view'),(req,res)=>res.json(product(store,req.query,{viewer:req.user,pageFile})));

  // ---- AI: use and cost; the prices are set here ("edit") ----
  app.get('/api/admin/ai',need('view'),(req,res)=>{const R=rangeOf(req.query); res.json({range:R,cost:aiCost(store,R.from,R.to),prices:aiPrices(store),
    byDay:store.db.prepare('select day, sum(calls) calls, sum(quick) quick, sum(input) input, sum(output) output from ai_usage where day>=? and day<=? group by day order by day').all(R.from,R.to)})});
  app.post('/api/admin/ai/prices',need('edit'),(req,res)=>{const P={}, b=(req.body||{}).prices||{};
    for(const [m,v] of Object.entries(b)){if(!/^[a-z0-9.\-]{2,60}$/.test(m)||!v)continue; const i=+v.in, o=+v.out; if(!(i>=0&&o>=0&&i<1e4&&o<1e4))continue; P[m]={in:i,out:o}}
    const before=aiPrices(store); store.setMeta('aiPrices',JSON.stringify(P)); audit(store,{user:req.user,action:'settings.aiPrices',target:'ai',detail:{before,after:P},ip:req.ip}); res.json({ok:true,prices:P})});

  // ---- the health (the same check the site already runs) and running a job ("system") ----
  app.get('/api/admin/health',need('view'),(req,res)=>res.json({...healthCheck(store),jobs:!!app.locals.jobs}));
  app.post('/api/admin/jobs/:name',need('system'),(req,res)=>{const j=app.locals.jobs; if(!j)return res.status(503).json({error:{code:'upstream_error',message:'המשימות המתוזמנות כבויות בשרת הזה.'}});
    if(!/^[a-z\-]{2,20}$/.test(req.params.name)||!j.run(req.params.name))return res.status(404).json({error:{code:'not_found',message:'אין משימה כזאת.'}});
    audit(store,{user:req.user,action:'system.job',target:req.params.name,ip:req.ip}); res.json({ok:true})});

  // ---- the logs: management actions ("view"), sign-ins ("sensitive") ----
  app.get('/api/admin/audit',need('view'),(req,res)=>res.json({items:auditList(store,{limit:req.query.limit,before:req.query.before,target:req.query.target||null,action:req.query.action||null}),verify:auditVerify(store)}));
  app.get('/api/admin/logins',need('sensitive'),(req,res)=>{const from=new Date(Date.now()-30*864e5).toISOString(), L=authSince(store,from);
    audit(store,{user:req.user,action:'sensitive.view',target:'logins',detail:{what:'sign-in log, 30 days'},ip:req.ip});
    // unusual: an address that failed five times or more, an e-mail that is not a user, a success after many failures
    const byIp={}; for(const e of L){const k=e.ip||'?'; const o=byIp[k]||(byIp[k]={ip:k,fail:0,ok:0,emails:new Set()}); e.ok?o.ok++:o.fail++; if(e.email)o.emails.add(e.email)}
    const known=new Set(store.users().map(u=>u.email)), odd=[];
    for(const o of Object.values(byIp))if(o.fail>=5)odd.push({kind:'many_fail',ip:o.ip,fail:o.fail,ok:o.ok,emails:o.emails.size});
    for(const e of L)if(!e.ok&&e.email&&!known.has(e.email))odd.push({kind:'unknown_email',ip:e.ip,at:e.at});
    res.json({items:L.slice(0,500),odd:odd.slice(0,50)})});

  // ---- stage C: the operations ----
  app.get('/api/admin/news',need('view'),(req,res)=>res.json(newsOps(store)));
  app.get('/api/admin/aiops',need('view'),(req,res)=>{const R=rangeOf(req.query); res.json({range:R,...aiOps(store,R),quality:aiQuality(store)})});
  app.get('/api/admin/system',need('view'),(req,res)=>{const R=rangeOf(req.query); res.json({...systemOps(store,{from:R.from,to:R.to,dataDir,dbFile}),range:R})});
  app.get('/api/admin/incidents',need('view'),(req,res)=>{const L=incidents(store,{days:+req.query.days||30}), U=Object.fromEntries(store.users().map(u=>[u.id,u.email]));
    res.json({items:L.map(i=>({...i,ownerEmail:i.owner?U[i.owner]||null:null})),managers:store.users().map(u=>store.userById(u.id)).filter(u=>can(u,'view')).map(u=>({id:u.id,email:u.email,name:u.name||''})),
      cfg:(()=>{try{return JSON.parse(store.getMeta('mcAlerts')||'null')||{push:true,mail:false}}catch(e){return {push:true,mail:false}}})()})});
  app.post('/api/admin/incidents/check',need('system'),(req,res)=>{const n=checkIncidents(store,{}); audit(store,{user:req.user,action:'incident.check',target:'incidents',detail:{opened:n.length},ip:req.ip}); res.json({ok:true,opened:n.length})});
  app.post('/api/admin/incidents/:id',need('system'),(req,res)=>{try{res.json({ok:true,item:incidentUpdate(store,req.user,req.params.id,req.body||{},req.ip)})}catch(e){fail(res,e,e.message==='not_found'?404:400)}});
  app.post('/api/admin/alerts-cfg',need('system'),(req,res)=>{const b=req.body||{}, before=(()=>{try{return JSON.parse(store.getMeta('mcAlerts')||'null')}catch(e){return null}})(), next={push:!!b.push,mail:!!b.mail};
    store.setMeta('mcAlerts',JSON.stringify(next)); audit(store,{user:req.user,action:'settings.alerts',target:'alerts',detail:{before,after:next},ip:req.ip}); res.json({ok:true,cfg:next})});
  app.get('/api/admin/security',need('view'),(req,res)=>{const S=security(store,{persist,dataDir,backup:backupStatus(store,{dataDir})}); if(!can(req.user,'sensitive'))delete S.sessions; res.json(S)});
  // the open sessions: who is signed in, from what device. A session is named by a hash of its id, never by the id
  const hid=sid=>createHash('sha256').update(String(sid)).digest('hex').slice(0,16);
  app.get('/api/admin/sessions',need('sensitive'),(req,res)=>{const U=Object.fromEntries(store.users().map(u=>[u.id,u]));
    const L=store.db.prepare('select sid, uid, created_at, expires_at, ua from sessions where expires_at>? order by created_at desc').all(new Date().toISOString());
    audit(store,{user:req.user,action:'sensitive.view',target:'sessions',detail:{what:'open sessions'},ip:req.ip});
    res.json({items:L.map(s=>({h:hid(s.sid),uid:s.uid,email:(U[s.uid]||{}).email||'?',role:(U[s.uid]||{}).role||'',created:s.created_at,expires:s.expires_at,ua:s.ua,mine:s.sid===req.sid}))})});
  app.post('/api/admin/sessions/end',need('users'),(req,res)=>{const {h,uid}=req.body||{}; const t=store.userById(uid); if(!t)return fail(res,new Error('not_found'),404);
    if(t.role==='owner'&&req.user.role!=='owner')return fail(res,new Error('owner'));
    let n=0; if(h==='all'){if(t.id===req.user.id){store.endSessionsBut(t.id,req.sid)}else store.endSessions(t.id); n=-1}
    else for(const s of store.db.prepare('select sid from sessions where uid=?').all(t.id))if(hid(s.sid)===h&&s.sid!==req.sid){store.endSession(s.sid); n++}
    audit(store,{user:req.user,action:'session.end',target:t.id,detail:{which:h==='all'?'all':'one',ended:n},ip:req.ip}); res.json({ok:true,ended:n})});

  // ---- stage D: support (the management's side) ----
  const tell=(uids,msg)=>{if(!push)return; for(const id of new Set(uids))push(store,id,msg,{log}).catch(()=>{})};
  const staffIds=p=>store.users().map(u=>store.userById(u.id)).filter(u=>can(u,p)).map(u=>u.id);
  app.get('/api/admin/support',need('view'),(req,res)=>{const R=rangeOf(req.query); res.json({range:R,stats:supportStats(store,R),tickets:ticketsList(store),topics:TOPIC_HE,
    staff:store.users().map(u=>store.userById(u.id)).filter(u=>can(u,'view')).map(u=>({id:u.id,email:u.email,name:u.name||''}))})});
  app.get('/api/admin/support/:id',need('view'),(req,res)=>{const t=ticketGet(store,req.params.id); if(!t)return fail(res,new Error('not_found'),404);
    store.db.prepare('update tickets set staff_seen_at=? where id=?').run(new Date().toISOString(),t.id); const U=store.userById(t.uid)||{};
    res.json({ticket:{...t,email:U.email||'(משתמש שהוסר)',name:U.name||'',role:U.role||'',msgs:t.msgs.map(m=>({...m,by:m.uid===t.uid?'user':((store.userById(m.uid)||{}).email||'?')}))},
      history:auditList(store,{target:'tkt:'+t.id,limit:50}),staff:store.users().map(u=>store.userById(u.id)).filter(u=>can(u,'view')).map(u=>({id:u.id,email:u.email,name:u.name||''})),roadmap:roadmapList(store).filter(r=>!['launched','existing'].includes(r.status)).map(r=>({id:r.id,title:r.title}))})});
  app.post('/api/admin/support/:id',need('edit'),(req,res)=>{try{const t=ticketStaff(store,req.user,req.params.id,req.body||{},req.ip);
    if((req.body||{}).reply&&!(req.body||{}).internal)tell([t.uid],{title:'תשובה לפנייה שלך',body:t.subject.slice(0,120),url:'./help.html#t'+t.id,tag:'ticket-'+t.id}); res.json({ok:true,ticket:t})}catch(e){fail(res,e,e.message==='not_found'?404:400)}});
  // ---- the roadmap ----
  const usageOf=u=>{const d=store.getDoc(u.role==='owner'?'usage/main':`data/users/${u.id}/usage`); return d.exists&&d.data&&d.data.days||{}};
  app.get('/api/admin/roadmap',need('view'),(req,res)=>{const users=store.users(); res.json({items:roadmapList(store).map(r=>({...r,impact:launchImpact(store,r,{users,usageOf,k:K_ANON})})),
    staff:users.map(u=>store.userById(u.id)).filter(u=>can(u,'view')).map(u=>({id:u.id,email:u.email,name:u.name||''}))})});
  app.post('/api/admin/roadmap',need('edit'),(req,res)=>{try{res.json({ok:true,item:roadmapSave(store,req.user,req.body||{},req.ip)})}catch(e){fail(res,e,e.message==='not_found'?404:400)}});
  app.delete('/api/admin/roadmap/:id',need('edit'),(req,res)=>{try{roadmapDelete(store,req.user,req.params.id,req.ip); res.json({ok:true})}catch(e){fail(res,e,404)}});
  // ---- the content ----
  app.get('/api/admin/content',need('view'),(req,res)=>res.json({items:contentList(store)}));
  app.post('/api/admin/content',need('edit'),(req,res)=>{try{res.json({ok:true,item:contentSave(store,req.user,req.body||{},req.ip)})}catch(e){fail(res,e,e.message==='not_found'?404:400)}});
  app.post('/api/admin/content/:id/status',need('edit'),(req,res)=>{try{res.json({ok:true,item:contentStatus(store,req.user,req.params.id,(req.body||{}).status,req.ip)})}catch(e){fail(res,e,e.message==='not_found'?404:400)}});
  // ---- the money ----
  const fxNow=()=>{const q=store.getDoc('quotes/latest').data; return q&&+q.usdIls>0?+q.usdIls:null};
  app.get('/api/admin/biz',need('view'),(req,res)=>res.json({...business(store,{months:Math.min(24,Math.max(3,+req.query.months||12)),fx:fxNow()}),cats:CAT_HE}));
  app.post('/api/admin/ledger',need('edit'),(req,res)=>{try{res.json({ok:true,item:ledgerAdd(store,req.user,req.body||{},req.ip)})}catch(e){fail(res,e)}});
  app.delete('/api/admin/ledger/:id',need('edit'),(req,res)=>{try{ledgerDelete(store,req.user,req.params.id,req.ip); res.json({ok:true})}catch(e){fail(res,e,404)}});

  // ---- stage D, the users' side: a ticket from the site, their own tickets and answers, the content for them ----
  const signed=(req,res,next)=>req.user?next():res.status(401).json({error:{code:'not_granted',message:'not signed in'}});
  const UERR={short:'כתוב נושא ותיאור קצר.',rate:'נשלחו כבר כמה פניות בשעה האחרונה. אפשר להוסיף לפנייה קיימת.',not_found:'הפנייה לא נמצאה.'};
  app.post('/api/support',signed,(req,res)=>{try{const t=ticketCreate(store,req.user,req.body||{},{ua:req.headers['user-agent']});
      bump('tickets',t.type,1); tell(staffIds('edit').filter(id=>id!==req.user.id),{title:'פנייה חדשה: '+({bug:'תקלה',idea:'הצעה',request:'בקשה',question:'שאלה'}[t.type]),body:t.subject.slice(0,120),url:'/admin#ticket/'+t.id,tag:'mc-ticket'});
      res.json({ok:true,id:t.id})}catch(e){res.status(e.message==='rate'?429:400).json({error:{code:e.message,message:UERR[e.message]||e.message}})}});
  app.get('/api/support',signed,(req,res)=>res.json({items:ticketsOfUser(store,req.user.id)}));
  app.get('/api/support/:id',signed,(req,res)=>{const t=ticketUserView(store,req.user,req.params.id); t?res.json(t):res.status(404).json({error:{code:'not_found',message:UERR.not_found}})});
  app.post('/api/support/:id',signed,(req,res)=>{try{ticketUserReply(store,req.user,req.params.id,(req.body||{}).body); const t=ticketGet(store,req.params.id);
      tell([t.assignee].filter(Boolean).length?[t.assignee]:staffIds('edit').filter(id=>id!==req.user.id),{title:'תגובה לפנייה',body:t.subject.slice(0,120),url:'/admin#ticket/'+t.id,tag:'mc-ticket'}); res.json({ok:true})}
    catch(e){res.status(e.message==='not_found'?404:400).json({error:{code:e.message,message:UERR[e.message]||e.message}})}});
  app.get('/api/content',signed,(req,res)=>{const u=req.user, pf=store.getDoc(u.role==='owner'?'portfolio/main':`data/users/${u.id}/portfolio`), hasPf=!!(pf.exists&&pf.data&&(pf.data.positions||[]).some(p=>p&&+p.qty>0));
    res.json({items:contentFor(store,u,{hasPf,newUser:Date.now()-Date.parse(u.created_at)<30*864e5}),unread:ticketsOfUser(store,u.id).filter(t=>t.unread).length})});

  // ---- stage E: the radar, the voice of the users, the intelligence ----
  app.get('/api/admin/radar',need('view'),(req,res)=>res.json({items:radarList(store,{days:+req.query.days||30}),at:(()=>{try{return JSON.parse(store.getMeta('radarAt')||'null')}catch(e){return null}})(),
    staff:store.users().map(u=>store.userById(u.id)).filter(u=>can(u,'view')).map(u=>({id:u.id,email:u.email,name:u.name||''}))}));
  app.post('/api/admin/radar/scan',need('system'),(req,res)=>{const o=radarScan(store,{cat:catalog(pageFile),log,push}); audit(store,{user:req.user,action:'radar.scan',target:'radar',detail:{opened:o.length},ip:req.ip}); res.json({ok:true,opened:o.length})});
  app.post('/api/admin/radar/:id',need('system'),(req,res)=>{try{res.json({ok:true,item:radarUpdate(store,req.user,req.params.id,req.body||{},req.ip)})}catch(e){fail(res,e,e.message==='not_found'?404:400)}});
  app.get('/api/admin/voice',need('view'),(req,res)=>{const R=rangeOf(req.query); res.json(voice(store,R))});
  app.get('/api/admin/intel',need('view'),(req,res)=>res.json({items:intelHistory(store,req.user.id),keyOff:!process.env.ANTHROPIC_API_KEY&&!app.locals.intelAsk}));
  const IERR={short:'כתוב שאלה.',rate:'הגעת ל-20 שאלות בשעה. אפשר להמשיך בעוד מעט.',upstream:'צ׳יקו לא ענה כרגע. נסה שוב בעוד רגע.',no_answer:'התשובה לא הגיעה במבנה הנכון. נסה לנסח אחרת.'};
  app.post('/api/admin/intel',need('view'),async(req,res)=>{const b=req.body||{}; try{res.json(await intelAsk(store,req.user,b.q,{ask:app.locals.intelAsk||null,q:{range:b.range||'30',from:b.from,to:b.to,pageFile},log}))}
    catch(e){res.status(e.message==='rate'?429:e.message==='upstream'?502:400).json({error:{code:e.message,message:IERR[e.message]||e.message}})}});

  // 5.11: the keys in Railway, by name only, and a check of one against its own service (the outcome and its time are kept)
  app.get('/api/admin/keys',need('system'),(req,res)=>res.json(keysList(store)));
  const KT=new Map(), KERR={unknown:'האתר לא משתמש במפתח בשם הזה, ולכן אין מה לבדוק. ספר ל-Claude לאיזה שירות הוא שייך, והוא יחובר.',missing:'המפתח לא שמור ב-Railway.',no_test:'למפתח הזה אין בדיקה מול שירות.'};
  app.post('/api/admin/keys/test',need('system'),async(req,res)=>{const n=String((req.body||{}).name||'').slice(0,64), last=KT.get(n)||0;
    if(Date.now()-last<10e3)return res.status(429).json({error:{code:'rate_limited',message:'בדיקה של המפתח הזה רצה לפני רגע. אפשר שוב בעוד כמה שניות.'}}); KT.set(n,Date.now());
    try{const r=await keyTest(store,n,{fetch:app.locals.keyFetch||globalThis.fetch}); audit(store,{user:req.user,action:'keys.test',target:n,detail:{st:r.st,code:r.code},ip:req.ip}); res.json(r)}
    catch(e){res.status(400).json({error:{code:e.message,message:KERR[e.message]||e.message}})}});

  // ---- the global news model ----
  // 4.11: Yahoo as a source (counted by kind and outcome) and the market it brings (public data)
  app.get('/api/admin/yahoo',need('view'),(req,res)=>res.json({status:yahooStatus(store,{days:Math.max(1,Math.min(30,+req.query.days||7))}),market:marketData(store),splits:splitsAdmin(store)}));
  app.get('/api/admin/world',need('view'),(req,res)=>{const M=worldModel(store,{days:+req.query.days||3}); let brief=null; try{brief=JSON.parse(store.getMeta('worldBrief:'+M.days)||'null')}catch(e){} res.json({...M,brief,keyOff:!process.env.ANTHROPIC_API_KEY&&!app.locals.worldAsk})});
  const WB=new Map();
  app.post('/api/admin/world/brief',need('view'),async(req,res)=>{const last=WB.get(req.user.id)||0; if(Date.now()-last<20e3)return res.status(429).json({error:{code:'rate_limited',message:'התקציר הקודם עוד נכתב.'}}); WB.set(req.user.id,Date.now());
    try{res.json(await worldBrief(store,req.user,{days:+(req.body||{}).days||3,force:!!(req.body||{}).force,ask:app.locals.worldAsk||null,log}))}
    catch(e){res.status(e.message==='upstream'?502:400).json({error:{code:e.message,message:{upstream:'צ׳יקו לא ענה כרגע. נסה שוב בעוד רגע.',no_answer:'התקציר לא הגיע במבנה הנכון. נסה שוב.'}[e.message]||e.message}})}});

  // ---- the page: only to someone with "view". Anyone else gets the site's ordinary "not found", not a closed door ----
  const zc={m:0};
  app.get(['/admin','/admin/'],(req,res)=>{
    if(!req.user)return res.redirect(302,'/?next=admin');
    if(!can(req.user,'view'))return res.status(404).send('לא נמצא');
    let st; try{st=fs.statSync(adminFile)}catch(e){return res.status(500).send('הדף לא נבנה')}
    if(zc.m!==st.mtimeMs){const raw=fs.readFileSync(adminFile); zc.m=st.mtimeMs; zc.raw=raw; zc.gz=zlib.gzipSync(raw,{level:9})}
    res.setHeader('content-type','text/html; charset=utf-8'); res.setHeader('cache-control','no-store'); res.setHeader('x-frame-options','DENY'); res.setHeader('x-content-type-options','nosniff'); res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    if(/\bgzip\b/.test(String(req.headers['accept-encoding']||''))){res.setHeader('content-encoding','gzip'); res.setHeader('vary','accept-encoding'); return res.end(zc.gz)} res.end(zc.raw)});
  app.locals.bump=bump;
}
