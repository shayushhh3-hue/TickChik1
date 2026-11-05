// 5.11 TikChik Management Center: the keys saved in Railway. Names only: never a value, its length or any of its letters.
// Each name says whether the site reads it and for what, so a key saved under a name the site does not know is seen at
// once ("not connected to the site"), instead of looking as if it were working. A check on request asks the service
// itself with the key (a light, free call) and keeps only the outcome and its time.
import {DW} from '../ilsyms.js';

export const KEYS={
  ANTHROPIC_API_KEY:{what:'Claude: צ׳יקו, קריאת הדוחות והכתבות',test:'anthropic'},
  FINNHUB_API_KEY:{what:'Finnhub: דוחות, תחזיות, אנליסטים ומועדי דוחות',test:'finnhub'},
  TASE_API_KEY:{what:'הבורסה בתל אביב (DataWise): רשימת הניירות הישראליים',test:'tase'},
  X_BEARER_TOKEN:{what:'X: פוסטים מחשבונות נבחרים בחדשות',test:'x'},
  RESEND_API_KEY:{what:'Resend: שליחת המיילים (סיכומים, גיבוי, התראות)',test:'resend'},
  BACKUP_KEY:{what:'הצפנת הגיבוי שנשלח במייל'},
  VAPID_PUBLIC_KEY:{what:'התראות לטלפון (מפתח ציבורי)'},
  VAPID_PRIVATE_KEY:{what:'התראות לטלפון (מפתח פרטי)'},
  OWNER_PASSWORD:{what:'הסיסמה הראשונה של בעל המערכת'},
  SEC_USER_AGENT:{what:'הזיהוי מול SEC, למועדי הדוחות'},
  ANTHROPIC_BASE_URL:{what:'כתובת שירות Claude (אם לא הרגילה)'},
  MAIL_USER:{what:'כתובת השולח של המיילים'}
};
// what looks like a key or a secret (the platform's own variables are not listed)
const SECRETISH=/(^|_)(API_?KEY|KEY|TOKEN|SECRET|SECRET_KEY|PASSWORD|PASS|BEARER(_TOKEN)?|ACCESS_KEY(_ID)?|CREDENTIALS?|DSN)$/i;
const SYSTEM=/^(RAILWAY_|NIXPACKS_|NODE_|NPM_|npm_|PATH$|HOME$|HOSTNAME$|PWD$|SHLVL$|TERM$|LANG$|YARN_|COREPACK_)/;

export function keysList(store,{env=process.env}={}){
  let last={}; try{last=JSON.parse(store.getMeta('keyTests')||'{}')}catch(e){}
  const names=new Set([...Object.keys(env).filter(n=>!SYSTEM.test(n)&&(SECRETISH.test(n)||KEYS[n])&&String(env[n]||'').trim()),...Object.keys(KEYS).filter(n=>KEYS[n].test)]);
  const rows=[...names].map(n=>{const K=KEYS[n]||null, set=!!String(env[n]||'').trim();
    return {name:n,set,used:!!K,what:K?K.what:null,canTest:!!(K&&K.test&&set),last:last[n]||null}});
  // the unknown ones first (that is what a newly added key looks like), then the ones in use, then the missing ones
  rows.sort((a,b)=>(a.used-b.used)||(b.set-a.set)||(a.name<b.name?-1:1));
  return {rows,note:'רק שמות. הערך של מפתח לא מוצג, לא נשמר כאן ולא נשלח לשום מקום חוץ מהשירות שלו.',at:new Date().toISOString()};
}

const T=12000;
const said={ok:'עובד',bad:'נדחה',limit:'עובד, אבל הגיע למכסה כרגע',down:'השירות לא ענה',restricted:'עובד (מפתח לשליחה בלבד)'};
// one light call per service; the answer is only its outcome, never the service's text back to the page
export async function keyTest(store,name,{env=process.env,fetch:f=globalThis.fetch,now=new Date()}={}){
  const K=KEYS[name]; if(!K)throw new Error('unknown');
  const key=String(env[name]||'').trim(); if(!key)throw new Error('missing'); if(!K.test)throw new Error('no_test');
  const t0=Date.now(), get=(u,h={})=>f(u,{headers:h,signal:AbortSignal.timeout(T)});
  let st='down', code=null, extra='';
  try{
    if(K.test==='anthropic'){const base=String(env.ANTHROPIC_BASE_URL||'https://api.anthropic.com').replace(/\/$/,''); const r=await get(base+'/v1/models',{'x-api-key':key,'anthropic-version':'2023-06-01'}); code=r.status;
      if(r.ok){st='ok'; try{const j=await r.json(); extra=(j.data||[]).length?`${(j.data||[]).length} מודלים זמינים`:''}catch(e){}} else st=r.status===401||r.status===403?'bad':r.status===429?'limit':'down'}
    else if(K.test==='finnhub'){const r=await get('https://finnhub.io/api/v1/quote?symbol=AAPL&token='+encodeURIComponent(key)); code=r.status;
      if(r.ok){let j=null; try{j=await r.json()}catch(e){} st=j&&+j.c>0?'ok':'down'; if(st==='ok')extra='מחיר AAPL התקבל'} else st=r.status===401||r.status===403?'bad':r.status===429?'limit':'down'}
    else if(K.test==='tase'){const r=await get(DW+'/basic-indices/indices-list',{accept:'application/json',apikey:key,'accept-language':'he-IL'}); code=r.status;
      const txt=r.ok?await r.text():''; st=r.ok&&!/Request Rejected/i.test(txt)?'ok':r.status===401||r.status===403||/Request Rejected/i.test(txt)?'bad':r.status===429?'limit':'down'; if(st==='ok')extra='רשימת המדדים התקבלה'}
    else if(K.test==='x'){const r=await get('https://api.twitter.com/2/users/by/username/Reuters',{authorization:'Bearer '+key}); code=r.status;
      st=r.ok?'ok':r.status===401||r.status===403?'bad':r.status===429?'limit':'down'}
    else if(K.test==='resend'){const r=await get('https://api.resend.com/domains',{authorization:'Bearer '+key}); code=r.status;
      if(r.ok)st='ok'; else if(r.status===401){let j=null; try{j=await r.json()}catch(e){} st=j&&/restricted/i.test(String(j.name||j.message||''))?'restricted':'bad'} else st=r.status===429?'limit':'down'}
  }catch(e){st='down'; code=e&&e.name==='TimeoutError'?'timeout':'network'}
  const out={name,st,ok:st==='ok'||st==='limit'||st==='restricted',said:said[st]+(extra?' · '+extra:''),code,ms:Date.now()-t0,at:now.toISOString()};
  let L={}; try{L=JSON.parse(store.getMeta('keyTests')||'{}')}catch(e){} L[name]=out; store.setMeta('keyTests',JSON.stringify(L));
  return out;
}
