// 30.10: notifications to the phone (Web Push), for the owner and for every partner who switched them on on a device.
// The keys (VAPID) come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or are made once and kept in the database. Each
// person's devices are kept apart (meta push:<uid>), never sent to any page. What is pushed is the live alerts
// (server/livealert.js): a price set, a big day, the dollar's rates, a critical reading about a holding. A device that the
// push service says is gone (404 / 410) is dropped.
import webpush from 'web-push';

const MAX_DEV=6;
export function vapid(store,{env=process.env}={}){
  if(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY)return {publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY};
  let k=null; try{k=JSON.parse(store.getMeta('vapid')||'null')}catch(e){}
  if(!k||!k.publicKey||!k.privateKey){k=webpush.generateVAPIDKeys(); store.setMeta('vapid',JSON.stringify(k))}
  return k;
}
const subject=env=>/^https:\/\//.test(env.SITE_URL||'')?env.SITE_URL:'mailto:noreply@tikchik.invalid';
export function devices(store,uid){try{const L=JSON.parse(store.getMeta('push:'+uid)||'[]'); return Array.isArray(L)?L:[]}catch(e){return []}}
const putDevices=(store,uid,L)=>store.setMeta('push:'+uid,JSON.stringify(L.slice(-MAX_DEV)));
// a subscription as the browser gives it: an https endpoint and its two keys
export function cleanSub(s){
  if(!s||typeof s!=='object')return null; const e=String(s.endpoint||''), k=s.keys||{};
  if(!/^https:\/\/[^\s]{10,800}$/.test(e)||!/^[A-Za-z0-9_\-=]{20,200}$/.test(String(k.p256dh||''))||!/^[A-Za-z0-9_\-=]{8,100}$/.test(String(k.auth||'')))return null;
  return {endpoint:e,keys:{p256dh:String(k.p256dh),auth:String(k.auth)}};
}
export function addDevice(store,uid,sub,{ua=''}={}){const s=cleanSub(sub); if(!s)return false;
  const L=devices(store,uid).filter(d=>d.endpoint!==s.endpoint); L.push({...s,at:new Date().toISOString(),ua:String(ua).slice(0,120)}); putDevices(store,uid,L); return true}
export function dropDevice(store,uid,endpoint){const L=devices(store,uid), M=L.filter(d=>d.endpoint!==endpoint); putDevices(store,uid,M); return L.length-M.length}
// every person with a device: the owner and the partners
export function pushUsers(store){return store.users().filter(u=>devices(store,u.id).length)}
// one message to all of a person's devices: {title, body, url, tag}; how many got it
export async function pushTo(store,uid,msg,{env=process.env,send=null,log=()=>{}}={}){
  const L=devices(store,uid); if(!L.length)return 0;
  const k=vapid(store,{env}), opts={TTL:6*3600,urgency:'high',vapidDetails:{subject:subject(env),publicKey:k.publicKey,privateKey:k.privateKey}};
  const go=send||((sub,body,o)=>webpush.sendNotification(sub,body,o)), body=JSON.stringify({title:String(msg.title||'תיק צ׳יק').slice(0,80),body:String(msg.body||'').slice(0,300),url:msg.url||'./',tag:msg.tag||'tc'});
  let n=0; const gone=[];
  for(const d of L){try{await go({endpoint:d.endpoint,keys:d.keys},body,opts); n++}
    catch(e){const c=e&&e.statusCode; if(c===404||c===410)gone.push(d.endpoint); log(`push: ${c||''} ${String(e&&e.message||e).slice(0,120)}`)}}
  if(gone.length)putDevices(store,uid,L.filter(d=>!gone.includes(d.endpoint)));
  return n;
}
