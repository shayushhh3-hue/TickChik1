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
