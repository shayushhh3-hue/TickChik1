// The jobs' settings come from GitHub secrets and variables (see SETUP.md). Nothing is read from files.
import {botClient} from '../../shared/fsrest.js';
import {ilParts} from '../../shared/market.js';

export function need(...names){const o={};for(const n of names){const v=process.env[n];if(!v){console.error('missing environment variable '+n);process.exit(2)}o[n]=v}return o}
export const opt=(n,d='')=>process.env[n]||d;
export const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
// scheduled runs fire twice a day in UTC so that one of them lands on the right Israel hour; the other one leaves here
export function guard(ok,what){if(opt('FORCE'))return;if(!ok){const p=ilParts(new Date());log(`${what}: not now (Israel ${p.iso} ${p.h}:${String(p.min).padStart(2,'0')}, weekday ${p.wd}); nothing to do`);process.exit(0)}}

export async function bot(){
  const e=need('FIREBASE_PROJECT_ID','FIREBASE_API_KEY','BOT_EMAIL','BOT_PASSWORD');
  return botClient({projectId:e.FIREBASE_PROJECT_ID,apiKey:e.FIREBASE_API_KEY,email:e.BOT_EMAIL,password:e.BOT_PASSWORD});
}
// the owner's documents the page needs to run headless (the bot may read them; nothing of other people is touched)
export const OWNER_DOCS=['portfolio/main','plan/main','settings/main','history/main','history/prices','history/daily','quotes/latest','research/latest','research/candidates','research/longterm','research/comove','alerts/ack','alerts/state'];
export async function loadOwnerDocs(fs){
  const out={};
  await Promise.all(OWNER_DOCS.map(async p=>{try{const d=await fs.getDoc(p);if(d.exists)out[p]=d.data}catch(e){log('read failed',p,e.message)}}));
  return out;
}
