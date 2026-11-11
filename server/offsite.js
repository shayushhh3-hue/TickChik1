// 11.11: the off-site copy. The daily full copy of the database (backup.js, on the same volume) is sealed with BACKUP_KEY
// (sealBackup: gzip + AES-256-GCM, the key from the passphrase by scrypt) and uploaded to an S3-compatible bucket: a
// Railway bucket, Cloudflare R2, AWS S3, any of them. So losing the volume loses at most a day, whatever the size (the
// e-mail copy stops at 22MB). Never in the clear: without BACKUP_KEY nothing is uploaded. Kept: the last 30 days and the
// first copy of each month for a year. After each upload the copy is looked up (HEAD) and its size compared.
// The settings, in Railway's variables (the AWS names, or S3_*, or a Railway bucket's own):
//   S3_ENDPOINT (https://t3.storageapi.dev for a Railway bucket), S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
//   S3_REGION (default "auto"), S3_URL_STYLE ("virtual", the default, or "path"), S3_PREFIX (default "tikchik/")
// A request is signed by AWS Signature V4 here, without a library (s3Sign; tested against AWS's own example).
import fs from 'node:fs';
import {createHash, createHmac} from 'node:crypto';
import {sealBackup} from './backup.js';

const pick=(e,...ks)=>{for(const k of ks)if(e[k])return String(e[k]).trim(); return ''};
export function offsiteConf(e=process.env){
  const c={endpoint:pick(e,'S3_ENDPOINT','AWS_ENDPOINT_URL_S3','AWS_ENDPOINT_URL'),bucket:pick(e,'S3_BUCKET','AWS_S3_BUCKET_NAME','BUCKET_NAME'),
    region:pick(e,'S3_REGION','AWS_DEFAULT_REGION','AWS_REGION')||'auto',key:pick(e,'S3_ACCESS_KEY_ID','AWS_ACCESS_KEY_ID'),secret:pick(e,'S3_SECRET_ACCESS_KEY','AWS_SECRET_ACCESS_KEY'),
    style:(pick(e,'S3_URL_STYLE')||'virtual').toLowerCase()==='path'?'path':'virtual',prefix:(pick(e,'S3_PREFIX')||'tikchik/').replace(/^\/+/,'')};
  if(c.endpoint&&!/^https?:\/\//.test(c.endpoint))c.endpoint='https://'+c.endpoint;
  c.ready=!!(c.endpoint&&c.bucket&&c.key&&c.secret); return c}

const sha=b=>createHash('sha256').update(b).digest('hex'), hmac=(k,s)=>createHmac('sha256',k).update(s).digest();
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
// the address of a key, and the headers of a signed request (AWS Signature V4, the payload's hash signed too)
export function s3Sign(c,method,key,{query='',payloadHash=sha(''),now=new Date()}={}){
  const u=new URL(c.endpoint), host=c.style==='path'?u.host:`${c.bucket}.${u.host}`;
  const path=(c.style==='path'?'/'+enc(c.bucket):'')+'/'+String(key||'').split('/').map(enc).join('/');
  const amz=now.toISOString().replace(/[:-]|\.\d{3}/g,''), day=amz.slice(0,8);
  const hdr={host,'x-amz-content-sha256':payloadHash,'x-amz-date':amz}, names=Object.keys(hdr).sort(), signed=names.join(';');
  const canonQ=query?query.split('&').filter(Boolean).map(kv=>{const i=kv.indexOf('='), k=i<0?kv:kv.slice(0,i), v=i<0?'':kv.slice(i+1); return [enc(decodeURIComponent(k)),enc(decodeURIComponent(v))]}).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).map(([k,v])=>k+'='+v).join('&'):'';
  const creq=[method,path,canonQ,names.map(n=>`${n}:${hdr[n]}\n`).join(''),signed,payloadHash].join('\n'), scope=`${day}/${c.region}/s3/aws4_request`;
  const sts=['AWS4-HMAC-SHA256',amz,scope,sha(creq)].join('\n'), kS=hmac(hmac(hmac(hmac('AWS4'+c.secret,day),c.region),'s3'),'aws4_request');
  const auth=`AWS4-HMAC-SHA256 Credential=${c.key}/${scope}, SignedHeaders=${signed}, Signature=${createHmac('sha256',kS).update(sts).digest('hex')}`;
  const {host:_h,...send}=hdr;   // fetch sets the host itself, the same one
  return {url:`${u.protocol}//${host}${path}${canonQ?'?'+canonQ:''}`,headers:{...send,authorization:auth}};
}
async function s3(c,method,key,{body=null,query='',fetch:f=globalThis.fetch,now}={}){
  const {url,headers}=s3Sign(c,method,key,{query,payloadHash:sha(body||''),now});
  const r=await f(url,{method,headers:{...headers,...(body?{'content-type':'application/octet-stream'}:{})},body:body||undefined,signal:AbortSignal.timeout(120000)});
  if(!r.ok&&!(method==='DELETE'&&r.status===404)){let t=''; try{t=(await r.text()).slice(0,200)}catch(e){} throw new Error(`${method} ${r.status}${t?': '+t.replace(/\s+/g,' '):''}`)}
  return r;
}

