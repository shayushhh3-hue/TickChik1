// 1.11 TikChik Management Center: the site's own counters (mails sent, pushes sent, AI errors, navigation between
// screens). One row per day, kind, key and cohort, summed in place: cheap enough to call on every event, and it keeps no
// person: a count, never who. The modules that send (mail.js, push.js) call bump(); until the server sets the store
// (tests, scripts) a bump is a no-op.
import {ilParts} from '../../shared/market.js';

let STORE=null;
export function setCounterStore(store){STORE=store; if(store)ensureCounters(store)}
export function ensureCounters(store){
  store.db.exec(`create table if not exists counters(day text not null, kind text not null, key text not null, cohort text not null default '', n integer not null default 0, primary key(day,kind,key,cohort));
    create index if not exists counters_kind on counters(kind, day);`)}
const clip=(s,n)=>String(s==null?'':s).slice(0,n);
export function bump(kind,key='',n=1,{cohort='',day=null,store=null}={}){
  const S=store||STORE; if(!S)return; const d=day||ilParts(new Date()).iso;
  try{S.db.prepare('insert into counters(day,kind,key,cohort,n) values(?,?,?,?,?) on conflict(day,kind,key,cohort) do update set n=n+excluded.n').run(d,clip(kind,24),clip(key,120),clip(cohort,8),Math.round(+n||0))}catch(e){}
}
export function countersSince(store,kind,from,to='9999'){return store.db.prepare('select day, key, cohort, n from counters where kind=? and day>=? and day<=? order by day').all(kind,from,to)}

// ---- the AI meter: every call to Claude, from the chat and from the background (the news reading, the daily brief, the
// stories, the report explanations), counted per feature and model: calls, tokens, time, the outcome. The background calls
// also go into the per-model table (ai_models) the cost is computed from; the chat and the files already do. The last
// hundred failures are kept with their code and time (never the question or the answer)
export function aiMeter({feature,model='?',usage=null,ms=0,ok=true,code='',addModel=false,store=null}){
  const S=store||STORE; if(!S)return; const day=ilParts(new Date()).iso, k=`${feature}|${String(model).slice(0,60)}`;
  const u=usage||{}, inp=(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0), out=u.output_tokens||0;
  bump('ai_calls',k,1,{day,store:S}); if(inp)bump('ai_in',k,inp,{day,store:S}); if(out)bump('ai_out',k,out,{day,store:S});
  if(ms>0)bump('ai_ms',feature,Math.round(ms),{day,store:S}); bump('ai_res',`${feature}|${ok?'ok':'err:'+String(code||'?').slice(0,40)}`,1,{day,store:S});
  if(addModel&&(inp||out))try{S.aiModelAdd(day,model,{calls:1,input:inp,output:out})}catch(e){}
  if(!ok)try{const L=JSON.parse(S.getMeta('aiFails')||'[]'); L.unshift({at:new Date().toISOString(),feature,model:String(model).slice(0,60),code:String(code||'?').slice(0,80),ms:Math.round(ms)}); S.setMeta('aiFails',JSON.stringify(L.slice(0,100)))}catch(e){}
}
