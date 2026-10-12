// תיק צ׳יק – the server. One Node process on Railway: serves the site, keeps the documents in SQLite, signs people in
// with e-mail and password, answers the page's data calls, forwards צ׳יקו to Claude with the server's key, refreshes
// prices on demand, and runs the scheduled jobs in-process. Nothing secret reaches the browser.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {sendMail, esc as mesc} from './mail.js';
import {Store, canRead, canWrite} from './store.js';
import {refreshQuotes} from '../shared/pxjob.js';
import {startJobs} from './jobs.js';
import {closesFor} from './tasks.js';
import {buildSite} from '../tools/build.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
const env=process.env;
const DATA_DIR=env.DATA_DIR||'/data';
const PORT=+env.PORT||3000;
const OWNER_EMAIL=String(env.OWNER_EMAIL||'').trim().toLowerCase();
const ALLOWED_MODELS=String(env.ALLOWED_MODELS||'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5').split(',').map(s=>s.trim()).filter(Boolean);
const ANTHROPIC=(env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages';
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

export function createApp({store,siteDir,jobs=true}={}){
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy',1);
  app.use(express.json({limit:'14mb'}));

  // ---- sessions ----
  const COOKIE='tc_sid';
  const parseCookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),decodeURIComponent(s.slice(i+1))]}));
  const setCookie=(res,sid,maxAge)=>res.setHeader('Set-Cookie',`${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.NODE_ENV==='production'||env.RAILWAY_ENVIRONMENT?'; Secure':''}`);
  app.use((req,res,next)=>{req.sid=parseCookies(req)[COOKIE]||null; req.user=req.sid?store.session(req.sid):null; next()});
  const needUser=(req,res,next)=>req.user?next():res.status(401).json({error:{code:'not_granted',message:'not signed in'}});
  const needOwner=(req,res,next)=>req.user&&req.user.role==='owner'?next():res.status(403).json({error:{code:'not_granted',message:'owner only'}});
  // state-changing calls must come from the page itself (a custom header no cross-site form can send)
  app.use('/api',(req,res,next)=>{if(req.method!=='GET'&&req.headers['x-tc']!=='1')return res.status(403).json({error:{code:'invalid_argument',message:'missing header'}});next()});
  app.use('/api',(req,res,next)=>{res.setHeader('cache-control','no-store');next()});

  // ---- sign in / out ----
  const tries=new Map(); // ip -> [timestamps], a soft brake on guessing passwords and invite codes
  const brake=req=>{const ip=req.ip||'?', now=Date.now(), L=(tries.get(ip)||[]).filter(t=>now-t<10*60*1000); tries.set(ip,L); return {over:L.length>=12,miss:()=>L.push(now),clear:()=>tries.delete(ip)}};
  const TOO_MANY={error:{code:'rate_limited',message:'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'}};
  app.post('/api/login',(req,res)=>{
    const b=brake(req); if(b.over)return res.status(429).json(TOO_MANY);
    const {email,password}=req.body||{}; const u=store.userByEmail(email);
    if(!u||!store.checkPassword(u,password)){b.miss();return res.status(401).json({error:{code:'bad_login',message:'המייל או הסיסמה לא נכונים.'}})}
    b.clear(); const sid=store.newSession(u.id,req.headers['user-agent']); setCookie(res,sid,30*86400);
    res.json({ok:true,me:me(u)});
  });
  // ---- sign-up with the owner's invite code (no code set = sign-up closed) ----
  const invite=()=>{try{const v=JSON.parse(store.getMeta('invite')||'null');return v&&v.code?v:null}catch(e){return null}};
  const norm=c=>String(c||'').trim().toUpperCase().replace(/[\s-]/g,'');
  const sameCode=(a,b)=>{const x=createHash('sha256').update(norm(a)).digest(), y=createHash('sha256').update(norm(b)).digest(); return timingSafeEqual(x,y)};
  app.post('/api/register',(req,res)=>{
    const b=brake(req); if(b.over)return res.status(429).json(TOO_MANY);
    const inv=invite(); if(!inv)return res.status(403).json({error:{code:'closed',message:'ההרשמה סגורה כרגע. בקש מבעל הדף קוד הזמנה.'}});
    const {email,password,code,name}=req.body||{};
    if(!sameCode(code,inv.code)){b.miss();return res.status(403).json({error:{code:'bad_code',message:'קוד ההזמנה לא נכון.'}})}
    let u; try{u=store.addUser({email,name:String(name||'').slice(0,60),password,role:'friend',mustChange:false})}
    catch(e){if(e.message!=='exists')b.miss(); return res.status(400).json({error:{code:e.message,message:{bad_email:'כתובת מייל לא תקינה.',short_password:'סיסמה של 8 תווים לפחות.',exists:'הכתובת כבר רשומה. אפשר להיכנס איתה.'}[e.message]||e.message}})}
    b.clear(); const sid=store.newSession(u.id,req.headers['user-agent']); setCookie(res,sid,30*86400);
    log('new sign-up:',u.email);
    sendMail({subject:'תיק צ׳יק – נרשם משתמש חדש',text:`${u.email} נרשם לאתר עם קוד ההזמנה.\nאפשר לראות ולהסיר משתמשים בעמוד "משתמשים ושותפים".`,html:`<p dir="rtl"><b>${mesc(u.email)}</b> נרשם לאתר עם קוד ההזמנה.</p><p dir="rtl">אפשר לראות ולהסיר משתמשים בעמוד "משתמשים ושותפים".</p>`}).catch(()=>{});
    res.json({ok:true,me:me(u)});
  });
  // the owner sets, replaces or closes the invite code
  const CODE_ABC='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode=()=>[...randomBytes(8)].map(x=>CODE_ABC[x%CODE_ABC.length]).join('');
  app.get('/api/invite',needOwner,(req,res)=>{const v=invite(); res.json({code:v?v.code:null,setAt:v?v.setAt:null})});
  app.post('/api/invite',needOwner,(req,res)=>{let c=norm((req.body||{}).code); if(c&&!/^[A-Z0-9]{6,24}$/.test(c))return res.status(400).json({error:{code:'invalid_argument',message:'קוד של 6 עד 24 אותיות באנגלית וספרות.'}});
    if(!c)c=newCode(); const v={code:c,setAt:new Date().toISOString()}; store.setMeta('invite',JSON.stringify(v)); res.json(v)});
  app.delete('/api/invite',needOwner,(req,res)=>{store.setMeta('invite','null'); res.json({ok:true})});
  app.post('/api/logout',(req,res)=>{if(req.sid)store.endSession(req.sid);setCookie(res,'',0);res.json({ok:true})});
  const me=u=>({id:u.id,email:u.email,name:u.name||'',owner:u.role==='owner',mustChange:!!u.must_change});
  app.get('/api/me',(req,res)=>res.json(req.user?{me:me(req.user)}:{me:null,signup:!!invite()}));
  app.post('/api/password',needUser,(req,res)=>{const {old,password}=req.body||{}; if(!store.checkPassword(req.user,old))return res.status(400).json({error:{code:'bad_login',message:'הסיסמה הנוכחית לא נכונה.'}});
    try{store.setPassword(req.user.id,password)}catch(e){return res.status(400).json({error:{code:e.message,message:'סיסמה של 8 תווים לפחות.'}})} res.json({ok:true})});

  // ---- users (the owner opens the door) ----
  app.get('/api/users',needOwner,(req,res)=>res.json({users:store.users()}));
  app.post('/api/users',needOwner,(req,res)=>{try{const u=store.addUser({...req.body,role:'friend',mustChange:true});res.json({user:me(u)})}catch(e){res.status(400).json({error:{code:e.message,message:{bad_email:'כתובת מייל לא תקינה.',short_password:'סיסמה של 8 תווים לפחות.',exists:'הכתובת כבר רשומה.'}[e.message]||e.message}})}});
  app.post('/api/users/:id/password',needOwner,(req,res)=>{try{store.setPassword(req.params.id,(req.body||{}).password,{mustChange:true});store.endSessions(req.params.id);res.json({ok:true})}catch(e){res.status(400).json({error:{code:e.message,message:'סיסמה של 8 תווים לפחות.'}})}});
  app.delete('/api/users/:id',needOwner,(req,res)=>{const u=store.userById(req.params.id); if(!u)return res.status(404).json({error:{code:'not_found'}}); if(u.role==='owner')return res.status(400).json({error:{code:'invalid_argument',message:'אי אפשר להסיר את בעל הדף.'}});
    store.removeUser(u.id); for(const p of store.pathsUnder('data/users/'+u.id))store.deleteDoc(p); store.deleteDoc('watch/'+u.id); res.json({ok:true})});

  // ---- documents ----
  const badPath=p=>!p||p.length>400||!/^[A-Za-z0-9_.\-@:]+(\/[A-Za-z0-9_.\-@:]+)*$/.test(p);
  app.get('/api/db/doc',needUser,async(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canRead(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}});
    const d=store.getDoc(p);
    // a chart nobody has asked for yet: fetched now, kept for next time (the nightly run keeps the followed ones fresh)
    const m=p.match(/^quotes\/c_((?:TLV_)?[A-Z0-9.\-]{1,10})$/);
    if(m&&(!d.exists||(d.data&&d.data.missing&&Date.now()-new Date(d.data.updatedAt)>7*864e5))){
      const key=m[1].replace(/^TLV_/,'TLV:'); try{const doc=await chartOnce(key); return res.json({exists:true,data:doc,id:'c_'+m[1]})}catch(e){}}
    res.json(d)});
  const CHARTS=new Map();
  const chartOnce=key=>{if(CHARTS.has(key))return CHARTS.get(key); const pr=(async()=>{
      const map=(store.getDoc('settings/main').data||{}).symMap||{};
      let doc; try{doc=await closesFor(key,map)}catch(e){doc={key,missing:true,updatedAt:new Date().toISOString()}}
      store.setDoc('quotes/c_'+key.replace(':','_'),doc,{silent:true}); return doc})().finally(()=>setTimeout(()=>CHARTS.delete(key),60000));
    CHARTS.set(key,pr); return pr};
  app.put('/api/db/doc',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canWrite(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}}); const s=JSON.stringify(req.body); if(s.length>2e6)return res.status(413).json({error:{code:'too_large',message:'document too large'}});
    store.setDoc(p,req.body); res.json({ok:true})});
  app.patch('/api/db/doc',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canWrite(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}}); store.updateDoc(p,req.body); res.json({ok:true})});
  app.delete('/api/db/doc',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canWrite(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}}); store.deleteDoc(p); res.json({ok:true})});
  app.get('/api/db/list',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2===0)return res.status(400).json({error:{code:'invalid_argument',message:'bad collection'}});
    if(!canRead(req.user,p+'/x'))return res.status(403).json({error:{code:'permission_denied',message:'no access'}});
    let where=null; if(req.query.wf){where={f:String(req.query.wf),op:String(req.query.wo||'=='),v:req.query.wv===undefined?null:JSON.parse(String(req.query.wv))}}
    res.json({docs:store.listDocs(p,{orderBy:req.query.orderBy?String(req.query.orderBy):null,dir:req.query.dir==='desc'?'desc':'asc',limit:+req.query.limit||0,where})})});
  // one import or export at a time, the owner only: the whole set of documents as {path: data}
  app.post('/api/db/import',needOwner,(req,res)=>{const docs=(req.body&&req.body.docs)||{}; const ws=[]; for(const [p,d] of Object.entries(docs)){if(badPath(p)||p.split('/').length%2||!d||typeof d!=='object')continue; if(p.startsWith('data/users/'))continue; ws.push({path:p,data:d})}
    store.batch(ws); res.json({ok:true,n:ws.length})});
  app.get('/api/db/export',needOwner,(req,res)=>{const out={}; for(const [p,d] of store.allDocs()){if(p.startsWith('data/users/'))continue; out[p]=d} res.setHeader('content-disposition',`attachment; filename="tikchik-backup-${new Date().toISOString().slice(0,10)}.json"`); res.json({exportedAt:new Date().toISOString(),source:'tik-chik site',docs:out})});
  // live changes: an event per written path the viewer may read
  app.get('/api/db/stream',needUser,(req,res)=>{
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store',connection:'keep-alive','x-accel-buffering':'no'}); res.write(':ok\n\n');
    const user=req.user; const off=store.onChange(ev=>{if(canRead(user,ev.path))res.write(`data: ${JSON.stringify(ev)}\n\n`)});
    const ping=setInterval(()=>{try{res.write(':ping\n\n')}catch(e){}},25000);
    req.on('close',()=>{off();clearInterval(ping)});
  });

  // ---- צ׳יקו: the page's Claude request, with the server's key ----
  app.post('/api/ask',needUser,async(req,res)=>{
    if(!env.ANTHROPIC_API_KEY)return res.status(503).json({error:{code:'upstream_error',message:'ANTHROPIC_API_KEY is not set'}});
    const body=req.body||{}; if(!ALLOWED_MODELS.includes(body.model))return res.status(400).json({error:{code:'invalid_argument',message:'model not allowed'}});
    try{
      const r=await fetch(ANTHROPIC,{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify(body)});
      const text=await r.text();
      if(r.ok){res.status(200).type('application/json').send(text);return}
      let msg=''; try{msg=(JSON.parse(text).error||{}).message||''}catch(e){}
      if(r.status===429)return res.status(429).json({error:{code:'rate_limited',message:msg||'rate limited'}});
      if(r.status===401||r.status===403)return res.status(502).json({error:{code:'upstream_error',message:'the Claude API key was refused: '+msg}});
      if(r.status===400)return res.status(400).json({error:{code:'invalid_argument',message:msg||'bad request'}});
      res.status(502).json({error:{code:'upstream_error',message:msg||('Claude API HTTP '+r.status)}});
    }catch(e){res.status(502).json({error:{code:'upstream_error',message:String(e&&e.message||e)}})}
  });

  // ---- prices now ----
  let pxLast={at:0,res:null}, pxBusy=null;
  app.post('/api/prices',needUser,async(req,res)=>{
    try{
      if(Date.now()-pxLast.at<3*60*1000&&pxLast.res)return res.json({...pxLast.res,cached:true});
      if(!pxBusy)pxBusy=refreshQuotes(store,{log,reason:(req.user.role==='owner'?'owner':'friend')+': '+String((req.body||{}).reason||'').slice(0,80)}).finally(()=>{pxBusy=null});
      const r=await pxBusy; pxLast={at:Date.now(),res:r}; res.json({ok:true,...r});
    }catch(e){res.status(502).json({error:{code:'upstream_error',message:String(e&&e.message||e)}})}
  });

  // the owner can run a scheduled job now (setup checks, or after a missed run)
  app.post('/api/jobs/:name',needOwner,(req,res)=>{const j=app.locals.jobs; if(!j)return res.status(503).json({error:{code:'upstream_error',message:'jobs are off'}}); if(!j.run(req.params.name))return res.status(404).json({error:{code:'not_found',message:'no such job'}}); res.json({ok:true,queued:req.params.name})});

  app.use('/api',(req,res)=>res.status(404).json({error:{code:'not_found',message:'no such call'}}));

  // ---- the site ----
  app.use(express.static(siteDir,{index:'index.html',etag:true,setHeaders:(res,p)=>{if(/\.html$/.test(p)||/config\.js$/.test(p))res.setHeader('cache-control','no-cache'); res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); res.setHeader('referrer-policy','strict-origin-when-cross-origin')}}));
  app.use((req,res)=>res.status(404).send('לא נמצא'));
  return app;
}