// which copies stay: the last 30 days, and the first of each month (by its date) for a year
export function keepOf(keys,{now=new Date(),days=30,months=12}={}){
  const dated=keys.map(k=>({k,d:(/full-(\d{4}-\d\d-\d\d)\./.exec(k)||[])[1]})).filter(x=>x.d).sort((a,b)=>a.d<b.d?-1:1);
  const day=now.toISOString().slice(0,10), from=new Date(now.getTime()-days*864e5).toISOString().slice(0,10), monthFrom=new Date(now.getTime()-months*31*864e5).toISOString().slice(0,7);
  const firstOf={}; for(const x of dated){const m=x.d.slice(0,7); if(!firstOf[m])firstOf[m]=x.k}
  return new Set(dated.filter(x=>x.d>=from&&x.d<=day||(x.d.slice(0,7)>=monthFrom&&firstOf[x.d.slice(0,7)]===x.k)).map(x=>x.k));
}

export async function offsiteBackup(store,{file,now=new Date(),log=()=>{},env=process.env,fetch:f=globalThis.fetch}={}){
  const c=offsiteConf(env), pass=env.BACKUP_KEY||'', note=o=>{try{store.setMeta('lastOffsite',JSON.stringify({at:now.toISOString(),...o}))}catch(e){} return o};
  if(!c.ready)return note({ok:false,why:'not_set'});
  if(!pass){log('offsite: BACKUP_KEY is missing; nothing is uploaded in the clear'); return note({ok:false,why:'no_key'})}
  const day=now.toISOString().slice(0,10), key=`${c.prefix}full-${day}.sqlite.gz.enc`;
  try{const sealed=sealBackup(fs.readFileSync(file),pass);
    await s3(c,'PUT',key,{body:sealed,fetch:f,now});
    const h=await s3(c,'HEAD',key,{fetch:f,now}), len=+h.headers.get('content-length');
    if(len!==sealed.length)throw new Error(`the copy in the bucket is ${len} bytes, not ${sealed.length}`);
    // the old copies: listed under the prefix, those outside keepOf removed (a failure here does not fail the copy)
    let removed=0; try{const L=await s3(c,'GET','',{query:`list-type=2&prefix=${enc(c.prefix+'full-')}`,fetch:f,now}), xml=await L.text();
      const keys=[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m=>m[1].replace(/&amp;/g,'&')), keep=keepOf(keys,{now});
      for(const k of keys)if(!keep.has(k)){await s3(c,'DELETE',k,{fetch:f,now}); removed++}}
    catch(e){log('offsite: the old copies were not pruned: '+e.message)}
    log(`offsite: ${key} ${(sealed.length/1e6).toFixed(1)}MB uploaded and checked${removed?`, ${removed} old removed`:''}`);
    return note({ok:true,key,size:sealed.length,removed});
  }catch(e){log('offsite: the upload failed: '+e.message); return note({ok:false,why:'error',err:String(e.message||e).slice(0,200)})}
}
export function offsiteStatus(store,env=process.env){
  const c=offsiteConf(env); let last=null; try{last=JSON.parse(store.getMeta('lastOffsite')||'null')}catch(e){}
  return {ready:c.ready,key:!!env.BACKUP_KEY,bucket:c.ready?c.bucket:null,last};
}
