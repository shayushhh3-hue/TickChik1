// A stand-in for the cloud the jobs talk to: Firebase Auth (password sign-in), Firestore REST (in memory), Yahoo
// Finance, the Bank of Israel, the GitHub mirror of the US screener. Installed over globalThis.fetch for a test.
import {toFields, fromFields} from '../shared/fsrest.js';

export function installFakeCloud({seeds={},yahoo={},mirror=null,boi=3.074,log=()=>{}}={}){
  const store=new Map(); // path -> fields
  for(const [p,d] of Object.entries(seeds))if(d)store.set(p,toFields(d));
  const calls=[]; const real=globalThis.fetch;
  const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const chart=(sym,q)=>{const closes=q.closes||[q.px*0.98,q.px*0.99,q.px]; const base=Date.parse((q.lastDay||'2026-10-09')+'T20:00:00Z')/1000; const ts=closes.map((c,i)=>base-(closes.length-1-i)*86400);
    return {chart:{result:[{meta:{currency:q.ccy||'USD',symbol:sym,exchangeName:'NMS',regularMarketPrice:q.px,regularMarketTime:ts[ts.length-1]+60,gmtoffset:q.off||-14400,chartPreviousClose:closes[0]},timestamp:ts,indicators:{quote:[{close:closes}]}}],error:null}}};
  globalThis.fetch=async(url,o={})=>{
    url=String(url); const m=o.method||'GET'; calls.push([m,url]);
    try{
      if(url.includes('accounts:signInWithPassword'))return json(200,{idToken:'bot-tok',refreshToken:'r',localId:'bot',email:'bot@example.com',expiresIn:'3600'});
      if(url.includes('/jwk/'))return json(200,{keys:[]});
      let fm=url.match(/\/documents:commit$/);
      if(fm){const b=JSON.parse(o.body);for(const w of b.writes){if(w.delete)store.delete(w.delete.replace(/^.*\/documents\//,''));else store.set(w.update.name.replace(/^.*\/documents\//,''),w.update.fields||{})}return json(200,{})}
      fm=url.match(/\/documents\/([^?]+)(\?.*)?$/);
      if(fm){const p=decodeURIComponent(fm[1]);
        const isColl=p.split('/').length%2===1;
        if(m==='GET'&&isColl){const docs=[...store.entries()].filter(([k])=>k.startsWith(p+'/')&&k.slice(p.length+1).split('/').length===1).map(([k,f])=>({name:'projects/x/databases/(default)/documents/'+k,fields:f}));return json(200,{documents:docs})}
        if(m==='GET')return store.has(p)?json(200,{name:'projects/x/databases/(default)/documents/'+p,fields:store.get(p),updateTime:'2026-10-11T00:00:00Z'}):json(404,{error:{status:'NOT_FOUND',message:'no'}});
        if(m==='PATCH'){store.set(p,JSON.parse(o.body).fields||{});return json(200,{})}
        if(m==='DELETE'){store.delete(p);return json(200,{})}
      }
      const ym=url.match(/\/v8\/finance\/chart\/([^?]+)\?(.*)$/);
      if(ym){const sym=decodeURIComponent(ym[1]); const q=yahoo[sym]; if(!q)return json(404,{chart:{result:null,error:{code:'Not Found',description:'No data found, symbol may be delisted'}}});
        if(/interval=1wk/.test(ym[2]))return json(200,chart(sym,{...q,closes:[q.px*0.9,q.px*0.95,q.px*0.97,q.px]}));
        return json(200,chart(sym,q))}
      if(url.includes('stooq.com'))return new Response('',{status:404});
      if(url.includes('boi.org.il'))return json(200,{exchangeRates:[{key:'USD',currentExchangeRate:boi,currentChange:0.1,unit:1,lastUpdate:'2026-10-09T00:00:00'}]});
      if(url.includes('raw.githubusercontent.com/rreichel3')){if(!mirror)return new Response('x',{status:404});const ex=url.match(/\/(nasdaq|nyse|amex)\//)[1];return json(200,mirror[ex]||[])}
      if(url.includes('api.anthropic.com'))return json(200,{content:[{type:'text',text:'{}'}],stop_reason:'end_turn'});
      log('unhandled fetch',m,url); return new Response('unhandled',{status:599});
    }catch(e){log('fake cloud error',e.message);return new Response(String(e),{status:598})}
  };
  return {store,calls,get:p=>store.has(p)?fromFields(store.get(p)):null,restore:()=>{globalThis.fetch=real}};
}