export function bootstrap(store){
  // the owner, from the environment, once; later password changes live in the database
  if(OWNER_EMAIL&&!store.userByEmail(OWNER_EMAIL)){
    const pw=env.OWNER_PASSWORD||''; if(pw.length<8){log('OWNER_PASSWORD missing or shorter than 8 characters: the owner cannot sign in yet');}
    else{store.addUser({email:OWNER_EMAIL,name:env.OWNER_NAME||'',password:pw,role:'owner'});log('owner created:',OWNER_EMAIL)}
  }
  if(!store.getMeta('instance'))store.setMeta('instance',randomBytes(8).toString('hex'));
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const dbFile=env.DB_FILE||path.join(DATA_DIR,'tikchik.sqlite');
  if(!fs.existsSync(DATA_DIR)){log(`DATA_DIR ${DATA_DIR} does not exist: creating it. On Railway, add a Volume mounted at ${DATA_DIR} or the data is lost on every deploy.`)}
  const store=new Store(dbFile); bootstrap(store);
  const siteDir=path.join(ROOT,'site'); try{buildSite(ROOT)}catch(e){log('build failed:',e.message)}
  const app=createApp({store,siteDir});
  app.listen(PORT,()=>log(`תיק צ׳יק listening on ${PORT}, data in ${dbFile}, ${store.users().length} user(s)`));
  if(env.JOBS!=='0')app.locals.jobs=startJobs(store,{log});
}
