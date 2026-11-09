// 8.11: the nightly consistency check. The same figure is computed in more than one place (the page's whole-portfolio
// model, the accounts one by one, "למה זז", what the home screen prints, the server's own holdings for Pulse, the saved
// daily points, the split records), and a gap between two of them is a bug, not a market event. Every night, for the
// owner and for every partner with a portfolio, the figures are gathered (the page's own code runs without a screen,
// server/headless.js; the documents are read here) and compared. The result is one document (system/consist): for the
// owner's own portfolio the gaps with their securities and amounts; for a partner only the kind of each gap and a count,
// never the contents of the portfolio. A gap marked bad opens an incident (server/admin/ops.js).
import {withPage} from './headless.js';
import {ownerDocs, partnerDocs} from './tasks.js';
import {holdingsOf} from './pulse.js';
import {sameSplit, splitDaily} from '../shared/splits.js';
import {ilDay} from '../shared/market.js';

export const CONSIST_DOC='system/consist';
// what each kind of gap is, in words a partner's row may show (no security, no amount)
export const KIND_HE={
  noPrice:'נייר בלי מחיר, לא נספר בשווי', stalePrice:'מחיר ישן בהרבה מיום המסחר האחרון', splitMissing:'פיצול שנמצא במחירים ולא הוחל על היחידות',
  splitUnits:'יחידות שונות ממה שנרשם אחרי הפיצול', splitDaily:'מחירים יומיים מלפני הפיצול שלא הותאמו', dailyJump:'קפיצה בשווי השמור שהמחירים לא מסבירים',
  negCash:'מזומן שלילי', pulseTotal:'השרת והדף מחשבים שווי שונה', totalAccounts:'סך החשבונות שונה משווי התיק', dayAccounts:'השינוי היומי לפי חשבונות שונה מהשינוי בתיק',
  acctsSame:'אותם מספרים בכל החשבונות אף שההחזקות שונות', dayWhy:'חלקי "למה זז" לא מסתכמים לשינוי היומי', heroTotal:'המסך הראשי מציג שווי שונה מהחישוב',
  heroDay:'המסך הראשי מציג שינוי יומי שונה מהחישוב', pulsePct:'התראת תנועה אומרת אחוז שונה מהדף', pulseW:'משקל בהתראה שונה מהמשקל בתיק', page:'הדף לא נטען לבדיקה', ledger:'יומן הפעולות נותן כמות שונה מזו שבתיק'};
