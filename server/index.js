// תיק צ׳יק – the server. One Node process on Railway: serves the site, keeps the documents in SQLite, signs people in
// with e-mail and password, answers the page's data calls, forwards צ׳יקו to Claude with the server's key, refreshes
// prices on demand, and runs the scheduled jobs in-process. Nothing secret reaches the browser.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {sendMail, esc as mesc} from './mail.js';
import {Store, canRead, canWrite, partnerView} from './store.js';
import {refreshQuotes} from '../shared/pxjob.js';
import {startJobs} from './jobs.js';
import {closesFor} from './tasks.js';
import {buildSite} from '../tools/build.js';
import {ilParts} from '../shared/market.js';
import {backupStatus, backupNow} from './backup.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
const env=process.env;
// Railway tells the service where its Volume is mounted; use that, whatever path was typed when it was added
const DATA_DIR=env.RAILWAY_VOLUME_MOUNT_PATH||env.DATA_DIR||'/data';
// on Railway without a Volume, everything written is lost at the next deploy
const PERSIST=!env.RAILWAY_ENVIRONMENT||!!env.RAILWAY_VOLUME_MOUNT_PATH;
const PORT=+env.PORT||3000;
const OWNER_EMAIL=String(env.OWNER_EMAIL||'').trim().toLowerCase();
const ALLOWED_MODELS=String(env.ALLOWED_MODELS||'claude-haiku-5-5,claude-sonnet-5-5').split(',').map(s=>s.trim()).filter(Boolean);
const ANTHROPIC=(env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages';
// Claude limits: what one partner may use per day (the owner is not limited), and the shape of one request
const AI_DAILY=Math.max(0,Math.floor(+(env.AI_DAILY_LIMIT??40)));
const AI_MAX_TOKENS=8192, AI_MAX_TURNS=12, AI_MAX_IMAGES=12, AI_MAX_SYSTEM=4000, AI_MAX_INFLIGHT=2;
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

export function createApp({store,siteDir,jobs=true,dataDir=DATA_DIR}={}){
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
    log('new sign-up:',u.id);
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
  app.get('/api/me',(req,res)=>res.json(req.user?{me:me(req.user),...(req.user.role==='owner'?{persist:PERSIST}:{})}:{me:null,signup:!!invite()}));
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
    res.json(d.exists?{...d,data:partnerView(store,req.user,p,d.data)}:d)});
  const CHARTS=new Map();
  const chartOnce=key=>{if(CHARTS.has(key))return CHARTS.get(key); const pr=(async()=>{
      const map=(store.getDoc('settings/main').data||{}).symMap||{};
      let doc; try{doc=await closesFor(key,map)}catch(e){doc={key,missing:true,updatedAt:new Date().toISOString()}}
      store.setDoc('quotes/c_'+key.replace(':','_'),doc,{silent:true}); return doc})().finally(()=>setTimeout(()=>CHARTS.delete(key),60000).unref());
    CHARTS.set(key,pr); return pr};
  app.put('/api/db/doc',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canWrite(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}}); const s=JSON.stringify(req.body); if(s.length>2e6)return res.status(413).json({error:{code:'too_large',message:'document too large'}});
    store.setDoc(p,req.body); res.json({ok:true})});
  app.patch('/api/db/doc',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canWrite(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}}); store.updateDoc(p,req.body); res.json({ok:true})});
  app.delete('/api/db/doc',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2)return res.status(400).json({error:{code:'invalid_argument',message:'bad path'}});
    if(!canWrite(req.user,p))return res.status(403).json({error:{code:'permission_denied',message:'no access'}}); store.deleteDoc(p); res.json({ok:true})});
  app.get('/api/db/list',needUser,(req,res)=>{const p=String(req.query.path||''); if(badPath(p)||p.split('/').length%2===0)return res.status(400).json({error:{code:'invalid_argument',message:'bad collection'}});
    if(!canRead(req.user,p+'/x')||(req.user.role!=='owner'&&!(p+'/').startsWith('data/users/'+req.user.id+'/')))return res.status(403).json({error:{code:'permission_denied',message:'no access'}});
    let where=null; if(req.query.wf){where={f:String(req.query.wf),op:String(req.query.wo||'=='),v:req.query.wv===undefined?null:JSON.parse(String(req.query.wv))}}
    res.json({docs:store.listDocs(p,{orderBy:req.query.orderBy?String(req.query.orderBy):null,dir:req.query.dir==='desc'?'desc':'asc',limit:+req.query.limit||0,where})})});
  // one import or export at a time, the owner only: the whole set of documents as {path: data}
  app.post('/api/db/import',needUser,(req,res)=>{const docs=(req.body&&req.body.docs)||{}; const ws=[], own=req.user.role==='owner', mine='data/users/'+req.user.id+'/'; for(const [p,d] of Object.entries(docs)){if(badPath(p)||p.split('/').length%2||!d||typeof d!=='object')continue; if(own?(p.startsWith('data/users/')||(p.startsWith('watch/')&&p!=='watch/'+req.user.id)):!(p.startsWith(mine)||p==='watch/'+req.user.id))continue; ws.push({path:p,data:d})}
    store.batch(ws); res.json({ok:true,n:ws.length})});
  app.get('/api/db/export',needUser,(req,res)=>{const out={}, own=req.user.role==='owner', mine='data/users/'+req.user.id+'/'; for(const [p,d] of store.allDocs()){if(own?(p.startsWith('data/users/')||(p.startsWith('watch/')&&p!=='watch/'+req.user.id)):!(p.startsWith(mine)||p==='watch/'+req.user.id))continue; out[p]=d} res.setHeader('content-disposition',`attachment; filename="tikchik-backup-${new Date().toISOString().slice(0,10)}.json"`); res.json({exportedAt:new Date().toISOString(),source:'tik-chik site',docs:out})});
  // live changes: an event per written path the viewer may read
  app.get('/api/db/stream',needUser,(req,res)=>{
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store',connection:'keep-alive','x-accel-buffering':'no'}); res.write(':ok\n\n');
    const user=req.user; const off=store.onChange(ev=>{if(canRead(user,ev.path)&&(user.role==='owner'||!ev.path.startsWith('quotes/c_')))res.write(`data: ${JSON.stringify(ev)}\n\n`)});
    const ping=setInterval(()=>{try{res.write(':ping\n\n')}catch(e){}},25000);
    req.on('close',()=>{off();clearInterval(ping)});
  });

  // ---- צ׳יקו: the page's Claude request, with the server's key ----
  // Claude's errors in plain Hebrew, so the page can say what is wrong (and the owner can fix it in Railway)
  const NOKEY='צ׳יקו לא מחובר: חסר המשתנה ANTHROPIC_API_KEY ב-Railway.';
  const askErr=(status,type,msg)=>{const m=String(msg||'');
    if(/credit balance|billing|purchase credits/i.test(m))return [402,'sampling_disabled','אין יתרה בחשבון Anthropic. צריך להטעין קרדיט ב-console.anthropic.com (Billing).'];
    if(status===401||status===403||type==='authentication_error'||type==='permission_error')return [502,'sampling_disabled','מפתח ה-API של Anthropic נדחה. בדוק שהמפתח ב-Railway (ANTHROPIC_API_KEY) הועתק במלואו ושהוא לא בוטל.'];
    if(status===404||type==='not_found_error')return [502,'upstream_error','המודל של Claude לא זמין בחשבון Anthropic הזה ('+m.slice(0,80)+').'];
    if(status===429||type==='rate_limit_error')return [429,'rate_limited','Claude ביקש להאט (מגבלת קצב בחשבון Anthropic). נסה שוב בעוד דקה.'];
    if(status===529||type==='overloaded_error')return [503,'upstream_error','Claude עמוס כרגע. נסה שוב בעוד כמה דקות.'];
    if(status===413||/too large|too long|prompt is too long/i.test(m))return [413,'prompt_too_large','הקובץ גדול מדי בשביל Claude. נסה פחות עמודים.'];
    if(status===400)return [400,'invalid_argument','Claude דחה את הבקשה: '+m.slice(0,200)];
    return [502,'upstream_error','Claude לא ענה'+(status?' (HTTP '+status+')':'')+'. נסה שוב.']};
  async function askClaude(body,signal){
    if(!env.ANTHROPIC_API_KEY)return {status:503,json:{error:{code:'sampling_disabled',message:NOKEY}}};
    const sig=signal?AbortSignal.any([signal,AbortSignal.timeout(280000)]):AbortSignal.timeout(280000);
    let r; try{r=await fetch(ANTHROPIC,{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify(body),signal:sig})}
    catch(e){if(signal&&signal.aborted)return {status:499,aborted:true,json:{error:{code:'cancelled',message:'cancelled'}}};
      const to=e&&(e.name==='TimeoutError'||e.name==='AbortError'); log('ask failed:',to?'timeout':String(e&&e.message||e)); return {status:504,json:{error:{code:'upstream_error',message:to?'Claude לא סיים לענות בזמן (יותר מ-4 דקות). נסה קובץ קצר יותר או שוב בעוד רגע.':'אין חיבור ל-Claude מהשרת. נסה שוב.'}}}}
    let text; try{text=await r.text()}catch(e){if(signal&&signal.aborted)return {status:499,aborted:true,json:{error:{code:'cancelled',message:'cancelled'}}}; throw e}
    if(r.ok)return {status:200,text};
    let type='',msg=''; try{const e=JSON.parse(text).error||{};type=e.type||'';msg=e.message||''}catch(e){}
    const [st,code,message]=askErr(r.status,type,msg); log('ask failed:',r.status,type,msg.slice(0,160));
    return {status:st,json:{error:{code,message}}};
  }
  // only the kinds of request the page makes: a model from the list, a capped answer length, plain text and image turns,
  // an optional system line. Anything else (tools, other settings) is dropped or refused.
  function cleanAsk(b){
    if(!b||typeof b!=='object')return {err:'bad request'};
    if(!ALLOWED_MODELS.includes(b.model))return {err:'model not allowed'};
    const msgs=Array.isArray(b.messages)?b.messages:null; if(!msgs||!msgs.length||msgs.length>AI_MAX_TURNS)return {err:'bad messages'};
    let imgs=0; const out=[];
    for(const m of msgs){
      if(!m||(m.role!=='user'&&m.role!=='assistant'))return {err:'bad role'};
      if(typeof m.content==='string'){out.push({role:m.role,content:m.content});continue}
      if(!Array.isArray(m.content)||!m.content.length)return {err:'bad content'};
      const parts=[];
      for(const c of m.content){
        if(c&&c.type==='text'&&typeof c.text==='string')parts.push({type:'text',text:c.text});
        else if(c&&c.type==='image'&&c.source&&c.source.type==='base64'&&/^image\/(jpeg|png|webp|gif)$/.test(c.source.media_type)&&typeof c.source.data==='string'){
          if(++imgs>AI_MAX_IMAGES)return {err:'too many images'}; parts.push({type:'image',source:{type:'base64',media_type:c.source.media_type,data:c.source.data}})}
        else return {err:'bad content block'};
      }
      out.push({role:m.role,content:parts});
    }
    const body={model:b.model,max_tokens:Math.max(1,Math.min(AI_MAX_TOKENS,Math.floor(+b.max_tokens||1024))),messages:out};
    if(typeof b.system==='string'&&b.system)body.system=b.system.slice(0,AI_MAX_SYSTEM);
    return {body};
  }
  const inflight=new Map(); // user id -> requests running now
  app.post('/api/ask',needUser,async(req,res)=>{
    const c=cleanAsk(req.body); if(c.err)return res.status(400).json({error:{code:'invalid_argument',message:c.err}});
    const u=req.user, owner=u.role==='owner', day=ilParts(new Date()).iso;
    if(!owner){
      if(store.aiUsage(u.id,day).calls>=AI_DAILY)return res.status(429).json({error:{code:'quota_exceeded',message:`הגעת למכסה היומית של צ׳יקו (${AI_DAILY} פניות ביום). המכסה מתחדשת בחצות.`}});
      if((inflight.get(u.id)||0)>=AI_MAX_INFLIGHT)return res.status(429).json({error:{code:'rate_limited',message:'בקשה קודמת ל-Claude עדיין רצה. נסה שוב בעוד רגע.'}});
    }
    store.aiAdd(u.id,day,{calls:1}); inflight.set(u.id,(inflight.get(u.id)||0)+1);
    // the page's "stop" closes the request: the call to Claude stops too, instead of running (and being billed) to the end
    const ctl=new AbortController(); res.on('close',()=>{if(!res.writableEnded)ctl.abort()});
    let out; try{out=await askClaude(c.body,ctl.signal)}finally{const n=(inflight.get(u.id)||1)-1; if(n>0)inflight.set(u.id,n); else inflight.delete(u.id)}
    if(out.aborted){log('ask cancelled by the page');return}
    if(out.text!=null){
      try{const us=(JSON.parse(out.text).usage)||{}; store.aiAdd(u.id,day,{input:(us.input_tokens||0)+(us.cache_read_input_tokens||0)+(us.cache_creation_input_tokens||0),output:us.output_tokens||0})}catch(e){}
      res.status(200).type('application/json').send(out.text);return}
    res.status(out.status).json(out.json);
  });
  // the owner sees who used Claude how much (calls and tokens, today and the last 30 days)
  app.get('/api/ai/usage',needOwner,(req,res)=>{
    const today=ilParts(new Date()).iso, from=ilParts(new Date(Date.now()-29*864e5)).iso;
    const users=store.users(), byId=Object.fromEntries(users.map(x=>[x.id,x])), month=store.aiSince(from), day=store.aiSince(today);
    const rows=users.map(x=>{const m=month.find(r=>r.uid===x.id)||{}, d=day.find(r=>r.uid===x.id)||{}; return {email:x.email,owner:x.role==='owner',today:d.calls||0,calls30:m.calls||0,input30:m.input||0,output30:m.output||0}});
    for(const m of month)if(!byId[m.uid])rows.push({email:'(משתמש שהוסר)',owner:false,today:0,calls30:m.calls,input30:m.input,output30:m.output});
    res.json({limit:AI_DAILY,models:ALLOWED_MODELS,rows});
  });
  app.get('/api/backup/status',needOwner,(req,res)=>res.json(backupStatus(store,{dataDir})));
  // the owner checks the connection to Claude with one tiny question
  app.post('/api/ask/check',needOwner,async(req,res)=>{
    const t0=Date.now(); const out=await askClaude({model:ALLOWED_MODELS.find(m=>/haiku/.test(m))||ALLOWED_MODELS[0],max_tokens:16,messages:[{role:'user',content:'Reply with the single word: ok'}]});
    if(out.text!=null)return res.json({ok:true,ms:Date.now()-t0});
    res.json({ok:false,message:out.json.error.message});
  });

  // ---- prices now ----
  let pxLast={at:0,res:null}, pxBusy=null;
  app.post('/api/prices',needUser,async(req,res)=>{
    try{
      if(Date.now()-pxLast.at<3*60*1000&&pxLast.res){const {errors,...rest}=pxLast.res; return res.json({...(req.user.role==='owner'?pxLast.res:{...rest,errors:(errors||[]).length}),cached:true})}
      if(!pxBusy){let to; pxBusy=Promise.race([refreshQuotes(store,{log,reason:(req.user.role==='owner'?'owner':'friend')+': '+String((req.body||{}).reason||'').slice(0,80)}),new Promise((_,rej)=>{to=setTimeout(()=>rej(new Error('price update took too long')),120000)})]).finally(()=>{clearTimeout(to);pxBusy=null})}
      const r=await pxBusy; pxLast={at:Date.now(),res:r}; const {errors,...rest}=r; res.json({ok:true,...(req.user.role==='owner'?r:{...rest,errors:(errors||[]).length})});
    }catch(e){res.status(502).json({error:{code:'upstream_error',message:String(e&&e.message||e)}})}
  });

  // the owner can run a scheduled job now (setup checks, or after a missed run)
  app.post('/api/jobs/:name',needOwner,(req,res)=>{const j=app.locals.jobs; if(!j)return res.status(503).json({error:{code:'upstream_error',message:'jobs are off'}}); if(!j.run(req.params.name))return res.status(404).json({error:{code:'not_found',message:'no such job'}}); res.json({ok:true,queued:req.params.name})});

  app.use('/api',(req,res)=>res.status(404).json({error:{code:'not_found',message:'no such call'}}));

  // ---- the site ----
  // the page is about 4 MB of text; compressed it is about 1 MB. Each file is compressed once per version (in the
  // background, so a request never waits on more than its own file), and sent compressed when the browser accepts it.
  const ZC=new Map(), TYPES={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',webmanifest:'application/manifest+json',txt:'text/plain; charset=utf-8'};
  const squeeze=(file,st,enc)=>{const key=file+'|'+enc, c=ZC.get(key); if(c&&c.mtime===st.mtimeMs&&c.size===st.size)return c.p;
    const p=new Promise((ok,no)=>{const raw=fs.readFileSync(file); const done=(e,b)=>e?no(e):ok({body:b,etag:`"${enc}-${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`});
      if(enc==='br')zlib.brotliCompress(raw,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:raw.length}},done); else zlib.gzip(raw,{level:9},done)});
    ZC.set(key,{mtime:st.mtimeMs,size:st.size,p}); p.catch(()=>ZC.delete(key)); return p};
  app.use(async(req,res,next)=>{
    if(req.method!=='GET'&&req.method!=='HEAD')return next();
    const ae=String(req.headers['accept-encoding']||''), enc=/\bbr\b/.test(ae)?'br':/\bgzip\b/.test(ae)?'gzip':null; if(!enc)return next();
    let rel; try{rel=decodeURIComponent(req.path)}catch(e){return next()} if(rel.endsWith('/'))rel+='index.html';
    const ext=(rel.match(/\.([a-z]+)$/)||[])[1]; if(!TYPES[ext]||rel.includes('..'))return next();
    const file=path.join(siteDir,rel); if(!file.startsWith(path.resolve(siteDir)+path.sep))return next();
    let st; try{st=fs.statSync(file)}catch(e){return next()} if(!st.isFile()||st.size<4096)return next();
    let z; try{z=await squeeze(file,st,enc)}catch(e){return next()}
    res.setHeader('vary','accept-encoding'); res.setHeader('etag',z.etag); res.setHeader('content-type',TYPES[ext]);
    res.setHeader('cache-control',ext==='html'||/config\.js$/.test(rel)?'no-cache':'public, max-age=0');
    res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); res.setHeader('referrer-policy','strict-origin-when-cross-origin');
    if(req.headers['if-none-match']===z.etag)return res.status(304).end();
    res.setHeader('content-encoding',enc); res.setHeader('content-length',z.body.length);
    if(req.method==='HEAD')return res.end(); res.end(z.body);
  });
  app.locals.squeezeSite=()=>{const f=path.join(siteDir,'index.html'); try{const st=fs.statSync(f); for(const e of ['br','gzip'])squeeze(f,st,e).catch(()=>{})}catch(e){}};
  app.use(express.static(siteDir,{index:'index.html',etag:true,setHeaders:(res,p)=>{if(/\.html$/.test(p)||/config\.js$/.test(p))res.setHeader('cache-control','no-cache'); res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); res.setHeader('referrer-policy','strict-origin-when-cross-origin')}}));
  app.use((req,res)=>res.status(404).send('לא נמצא'));
  return app;
}

