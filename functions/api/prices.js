// POST /api/prices – a price refresh now. The page calls this when a market is open and the stored prices are old
// (the same thing the hourly job does). The caller must be signed in and invited; the writing is done as the bot user.
import {requireUser, json, fail, AuthError} from '../../shared/webauth.js';
import {botClient} from '../../shared/fsrest.js';
import {refreshQuotes} from '../../shared/pxjob.js';

let BOT=null, LAST={at:0,res:null};
const MIN_GAP=3*60*1000; // two clicks within three minutes get the same answer

export async function onRequestPost({request,env}){
  try{
    const u=await requireUser(request,env);
    for(const k of ['FIREBASE_PROJECT_ID','FIREBASE_API_KEY','BOT_EMAIL','BOT_PASSWORD'])if(!env[k])return json(503,{error:{code:'upstream_error',message:k+' is not set'}});
    let reason=''; try{const j=await request.json();reason=String((j&&j.reason)||'').slice(0,120)}catch(e){}
    if(Date.now()-LAST.at<MIN_GAP&&LAST.res)return json(200,{...LAST.res,cached:true});
    if(!BOT)BOT=await botClient({projectId:env.FIREBASE_PROJECT_ID,apiKey:env.FIREBASE_API_KEY,email:env.BOT_EMAIL,password:env.BOT_PASSWORD});
    try{await BOT.ensure()}catch(e){BOT=null;throw e}
    const res=await refreshQuotes(BOT,{reason:(u.owner?'owner':'friend')+(reason?': '+reason:'')});
    LAST={at:Date.now(),res};
    return json(200,{ok:true,...res});
  }catch(e){return fail(e instanceof AuthError?e:{status:502,code:'upstream_error',message:String(e&&e.message||e)})}
}
export const onRequest=()=>json(405,{error:{code:'invalid_argument',message:'POST only'}});
