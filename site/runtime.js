// תיק צ׳יק – the page's runtime on the site's own server.
// The page was written against the claude.ai artifact runtime (window.claude.use('db' | 'user' | 'sample' | 'downloads' |
// 'mcp' | 'permissions')). This module serves the same six namespaces from this site's server: documents through
// /api/db, live changes through one event stream, Claude through /api/ask, a price refresh through /api/prices.
// Sign-in is e-mail and password, kept in an HttpOnly cookie; nothing secret is in the page.

const API='/api';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
const MODELS={quick:'claude-haiku-5-5',default:'claude-sonnet-5-5',complex:'claude-sonnet-5-5'};

async function call(method,url,body,signal){
  let r;
  try{r=await fetch(API+url,{method,credentials:'same-origin',headers:{'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal})}
  catch(e){if(e&&e.name==='AbortError')throw {code:'cancelled',message:'cancelled'};throw {code:'server_unavailable',message:String(e&&e.message||e)}}
  let j=null; try{j=await r.json()}catch(e){}
  if(r.ok)return j;
  const code=(j&&j.error&&j.error.code)||(r.status===401||r.status===403?'not_granted':r.status===429?'rate_limited':r.status===413?'too_large':r.status>=500?'upstream_error':'invalid_argument');
  const err={code,message:(j&&j.error&&j.error.message)||('HTTP '+r.status),status:r.status};
  if(r.status===401&&url!=='/login'&&url!=='/me')setTimeout(()=>showGate('login',{err:'החיבור פג. היכנס שוב.'}),0);
  throw err;
}

// ---- the sign-in screen ----
const CSS=`
#tcGate{position:fixed;inset:0;z-index:1000;background:#f3f5f8;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Heebo,"Segoe UI",Arial,sans-serif;direction:rtl;color:#1e293b;overflow:auto}
#tcGate .card{width:min(400px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;box-shadow:0 8px 30px rgb(30 52 78 / .10)}
#tcGate h1{margin:0 0 2px;font-size:26px;color:#1e344e;text-align:center}
#tcGate .sub{margin:0 0 20px;color:#64748b;font-size:14px;text-align:center}
#tcGate label{display:block;font-size:13.5px;color:#45566b;margin:12px 0 4px}
#tcGate input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#1e293b}
#tcGate input:focus{outline:2px solid #2e6da4;outline-offset:1px;border-color:#2e6da4}
#tcGate input[type=email]{direction:ltr;text-align:left}
#tcGate .btn{display:block;width:100%;margin-top:18px;border:0;background:#1e344e;color:#fff;border-radius:10px;padding:11px 18px;font:inherit;font-size:15.5px;font-weight:600;cursor:pointer}
#tcGate .btn:disabled{opacity:.6;cursor:default}
#tcGate .note{font-size:12.5px;color:#64748b;margin:16px 0 0;line-height:1.6;text-align:center}
#tcGate .err{color:#b91c1c;font-size:13.5px;margin:12px 0 0;min-height:1em}
#tcGate .alt{margin:18px 0 0;padding-top:14px;border-top:1px solid #eef1f4;text-align:center;font-size:14px;color:#45566b}
#tcGate .lnk{border:0;background:none;padding:4px 2px;font:inherit;font-weight:600;color:#2e6da4;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
#tcGate .hint{font-size:12px;color:#64748b;margin:4px 0 0}
#tcGate input.code{direction:ltr;text-align:left;letter-spacing:.08em;text-transform:uppercase}
`;
function gateEl(){
  let el=document.getElementById('tcGate');
  if(!el){const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
    el=document.createElement('div');el.id='tcGate';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','tcGateH');
    (document.body||document.documentElement).appendChild(el)}
  return el;
}
let GATE_DONE=null, SIGNUP=false;
const INVITE=(()=>{try{return new URLSearchParams(location.search).get('invite')||''}catch(e){return ''}})();
function showGate(kind,x={}){
  const el=gateEl(), head=`<h1 id="tcGateH">תיק צ׳יק</h1><p class="sub">חדר המסחר שלי</p>`;
  if(kind==='loading'){el.innerHTML=`<div class="card">${head}<p class="sub">טוען…</p></div>`;return}
  if(kind==='login'){
    el.innerHTML=`<div class="card">${head}<form id="tcLogin" novalidate><label for="tcEmail">מייל</label><input id="tcEmail" type="email" autocomplete="username" required value="${esc(x.email||'')}">
      <label for="tcPass">סיסמה</label><input id="tcPass" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit">כניסה</button><p class="err" id="tcErr" role="alert">${esc(x.err||'')}</p></form>
      ${SIGNUP?'<p class="alt">משתמש חדש? <button type="button" class="lnk" id="tcToReg">הרשמה עם קוד הזמנה</button></p>':''}
      <p class="note">הנתונים שלך נשמרים בחשבון שלך ואינם גלויים למשתמשים אחרים.${SIGNUP?'':' את החשבון פותח בעל הדף.'}</p></div>`;
    const f=document.getElementById('tcLogin'), toReg=document.getElementById('tcToReg');
    if(toReg)toReg.addEventListener('click',()=>showGate('register',{email:document.getElementById('tcEmail').value})); setTimeout(()=>{try{document.getElementById(x.email?'tcPass':'tcEmail').focus()}catch(e){}},30);
    f.addEventListener('submit',async ev=>{ev.preventDefault(); const b=f.querySelector('button'); b.disabled=true; document.getElementById('tcErr').textContent='';
      try{const r=await call('POST','/login',{email:document.getElementById('tcEmail').value,password:document.getElementById('tcPass').value}); location.reload()}
      catch(e){b.disabled=false; document.getElementById('tcErr').textContent=e.message||'הכניסה לא הצליחה.'}});
    return;
  }
  if(kind==='register'){
    el.innerHTML=`<div class="card">${head}<p class="sub">הרשמה עם קוד הזמנה מבעל הדף</p><form id="tcReg" novalidate>
      <label for="tcEmail">מייל</label><input id="tcEmail" type="email" autocomplete="username" required value="${esc(x.email||'')}">
      <label for="tcPass">סיסמה (8 תווים לפחות)</label><input id="tcPass" type="password" autocomplete="new-password" minlength="8" required>
      <label for="tcPass2">הסיסמה שוב</label><input id="tcPass2" type="password" autocomplete="new-password" minlength="8" required>
      <label for="tcCode">קוד הזמנה</label><input id="tcCode" class="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required value="${esc(x.code||INVITE)}">
      <button class="btn" type="submit">הרשמה</button><p class="err" id="tcErr" role="alert">${esc(x.err||'')}</p></form>
      <p class="alt">כבר יש לך חשבון? <button type="button" class="lnk" id="tcToLog">כניסה</button></p>
      <p class="note">כל משתמש רואה רק את התיק של עצמו. התיק שלך לא גלוי למשתמשים אחרים.</p></div>`;
    const f=document.getElementById('tcReg'); setTimeout(()=>{try{document.getElementById('tcEmail').focus()}catch(e){}},30);
    document.getElementById('tcToLog').addEventListener('click',()=>showGate('login',{email:document.getElementById('tcEmail').value}));
    f.addEventListener('submit',async ev=>{ev.preventDefault(); const b=f.querySelector('button[type=submit]'), er=document.getElementById('tcErr'); er.textContent='';
      const v=id=>document.getElementById(id).value, pw=v('tcPass');
      if(pw.length<8){er.textContent='סיסמה של 8 תווים לפחות.';return}
      if(pw!==v('tcPass2')){er.textContent='שתי הסיסמאות לא זהות.';return}
      if(!v('tcCode').trim()){er.textContent='צריך קוד הזמנה מבעל הדף.';return}
      b.disabled=true;
      try{await call('POST','/register',{email:v('tcEmail'),password:pw,code:v('tcCode')}); location.replace(location.pathname)}
      catch(e){b.disabled=false; er.textContent=e.message||'ההרשמה לא הצליחה.'}});
    return;
  }
  if(kind==='change'){
    el.innerHTML=`<div class="card">${head}<p class="sub">ברוך הבא. בחר סיסמה משלך במקום זו שקיבלת.</p><form id="tcChg" novalidate>
      <label for="tcOld">הסיסמה שקיבלת</label><input id="tcOld" type="password" autocomplete="current-password">
      <label for="tcNew">סיסמה חדשה (8 תווים לפחות)</label><input id="tcNew" type="password" autocomplete="new-password" minlength="8">
      <button class="btn" type="submit">שמירה והמשך</button><p class="err" id="tcErr" role="alert"></p></form></div>`;
    const f=document.getElementById('tcChg');
    f.addEventListener('submit',async ev=>{ev.preventDefault(); const b=f.querySelector('button'); b.disabled=true;
      try{await call('POST','/password',{old:document.getElementById('tcOld').value,password:document.getElementById('tcNew').value}); hideGate(); if(GATE_DONE)GATE_DONE()}
      catch(e){b.disabled=false; document.getElementById('tcErr').textContent=e.message||'השמירה לא הצליחה.'}});
    return;
  }
  el.innerHTML=`<div class="card">${head}<p class="err">${esc(x.err||'שגיאה')}</p><button class="btn" type="button" onclick="location.reload()">לנסות שוב</button></div>`;
}
function hideGate(){const el=document.getElementById('tcGate');if(el)el.remove()}

// ---- live changes: one event stream; listeners per document and per collection ----
const DOC_L=new Map(), COL_L=new Map();
let ES=null;
function stream(){
  if(ES)return; try{ES=new EventSource(API+'/db/stream')}catch(e){return}
  ES.onmessage=ev=>{let m=null; try{m=JSON.parse(ev.data)}catch(e){return} const p=m.path; if(!p)return;
    for(const f of (DOC_L.get(p)||[]))f();
    const c=p.slice(0,p.lastIndexOf('/')); for(const f of (COL_L.get(c)||[]))f()};
  ES.onerror=()=>{}; // the browser reconnects by itself
}
const addL=(map,k,f)=>{const s=map.get(k)||new Set(); s.add(f); map.set(k,s); return()=>{s.delete(f)}};

export async function boot(){
  showGate('loading');
  let who=null; try{who=await call('GET','/me')}catch(e){showGate('error',{err:'השרת לא זמין כרגע. נסה שוב בעוד רגע.'});return {use:async()=>null}}
  if(!who||!who.me){SIGNUP=!!who&&!!who.signup; showGate(SIGNUP&&INVITE?'register':'login',INVITE&&!SIGNUP?{err:'ההרשמה סגורה כרגע. בקש מבעל הדף קוד הזמנה חדש.'}:{}); return {use:()=>new Promise(()=>{})}}
  const me=who.me;
  if(me.mustChange){await new Promise(r=>{GATE_DONE=r;showGate('change')})}
  hideGate();
  window.__tc={id:me.id,email:me.email,owner:me.owner,signOut:async()=>{try{await call('POST','/logout',{})}catch(e){} location.reload()}};
  stream();

  // ---- db ----
  const snap=(id,r)=>({id,exists:!!(r&&r.exists),data:()=>r&&r.exists?JSON.parse(JSON.stringify(r.data)):undefined,metadata:{hasPendingWrites:false,fromCache:false}});
  const enc=encodeURIComponent;
  const docRef=p=>{const id=p.slice(p.lastIndexOf('/')+1); return {
    id, path:p,
    get:async()=>snap(id,await call('GET','/db/doc?path='+enc(p))),
    set:async d=>{await call('PUT','/db/doc?path='+enc(p),d)},
    update:async d=>{await call('PATCH','/db/doc?path='+enc(p),d)},
    delete:async()=>{await call('DELETE','/db/doc?path='+enc(p))},
    onSnapshot:(cb,onErr)=>{let live=true, seq=0; const load=async()=>{const n=++seq; try{const r=await call('GET','/db/doc?path='+enc(p)); if(live&&n===seq)cb(snap(id,r))}catch(e){if(live&&onErr)onErr(e)}};
      load(); const off=addL(DOC_L,p,load); return()=>{live=false;off()}},
    collection:c=>colRef(p+'/'+c)
  }};
  const colRef=(p,q={})=>({
    id:p.slice(p.lastIndexOf('/')+1), path:p,
    doc:id=>docRef(p+'/'+(id||Math.random().toString(36).slice(2,12))),
    where:(f,op,v)=>colRef(p,{...q,wf:f,wo:op,wv:JSON.stringify(v)}),
    orderBy:(f,d)=>colRef(p,{...q,orderBy:f,dir:d||'asc'}),
    limit:n=>colRef(p,{...q,limit:n}),
    get:async()=>{const r=await call('GET','/db/list?'+new URLSearchParams({path:p,...q})); const docs=(r.docs||[]).map(d=>snap(d.id,{exists:true,data:d.data})); return {docs,size:docs.length,empty:!docs.length}},
    onSnapshot:(cb,onErr)=>{let live=true, seq=0; const self=colRef(p,q); const load=async()=>{const n=++seq; try{const s=await self.get(); if(live&&n===seq)cb(s)}catch(e){if(live&&onErr)onErr(e)}};
      load(); const off=addL(COL_L,p,load); return()=>{live=false;off()}}
  });
  const dbNS={doc:docRef,collection:p=>colRef(p)};

  // ---- user ----
  const userNS={
    id:async()=>me.id, me:async()=>({id:me.id,name:me.name||'',email:me.email}),
    isOwner:async()=>!!me.owner, canEdit:async()=>!!me.owner, can:async()=>true,
    profiles:async ids=>Object.fromEntries((ids||[]).map(i=>[i,{id:i,name:i===me.id?(me.name||''):''}])), search:async()=>[]
  };

  // ---- sample: Claude through /api/ask ----
  const b64=blob=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(',')[1]||'');fr.onerror=()=>rej(fr.error);fr.readAsDataURL(blob)});
  async function sample(input,opts){
    opts=opts||{};
    const turns=typeof input==='string'?[{role:'user',content:input}]:(input||[]).map(t=>({role:t.role==='assistant'?'assistant':'user',content:String(t.content==null?'':t.content)}));
    if(!turns.length||turns[turns.length-1].role!=='user')turns.push({role:'user',content:'.'});
    const imgs=[]; for(const im of (opts.images||[])){try{imgs.push({type:'image',source:{type:'base64',media_type:im.type||'image/jpeg',data:await b64(im)}})}catch(e){}}
    const messages=turns.map((t,i)=>i===turns.length-1&&imgs.length?{role:t.role,content:[...imgs,{type:'text',text:t.content}]}:{role:t.role,content:t.content});
    const tier=opts.modelTier==='quick'||opts.modelTier==='complex'?opts.modelTier:'default';
    const body={model:MODELS[tier],max_tokens:8192,messages};
    if(opts.json)body.system='Reply with a single JSON value and nothing else: no prose, no code fences.';
    const r=await call('POST','/ask',body,opts.signal);
    const text=((r&&r.content)||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
    if(typeof opts.onText==='function'){try{opts.onText({text,delta:text})}catch(e){}}
    return {text,truncated:!!(r&&r.stop_reason==='max_tokens'),modelTierApplied:tier};
  }
  sample.json=async(input,opts)=>{
    const {text}=await sample(input,{...(opts||{}),json:true,onText:null});
    let t=String(text||'').trim(); const m=t.match(/```(?:json)?\s*([\s\S]*?)```/); if(m)t=m[1].trim();
    try{return JSON.parse(t)}catch(e){}
    const a=t.search(/[\[{]/); if(a>=0){const b=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']')); if(b>a){try{return JSON.parse(t.slice(a,b+1))}catch(e){}}}
    throw {code:'invalid_json',message:'The answer was not JSON',text};
  };
  sample.limits=async()=>({maxPromptBytes:400000,images:{maxCount:12}});

  // ---- downloads, the price refresh, permissions ----
  const downloadsNS={save:async({filename,data})=>{const u=URL.createObjectURL(data);const a=document.createElement('a');a.href=u;a.download=filename||'file';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}};
  const mcpNS={
    callTool:async(server,tool,input,opts)=>{if(tool!=='fire_trigger')throw {code:'not_in_manifest',message:'unknown tool'}; const r=await call('POST','/prices',{reason:(input&&input.text)||''},opts&&opts.signal); return {payload:r,result:r}},
    describeTool:async()=>({name:'fire_trigger'})
  };
  const permissionsNS={state:async()=>'granted',request:async()=>({}),manage:async()=>{}};

  return {use:async name=>({db:dbNS,user:userNS,sample,downloads:downloadsNS,mcp:mcpNS,permissions:permissionsNS})[name]||null};
}
