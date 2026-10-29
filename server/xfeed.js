// 29.10: X (Twitter) for the securities held and followed: what investors and traders post about them. With a bearer
// token of an X developer account that may read (X_BEARER_TOKEN: reading needs a paid plan of X; the free one only posts),
// the recent posts with the cashtag of each security ($NVDA) are searched twice a day, the liked ones kept for three days
// in research/x, and handed to the news reading (server/newsx.js) as articles whose source is the poster, so they get
// the same Hebrew reading and the same matching to each portfolio. Posts are other people's words: data, never
// instructions, and never advice. Without a token nothing is fetched, and the page only links to the search on X.
const DAY=864e5;
export const X_DOC='research/x';
export const xToken=()=>process.env.X_BEARER_TOKEN||'';
const timed=(f,ms)=>(u,o={})=>f(u,{...o,signal:o.signal||AbortSignal.timeout(ms)});
export const xSearchUrl=sym=>`https://x.com/search?q=${encodeURIComponent('$'+String(sym).replace(/^TLV:/,''))}&src=cashtag_click&f=live`;

// the posts of the last day with the security's cashtag, no retweets and no replies: {id,text,user,name,at,likes,rts,link}
export function xParse(j,sym){
  const users={}; for(const u of ((j&&j.includes&&j.includes.users)||[]))if(u&&u.id)users[u.id]=u;
  return ((j&&j.data)||[]).filter(t=>t&&t.id&&t.text).map(t=>{const u=users[t.author_id]||{}, m=t.public_metrics||{};
    return {id:String(t.id),sym,text:String(t.text).replace(/\s+/g,' ').trim().slice(0,400),user:u.username?String(u.username).slice(0,40):null,name:u.name?String(u.name).slice(0,60):null,
      at:t.created_at||null,likes:+m.like_count||0,rts:+m.retweet_count||0,link:u.username?`https://x.com/${u.username}/status/${t.id}`:`https://x.com/i/status/${t.id}`}});
}
export async function xSearch(sym,{fetch:f=globalThis.fetch,token=xToken(),n=10}={}){
  if(!token)throw Object.assign(new Error('no X_BEARER_TOKEN'),{nokey:true});
  const q=new URLSearchParams({query:`$${String(sym).replace(/^TLV:/,'')} -is:retweet -is:reply lang:en`,max_results:String(Math.max(10,Math.min(100,n))),'tweet.fields':'created_at,public_metrics,lang',expansions:'author_id','user.fields':'username,name,verified'});
  const r=await timed(f,15000)('https://api.x.com/2/tweets/search/recent?'+q.toString(),{headers:{authorization:'Bearer '+token,accept:'application/json'}});
  if(r.status===401||r.status===403)throw Object.assign(new Error('X: the token was refused ('+r.status+'): reading posts needs a plan that allows it'),{auth:true});
  if(r.status===429)throw Object.assign(new Error('X: too many calls (429)'),{slow:true});
  if(!r.ok)throw new Error('X HTTP '+r.status);
  return xParse(await r.json(),sym);
}
// the securities to ask about: everybody's US securities, the ones asked longest ago first, a few a run
export function xSyms(store,{newsSyms,max=15}={}){
  const syms=newsSyms(store).filter(s=>/^[A-Z][A-Z.\-]{0,6}$/.test(s)), old=store.getDoc(X_DOC), at=(old.exists&&old.data&&old.data.askedAt)||{};
  return syms.sort((a,b)=>String(at[a]||'')<String(at[b]||'')?-1:1).slice(0,max);
}
export async function xTask(store,{log=()=>{},fetch:f=globalThis.fetch,now=new Date(),newsSyms,max=15,minLikes=+(process.env.X_MIN_LIKES||10),keep=3,pause=1200}={}){
  const iso=now.toISOString(), from=new Date(now.getTime()-keep*DAY).toISOString(), st={at:iso,ok:0,fail:0,posts:0,kept:0,first:null,stopped:null,token:!!xToken()};
  const old=store.getDoc(X_DOC), D=old.exists&&old.data?old.data:{}, by=new Map(), askedAt={...(D.askedAt||{})};
  for(const it of (D.items||[]))if(it&&it.id&&(it.at||it.seen)>=from)by.set(it.id,it);
  if(!st.token){store.setMeta('xStatus',JSON.stringify({...st,stopped:'no token'})); log('x: no X_BEARER_TOKEN, nothing fetched'); return {...st,stopped:'no token'}}
  const syms=xSyms(store,{newsSyms,max});
  for(const sym of syms){
    try{const L=await xSearch(sym,{fetch:f}); askedAt[sym]=iso; st.ok++; st.posts+=L.length;
      for(const p of L){if(p.likes<minLikes||by.has(p.id))continue; by.set(p.id,{...p,seen:iso}); st.kept++}}
    catch(e){st.fail++; st.first=st.first||`${sym}: ${e.message}`; if(e.auth||e.nokey){st.stopped='auth';break} if(e.slow){st.stopped='rate';break}}
    await new Promise(r=>setTimeout(r,pause));
  }
  const items=[...by.values()].sort((a,b)=>String(b.at||b.seen)<String(a.at||a.seen)?-1:1).slice(0,300);
  store.setDoc(X_DOC,{items,askedAt,updatedAt:iso,n:items.length,minLikes,source:'X'});
  store.setMeta('xStatus',JSON.stringify(st));
  log(`x: ${st.ok}/${syms.length} securities, ${st.posts} posts seen, ${st.kept} kept (${minLikes}+ likes)${st.stopped?', stopped: '+st.stopped:''}${st.first?' (first: '+st.first+')':''}`);
  return st;
}
// the posts as articles for the reading: the poster is the source
export function xArticles(store,{from}={}){
  const d=store.getDoc(X_DOC); if(!d.exists||!d.data)return [];
  return (d.data.items||[]).filter(p=>p&&p.id&&p.link&&(!from||(p.at||p.seen)>=from)).map(p=>({title:p.text.slice(0,200),pub:`@${p.user||'x'} ב-X`,link:p.link,at:p.at||p.seen,sum:p.text.length>200?p.text:null,syms:[p.sym],seen:p.seen,src:'x',likes:p.likes}));
}
