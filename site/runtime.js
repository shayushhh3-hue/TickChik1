// תיק צ׳יק – the page's runtime on the site's own server.
// The page was written against the claude.ai artifact runtime (window.claude.use('db' | 'user' | 'sample' | 'downloads' |
// 'mcp' | 'permissions')). This module serves the same six namespaces from this site's server: documents through
// /api/db, live changes through one event stream, Claude through /api/ask, a price refresh through /api/prices.
// Sign-in is e-mail and password, kept in an HttpOnly cookie; nothing secret is in the page.

const API='/api';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
const MODELS={quick:'claude-haiku-5-5',default:'claude-sonnet-5-5',complex:'claude-sonnet-5-5',files:'claude-fable-5-1',quickfiles:'claude-haiku-5-5'};
// reading uploaded files goes to the strongest model; the server falls back to the next one when it cannot read (FILE_MODELS)
const MODEL_NAMES={'claude-fable-5-1':'המנוע המעמיק','claude-opus-5-5':'המנוע החזק','claude-sonnet-5-5':'המנוע הרגיל','claude-haiku-5-5':'המנוע המהיר'};

async function call(method,url,body,signal){
  let r;
  try{r=await fetch(API+url,{method,credentials:'same-origin',headers:{'x-tc':'1',...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal})}
  catch(e){if(e&&e.name==='AbortError')throw {code:'cancelled',message:'cancelled'};throw {code:'server_unavailable',message:String(e&&e.message||e)}}
  // a stop while the answer is still arriving (a long reading starts its answer early) is a stop, not a broken answer
  let j=null, bad=false; try{j=await r.json()}catch(e){if((e&&e.name==='AbortError')||(signal&&signal.aborted))throw {code:'cancelled',message:'cancelled'}; bad=true}
  // an answer that is not what the server sends (a proxy page, a cut connection) is an error, never "no data"
  if(r.ok&&(bad||j===null||typeof j!=='object'))throw {code:'invalid_response',message:'התשובה מהשרת לא תקינה',status:r.status};
  // a long reading answers 200 early (to keep the connection open); a failure after that comes as {"error":...}
  if(r.ok&&j.error&&j.error.code&&!j.content)throw {code:j.error.code,message:j.error.message||'',status:r.status};
  if(r.ok)return j;
  const code=(j&&j.error&&j.error.code)||(r.status===401||r.status===403?'not_granted':r.status===429?'rate_limited':r.status===413?'too_large':r.status>=500?'upstream_error':'invalid_argument');
  const err={code,message:(j&&j.error&&j.error.message)||('HTTP '+r.status),status:r.status};
  if(r.status===401&&url!=='/login'&&url!=='/me')setTimeout(()=>showGate('login',{err:'החיבור פג. היכנס שוב.'}),0);
  throw err;
}

// ---- the sign-in screen ----
// 25.11 (the owner: "בדף של ההתחברות תוסיף ברקע דברים יפים שקשורים לבורסה והשקעות… וצבעים שתואמים את האתר"): the screen was a
// grey page with a navy button (an orange one at night), none of them the site's. Its colours are the site's own now (the
// page's tokens: the violet accent, the two backgrounds, the inks), and behind the card there is a market drawn in them:
// candles that climb, the line of their closes with its area, a slower average, the volume, a ring of a portfolio's
// parts. A drawing only (aria-hidden, no figures, no names), under a card that stays opaque enough to read; it moves
// once on arrival, and not at all for someone who asked for less motion. The "loading" card of every visit has none
const CSS=`
#tcGate{--g-bg:#F6F5FC;--g-surface:rgb(255 255 255 / .95);--g-ink:#14122E;--g-ink2:#44425F;--g-muted:#5F5D7C;--g-line:#D9D6EC;--g-accent:#7C3AED;--g-accent-ink:#6D28D9;--g-field:#FFFFFF;--g-err:#B91C1C;--g-up:#13773A;--g-down:#C81E1E;--g-ok:#0F6B33;--g-art:.34;--g-r1:#7C3AED;--g-r2:#2DD4BF;--g-r3:#A78BFA;--g-glow:.30;--g-teal:.22;--g-fill:.30;
  position:fixed;inset:0;z-index:1000;background:var(--g-bg);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Heebo,"Segoe UI",Arial,sans-serif;direction:rtl;color:var(--g-ink);overflow:auto}
html[data-theme="dark"] #tcGate{--g-bg:#07071A;--g-surface:rgb(17 18 51 / .93);--g-ink:#F4F3FF;--g-ink2:#C9C8E6;--g-muted:#A5A4CC;--g-line:#3A3C78;--g-accent:#7C3AED;--g-accent-ink:#B9A3FF;--g-field:#0B0B24;--g-err:#FCA5A5;--g-up:#4ADE80;--g-down:#F87171;--g-ok:#86EFAC;--g-art:.7;--g-r1:#8B5CF6;--g-r2:#2DD4BF;--g-r3:#C4B5FD;--g-glow:.46;--g-teal:.26;--g-fill:.42}
html[data-theme="dark"] #tcGate .bgx .vol{opacity:.34} html[data-theme="dark"] #tcGate .bgx .grid{opacity:.6} html[data-theme="dark"] #tcGate .bgx .ln{stroke:#8B5CF6;opacity:.95} html[data-theme="dark"] #tcGate .bgx .avg{opacity:.7}
#tcGate .bgx{position:absolute;inset:0;overflow:hidden;pointer-events:none}
#tcGate .bgx svg{position:absolute;inset:0;width:100%;height:100%;display:block}
#tcGate .bgx .grid{stroke:var(--g-line);stroke-width:1;opacity:.55}
#tcGate .bgx .up{fill:var(--g-up);stroke:var(--g-up)} #tcGate .bgx .dn{fill:var(--g-down);stroke:var(--g-down)}
#tcGate .bgx .cd{opacity:0;animation:tcIn .5s ease-out forwards}
#tcGate .bgx .vol{fill:var(--g-accent);opacity:.16}
#tcGate .bgx .ln{fill:none;stroke:var(--g-accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;opacity:.8;stroke-dasharray:3200;stroke-dashoffset:3200;animation:tcDraw 2.4s ease-out .2s forwards}
#tcGate .bgx .avg{fill:none;stroke:var(--g-accent-ink);stroke-width:2;stroke-dasharray:3 9;stroke-linecap:round;opacity:.55}
#tcGate .bgx .area{opacity:0;animation:tcArea 1.6s ease-out 1.2s forwards}
#tcGate .bgx .blob{animation:tcFloat 16s ease-in-out infinite alternate}
#tcGate .bgx .ring{fill:none} #tcGate .bgx .rg{opacity:.45} html[data-theme="dark"] #tcGate .bgx .rg{opacity:.7}
#tcGate .bgx .ga0{stop-color:var(--g-accent);stop-opacity:var(--g-fill)} #tcGate .bgx .ga1{stop-color:var(--g-accent);stop-opacity:0}
#tcGate .bgx .gb0{stop-color:var(--g-accent);stop-opacity:var(--g-glow)} #tcGate .bgx .gb1{stop-color:var(--g-accent);stop-opacity:0}
#tcGate .bgx .gc0{stop-color:#2DD4BF;stop-opacity:var(--g-teal)} #tcGate .bgx .gc1{stop-color:#2DD4BF;stop-opacity:0}
@keyframes tcIn{to{opacity:var(--g-art)}} @keyframes tcDraw{to{stroke-dashoffset:0}} @keyframes tcArea{to{opacity:1}} @keyframes tcFloat{to{transform:translate(40px,-30px)}}
@media (prefers-reduced-motion:reduce){#tcGate .bgx .cd{animation:none;opacity:var(--g-art)} #tcGate .bgx .ln{animation:none;stroke-dashoffset:0} #tcGate .bgx .area{animation:none;opacity:1} #tcGate .bgx .blob{animation:none}}
#tcGate .card{position:relative;width:min(320px,100%);background:var(--g-surface);border:1px solid var(--g-line);border-radius:14px;padding:18px 18px 16px;box-shadow:0 18px 50px rgb(76 29 149 / .18);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
#tcGate .mark svg{width:22px;height:22px}
#tcGate .mark{display:grid;place-items:center;width:40px;height:40px;margin:0 auto 6px;border-radius:11px;background:var(--g-accent);color:#fff}
#tcGate h1{margin:0;font-size:20px;line-height:1.25;color:var(--g-ink);text-align:center}
#tcGate .sub{margin:0 0 10px;color:var(--g-muted);font-size:13px;line-height:1.4;text-align:center}
#tcGate label{display:block;font-size:13px;color:var(--g-ink2);margin:8px 0 3px}
#tcGate input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;min-height:44px;padding:8px 12px;border:1px solid var(--g-line);border-radius:10px;background:var(--g-field);color:var(--g-ink)}
#tcGate input:focus{outline:2px solid var(--g-accent-ink);outline-offset:1px;border-color:var(--g-accent-ink)}
#tcGate input[type=email]{direction:ltr;text-align:left}
#tcGate .btn{display:block;width:100%;min-height:44px;margin-top:14px;border:0;background:var(--g-accent);color:#fff;border-radius:10px;padding:9px 16px;font:inherit;font-size:15px;font-weight:600;cursor:pointer}
#tcGate .btn:focus-visible,#tcGate .lnk:focus-visible{outline:2px solid var(--g-accent-ink);outline-offset:3px}
#tcGate .btn:disabled{opacity:.6;cursor:default}
#tcGate .note{font-size:12px;color:var(--g-muted);margin:4px 0 0;line-height:1.45;text-align:center}
#tcGate .err{color:var(--g-err);font-size:13px;margin:8px 0 0} #tcGate .err:empty{display:none}
#tcGate .alt{margin:10px 0 0;padding-top:6px;border-top:1px solid var(--g-line);text-align:center;font-size:14px;color:var(--g-ink2)}
#tcGate .lnk{border:0;background:none;min-height:44px;padding:4px 2px;font:inherit;font-size:14px;font-weight:600;color:var(--g-accent-ink);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
#tcGate .fg{margin:2px 0 0;text-align:center} #tcGate .okm{color:var(--g-ok);font-size:13.5px;line-height:1.55;margin:10px 0 0} #tcGate .okm:empty{display:none}
#tcGate .hint{font-size:12px;color:var(--g-muted);margin:4px 0 0}
#tcGate input.code{direction:ltr;text-align:left;letter-spacing:.08em;text-transform:uppercase}
`;
// the market behind the card: the same drawing on every visit (a fixed seed), from the page's own colours
function gateArt(){
  // 25.11 (the owner, on the wide screen's day picture: "אני רוצה שזה ייראה בדיוק ככה גם במחשב וגם במובייל כולל מצב יום ולילה"):
  // one composition on every screen and in both looks: the ring at the top corner, the candles and their line across the
  // screen behind the card, the volume along the bottom, a violet glow above and a teal one below. The drawing is made
  // for the screen's own shape (a unit of it is about a pixel, as on the wide screen), so a phone gets the same picture
  // with fewer candles, not a strip cut out of the wide one
  let seed=20261125; const rnd=()=>{seed=(seed*1664525+1013904223)%4294967296; return seed/4294967296};
  const vw=(()=>{try{return Math.max(320,innerWidth||1280)}catch(e){return 1280}})(), vh=(()=>{try{return Math.max(480,innerHeight||900)}catch(e){return 900}})();
  const W=Math.round(vw/1.0667), H=Math.round(vh/1.0667), k=H/800, small=W<700, N=Math.max(8,Math.round(W/40)), step=W/N, bw=18, Y=y=>y*k;
  let c=560; const C=[];
  for(let n=0;n<N;n++){const drift=-9.5*30/N+(rnd()-0.42)*46, o=c, cl=Math.max(150,Math.min(640,o+drift)), hi=Math.min(o,cl)-8-rnd()*26, lo=Math.max(o,cl)+8+rnd()*26; c=cl; C.push({x:step*n+step/2,o,cl,hi,lo,v:24+rnd()*86})}
  let cd='', vol='', sum=0; const pts=[], avg=[];
  C.forEach((q,n)=>{const up=q.cl<=q.o, y0=Y(Math.min(q.o,q.cl)), y1=Y(Math.max(q.o,q.cl));
    cd+=`<g class="cd ${up?'up':'dn'}" style="animation-delay:${n*45}ms"><line x1="${q.x.toFixed(1)}" x2="${q.x.toFixed(1)}" y1="${Y(q.hi).toFixed(1)}" y2="${Y(q.lo).toFixed(1)}" stroke-width="2"/><rect x="${(q.x-bw/2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw}" height="${Math.max(4,y1-y0).toFixed(1)}" rx="3"/></g>`;
    vol+=`<rect class="vol" x="${(q.x-bw/2).toFixed(1)}" y="${(H-q.v).toFixed(1)}" width="${bw}" height="${q.v.toFixed(1)}" rx="3"/>`;
    pts.push([q.x,Y(q.cl)]); sum+=q.cl; avg.push([q.x,Y(sum/(n+1)+34)])});
  // the line and its area reach both edges of the screen
  const edge=P=>[[0,P[0][1]],...P,[W,P[P.length-1][1]]], path=P=>P.map((q,n)=>(n?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' ');
  const grid=[160,280,400,520,640].map(y=>`<line class="grid" x1="0" x2="${W}" y1="${Y(y).toFixed(1)}" y2="${Y(y).toFixed(1)}"/>`).join('');
  const rr=small?46:86, rc=rr+(small?26:64), sw=small?16:26;
  const ring=parts=>{const L=2*Math.PI*rr; let off=0; return parts.map(([f,col])=>{const q=`<circle class="ring" cx="${rc}" cy="${rc}" r="${rr}" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${(L*f-10).toFixed(1)} ${(L-(L*f-10)).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${rc} ${rc})"/>`; off+=L*f; return q}).join('')};
  return `<div class="bgx" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" focusable="false">
    <defs><linearGradient id="tcGa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ga0"/><stop offset="1" class="ga1"/></linearGradient>
      <radialGradient id="tcGb"><stop offset="0" class="gb0"/><stop offset="1" class="gb1"/></radialGradient>
      <radialGradient id="tcGc"><stop offset="0" class="gc0"/><stop offset="1" class="gc1"/></radialGradient></defs>
    <circle class="blob" cx="${(W-190*Math.min(1,W/1200)*1.6).toFixed(0)}" cy="130" r="${Math.min(330,W*0.62).toFixed(0)}" fill="url(#tcGb)"/><circle class="blob" cx="${Math.min(170,W*0.3).toFixed(0)}" cy="${(H-110).toFixed(0)}" r="${Math.min(300,W*0.6).toFixed(0)}" fill="url(#tcGc)" style="animation-delay:-6s"/>
    ${grid}${vol}
    <path class="area" d="${path(edge(pts))} L${W} ${H} L0 ${H} Z" fill="url(#tcGa)"/>
    ${cd}<path class="avg" d="${path(edge(avg))}"/><path class="ln" d="${path(edge(pts))}"/>
    <g class="rg">${ring([[0.46,'var(--g-r1)'],[0.3,'var(--g-r2)'],[0.24,'var(--g-r3)']])}</g>
  </svg></div>`}
// the drawing follows the screen when its shape changes (a phone turned on its side, a window pulled)
let GATE_RS=0; try{addEventListener('resize',()=>{clearTimeout(GATE_RS); GATE_RS=setTimeout(()=>{for(const b of document.querySelectorAll('#tcGate .bgx,#tcBg .bgx'))b.outerHTML=gateArt()},200)})}catch(e){}
// 25.11 (the owner: "the background of the sign-in page, on the site too"): the same market, behind every screen of the
// site once signed in. Fixed behind the page (under its text and cards, never taking a tap), fainter than on the sign-in
// screen so the figures over it stay easy to read, and still: nothing moves behind a page one works in. Not printed
const BG_CSS=`#tcBg{--g-line:#D9D6EC;--g-accent:#7C3AED;--g-accent-ink:#6D28D9;--g-up:#13773A;--g-down:#C81E1E;--g-art:.34;--g-r1:#7C3AED;--g-r2:#2DD4BF;--g-r3:#A78BFA;--g-glow:.30;--g-teal:.22;--g-fill:.30;position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.5}
html[data-theme="dark"] #tcBg{--g-line:#3A3C78;--g-accent-ink:#B9A3FF;--g-up:#4ADE80;--g-down:#F87171;--g-art:.7;--g-r1:#8B5CF6;--g-r3:#C4B5FD;--g-glow:.46;--g-teal:.26;--g-fill:.42;opacity:.42}
`+CSS.split('\n').filter(l=>l.includes('.bgx')&&!l.startsWith('@media')).join('\n').replace(/#tcGate/g,'#tcBg')+`
#tcBg .bgx .cd{animation:none;opacity:var(--g-art)} #tcBg .bgx .ln{animation:none;stroke-dashoffset:0} #tcBg .bgx .area{animation:none;opacity:1} #tcBg .bgx .blob{animation:none}
@media print{#tcBg{display:none}}`;
function siteBg(){try{if(document.getElementById('tcBg')||!document.body)return; const st=document.createElement('style'); st.textContent=BG_CSS; document.head.appendChild(st);
  const el=document.createElement('div'); el.id='tcBg'; el.setAttribute('aria-hidden','true'); el.innerHTML=gateArt(); document.body.prepend(el)}catch(e){}}
const GATE_MARK='<div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg></div>';
function gateEl(){
  let el=document.getElementById('tcGate');
  if(!el){const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
    el=document.createElement('div');el.id='tcGate';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','tcGateH');
    (document.body||document.documentElement).appendChild(el)}
  return el;
}
let GATE_DONE=null, SIGNUP=false;
const INVITE=(()=>{try{return new URLSearchParams(location.search).get('invite')||''}catch(e){return ''}})();
// 1.11: /admin sends a signed-out visitor here with ?next=admin; after signing in, someone allowed goes back there
const RESET=(()=>{try{const u=new URL(location.href), t=u.searchParams.get('reset')||''; if(!t)return ''; u.searchParams.delete('reset'); history.replaceState(null,'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams:'')+u.hash); return t}catch(e){return ''}})();
const NEXT_ADMIN=(()=>{try{return new URLSearchParams(location.search).get('next')==='admin'}catch(e){return false}})();
function showGate(kind,x={}){
  const el=gateEl(), head=`${GATE_MARK}<h1 id="tcGateH">תיק צ׳יק</h1><p class="sub">חדר המסחר שלי</p>`, art=gateArt();
  if(kind==='loading'){el.innerHTML=`<div class="card">${head}<p class="sub">טוען…</p></div>`;return}
  if(kind==='login'){
    el.innerHTML=`${art}<div class="card">${head}<form id="tcLogin" novalidate><label for="tcEmail">מייל</label><input id="tcEmail" type="email" autocomplete="username" required value="${esc(x.email||'')}">
      <label for="tcPass">סיסמה</label><input id="tcPass" type="password" autocomplete="current-password" required>
      <div id="tcCodeBox" hidden><label for="tcOtp">הקוד מאפליקציית האימות</label><input id="tcOtp" class="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="11" placeholder="6 ספרות"><p class="hint">אין את הטלפון? אפשר להקליד אחד מקודי הגיבוי.</p></div>
      <button class="btn" type="submit">כניסה</button><p class="err" id="tcErr" role="alert">${esc(x.err||'')}</p>${x.ok?`<p class="okm" role="status">${esc(x.ok)}</p>`:''}</form>
      <p class="fg"><button type="button" class="lnk" id="tcForgot">שכחתי את הסיסמה</button></p>
      ${SIGNUP?'<p class="alt">משתמש חדש? <button type="button" class="lnk" id="tcToReg">הרשמה עם קוד הזמנה</button></p>':''}
      <p class="note">הנתונים שלך נשמרים בחשבון שלך ואינם גלויים למשתמשים אחרים.${SIGNUP?'':' את החשבון פותח בעל הדף.'}</p></div>`;
    const f=document.getElementById('tcLogin'), toReg=document.getElementById('tcToReg');
    document.getElementById('tcForgot').addEventListener('click',()=>showGate('forgot',{email:document.getElementById('tcEmail').value}));
    if(toReg)toReg.addEventListener('click',()=>showGate('register',{email:document.getElementById('tcEmail').value})); setTimeout(()=>{try{document.getElementById(x.email?'tcPass':'tcEmail').focus()}catch(e){}},30);
    f.addEventListener('submit',async ev=>{ev.preventDefault(); const b=f.querySelector('button'); b.disabled=true; document.getElementById('tcErr').textContent='';
      const cb=document.getElementById('tcCodeBox'), otp=document.getElementById('tcOtp');
      try{const r=await call('POST','/login',{email:document.getElementById('tcEmail').value,password:document.getElementById('tcPass').value,...(cb.hidden?{}:{code:otp.value})}); if(NEXT_ADMIN&&r&&r.me&&r.me.mc){location.href='/admin';return} location.reload()}
      catch(e){b.disabled=false; if(e.code==='need_code'||e.code==='bad_code'){cb.hidden=false; otp.value=''; setTimeout(()=>{try{otp.focus()}catch(x){}},20)}
        document.getElementById('tcErr').textContent=e.message||'הכניסה לא הצליחה.'}});
    return;
  }
  // "שכחתי את הסיסמה": the address, and a letter with a link; the answer is the same for an address the site does not know
  if(kind==='forgot'){
    el.innerHTML=`${art}<div class="card">${head}<p class="sub">שכחת את הסיסמה? נשלח קישור למייל שלך, ודרכו בוחרים סיסמה חדשה.</p><form id="tcFg" novalidate>
      <label for="tcEmail">המייל של החשבון</label><input id="tcEmail" type="email" autocomplete="username" required value="${esc(x.email||'')}">
      <button class="btn" type="submit">לשלוח לי קישור</button><p class="err" id="tcErr" role="alert"></p><p class="okm" id="tcOkm" role="status"></p></form>
      <p class="alt"><button type="button" class="lnk" id="tcToLog">חזרה לכניסה</button></p></div>`;
    const f=document.getElementById('tcFg'); setTimeout(()=>{try{document.getElementById('tcEmail').focus()}catch(e){}},30);
    document.getElementById('tcToLog').addEventListener('click',()=>showGate('login',{email:document.getElementById('tcEmail').value}));
    f.addEventListener('submit',async ev=>{ev.preventDefault(); const b=f.querySelector('button[type=submit]'), er=document.getElementById('tcErr'), ok=document.getElementById('tcOkm'), em=document.getElementById('tcEmail').value.trim(); er.textContent=''; ok.textContent='';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){er.textContent='כתוב את כתובת המייל של החשבון.';return}
      b.disabled=true;
      try{const r=await call('POST','/forgot',{email:em}); ok.textContent=`אם הכתובת רשומה באתר, נשלח אליה עכשיו מייל עם קישור לבחירת סיסמה חדשה. הקישור תקף ל-${(r&&r.minutes)||30} דקות. לא הגיע? כדאי לבדוק גם בתיקיית הספאם.`; b.textContent='נשלח'}
      catch(e){b.disabled=false; er.textContent=e.message||'השליחה לא הצליחה. נסה שוב.'}});
    return;
  }
  // the link of the letter: a new password, twice; then the sign-in, with it
  if(kind==='reset'){
    el.innerHTML=`${art}<div class="card">${head}<p class="sub">בחירת סיסמה חדשה לחשבון</p><form id="tcRs" novalidate>
      <label for="tcNew">סיסמה חדשה (8 תווים לפחות)</label><input id="tcNew" type="password" autocomplete="new-password" minlength="8" required>
      <label for="tcNew2">הסיסמה שוב</label><input id="tcNew2" type="password" autocomplete="new-password" minlength="8" required>
      <button class="btn" type="submit">שמירת הסיסמה</button><p class="err" id="tcErr" role="alert"></p></form>
      <p class="alt"><button type="button" class="lnk" id="tcToLog">חזרה לכניסה</button></p></div>`;
    const f=document.getElementById('tcRs'); setTimeout(()=>{try{document.getElementById('tcNew').focus()}catch(e){}},30);
    document.getElementById('tcToLog').addEventListener('click',()=>showGate('login'));
    f.addEventListener('submit',async ev=>{ev.preventDefault(); const b=f.querySelector('button[type=submit]'), er=document.getElementById('tcErr'), pw=document.getElementById('tcNew').value; er.textContent='';
      if(pw.length<8){er.textContent='סיסמה של 8 תווים לפחות.';return}
      if(pw!==document.getElementById('tcNew2').value){er.textContent='שתי הסיסמאות לא זהות.';return}
      b.disabled=true;
      try{const r=await call('POST','/reset',{token:x.token,password:pw}); showGate('login',{email:(r&&r.email)||'',ok:'הסיסמה הוחלפה. אפשר להיכנס איתה עכשיו.'})}
      catch(e){b.disabled=false; er.textContent=e.message||'השמירה לא הצליחה.'; if(e.code==='bad_token'){const a=document.createElement('button'); a.type='button'; a.className='lnk'; a.textContent='לבקש קישור חדש'; a.addEventListener('click',()=>showGate('forgot')); er.appendChild(document.createTextNode(' ')); er.appendChild(a)}}});
    return;
  }
  if(kind==='register'){
    el.innerHTML=`${art}<div class="card">${head}<p class="sub">הרשמה עם קוד הזמנה מבעל הדף</p><form id="tcReg" novalidate>
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
    el.innerHTML=`${art}<div class="card">${head}<p class="sub">ברוך הבא. בחר סיסמה משלך במקום זו שקיבלת.</p><form id="tcChg" novalidate>
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
// the page shows a line while a document it follows has failed to load, and hides it once that document loads
const tell=(path,ok,e)=>{try{window.dispatchEvent(new CustomEvent('tc-load',{detail:{path,ok,code:e&&e.code}}))}catch(x){}};
const retry=(e,i,load,alive)=>{if(i>=3||!e||e.code==='not_granted'||e.code==='permission_denied'||e.code==='cancelled')return; setTimeout(()=>{if(alive())load()},[5000,20000,60000][i])};
const addL=(map,k,f)=>{const s=map.get(k)||new Set(); s.add(f); map.set(k,s); return()=>{s.delete(f)}};

export async function boot(){
  showGate('loading');
  let who=null; try{who=await call('GET','/me')}catch(e){showGate('error',{err:'השרת לא זמין כרגע. נסה שוב בעוד רגע.'});return {use:async()=>null}}
  if((!who||!who.me)&&RESET){SIGNUP=!!who&&!!who.signup; showGate('reset',{token:RESET}); return {use:()=>new Promise(()=>{})}}
  if(!who||!who.me){SIGNUP=!!who&&!!who.signup; showGate(SIGNUP&&INVITE?'register':'login',INVITE&&!SIGNUP?{err:'ההרשמה סגורה כרגע. בקש מבעל הדף קוד הזמנה חדש.'}:{}); return {use:()=>new Promise(()=>{})}}
  const me=who.me;
  if(NEXT_ADMIN&&me.mc&&!me.mustChange){location.replace('/admin'); return {use:()=>new Promise(()=>{})}}
  if(me.mustChange){await new Promise(r=>{GATE_DONE=r;showGate('change')})}
  hideGate(); siteBg();
  if((me.owner||me.manage)&&who.persist===false){try{const w=document.createElement('div');w.setAttribute('role','alert');w.style.cssText='position:sticky;top:0;z-index:999;background:#b42318;color:#fff;padding:10px 16px;font:600 14px/1.5 Heebo,Arial,sans-serif;text-align:center;direction:rtl';
    w.textContent='אזהרה: הנתונים לא נשמרים לצמיתות. לשרת ב-Railway לא מחובר דיסק (Volume), ולכן כל עדכון של האתר מוחק את התיקים ואת המשתמשים. אל תעלה נתונים עד שזה יתוקן.';document.body.prepend(w)}catch(e){}}
  // 31.10: owner is the one person whose documents are the site's shared paths; an admin manages the site (manage) and
  // invests in their own area, like a partner
  window.__tc={id:me.id,email:me.email,owner:me.owner,admin:!!me.admin,manage:!!(me.owner||me.manage),mc:!!me.mc,signOut:async()=>{try{await call('POST','/logout',{})}catch(e){} location.reload()}};
  stream();

  // ---- db ----
  const snap=(id,r)=>({id,exists:!!(r&&r.exists),data:()=>r&&r.exists?JSON.parse(JSON.stringify(r.data)):undefined,metadata:{hasPendingWrites:false,fromCache:false}});
  const enc=encodeURIComponent;
  // 8.11: the documents the page reads first are asked for as soon as the user is known, while the page's script is still being
  // read; the page's first read of each takes that answer (if it is under ten seconds old), every later read asks again
  const PREF=new Map();
  try{const b=me.owner?null:'data/users/'+me.id+'/', L=b?['portfolio','settings','plan','history','daily','pulse'].map(n=>b+n):['portfolio/main','settings/main','plan/main','history/main','history/daily','alerts/pulse'];
    for(const p of [...L,'quotes/latest','history/prices'])PREF.set(p,{at:Date.now(),pr:call('GET','/db/doc?path='+enc(p)).catch(()=>null)})}catch(e){}
  const pref=async p=>{const x=PREF.get(p); if(!x)return null; PREF.delete(p); return Date.now()-x.at<10000?await x.pr:null};
  const docRef=p=>{const id=p.slice(p.lastIndexOf('/')+1); return {
    id, path:p,
    get:async()=>snap(id,(await pref(p))||await call('GET','/db/doc?path='+enc(p))),
    set:async d=>{await call('PUT','/db/doc?path='+enc(p),d)},
    update:async d=>{await call('PATCH','/db/doc?path='+enc(p),d)},
    delete:async()=>{await call('DELETE','/db/doc?path='+enc(p))},
    onSnapshot:(cb,onErr)=>{let live=true, seq=0, tries=0; const load=async()=>{const n=++seq; try{const r=(n===1&&await pref(p))||await call('GET','/db/doc?path='+enc(p)); tries=0; if(live&&n===seq){tell(p,true);cb(snap(id,r))}}catch(e){if(live&&n===seq){tell(p,false,e); if(onErr)onErr(e); retry(e,tries++,load,()=>live)}}};
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
    onSnapshot:(cb,onErr)=>{let live=true, seq=0, tries=0; const self=colRef(p,q); const load=async()=>{const n=++seq; try{const s=await self.get(); tries=0; if(live&&n===seq)cb(s)}catch(e){if(live&&n===seq){if(onErr)onErr(e); retry(e,tries++,load,()=>live)}}};
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
    // files / quickfiles: reading a statement, through the server's streaming path, with room for a long answer (a
    // statement of half a year can have hundreds of transactions; the model's thinking counts in the same limit)
    const tier=['quick','complex','files','quickfiles'].includes(opts.modelTier)?opts.modelTier:'default', fileRead=tier==='files'||tier==='quickfiles';
    const body={model:MODELS[tier],max_tokens:fileRead?32000:8192,messages}; if(fileRead)body.purpose='files';
    if(opts.json)body.system='Reply with a single JSON value and nothing else: no prose, no code fences.';
    // 3.11: which part of צ׳יקו asks (the management counts the AI costs by it); a short name, nothing else
    if(typeof opts.feature==='string'&&/^chico_[a-z]{1,12}$/.test(opts.feature))body.feature=opts.feature;
    const r=await call('POST','/ask',body,opts.signal);
    const text=((r&&r.content)||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
    // which model answered, and which could not (the page says so under a reading)
    sample.last={model:(r&&r.model)||body.model,name:MODEL_NAMES[(r&&r.model)||body.model]||(r&&r.model)||body.model,fallbackFrom:((r&&r.fallbackFrom)||[]).map(m=>MODEL_NAMES[m]||m),tier};
    // the same, for this call only (two reads can run at once, and sample.last belongs to whichever ended last)
    if(opts.meta&&typeof opts.meta==='object')Object.assign(opts.meta,sample.last);
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
