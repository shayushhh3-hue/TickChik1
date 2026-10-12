// Firestore and Firebase Auth over plain HTTPS, for the jobs (GitHub Actions) and the server functions (Cloudflare).
// Documents go through encodeDoc/decodeDoc, exactly like the page. No SDK, no service account: the jobs sign in as a
// normal (bot) user with email and password, and the security rules say what that user may touch.
import {encodeDoc, decodeDoc} from './docenc.js';

export const ID_TOOLKIT='https://identitytoolkit.googleapis.com/v1';
export const SECURE_TOKEN='https://securetoken.googleapis.com/v1';

// ---- values ----
export function toValue(v){
  if(v===null||v===undefined)return {nullValue:null};
  if(typeof v==='boolean')return {booleanValue:v};
  if(typeof v==='number')return Number.isInteger(v)&&Math.abs(v)<2**53?{integerValue:String(v)}:{doubleValue:Number.isFinite(v)?v:null};
  if(typeof v==='string')return {stringValue:v};
  if(Array.isArray(v))return {arrayValue:{values:v.map(x=>Array.isArray(x)?{stringValue:JSON.stringify(x)}:toValue(x))}};
  if(typeof v==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(v).filter(([k,x])=>x!==undefined).map(([k,x])=>[k,toValue(x)]))}};
  return {stringValue:String(v)};
}
export function fromValue(v){
  if(!v||typeof v!=='object')return null;
  if('nullValue' in v)return null;
  if('booleanValue' in v)return !!v.booleanValue;
  if('integerValue' in v)return Number(v.integerValue);
  if('doubleValue' in v)return v.doubleValue==null?null:Number(v.doubleValue);
  if('stringValue' in v)return v.stringValue;
  if('timestampValue' in v)return v.timestampValue;
  if('arrayValue' in v)return ((v.arrayValue&&v.arrayValue.values)||[]).map(fromValue);
  if('mapValue' in v)return Object.fromEntries(Object.entries((v.mapValue&&v.mapValue.fields)||{}).map(([k,x])=>[k,fromValue(x)]));
  if('referenceValue' in v)return v.referenceValue;
  if('geoPointValue' in v)return v.geoPointValue;
  if('bytesValue' in v)return v.bytesValue;
  return null;
}
export const toFields=obj=>Object.fromEntries(Object.entries(encodeDoc(obj)).map(([k,v])=>[k,toValue(v)]));
export const fromFields=fields=>decodeDoc(Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,fromValue(v)])));

export class FsError extends Error{constructor(status,code,message){super(message||code);this.status=status;this.code=code}}

// ---- auth ----
export async function signInPassword({apiKey,email,password,fetch:f=globalThis.fetch}){
  const r=await f(`${ID_TOOLKIT}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new FsError(r.status,(j.error&&j.error.message)||'auth_failed','sign-in failed: '+((j.error&&j.error.message)||r.status));
  return {idToken:j.idToken,refreshToken:j.refreshToken,uid:j.localId,email:j.email,expiresAt:Date.now()+(+j.expiresIn||3600)*1000-60000};
}
export async function refreshIdToken({apiKey,refreshToken,fetch:f=globalThis.fetch}){
  const r=await f(`${SECURE_TOKEN}/token?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'grant_type=refresh_token&refresh_token='+encodeURIComponent(refreshToken)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new FsError(r.status,'auth_failed','refresh failed');
  return {idToken:j.id_token,refreshToken:j.refresh_token,uid:j.user_id,expiresAt:Date.now()+(+j.expires_in||3600)*1000-60000};
}

// ---- documents ----
export function firestore({projectId,idToken,fetch:f=globalThis.fetch,database='(default)'}){
  const root=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents`;
  const name=path=>`projects/${projectId}/databases/${database}/documents/${path}`;
  const hdr=()=>({authorization:'Bearer '+(typeof idToken==='function'?idToken():idToken),'content-type':'application/json'});
  async function call(method,url,body){
    const r=await f(url,{method,headers:hdr(),body:body==null?undefined:JSON.stringify(body)});
    if(r.status===404)return null;
    const j=await r.json().catch(()=>({}));
    if(!r.ok){const e=(j&&j.error)||{};throw new FsError(r.status,(e.status||'error').toLowerCase(),e.message||('HTTP '+r.status))}
    return j;
  }
  const idOf=n=>n.slice(n.lastIndexOf('/')+1);
  return {
    name, root,
    async getDoc(path){const d=await call('GET',`${root}/${path}`);return d?{id:idOf(d.name),exists:true,data:fromFields(d.fields),updateTime:d.updateTime}:{id:idOf(path),exists:false,data:null}},
    async setDoc(path,data){await call('PATCH',`${root}/${path}`,{fields:toFields(data)})},
    async updateDoc(path,data){const cur=await this.getDoc(path);await this.setDoc(path,deepMerge(cur.exists?cur.data:{},data))},
    async deleteDoc(path){await call('DELETE',`${root}/${path}`)},
    // every document of a collection (ids and data), page by page
    async listDocs(collPath,{pageSize=300,max=5000}={}){
      const out=[]; let token='';
      while(out.length<max){const j=await call('GET',`${root}/${collPath}?pageSize=${pageSize}${token?'&pageToken='+encodeURIComponent(token):''}`);
        for(const d of (j&&j.documents)||[])out.push({id:idOf(d.name),data:fromFields(d.fields),updateTime:d.updateTime});
        token=j&&j.nextPageToken; if(!token)break}
      return out;
    },
    // several writes in one request (up to 500); each {path,data} is a set, {path,delete:true} a delete
    async batch(writes){
      for(let i=0;i<writes.length;i+=400){const part=writes.slice(i,i+400).map(w=>w.delete?{delete:name(w.path)}:{update:{name:name(w.path),fields:toFields(w.data)}});
        await call('POST',`${root.replace(/\/documents$/,'')}/documents:commit`,{writes:part})}
    }
  };
}
const isMap=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function deepMerge(a,b){const o={...(isMap(a)?a:{})};for(const [k,v] of Object.entries(b||{})){if(v===undefined)continue;o[k]=isMap(v)&&isMap(o[k])?deepMerge(o[k],v):v}return o}

// a client that signs in once and refreshes its token when needed
export async function botClient({projectId,apiKey,email,password,fetch:f=globalThis.fetch}){
  let tok=await signInPassword({apiKey,email,password,fetch:f});
  const idToken=()=>tok.idToken;
  const fs=firestore({projectId,idToken,fetch:f});
  fs.uid=tok.uid; fs.email=tok.email;
  fs.ensure=async()=>{if(Date.now()>tok.expiresAt){tok={...tok,...(await refreshIdToken({apiKey,refreshToken:tok.refreshToken,fetch:f}))}}};
  return fs;
}
