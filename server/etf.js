// 4.11: what is inside the funds people hold, so a double exposure (a share held directly and again through a fund) is a
// number and not "unknown". A US fund's largest holdings come from its page on stockanalysis.com (the 25 largest, with
// their weights, which for an index fund is most of it); an Israeli fund that follows a US index is read through a US fund
// that follows the same index (NASDAQ 100 through QQQ, S&P 500 through SPY), and says so. A fund that follows a Tel Aviv
// index, or one with no page, stays unknown. One document, research/etf, by the held security; a partner sees only the
// funds they hold (store.js partnerView)
import {trackOf} from '../shared/quotes.js';

const DAY=864e5;
export const IDX_PROXY={NDX:['QQQ','נאסד״ק 100'],SPX:['SPY','S&P 500'],DJI:['DIA','דאו ג׳ונס'],RUT:['IWM','ראסל 2000']};
const FUNDNAME=/\b(ETF|Trust|Fund|Index|iShares|Vanguard|SPDR|Invesco|Select Sector|ProShares|Schwab|Direxion|WisdomTree|VanEck|Global X|ARK)\b|קרן|מחקה|תעודת סל/i;
const txt=h=>String(h||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function etfParse(html){
  const h=String(html||''), top=[];
  for(const m of h.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const c=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>txt(x[1])); if(c.length<4)continue;
    const sym=(c[1]||'').toUpperCase(), w=(c.slice(2).find(x=>/^-?[\d.]+%$/.test(x))||'').replace('%','');
    if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)||w===''||!(+w>0))continue; top.push([sym,c[2]||'',Math.round(+w*100)/100]); if(top.length>=50)break}
  const n=(h.match(/of ([\d,]+) holdings/i)||[])[1], asOf=(h.match(/Updated ([A-Z][a-z]{2} \d{1,2}, \d{4})/)||[])[1];
  return {top,n:n?+n.replace(/,/g,''):null,asOf:asOf?new Date(asOf+' UTC').toISOString().slice(0,10):null}}
export async function etfFetch(sym,{fetch:f=globalThis.fetch}={}){
  const r=await f(`https://stockanalysis.com/etf/${encodeURIComponent(String(sym).toLowerCase())}/holdings/`,{headers:{'user-agent':'Mozilla/5.0 (compatible; TikChik/1.0)','accept':'text/html'},signal:AbortSignal.timeout(12000)});
  if(r.status===404)return {none:true}; if(!r.ok)throw new Error('HTTP '+r.status);
  const P=etfParse(await r.text()); return P.top.length?P:{none:true}}

// every held security, with its name, across the owner's and the partners' portfolios
function heldAll(store){const M=new Map(), add=d=>{for(const p of ((d&&d.positions)||[]))if(p&&typeof p.sym==='string'&&!M.has(p.sym))M.set(p.sym,p.name||'')};
  add(store.getDoc('portfolio/main').data); for(const p of store.pathsUnder('data/users'))if(/\/portfolio$/.test(p))add(store.getDoc(p).data); return M}
export function etfTargets(store){const out=[]; for(const [sym,name] of heldAll(store)){
    if(/^\d{6,9}$/.test(sym)){const k=trackOf(name); if(k&&IDX_PROXY[k])out.push({held:sym,etf:IDX_PROXY[k][0],proxy:`לפי ${IDX_PROXY[k][0]}, קרן שעוקבת אחרי ${IDX_PROXY[k][1]} כמו הקרן הזאת`}); continue}
    if(/^[A-Z][A-Z.\-]{0,6}$/.test(sym)&&FUNDNAME.test(name))out.push({held:sym,etf:sym})}
  return out}
export async function etfTask(store,{fetch:f=globalThis.fetch,log=()=>{},now=new Date(),maxAge=7,pause=800}={}){
  const old=store.getDoc('research/etf'), D=old.exists?old.data:{}, by={...(D.by||{})}, none={...(D.none||{})}, got={}, st={at:now.toISOString(),tried:0,ok:0,none:0,fail:0,first:null};
  for(const t of etfTargets(store)){const cur=by[t.held]; if(cur&&cur.at&&now-Date.parse(cur.at)<maxAge*DAY&&cur.etf===t.etf)continue; if(none[t.etf]&&now-Date.parse(none[t.etf])<30*DAY)continue;
    let P=got[t.etf]; if(!P){st.tried++; try{P=got[t.etf]=await etfFetch(t.etf,{fetch:f})}catch(e){st.fail++; st.first=st.first||`${e.message}`; continue} if(pause)await new Promise(r=>setTimeout(r,pause))}
    if(P.none){none[t.etf]=now.toISOString(); st.none++; continue}
    by[t.held]={etf:t.etf,proxy:t.proxy||null,src:'stockanalysis.com',asOf:P.asOf,n:P.n,top:P.top.slice(0,25).map(([s,,w])=>[s,w]),cover:Math.round(P.top.slice(0,25).reduce((a,x)=>a+x[2],0)*10)/10,at:now.toISOString()}; st.ok++}
  // a fund nobody holds any more leaves
  const held=new Set(etfTargets(store).map(t=>t.held)); for(const k of Object.keys(by))if(!held.has(k))delete by[k];
  store.setDoc('research/etf',{updatedAt:now.toISOString(),by,none,status:st}); log(`etf: ${st.ok} read, ${st.none} without holdings, ${st.fail} failed`); return st}