export function bootstrap(store){
  // the owner, from the environment, once; later password changes live in the database
  if(OWNER_EMAIL&&!store.userByEmail(OWNER_EMAIL)){
    const pw=env.OWNER_PASSWORD||''; if(pw.length<8){log('OWNER_PASSWORD missing or shorter than 8 characters: the owner cannot sign in yet');}
    else{store.addUser({email:OWNER_EMAIL,name:env.OWNER_NAME||'',password:pw,role:'owner'});log('owner created')}
  }
  if(!store.getMeta('instance'))store.setMeta('instance',randomBytes(8).toString('hex'));
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const dbFile=env.DB_FILE||path.join(DATA_DIR,'tikchik.sqlite');
  if(!fs.existsSync(DATA_DIR)){log(`DATA_DIR ${DATA_DIR} does not exist: creating it. On Railway, add a Volume mounted at ${DATA_DIR} or the data is lost on every deploy.`)}
  const store=new Store(dbFile); bootstrap(store);
  const siteDir=path.join(ROOT,'site'); try{buildSite(ROOT)}catch(e){log('build failed:',e.message)}
  const app=createApp({store,siteDir}); app.locals.squeezeSite();
  if(!PERSIST)log('WARNING: no Railway Volume is attached to this service: the data is lost at every deploy');
  app.listen(PORT,()=>log(`תיק צ׳יק listening on ${PORT}, data in ${dbFile}, ${store.users().length} user(s)`));
  if(env.JOBS!=='0')app.locals.jobs=startJobs(store,{log,dataDir:DATA_DIR});
  // a first copy right away when today has none (a new server, or after an update)
  if(PERSIST)try{const st=backupStatus(store,{dataDir:DATA_DIR}); if(!st.files.some(f=>f.name.includes(new Date().toISOString().slice(0,10)))){const r=backupNow(store,{dataDir:DATA_DIR}); log('backup at start:',path.basename(r.file))}}catch(e){log('backup at start failed:',e.message)}
  // no prices yet (a new server, or an import without them): fetch them now instead of waiting for the hourly run
  if(!store.getDoc('quotes/latest').exists)setTimeout(()=>refreshQuotes(store,{log,reason:'הפעלת השרת'}).catch(e=>log('first price update failed:',e.message)),5000);
}
