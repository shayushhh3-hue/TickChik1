// Build site/index.html from the page (page/live.html, the same file that is published in Claude).
// The page is kept as it is: the build wraps it in a full HTML document and adds a small bootstrap that gives the page
// window.claude.use (served by runtime.js from this site's server), plus a small account button (sign out; for the
// owner: users and backup). usage: node tools/build.js
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// the default universe of the "what fits my portfolio" ranking: the largest US companies in the page's own list of
// securities (shares only, by market value), for the night's research when nothing else names a universe
export function buildUniverse(root,h,{top=400}={}){
  const i=h.indexOf('<script type="text/plain" id="symdb">'), j=h.indexOf('</script>',i); if(i<0||j<0)return [];
  const rows=h.slice(h.indexOf('>',i)+1,j).trim().split('\n').map(l=>l.split('\t')).filter(p=>p.length>=6&&p[2]==='S'&&/^[A-Z][A-Z.\-]{0,6}$/.test(p[0])&&+p[5]>0);
  const seen=new Set(), keys=[]; for(const p of rows.sort((a,b)=>+b[5]-+a[5])){const k=p[0].replace(/\.[A-Z]$/,m=>m); if(seen.has(p[1]))continue; seen.add(p[1]); keys.push(k); if(keys.length>=top)break}
  fs.writeFileSync(path.join(root,'shared','universe.json'),JSON.stringify({keys,at:new Date().toISOString().slice(0,10),rule:'the largest US shares by market value in the page\'s list, one per company'},null,0)+'\n');
  return keys;
}
export function buildSite(root){
  const src=path.join(root,'page','live.html');
  let h=fs.readFileSync(src,'utf8');
  try{buildUniverse(root,h)}catch(e){console.error('universe:',e.message)}
  h=h.replace('נתוני התיק שמורים בחשבון שלך. פתח את הדף כשאתה מחובר ל-Claude כדי לראות אותם.','נתוני התיק שמורים בחשבון שלך. היכנס כדי לראות אותם.');
  const m=h.match(/<head>([\s\S]*?)<\/head>\s*<body>/);
  const reset=m?((m[1].match(/<style>([\s\S]*?)<\/style>/)||[])[1]||''):'';
  let body=m?h.slice(m.index+m[0].length):h;
  const end=body.lastIndexOf('</body></html>'); if(end>=0)body=body.slice(0,end);
  const t=body.match(/<title>([\s\S]*?)<\/title>\s*/); const title=t?t[1]:'תיק צ׳יק';
  // the big libraries (PDF and Excel: about 2.7 MB of the page) go to files of their own in site/lib, loaded when the page
  // needs them: reading a PDF or Excel statement, exporting a report. The page asks through window.__tcLib(name); in
  // Claude, where the page is one file, the libraries stay inside it and that call is not there
  const libs=extractLibs(body,path.join(root,'site','lib')); body=libs.body;
  if(t)body=body.slice(0,t.index)+body.slice(t.index+t[0].length);
  const boot=libs.loader+`<script>
// The page asks for window.claude.use(name); on this site it is served by runtime.js from the site's own server.
(function(){
  if(window.claude&&window.claude.use)return; // a headless run or a test put its own runtime in place
  var p=null; function rt(){return p||(p=import('./runtime.js').then(function(m){return m.boot()}))}
  window.claude={use:function(n){return rt().then(function(r){return r.use(n)})}};
})();
</script>
`;
  const acct=`<div id="tcAcct" hidden><button type="button" id="tcAcctBtn" aria-haspopup="true" aria-expanded="false" aria-label="החשבון שלי"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
<div id="tcAcctMenu" hidden><div class="who"></div><a href="users.html" class="own" hidden>משתמשים ושותפים</a><a href="security.html">אימות דו-שלבי</a><a href="/api/db/export">גיבוי הנתונים שלי (קובץ)</a><a href="import.html">שחזור מגיבוי</a><button type="button" id="tcOutBtn">יציאה</button></div></div>
<style>
#tcAcct{position:fixed;bottom:calc(16px + env(safe-area-inset-bottom,0px));right:16px;z-index:55;font-family:Heebo,Arial,sans-serif}
#tcAcctBtn{width:40px;height:40px;border-radius:50%;border:1px solid #cbd5e1;background:#fff;color:#2e4a66;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 10px rgb(30 52 78 / .14)}
#tcAcctMenu{position:absolute;bottom:48px;right:0;min-width:210px;background:#fff;border:1px solid #dfe4ea;border-radius:12px;box-shadow:0 8px 28px rgb(30 52 78 / .18);padding:6px;display:flex;flex-direction:column}
#tcAcctMenu[hidden]{display:none}
#tcAcctMenu .who{font-size:12.5px;color:#657587;padding:8px 10px;border-bottom:1px solid #eef1f4;margin-bottom:4px;direction:ltr;text-align:right;word-break:break-all}
#tcAcctMenu a,#tcAcctMenu button{display:block;text-align:start;padding:9px 10px;border-radius:8px;font:inherit;font-size:14px;color:#1b2a3c;text-decoration:none;background:none;border:0;cursor:pointer}
#tcAcctMenu a:hover,#tcAcctMenu button:hover{background:#f1f5f9}
html[data-theme="dark"] #tcAcctBtn{background:#1D1321;border-color:#3A2B40;color:#E8CFF0}
html[data-theme="dark"] #tcAcctMenu{background:#1D1321;border-color:#3A2B40} html[data-theme="dark"] #tcAcctMenu .who{color:#A895A7;border-color:#3A2B40}
html[data-theme="dark"] #tcAcctMenu a,html[data-theme="dark"] #tcAcctMenu button{color:#F4ECF2} html[data-theme="dark"] #tcAcctMenu a:hover,html[data-theme="dark"] #tcAcctMenu button:hover{background:#281B2D}
</style>
<script>
(function(){
  function show(){var t=window.__tc; if(!t){return setTimeout(show,400)} var a=document.getElementById('tcAcct'); a.hidden=false; a.querySelector('.who').textContent=t.email;
    a.querySelectorAll('.own').forEach(function(x){x.hidden=!t.owner})}
  show();
  document.addEventListener('click',function(e){var m=document.getElementById('tcAcctMenu'),b=document.getElementById('tcAcctBtn'); if(!m)return;
    if(e.target.closest('#tcAcctBtn')){m.hidden=!m.hidden;b.setAttribute('aria-expanded',String(!m.hidden));return}
    if(e.target.closest('#tcOutBtn')){window.__tc&&window.__tc.signOut();return}
    if(!e.target.closest('#tcAcctMenu')){m.hidden=true;b.setAttribute('aria-expanded','false')}});
})();
</script>
`;
  const out=`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0E1424">
<script>try{var tm=localStorage.getItem('tr_theme'),dk=tm==='dark'||!tm||(tm==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dk?'dark':'light';document.querySelector('meta[name=theme-color]').setAttribute('content',dk?'#0E1424':'#1B2A4A')}catch(e){}</script>
<title>${title}</title>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<style>${reset}</style>
${boot}</head>
<body>
${body.trim()}
${acct}</body>
</html>
`;
  fs.writeFileSync(path.join(root,'site','index.html'),out);
  return out.length;
}

