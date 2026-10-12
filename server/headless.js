// Runs the page itself, without a screen, on the stored documents: the alert engine, the daily point and the reports
// are then computed by the same code the page runs in the browser. The page gets a small stand-in for the runtime
// (documents from memory, writes recorded) and never reaches the network except for its fonts.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const PAGE=path.resolve(HERE,'..','site','index.html');

function stub(docs,user){
  return `window.__D=${JSON.stringify(docs)};window.__W=[];
const __cp=d=>d==null?d:JSON.parse(JSON.stringify(d));
const mk=p=>({id:p.slice(p.lastIndexOf('/')+1),path:p,
  onSnapshot(cb){setTimeout(()=>{const d=window.__D[p];cb({exists:!!d,data:()=>__cp(d),metadata:{hasPendingWrites:false}})},0);return()=>{}},
  async get(){const d=window.__D[p];return {exists:!!d,data:()=>__cp(d),metadata:{hasPendingWrites:false}}},
  async set(d){window.__D[p]=__cp(d);window.__W.push(['set',p,__cp(d)])},
  async update(d){window.__W.push(['update',p,__cp(d)]);const m=(a,b)=>{const o={...(a||{})};for(const k in b)o[k]=b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&o[k]&&typeof o[k]==='object'&&!Array.isArray(o[k])?m(o[k],b[k]):b[k];return o};window.__D[p]=m(window.__D[p],d)},
  async delete(){window.__W.push(['delete',p]);delete window.__D[p]}});
const col=p=>{const rows=()=>Object.keys(window.__D).filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>({id:k.slice(p.length+1),data:()=>__cp(window.__D[k])}));
  const q={orderBy(){return q},limit(){return q},where(){return q},doc:id=>mk(p+'/'+id),onSnapshot(cb){setTimeout(()=>{const d=rows();cb({docs:d,size:d.length,empty:!d.length})},0);return()=>{}},async get(){const d=rows();return {docs:d,size:d.length,empty:!d.length}}};return q};
const U=${JSON.stringify(user)};
window.claude={use:async n=>n==='db'?{doc:mk,collection:col}:n==='user'?{id:async()=>U.uid,me:async()=>({id:U.uid,name:U.name||'',email:U.email||''}),isOwner:async()=>!!U.owner,canEdit:async()=>!!U.owner,can:async()=>true,profiles:async()=>({})}:n==='permissions'?{state:async()=>'prompt',request:async()=>({}),manage:async()=>{}}:null};
try{localStorage.setItem('tr_bot_tip','2099-01-01');localStorage.setItem('tr_prof_later','2099-01-01T00:00:00Z');localStorage.setItem('tr_view','full')}catch(e){}`;
}

export async function withPage(docs,user,fn,{fonts=false,timeout=45000}={}){
  if(!fs.existsSync(PAGE))throw new Error('site/index.html is missing; run node tools/build.js');
  const exe=['/opt/pw-browsers/chromium','/opt/pw-browsers/chromium-1187/chrome-linux/chrome'].find(p=>fs.existsSync(p));
  const b=await chromium.launch({...(exe?{executablePath:exe}:{}),args:['--disable-dev-shm-usage','--no-sandbox']});
  try{
    const ctx=await b.newContext({viewport:{width:1100,height:900},timezoneId:'Asia/Jerusalem',locale:'he-IL'});
    const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    await pg.addInitScript(stub(docs,user));
    await pg.route('**/*',r=>{const u=r.request().url();if(u.startsWith('file:')||u.startsWith('data:')||u.startsWith('blob:')||(fonts&&/fonts\.(googleapis|gstatic)\.com/.test(u)))r.continue();else r.abort()});
    await pg.goto('file://'+PAGE);
    await pg.waitForFunction(()=>window.__rep&&window.__rep.readyA&&window.__rep.readyA(),null,{timeout});
    if(fonts){try{await pg.evaluate(()=>Promise.all([400,500,600,700].map(w=>document.fonts.load(w+' 20px Heebo','שלום ₪ 123')).concat([400,500,600].map(w=>document.fonts.load(w+' 20px "IBM Plex Mono"','123')))))}catch(e){}}
    await pg.waitForTimeout(1500);
    const out=await fn(pg);
    const writes=await pg.evaluate(()=>window.__W);
    return {out,writes,errs};
  }finally{await b.close()}
}

// apply the writes the page recorded (set / update / delete) to Firestore, only on the paths given
export async function applyWrites(fsc,writes,allow){
  let n=0;
  for(const [op,p,d] of writes){
    if(!allow(p))continue;
    if(op==='set')await fsc.setDoc(p,d); else if(op==='update')await fsc.updateDoc(p,d); else if(op==='delete')await fsc.deleteDoc(p);
    n++;
  }
  return n;
}
