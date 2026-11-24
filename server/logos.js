// 24.11 (the owner: "שלא יהיו חברות בלי אייקונים"): a company's logo for a security the page's own sheets lack (most of the
// Tel Aviv shares, the US shares outside the sheets, other exchanges). Fetched once from a public logo source
// (financialmodelingprep.com/image-stock, no key: US symbols, TEVA.TA for Tel Aviv, 0700.HK for another exchange), kept on
// the server's disk, and served from the site itself (the page's CSP allows images only from 'self'). A symbol the source
// does not have is remembered for a week; the page then keeps its issuer's tile or its monogram.
import fs from 'node:fs';
import path from 'node:path';

const SRC=t=>`https://financialmodelingprep.com/image-stock/${encodeURIComponent(t)}.png`;
const PNG=Buffer.from([0x89,0x50,0x4e,0x47]);
// the security's key on the page → the source's ticker; null when no company stands behind it (a fund by its number, an index)
export function logoTicker(key){
  const k=String(key||'').trim().toUpperCase();
  if(/^TLV:[A-Z][A-Z0-9.\-]{0,7}$/.test(k))return k.slice(4).replace(/\./g,'-')+'.TA';
  if(/^[A-Z][A-Z.\-]{0,5}$/.test(k))return k.replace(/\./g,'-');
  if(/^[A-Z0-9][A-Z0-9\-]{0,8}\.[A-Z]{1,3}$/.test(k))return k;
  return null;
}
const fileOf=t=>t.replace(/[^A-Z0-9.\-]/g,'_');
// the source sometimes holds a photo (Bank Hapoalim: its head office) where a logo belongs: an opaque RGB picture of some
// size that compresses poorly (over 1.5 bytes a pixel; the logos are 0.3-0.7, a photo 2+). Not shown: the monogram is
export function looksLikePhoto(b){if(!b||b.length<33)return false; const w=b.readUInt32BE(16), h=b.readUInt32BE(20), ct=b[25];
  return ct===2&&w>=64&&h>=64&&b.length/(w*h)>1.5}
export function logoStore(dir,{fetch:f=globalThis.fetch,now=()=>Date.now(),weekMs=7*864e5}={}){
  const NONE=new Map(), BUSY=new Map(); let made=false;
  const mk=()=>{if(!made){try{fs.mkdirSync(dir,{recursive:true})}catch(e){} made=true}};
  async function get(key){
    const t=logoTicker(key); if(!t)return null;
    const file=path.join(dir,fileOf(t)+'.png'), none=path.join(dir,fileOf(t)+'.none');
    try{return fs.readFileSync(file)}catch(e){}
    const n=NONE.get(t)??(()=>{try{return fs.statSync(none).mtimeMs}catch(e){return 0}})(); if(n&&now()-n<weekMs){NONE.set(t,n); return null}
    if(BUSY.has(t))return BUSY.get(t);
    const pr=(async()=>{let r; try{r=await f(SRC(t),{signal:AbortSignal.timeout(10000)})}catch(e){return null}   // a network failure is not remembered
      const b=r.ok?Buffer.from(await r.arrayBuffer()):null;
      if(!b||b.length<100||b.length>400e3||!b.subarray(0,4).equals(PNG)||looksLikePhoto(b)){if(r.status===404||r.ok){mk(); NONE.set(t,now()); try{fs.writeFileSync(none,'')}catch(e){}} return null}
      mk(); try{fs.writeFileSync(file,b)}catch(e){} return b})().finally(()=>BUSY.delete(t));
    BUSY.set(t,pr); return pr}
  return {get};
}
