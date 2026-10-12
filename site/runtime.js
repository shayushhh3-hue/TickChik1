// תיק צ׳יק – the runtime of the standalone site.
// The page was written against the claude.ai artifact runtime (window.claude.use('db' | 'user' | 'sample' | 'downloads' |
// 'mcp' | 'permissions')). This module gives the page the same six namespaces on top of Firebase (Google sign-in +
// Firestore) and the site's own server functions (/api/ask for Claude, /api/prices for a price refresh), so the page
// itself did not have to change. Nothing here holds a secret: the Firebase web config is public by design and the
// Claude API key lives only on the server.
import {encodeDoc, decodeDoc} from './docenc.js';

const SDK='https://www.gstatic.com/firebasejs/12.19.0/';
const DEFAULT_MODELS={quick:'claude-haiku-5-5',default:'claude-sonnet-5-5',complex:'claude-sonnet-5-5'};

async function loadFirebase(){
  if(window.__FB)return window.__FB; // the tests hand in a fake
  const [app,auth,fs]=await Promise.all([import(SDK+'firebase-app.js'),import(SDK+'firebase-auth.js'),import(SDK+'firebase-firestore.js')]);
  return {...app,...auth,...fs};
}

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
function deepMerge(a,b){const o={...(isMap(a)?a:{})};for(const [k,v] of Object.entries(b||{})){if(v===undefined)continue;o[k]=isMap(v)&&isMap(o[k])?deepMerge(o[k],v):v}return o}
const normCode=e=>String((e&&e.code)||'').replace(/^(firestore|auth)\//,'').replace(/-/g,'_')||'unknown';

// ---- the sign-in screen -----------------------------------------------------------------------------------------
const CSS=`
#tcGate{position:fixed;inset:0;z-index:1000;background:#f3f5f8;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Heebo,"Segoe UI",Arial,sans-serif;direction:rtl;color:#1e293b}
#tcGate .card{width:min(420px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;box-shadow:0 8px 30px rgb(30 52 78 / .10);text-align:center}
#tcGate h1{margin:0 0 4px;font-size:26px;color:#1e344e}
#tcGate .sub{margin:0 0 18px;color:#64748b;font-size:14px}
#tcGate p{margin:10px 0;font-size:14.5px;line-height:1.6}
#tcGate .btn{display:inline-flex;align-items:center;gap:10px;border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:10px 18px;font-size:15px;font-weight:600;cursor:pointer;color:#1e293b;font-family:inherit}
#tcGate .btn.pri{background:#1e344e;color:#fff;border-color:#1e344e}
#tcGate .btn:disabled{opacity:.6;cursor:default}
#tcGate .note{font-size:12.5px;color:#64748b;margin-top:16px}
#tcGate .err{color:#b91c1c;font-size:13.5px}
#tcGate .mail{direction:ltr;unicode-bidi:isolate;font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#f1f5f9;border-radius:6px;padding:2px 6px}
#tcGate .g{width:18px;height:18px}
`;
const GLOGO='<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

function gate(){
  let el=document.getElementById('tcGate');
  if(!el){const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
    el=document.createElement('div');el.id='tcGate';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','tcGateH');
    (document.body||document.documentElement).appendChild(el)}
  return el;
}
function show(kind,x={}){
  const el=gate(); const head=`<h1 id="tcGateH">תיק צ׳יק</h1><p class="sub">חדר המסחר שלי</p>`;
  const body=kind==='loading'?`<p>טוען…</p>`
    :kind==='signin'?`<p>כניסה לתיק שלך עם חשבון Google.</p><button class="btn" type="button" id="tcGoogle">${GLOGO}<span>כניסה עם Google</span></button>${x.err?`<p class="err">${esc(x.err)}</p>`:''}<p class="note">הנתונים שלך נשמרים בחשבון שלך ואינם גלויים למשתמשים אחרים. מי שלא הוזמן לא יכול להיכנס.</p>`
    :kind==='busy'?`<p>מתחבר…</p>`
    :kind==='noinvite'?`<p>החשבון <span class="mail">${esc(x.email)}</span> לא מוזמן לדף הזה.</p><p>בקש מבעל הדף להוסיף את הכתובת הזו ברשימת המוזמנים, ואז היכנס שוב.</p><button class="btn" type="button" id="tcOut">יציאה</button>`
    :kind==='noconfig'?`<p class="err">האתר עוד לא הוגדר: חסרים פרטי Firebase בקובץ config.js.</p><p class="note">ראה את מדריך ההקמה (SETUP.md) שבמאגר.</p>`
    :`<p class="err">${esc(x.err||'שגיאה')}</p><button class="btn" type="button" id="tcRetry">לנסות שוב</button>`;
  el.innerHTML=`<div class="card">${head}${body}</div>`;
  el.hidden=false;
}
function hideGate(){const el=document.getElementById('tcGate');if(el)el.remove()}

// ---- boot --------------------------------------------------------------------------------------------------------
export async function boot(cfg){
  cfg=cfg||{}; const models={...DEFAULT_MODELS,...(cfg.models||{})}, API=(cfg.api||'/api').replace(/\/$/,'');
  const ownerEmail=String(cfg.ownerEmail||'').trim().toLowerCase();
  if(!cfg.firebase||!cfg.firebase.apiKey||!cfg.firebase.projectId||!ownerEmail){show('noconfig');return {use:async()=>null}}
  const FB=await loadFirebase();
  const app=FB.initializeApp(cfg.firebase);
  const auth=FB.getAuth(app);
  const fs=FB.initializeFirestore(app,{ignoreUndefinedProperties:true});
  try{await FB.setPersistence(auth,FB.browserLocalPersistence)}catch(e){}

  // who is signed in, and whether they may use the page
  let me=null, owner=false, resolveReady, readyFailed=false;
  const ready=new Promise(r=>{resolveReady=r});
  const emailOf=u=>String((u&&u.email)||'').toLowerCase();
  async function invited(u){
    if(!u||!u.email)return false;
    if(emailOf(u)===ownerEmail)return true;
    try{const s=await FB.getDoc(FB.doc(fs,'invites/'+emailOf(u)));return s.exists()}catch(e){return false}
  }
  async function signIn(){
    show('busy');
    try{const p=new FB.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});await FB.signInWithPopup(auth,p)}
    catch(e){const c=normCode(e);
      if(c==='popup_blocked'||c==='operation_not_supported_in_this_environment'){try{await FB.signInWithRedirect(auth,new FB.GoogleAuthProvider());return}catch(e2){}}
      if(c!=='popup_closed_by_user'&&c!=='cancelled_popup_request')show('signin',{err:'הכניסה לא הצליחה ('+c+'). נסה שוב.'});else show('signin');
    }
  }
  document.addEventListener('click',ev=>{
    if(ev.target.closest('#tcGoogle'))signIn();
    else if(ev.target.closest('#tcOut')){FB.signOut(auth).then(()=>location.reload())}
    else if(ev.target.closest('#tcRetry'))location.reload();
  });
  show('loading');
  try{await FB.getRedirectResult(auth)}catch(e){}
  FB.onAuthStateChanged(auth,async u=>{
    if(!u){me=null;show('signin');return}
    show('busy');
    if(!(await invited(u))){show('noinvite',{email:u.email});return}
    me=u; owner=emailOf(u)===ownerEmail;
    window.__tc={uid:u.uid,email:u.email,owner,signOut:()=>FB.signOut(auth).then(()=>location.reload())};
    hideGate(); resolveReady();
  });

  // ---- db: the artifact's Firestore-shaped API, over Firestore ----
  const snapOf=s=>({id:s.id,exists:s.exists(),data:()=>s.exists()?decodeDoc(s.data()):undefined,metadata:{hasPendingWrites:!!(s.metadata&&s.metadata.hasPendingWrites),fromCache:!!(s.metadata&&s.metadata.fromCache)}});
  const qsnapOf=q=>({docs:q.docs.map(snapOf),size:q.size,empty:q.empty});
  const err=e=>{const c=normCode(e);const o={code:c==='permission_denied'&&!owner?'invalid_argument':c,message:(e&&e.message)||c};return o};
  const wrapDoc=ref=>({
    id:ref.id, path:ref.path,
    get:async()=>{try{return snapOf(await FB.getDoc(ref))}catch(e){throw err(e)}},
    set:async d=>{try{await FB.setDoc(ref,encodeDoc(d))}catch(e){throw err(e)}},
    // update merges into the stored document, maps deep (as a Firestore set with merge would), arrays and scalars replaced
    update:async d=>{try{const s=await FB.getDoc(ref);const cur=s.exists()?decodeDoc(s.data()):{};await FB.setDoc(ref,encodeDoc(deepMerge(cur,d)))}catch(e){throw err(e)}},
    delete:async()=>{try{await FB.deleteDoc(ref)}catch(e){throw err(e)}},
    onSnapshot:(cb,onErr)=>FB.onSnapshot(ref,s=>cb(snapOf(s)),e=>{if(onErr)onErr(err(e))}),
    collection:p=>wrapColl(FB.collection(ref,p))
  });
  const wrapColl=(ref,cons=[])=>({
    id:ref.id, path:ref.path,
    doc:id=>wrapDoc(id?FB.doc(ref,id):FB.doc(ref)),
    where:(f,op,v)=>wrapColl(ref,[...cons,FB.where(f,op,v)]),
    orderBy:(f,d)=>wrapColl(ref,[...cons,FB.orderBy(f,d||'asc')]),
    limit:n=>wrapColl(ref,[...cons,FB.limit(n)]),
    get:async()=>{try{return qsnapOf(await FB.getDocs(cons.length?FB.query(ref,...cons):ref))}catch(e){throw err(e)}},
    onSnapshot:(cb,onErr)=>FB.onSnapshot(cons.length?FB.query(ref,...cons):ref,q=>cb(qsnapOf(q)),e=>{if(onErr)onErr(err(e))})
  });
  const dbNS={doc:p=>wrapDoc(FB.doc(fs,p)),collection:p=>wrapColl(FB.collection(fs,p))};

  // ---- user ----
  const userNS={
    id:async()=>me?me.uid:null,
    me:async()=>({id:me?me.uid:'',name:me?(me.displayName||''):'',email:me?me.email:''}),
    isOwner:async()=>owner, canEdit:async()=>owner,
    can:async name=>owner?true:name==='data.write'?true:false,
    profiles:async ids=>Object.fromEntries((ids||[]).map(i=>[i,{id:i,name:i===(me&&me.uid)?(me.displayName||''):''}])),
    search:async()=>[]
  };

  // ---- the server: a signed call to this site's functions ----
  async function call(path,body,signal){
    const tok=await me.getIdToken();
    let r;
    try{r=await fetch(API+'/'+path,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+tok},body:JSON.stringify(body),signal})}
    catch(e){if(e&&e.name==='AbortError')throw {code:'cancelled',message:'cancelled'};throw {code:'server_unavailable',message:String(e&&e.message||e)}}
    let j=null; try{j=await r.json()}catch(e){}
    if(r.ok)return j;
    const code=(j&&j.error&&j.error.code)||(r.status===401||r.status===403?'not_granted':r.status===429?'rate_limited':r.status===413?'too_large':r.status>=500?'upstream_error':'invalid_argument');
    throw {code,message:(j&&j.error&&j.error.message)||('HTTP '+r.status)};
  }

  // ---- sample: Claude through /api/ask ----
  const b64=blob=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(',')[1]||'');fr.onerror=()=>rej(fr.error);fr.readAsDataURL(blob)});
  async function buildBody(input,opts){
    const turns=typeof input==='string'?[{role:'user',content:input}]:(input||[]).map(t=>({role:t.role==='assistant'?'assistant':'user',content:String(t.content==null?'':t.content)}));
    if(!turns.length||turns[turns.length-1].role!=='user')turns.push({role:'user',content:'.'});
    const imgs=[]; for(const im of (opts.images||[])){try{imgs.push({type:'image',source:{type:'base64',media_type:im.type||'image/jpeg',data:await b64(im)}})}catch(e){}}
    const messages=turns.map((t,i)=>i===turns.length-1&&imgs.length?{role:t.role,content:[...imgs,{type:'text',text:t.content}]}:{role:t.role,content:t.content});
    const tier=opts.modelTier==='quick'||opts.modelTier==='complex'?opts.modelTier:'default';
    const body={model:models[tier]||models.default,max_tokens:tier==='quick'?4096:8192,messages};
    if(opts.json)body.system='Reply with a single JSON value and nothing else: no prose, no code fences.';
    return body;
  }
  async function sample(input,opts){
    opts=opts||{};
    const body=await buildBody(input,opts);
    const r=await call('ask',body,opts.signal);
    const text=((r&&r.content)||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
    return {text,truncated:!!(r&&r.stop_reason==='max_tokens'),modelTierApplied:opts.modelTier||'default'};
  }
  sample.json=async(input,opts)=>{
    const {text}=await sample(input,{...(opts||{}),json:true});
    let t=String(text||'').trim(); const m=t.match(/```(?:json)?\s*([\s\S]*?)```/); if(m)t=m[1].trim();
    try{return JSON.parse(t)}catch(e){}
    const a=t.search(/[\[{]/); if(a>=0){const b=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']')); if(b>a){try{return JSON.parse(t.slice(a,b+1))}catch(e){}}}
    throw {code:'invalid_json',message:'The answer was not JSON',text};
  };
  sample.limits=async()=>({maxPromptBytes:400000,images:{maxCount:12}});

  // ---- downloads ----
  const downloadsNS={save:async({filename,data})=>{const u=URL.createObjectURL(data);const a=document.createElement('a');a.href=u;a.download=filename||'file';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}};

  // ---- mcp: the page's "fire the price task" becomes a call to /api/prices ----
  const mcpNS={
    callTool:async(server,tool,input,opts)=>{
      if(tool!=='fire_trigger')throw {code:'not_in_manifest',message:'unknown tool'};
      const r=await call('prices',{reason:(input&&input.text)||''},opts&&opts.signal);
      return {payload:r,result:r};
    },
    describeTool:async()=>({name:'fire_trigger'})
  };
  const permissionsNS={state:async()=>'granted',request:async()=>({}),manage:async()=>{}};

  return {
    use:async name=>{
      if(name==='downloads')return downloadsNS;
      if(name==='permissions')return permissionsNS;
      await ready;
      if(name==='db')return dbNS;
      if(name==='user')return userNS;
      if(name==='sample')return sample;
      if(name==='mcp')return mcpNS;
      return null;
    }
  };
}
