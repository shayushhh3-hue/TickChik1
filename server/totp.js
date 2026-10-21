// Two-step sign-in: a six-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password
// and the like), the standard one (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits), and one-time backup codes for a lost phone.
import {createHmac, randomBytes, createHash, timingSafeEqual} from 'node:crypto';

const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf){let bits=0,v=0,out=''; for(const b of buf){v=(v<<8)|b; bits+=8; while(bits>=5){out+=B32[(v>>>(bits-5))&31]; bits-=5}} if(bits>0)out+=B32[(v<<(5-bits))&31]; return out}
export function b32decode(s){s=String(s||'').toUpperCase().replace(/[\s=-]/g,''); let bits=0,v=0; const out=[]; for(const ch of s){const i=B32.indexOf(ch); if(i<0)throw new Error('bad base32'); v=(v<<5)|i; bits+=5; if(bits>=8){out.push((v>>>(bits-8))&255); bits-=8}} return Buffer.from(out)}
export function hotp(key,counter){
  const c=Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h=createHmac('sha1',key).update(c).digest(), o=h[h.length-1]&15;
  const n=((h[o]&127)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3];
  return String(n%1e6).padStart(6,'0');
}
export const step=(now=Date.now())=>Math.floor(now/30000);
// the counter a code is good for (this 30 seconds, the one before or the one after, for a clock a little off), or -1
export function totpMatch(secret,code,{now=Date.now(),after=-1}={}){
  code=String(code||'').replace(/\s/g,''); if(!/^\d{6}$/.test(code))return -1; const key=b32decode(secret), t=step(now);
  for(const k of [t,t-1,t+1]){if(k<=after)continue; const a=Buffer.from(hotp(key,k)), b=Buffer.from(code); if(a.length===b.length&&timingSafeEqual(a,b))return k}
  return -1;
}
export const newSecret=()=>b32encode(randomBytes(20));
export const otpUri=(secret,email)=>`otpauth://totp/${encodeURIComponent('תיק צ׳יק:'+email)}?secret=${secret}&issuer=${encodeURIComponent('תיק צ׳יק')}&algorithm=SHA1&digits=6&period=30`;
// backup codes: ten characters, shown once; only their hashes are kept
const ABC='abcdefghjkmnpqrstuvwxyz23456789';
export const newBackupCodes=(n=8)=>Array.from({length:n},()=>{const b=randomBytes(10); return [...b].map(x=>ABC[x%ABC.length]).join('').replace(/^(.{5})/,'$1-')});
export const codeHash=c=>createHash('sha256').update(String(c||'').toLowerCase().replace(/[\s-]/g,'')).digest('hex');
