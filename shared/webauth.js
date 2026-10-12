// Who is calling: a Firebase ID token (Google sign-in) checked against Google's published keys, then the invite list.
// Runs on Cloudflare (WebCrypto) and in Node 22. No secrets involved; the token itself proves the person.
const JWKS='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let KEYS={at:0,keys:[],ttl:0};

const b64u=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u};
const txt=u=>new TextDecoder().decode(u);

async function keys(f){
  if(Date.now()-KEYS.at<KEYS.ttl&&KEYS.keys.length)return KEYS.keys;
  const r=await f(JWKS); if(!r.ok)throw new Error('jwks '+r.status);
  const j=await r.json(); const cc=r.headers.get('cache-control')||''; const m=cc.match(/max-age=(\d+)/);
  KEYS={at:Date.now(),keys:j.keys||[],ttl:(m?+m[1]:3600)*1000};
  return KEYS.keys;
}

export class AuthError extends Error{constructor(code,message,status=401){super(message||code);this.code=code;this.status=status}}

export async function verifyIdToken(token,projectId,f=globalThis.fetch){
  const parts=String(token||'').split('.'); if(parts.length!==3)throw new AuthError('not_granted','bad token');
  let hdr,pay; try{hdr=JSON.parse(txt(b64u(parts[0])));pay=JSON.parse(txt(b64u(parts[1])))}catch(e){throw new AuthError('not_granted','bad token')}
  if(hdr.alg!=='RS256')throw new AuthError('not_granted','bad alg');
  const ks=await keys(f); let jwk=ks.find(k=>k.kid===hdr.kid);
  if(!jwk){KEYS.at=0;jwk=(await keys(f)).find(k=>k.kid===hdr.kid)}
  if(!jwk)throw new AuthError('not_granted','unknown key');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const okSig=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64u(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!okSig)throw new AuthError('not_granted','bad signature');
  const now=Math.floor(Date.now()/1000);
  if(pay.aud!==projectId||pay.iss!=='https://securetoken.google.com/'+projectId)throw new AuthError('not_granted','wrong project');
  if(!(pay.exp>now)||pay.iat>now+300||!pay.sub)throw new AuthError('not_granted','expired');
  if(!pay.email)throw new AuthError('not_granted','no email');
  return {uid:pay.sub,email:String(pay.email).toLowerCase(),verified:!!pay.email_verified,name:pay.name||''};
}

// the caller must be the owner or hold an invite document (read with the caller's own token: the rules allow that)
export async function requireUser(request,env,f=globalThis.fetch){
  const auth=request.headers.get('authorization')||''; const m=auth.match(/^Bearer\s+(\S+)$/i);
  if(!m)throw new AuthError('not_granted','no token');
  const u=await verifyIdToken(m[1],env.FIREBASE_PROJECT_ID,f);
  const owner=String(env.OWNER_EMAIL||'').trim().toLowerCase();
  if(u.email===owner)return {...u,owner:true,token:m[1]};
  const r=await f(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/invites/${encodeURIComponent(u.email)}`,{headers:{authorization:'Bearer '+m[1]}});
  if(r.status===200)return {...u,owner:false,token:m[1]};
  throw new AuthError('not_granted','not invited',403);
}

export const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export const fail=e=>json(e&&e.status||500,{error:{code:(e&&e.code)||'server_error',message:(e&&e.message)||'error'}});