const LIBS=[['jspdf',/jsPDF - PDF Document creation/],['xlsx',/xlsx\.js \(C\) 2013-present SheetJS/],['pdfworker',/define\("pdfjs-dist\/build\/pdf\.worker"/],['pdf',/define\("pdfjs-dist\/build\/pdf"/]];
export function extractLibs(body,dir){
  fs.mkdirSync(dir,{recursive:true}); const files={};
  for(const [name,re] of LIBS){
    const m=re.exec(body); if(!m)continue;
    const a=body.lastIndexOf('<script>',m.index), b=body.indexOf('</script>',m.index); if(a<0||b<0)continue;
    const code=body.slice(a+8,b); if(/<script>/.test(code))continue;   // the marker sat in another block: leave it
    fs.writeFileSync(path.join(dir,name+'.js'),code);
    files[name]='lib/'+name+'.js?v='+createHash('sha1').update(code).digest('hex').slice(0,10);
    body=body.slice(0,a)+body.slice(b+9);
  }
  const loader=Object.keys(files).length?`<script>
// the PDF and Excel libraries, when the page needs them (each once; the PDF reader with its worker)
window.__tcLib=(function(){var F=${JSON.stringify(files)},DEP={pdf:['pdfworker']},P={};
  function one(n){if(!F[n])return Promise.resolve(); return P[n]||(P[n]=new Promise(function(ok,no){var s=document.createElement('script');s.src=F[n];s.onload=function(){ok()};s.onerror=function(){P[n]=null;no(new Error('lib '+n))};document.head.appendChild(s)}))}
  return function(n){return Promise.all((DEP[n]||[]).map(one)).then(function(){return one(n)})}})();
</script>
`:'';
  return {body,loader,files};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  console.log('site/index.html written:',buildSite(root),'bytes');
}
