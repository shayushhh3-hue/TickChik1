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

const ERR={not_found:'המשתמש לא נמצא.',owner:'אי אפשר לשנות את בעל המערכת.',self:'אי אפשר לשנות את עצמך.',owner_only:'רק בעל המערכת יכול לתת או לקחת את ההרשאה הזאת.',
  permission_denied:'אין הרשאה.',bad_status:'מצב לא מוכר.',bad_role:'תפקיד לא מוכר.'};
const fail=(res,e,st=400)=>res.status(e.message==='permission_denied'?403:st).json({error:{code:e.message,message:ERR[e.message]||e.message}});

export function adminRoutes(app,{store,pageFile,adminFile,setRole,dataDir='/data',dbFile='',persist=true}){
  opsSchema(store);
  const me=u=>({id:u.id,email:u.email,name:u.name||'',role:u.role,perms:[...permsOf(u)],permNames:PERM_HE});
  app.get('/api/admin/me',need('view'),(req,res)=>res.json({me:me(req.user),perms:PERMS,k:K_ANON,portfolioAccess:PORTFOLIO_ACCESS}));

  // ---- stage B: the dashboard, the users, the product ----
  app.get('/api/admin/exec',need('view'),(req,res)=>res.json(executive(store,req.query)));
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
