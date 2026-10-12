// POST /api/ask – צ׳יקו. The page sends a Claude Messages request; this adds the API key (a server secret, never in
// the page), checks that the caller is signed in and invited, keeps the model inside the allowed list, and returns
// Claude's answer as it is. Nothing is stored here.
import {requireUser, json, fail, AuthError} from '../../shared/webauth.js';

const ANTHROPIC='https://api.anthropic.com/v1/messages';
const MAX_BYTES=12*1024*1024;

export async function onRequestPost({request,env}){
  try{
    if(!env.ANTHROPIC_API_KEY)return json(503,{error:{code:'upstream_error',message:'ANTHROPIC_API_KEY is not set'}});
    await requireUser(request,env);
    const len=+(request.headers.get('content-length')||0); if(len>MAX_BYTES)return json(413,{error:{code:'too_large',message:'request too large'}});
    const body=await request.text(); if(body.length>MAX_BYTES)return json(413,{error:{code:'too_large',message:'request too large'}});
    const allowed=String(env.ALLOWED_MODELS||'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5').split(',').map(s=>s.trim()).filter(Boolean);
    const m=body.match(/"model"\s*:\s*"([^"]+)"/); if(!m||!allowed.includes(m[1]))return json(400,{error:{code:'invalid_argument',message:'model not allowed'}});
    const r=await fetch(ANTHROPIC,{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body});
    const text=await r.text();
    if(r.ok)return new Response(text,{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
    let msg=''; try{const j=JSON.parse(text);msg=(j.error&&j.error.message)||''}catch(e){}
    if(r.status===429)return json(429,{error:{code:'rate_limited',message:msg||'rate limited'}});
    if(r.status===401||r.status===403)return json(502,{error:{code:'upstream_error',message:'the Claude API key was refused: '+msg}});
    if(r.status===400)return json(400,{error:{code:'invalid_argument',message:msg||'bad request'}});
    if(r.status===413)return json(413,{error:{code:'too_large',message:msg||'too large'}});
    return json(502,{error:{code:'upstream_error',message:msg||('Claude API HTTP '+r.status)}});
  }catch(e){return fail(e instanceof AuthError?e:{status:500,code:'server_error',message:String(e&&e.message||e)})}
}
// any other method (the POST handler above takes precedence for POST)
export const onRequest=()=>json(405,{error:{code:'invalid_argument',message:'POST only'}});