const ils=x=>'₪'+Math.round(+x||0).toLocaleString('en-US');
const num=s=>{const m=String(s||'').replace(/[^\d.\-−]/g,'').replace('−','-'); return m===''||m==='-'?null:+m};
const dmy=iso=>{const s=String(iso||'').slice(0,10); return s?`${+s.slice(8)}.${+s.slice(5,7)}`:''};
const isoAdd=(iso,n)=>new Date(Date.parse(String(iso).slice(0,10)+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const near=(a,b,tol)=>Math.abs((+a||0)-(+b||0))<=tol;

// the documents of one person, whatever their paths are (the owner's are at the root, a partner's under data/users/<id>)
export function docsOf(docs){
  const at=n=>{const k=Object.keys(docs).find(p=>p===n||p.endsWith('/'+n)); return k?docs[k]:null};
  return {P:at('portfolio/main')||at('portfolio'),Q:docs['quotes/latest']||null,DY:at('history/daily')||at('daily'),S:at('settings/main')||at('settings'),PL:at('alerts/pulse')||at('pulse')};
}

// ---- the documents alone: prices, splits, the saved days, the cash, the server's holdings ----
export function consistDocs(docs,{now=new Date(),pageTotal=null}={}){
  const {P,Q,DY}=docsOf(docs), out=[]; if(!P||!Q||!Q.prices)return out;
  const today=ilDay(now), prices=Q.prices||{}, meta=Q.meta||{}, held=[...new Set((P.positions||[]).filter(p=>p&&p.sym&&+p.qty>0).map(p=>p.sym))];
  for(const s of held)if(prices[s]==null)out.push({k:'noPrice',sev:'bad',sym:s,t:`אין מחיר ל-${s}: הנייר לא נספר בשווי התיק`});
  // a US price whose day is a week or more behind the market's last session (the model has no "today" for it, and the
  // value stands where it was); a statement price ("מחיר מהדוח") is reported by the page itself, so it is not repeated
  if(Q.usDate)for(const s of held){const m=meta[s]||{}; if(m.ccy&&m.ccy!=='USD')continue; if(prices[s]==null||!m.date||/^מחיר מהדוח/.test((Q.stale||{})[s]||''))continue;
    if(m.date<isoAdd(Q.usDate,-7))out.push({k:'stalePrice',sev:'warn',sym:s,t:`המחיר של ${s} הוא מ-${dmy(m.date)}, והשוק נסחר עד ${dmy(Q.usDate)}`})}
  // a split the prices found: applied to the units (a record, kept or not), unless FMP said there was none
  const recs=Object.entries(P.splits||{}).map(([k,v])=>({k,...(v||{})}));
  for(const [s,sp] of Object.entries(Q.splits||{})){if(!sp||!sp.d||!(+sp.r>0)||sp.d>today||sp.conf==='nofmp'||!held.includes(s))continue;
    if(!recs.some(r=>sameSplit(r,s,sp)))out.push({k:'splitMissing',sev:'bad',sym:s,t:`פיצול ${s} (1:${sp.r}, ${dmy(sp.d)}) נמצא במחירים ולא הוחל על היחידות`})}
  // after a split: the units stand where the record left them, unless a newer statement or a hand edit came after
  const asOf=P.asOf||{};
  for(const r of recs){if(r.undone||!Array.isArray(r.rows))continue;
    for(const row of r.rows){if(row.kept)continue; const p=(P.positions||[]).find(x=>x&&x.sym===r.sym&&(x.acct||null)===(row.acct||null)); if(!p)continue;
      if(String(asOf[p.acct]||'')>=r.d||(p.qAt&&String(p.qAt)>=String(r.at).slice(0,10)))continue;
      if(!near(p.qty,row.q1,1e-6))out.push({k:'splitUnits',sev:'warn',sym:r.sym,a:p.qty,b:row.q1,t:`יחידות ${r.sym} בחשבון ${p.acct||'?'}: ${p.qty} בתיק מול ${row.q1} שנרשמו אחרי הפיצול`})}
    // the saved daily prices before the split: still in the old units when splitDaily would still change days
    if(DY&&DY.points){const d=splitDaily(DY,r.sym,{d:r.d,r:r.r,prev:null}); if(d&&d.n>0)out.push({k:'splitDaily',sev:'warn',sym:r.sym,a:d.n,t:`${d.n} מחירים יומיים של ${r.sym} מלפני הפיצול עוד ביחידות הישנות`})}}
  // a jump in the saved value between two near days that neither the deposits nor the prices explain (a split applied
  // twice looked like this)
  if(DY&&DY.points){const days=Object.keys(DY.points).filter(k=>DY.points[k]&&+DY.points[k].v>0).sort();
    for(let i=1;i<days.length;i++){const a=DY.points[days[i-1]], b=DY.points[days[i]]; if((Date.parse(days[i])-Date.parse(days[i-1]))/864e5>7)continue;
      const jump=b.v/a.v-1; if(Math.abs(jump)<0.25)continue; if(Math.abs((+b.dep||0)-(+a.dep||0))>=0.1*a.v)continue;
      const syms=Object.keys(b.px||{}).filter(s=>+(a.px||{})[s]>0), mx=syms.reduce((m,s)=>Math.max(m,Math.abs(b.px[s]/a.px[s]-1)),0);
      if(syms.length&&mx<0.12)out.push({k:'dailyJump',sev:'warn',a:a.v,b:b.v,t:`השווי השמור קפץ ${(jump*100).toFixed(0)}% בין ${dmy(days[i-1])} ל-${dmy(days[i])} (${ils(a.v)} → ${ils(b.v)}), והמחירים זזו עד ${(mx*100).toFixed(0)}%`})}}
  for(const c of P.cash||[])if(+c.amount<0)out.push({k:'negCash',sev:'warn',a:c.amount,t:`מזומן שלילי בחשבון ${c.acct||'?'}: ${c.ccy==='USD'?'$':'₪'}${Math.round(+c.amount).toLocaleString('en-US')}`});
  // the server's own holdings (Pulse weights) against the page's value
  if(pageTotal!=null){const H=holdingsOf(P,Q); if(H.wOk&&H.total!=null&&!near(H.total,pageTotal,Math.max(2,0.001*pageTotal)))out.push({k:'pulseTotal',sev:'warn',a:H.total,b:pageTotal,t:`השרת (Pulse) מחשב שווי ${ils(H.total)} והדף ${ils(pageTotal)}`})}
  return out;
}

// ---- the page's figures (window.__model.consist) against each other ----
export function consistPage(out){
  const F=[]; if(!out||!out.ready)return [{k:'page',sev:'warn',t:'הדף לא נטען לבדיקה'+(out&&out.err?': '+out.err:'')}];
  const T=out.total, A=out.accts||[];
  {const s=A.reduce((t,a)=>t+(+a.total||0),0); if(A.length&&!near(s,T,1))F.push({k:'totalAccounts',sev:'bad',a:s,b:T,t:`סך החשבונות ${ils(s)} שונה משווי התיק ${ils(T)}`})}
  if(out.hasDay&&out.dayIls!=null&&A.length&&A.every(a=>a.dayIls!=null)){const s=A.reduce((t,a)=>t+a.dayIls,0); if(!near(s,out.dayIls,1))F.push({k:'dayAccounts',sev:'bad',a:s,b:out.dayIls,t:`השינוי היומי לפי חשבונות ${ils(s)} שונה מהשינוי בתיק ${ils(out.dayIls)}`})}
  // two accounts that hold different things cannot show the same value to the shekel
  for(let i=0;i<A.length;i++)for(let j=i+1;j<A.length;j++){const a=A[i], b=A[j]; if(!a.syms.length||!b.syms.length||a.syms.join()===b.syms.join())continue;
    if(+a.total>0&&near(a.total,b.total,0.01)&&(a.dayIls==null||b.dayIls==null||near(a.dayIls,b.dayIls,0.01)))F.push({k:'acctsSame',sev:'bad',t:`החשבונות ${a.acct} ו-${b.acct} מציגים אותם מספרים (${ils(a.total)}) אף שההחזקות בהם שונות`})}
  if(out.why&&out.hasDay&&out.why.total!=null&&!near(out.why.parts,out.why.total,1))F.push({k:'dayWhy',sev:'bad',a:out.why.parts,b:out.why.total,t:`חלקי "למה זז" מסתכמים ל-${ils(out.why.parts)} והשינוי היומי הוא ${ils(out.why.total)}`});
  // what the home screen prints, when it prints shekels: against the model it shows (with the plan's ticked items on top,
  // when there are any), not against the statement data alone
  const SH=out.shown||{}, TS=SH.total!=null?SH.total:T, DS=SH.dayIls!=null?SH.dayIls:out.dayIls;
  const H=out.hero||{}; if(H.total&&H.total!=='—'&&(!H.hc||H.hc==='ils'||H.hc==='both')){const v=num(H.total); if(v!=null&&!near(v,Math.round(TS),1))F.push({k:'heroTotal',sev:'bad',a:v,b:TS,t:`המסך הראשי מציג ${ils(v)} והחישוב נותן ${ils(TS)}${SH.plan?' (כולל מה שסומן בתוכנית)':''}`});
    if(out.hasDay&&DS!=null&&H.day&&H.day!=='—'){const d=num(H.day); if(d!=null&&!near(Math.abs(d),Math.abs(Math.round(DS)),1))F.push({k:'heroDay',sev:'bad',a:d,b:DS,t:`המסך הראשי מציג שינוי של ${ils(Math.abs(d))} והחישוב נותן ${ils(Math.abs(DS))}`})}}
  // the server's move alerts (Pulse), when they were made on the price the page has now
  const pos=new Map((out.pos||[]).map(p=>[p.sym,p]));
  for(const a of out.pulse||[]){const p=pos.get(a.sym); if(!p||!near(a.to,p.px,1e-9))continue;
    if(p.dayPct!=null&&a.pct!=null&&!near(a.pct,p.dayPct,0.1))F.push({k:'pulsePct',sev:'bad',sym:a.sym,a:a.pct,b:p.dayPct,t:`התראת התנועה של ${a.sym} אומרת ${(+a.pct).toFixed(1)}% והדף מחשב ${(+p.dayPct).toFixed(1)}%`});
    if(a.w!=null&&p.w!=null&&!near(a.w,p.w,0.6))F.push({k:'pulseW',sev:'warn',sym:a.sym,a:a.w,b:p.w,t:`ההתראה על ${a.sym} אומרת ${(+a.w).toFixed(1)}% מהתיק והתיק נותן ${(+p.w).toFixed(1)}%`})}
  // 8.11: the ledger replayed from its last anchor against the holdings
  for(const L of out.ledger||[])for(const g of L.gaps||[])F.push({k:'ledger',sev:'bad',sym:g.sym,a:g.expected,b:g.actual,t:`${g.sym} בחשבון ${L.acct}: לפי יומן הפעולות ${g.expected} יחידות, בתיק ${g.actual}${L.anchor?` (מאז הדוח של ${dmy(L.anchor)})`:''}`});
  return F;
}

const ownerUser=store=>{const o=store.users().find(u=>u.role==='owner'); return {uid:o?o.id:'owner',email:o?o.email:'',owner:true}};
// one person: the page's figures (without a screen) and the documents, compared
export async function consistOne(docs,user,{now=new Date(),log=()=>{},page=null}={}){
  const {P,Q}=docsOf(docs); if(!P||!Q||!Q.prices)return null;
  let out=null, errs=[];
  try{const r=page?await page(docs,user):await withPage(docs,user,pg=>pg.evaluate(()=>window.__model.consist&&window.__model.consist())); out=r.out; errs=r.errs||[]}
  catch(e){out={ready:false,err:e&&e.message||String(e)}}
  if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
  const items=[...consistPage(out),...consistDocs(docs,{now,pageTotal:out&&out.ready?out.total:null})];
  return {items,total:out&&out.ready?Math.round(out.total):null,pricesAt:out&&out.pricesAt||Q.updatedAt||null};
}
// a partner's row: kinds and counts only
const strip=items=>items.map(x=>({k:x.k,sev:x.sev,t:KIND_HE[x.k]||x.k}));
export async function consistTask(store,{log=()=>{},now=new Date(),page=null}={}){
  const runs=[], t0=Date.now();
  try{const r=await consistOne(ownerDocs(store),ownerUser(store),{now,log,page}); if(r)runs.push({uid:ownerUser(store).uid,owner:true,n:r.items.length,bad:r.items.filter(x=>x.sev==='bad').length,items:r.items,total:r.total,pricesAt:r.pricesAt}); else log('owner: no portfolio or quotes yet')}
  catch(e){log('owner failed: '+(e&&e.message||e))}
  for(const u of store.users().filter(u=>u.role!=='owner')){
    try{const d=partnerDocs(store,u); if(!d[`data/users/${u.id}/portfolio`])continue;
      const r=await consistOne(d,{uid:u.id,email:u.email,owner:false,u},{now,log,page}); if(!r)continue;
      runs.push({uid:u.id,owner:false,n:r.items.length,bad:r.items.filter(x=>x.sev==='bad').length,items:strip(r.items),pricesAt:r.pricesAt})}
    catch(e){log(`${u.id} failed: ${e&&e.message||e}`)}}
  const doc={at:now.toISOString(),ms:Date.now()-t0,runs,n:runs.reduce((t,r)=>t+r.n,0),bad:runs.reduce((t,r)=>t+r.bad,0)};
  store.setDoc(CONSIST_DOC,doc);
  log(`consistency: ${runs.length} portfolio(s), ${doc.n} gap(s), ${doc.bad} bad`+(doc.n?': '+runs.flatMap(r=>r.items.map(x=>x.k)).slice(0,8).join(', '):''));
  return doc;
}
// the last result, for the management center: the owner's own gaps in full only to the owner; a partner's row never
// carries more than kinds and counts (it was stripped when written)
export function consistView(store,viewer){
  const d=store.getDoc(CONSIST_DOC); if(!d.exists||!d.data)return {at:null,runs:[],n:0,bad:0};
  const D=d.data, own=r=>!!viewer&&(viewer.role==='owner'||(viewer.id&&r.uid===viewer.id));
  return {...D,runs:(D.runs||[]).map(r=>r.owner&&!own(r)?{...r,items:strip(r.items),total:undefined}:r)};
}
