// 6.11: share splits (SOXX split 3 for 1 on 5.11). A split divides every unit into several (or joins several into one,
// a reverse split) and leaves the holding's worth as it was. The quote sources adjust the previous close on the split day,
// so the day's change is right; what does not adjust by itself is what the site keeps: the units from the statements, the
// prices it saved day by day, the price alerts that were set. Before this, the units stayed and the worth fell to a third.
//
// The split is found from the prices themselves: for a US security, the last price kept and the source's previous close
// are the same day's close, so they can differ by a clean ratio (3, 2, 3:2, 1:10) only through a split. It is then applied
// once to every portfolio that holds the security (units from a statement dated before the split), to the saved daily
// prices and to the price alerts, with a record of before and after (the page says so, and can undo it).

const R_FWD=[1.5,2,2.5,3,4,5,6,7,8,10,12,15,20,25,30,40,50], R_REV=[2,3,4,5,8,10,12,15,20,25,30,40,50].map(x=>1/x).concat([2/3]);
const R_ALL=R_FWD.concat(R_REV);
const r6=x=>Math.round(x*1e6)/1e6;
// the units after the split for one unit before: 3 for a 3-for-1 split, 0.1 for a 1-for-10 reverse split; null when the
// ratio is not a split's
export function splitRatio(x){
  if(!(x>0)||(x>0.8&&x<1.25))return null;
  let best=null; for(const v of R_ALL){const e=Math.abs(v-x)/v; if(e<0.025&&(!best||e<best.e))best={v,e}}
  return best?r6(best.v):null}
const wd=iso=>new Date(Date.parse(iso+'T12:00:00Z')).getUTCDay();
const addD=(iso,k)=>new Date(Date.parse(iso+'T12:00:00Z')+k*864e5).toISOString().slice(0,10);
export function nextWeekday(iso){let d=addD(iso,1); while([0,6].includes(wd(d)))d=addD(d,1); return d}
// one quote against the price kept before it: a split, or null
export function splitFromQuote(sym,old,q){
  const ref=+(((old&&old.prices)||{})[sym]), om=(((old&&old.meta)||{})[sym])||{};
  if(!(ref>0)||!q||!(+q.px>0)||q.src==='maya'||(q.ccy&&q.ccy!=='USD')||(om.ccy&&om.ccy!=='USD')||om.src==='maya'||om.src==='index')return null;
  const od=String(om.date||''), nd=String(q.closeDate||''); if(!/^\d{4}-\d\d-\d\d$/.test(od)||!/^\d{4}-\d\d-\d\d$/.test(nd)||nd<od)return null;
  if((Date.parse(nd)-Date.parse(od))/864e5>5)return null;   // the kept price is too old to be the same day's close
  const newDay=nd>od, cand=newDay?+q.prev:+q.px; if(!(cand>0))return null;
  const r=splitRatio(ref/cand); if(!r)return null;
  // the price itself moved by the same ratio (with at most a day's move)
  const mv=(+q.px*r)/ref; if(!(mv>0.6&&mv<1.6))return null;
  return {d:newDay?nd:nextWeekday(od),r,ref:r6(ref),prev:r6(cand)}}

const key=(sym,sp)=>`${sym}:${sp.d}`;
const dd=(a,b)=>Math.abs(Date.parse(a)-Date.parse(b))/864e5;
// 6.11: one split is one event: the same security, the same ratio, within a week. Found once by the announced day and once
// by the saved days, it was two keys, and was applied twice
export const sameSplit=(a,sym,sp)=>!!a&&a.sym===sym&&!!a.d&&dd(a.d,sp.d)<=7&&Math.abs((+a.r)/(+sp.r)-1)<0.03;
const recsOf=(P,sym)=>Object.entries((P&&P.splits)||{}).map(([k,v])=>({k,...(v||{})})).filter(x=>x.sym===sym);
// a portfolio: the units of the security, in every account whose statement (or the hand-written units, qAt) is older
// than the split; the statement's own price divided. The record keeps each row's units before and after.
// late (found days after the split): units someone may have fixed by hand since. With a known cost, the split is applied
// only when it brings the cost of a unit nearer to the price (a holding bought at $400 is not worth $44 a unit)
export function splitPortfolio(P,sym,sp,now=new Date(),{late=false,px=null}={}){
  if(!P||!Array.isArray(P.positions)||((P.splits||{})[key(sym,sp)])||recsOf(P,sym).some(x=>sameSplit(x,sym,sp)))return null;
  if(!P.positions.some(p=>p&&p.sym===sym))return null;
  const P2=JSON.parse(JSON.stringify(P)), asOf=P2.asOf||{}, rows=[];
  for(const p of P2.positions){if(!p||p.sym!==sym)continue; const a=String(asOf[p.acct]||''), qa=String(p.qAt||'');
    if((a&&a>=sp.d)||(qa&&qa>=sp.d)){rows.push({acct:p.acct||null,q0:+p.qty||0,q1:+p.qty||0,kept:true}); continue}
    const q0=+p.qty||0; if(!(q0>0))continue;
    const cost=+(p.ccy==='ILS'?p.costIls:p.costUsd)||0; if(late&&cost>0&&+px>0){const c0=cost/q0, c1=cost/(q0*sp.r); if(Math.abs(Math.log(c1/px))>=Math.abs(Math.log(c0/px))){rows.push({acct:p.acct||null,q0,q1:q0,kept:true,why:'cost'}); continue}}
    p.qty=r6(q0*sp.r); if(+p.px>0)p.px=r6(+p.px/sp.r); rows.push({acct:p.acct||null,q0,q1:p.qty})}
  P2.splits={...(P2.splits||{}),[key(sym,sp)]:{sym,d:sp.d,r:sp.r,at:now.toISOString(),rows}};
  return {P:P2,rows}}
// the saved daily prices before the split, in the new units (an Israeli day before the US split day), from the prices
// themselves: from the split day back, a day the split's ratio away from the next one is in the old units (divided), a day
// the ratio below it was divided twice (put back), any other day is already right. Running it again changes nothing.
export function splitDaily(DY,sym,sp){
  const r=+sp.r; if(!DY||!DY.points||!(r>0)||Math.abs(r-1)<0.2)return null;
  const D=JSON.parse(JSON.stringify(DY)), days=Object.keys(D.points).filter(k=>D.points[k]&&D.points[k].px&&+D.points[k].px[sym]>0).sort();
  const firstNew=days.find(k=>k>=sp.d); let next=firstNew?+D.points[firstNew].px[sym]:(+sp.prev>0?+sp.prev:null); if(!(next>0))return null;
  const L=Math.log(r), tol=Math.min(0.22,Math.abs(L)/3); let n=0;
  for(const k of days.filter(k=>k<sp.d).reverse()){const v=+D.points[k].px[sym], x=Math.log(v/next); let w=v;
    if(Math.abs(x-L)<tol)w=v/r; else if(Math.abs(x+L)<tol)w=v*r;
    if(w!==v){D.points[k].px[sym]=r6(w); n++} next=w}
  if(!n)return null; D.splits={...(D.splits||{}),[key(sym,sp)]:true}; return {D,n}}
// the price alerts set on the security (an alert "below 400" on a price that is now 132 would fire at once)
export function splitSettings(S,sym,sp){
  const a=S&&S.pxAlerts&&S.pxAlerts[sym]; if(!a||Object.keys(S.splits||{}).some(k=>k.split(':')[0]===sym&&dd(k.slice(sym.length+1),sp.d)<=7))return null;
  const S2=JSON.parse(JSON.stringify(S)), t=S2.pxAlerts[sym];
  for(const k of ['above','below'])if(+t[k]>0)t[k]=Math.round(+t[k]/sp.r*100)/100;
  S2.splits={...(S2.splits||{}),[key(sym,sp)]:true}; return {S:S2}}
// every person's documents (the owner's, and each partner's under data/users/<id>/)
export function applySplits(store,splits,{now=new Date(),log=()=>{},late=false}={}){
  const out=[]; if(!splits||!Object.keys(splits).length)return out;
  const ids=new Set(); try{for(const p of (store.pathsUnder?store.pathsUnder('data/users'):[])){const m=/^data\/users\/([^/]+)\//.exec(p); if(m)ids.add(m[1])}}catch(e){}
  const sets=[{port:'portfolio/main',daily:'history/daily',set:'settings/main',who:'owner'},...[...ids].map(id=>({port:`data/users/${id}/portfolio`,daily:`data/users/${id}/daily`,set:`data/users/${id}/settings`,who:id}))];
  for(const [sym,sp] of Object.entries(splits)){
    for(const w of sets){
      const P=store.getDoc(w.port); if(!P.exists||!((P.data||{}).positions||[]).some(p=>p&&p.sym===sym))continue;
      const DY=store.getDoc(w.daily); if(DY.exists){const d=splitDaily(DY.data,sym,sp); if(d){store.setDoc(w.daily,d.D,{silent:true}); log(`split ${sym}: ${d.n} saved day(s) put in the new units for ${w.who}`)}}
      const px=+((((store.getDoc('quotes/latest')||{}).data||{}).prices||{})[sym])||null; const r=splitPortfolio(P.data,sym,sp,now,{late,px}); if(!r)continue;
      store.setDoc(w.port,r.P);
      if(r.rows.some(x=>!x.kept)){const S=store.getDoc(w.set); if(S.exists){const s=splitSettings(S.data,sym,sp); if(s)store.setDoc(w.set,s.S)}}
      out.push({who:w.who,sym,d:sp.d,r:sp.r,rows:r.rows}); log(`split ${sym} ${sp.r}:1 on ${sp.d} applied for ${w.who}: ${r.rows.map(x=>`${x.acct||'-'} ${x.q0}→${x.q1}`).join(', ')}`)}}
  return out}

// 6.11: a split the live prices did not catch (the server was down that day, or the split came before this check existed,
// as SOXX's on 5.11): the prices the site saved day by day against the source's close series of the same days. The source
// adjusts its whole series after a split; the saved prices before the split are in the old units, so for those days the two
// differ by the split's ratio, and from the split day on they agree. Found once, kept with the quotes, applied like the others.
export function splitFromSeries(sym,pts,ser){
  if(!pts||!ser||!Array.isArray(ser.d)||!Array.isArray(ser.c)||ser.d.length<5)return null;
  const at=new Map(ser.d.map((d,i)=>[d,+ser.c[i]])), days=Object.keys(pts).filter(k=>pts[k]&&pts[k].px&&+pts[k].px[sym]>0&&at.get(k)>0).sort().slice(-40);
  if(!days.length)return null;
  const rs=days.map(k=>({k,x:+pts[k].px[sym]/at.get(k)}));
  // the last day whose saved price is a split's ratio away from the series, and every later day in agreement
  let i=rs.length-1; while(i>=0&&Math.abs(rs[i].x-1)<0.12)i--; if(i<0)return null;
  const r=splitRatio(rs[i].x); if(!r)return null;
  const after=rs.slice(i+1); if(!after.length||after.some(z=>Math.abs(z.x-1)>=0.12))return null;
  // the days before it in the old units agree on the ratio (a lone odd price is not a split)
  const before=rs.slice(0,i+1).filter(z=>Math.abs(z.x-1)>=0.12); if(before.some(z=>Math.abs(z.x/r-1)>0.05))return null;
  const last=rs[i].k, nextSer=ser.d.filter(d=>d>last).sort()[0];
  // the split day is the source's next trading day after the last day in the old units
  return {d:nextSer||nextWeekday(last),r,ref:r6(+pts[last].px[sym]),prev:r6(at.get(last)),src:'series'}}
const KNOWN={SOXX:{d:'2026-11-05',r:3,src:'הודעת iShares'}};
export function reconcileSplits(store,{now=new Date(),log=()=>{}}={}){
  const Qd=store.getDoc('quotes/latest'); if(!Qd.exists||!Qd.data)return [];
  const Q=Qd.data, meta=Q.meta||{}, found={};
  const ids=new Set(); try{for(const p of (store.pathsUnder?store.pathsUnder('data/users'):[])){const m=/^data\/users\/([^/]+)\//.exec(p); if(m)ids.add(m[1])}}catch(e){}
  const dailies=['history/daily',...[...ids].map(id=>`data/users/${id}/daily`)].map(p=>store.getDoc(p)).filter(d=>d.exists&&d.data&&d.data.points);
  for(const sym of Object.keys(Q.prices||{})){const m=meta[sym]||{}; if(m.src==='maya'||m.src==='index'||(m.ccy&&m.ccy!=='USD')||/\.TA$|^TLV:|^\d/.test(sym))continue;
    const S=store.getDoc('quotes/c_'+sym.replace(':','_')); if(!S.exists||!S.data)continue;
    for(const D of dailies){const sp=splitFromSeries(sym,D.data.points,S.data); if(!sp)continue;
      const had=(Q.splits||{})[sym]; if(had&&sameSplit({...had,sym},sym,sp))break;   // known: applied where it was not yet (the records say)
      found[sym]={...sp,at:now.toISOString()}; break}}
  // the splits announced by the fund or the company itself, for the days before this check existed (iShares announced SOXX's
  // 3-for-1 split for 5.11; the saved days find it too when the source's series is adjusted)
  for(const [sym,v] of Object.entries(KNOWN))if(!found[sym]&&!sameSplit({...((Q.splits||{})[sym]||{}),sym},sym,v)&&Date.parse(v.d)>now.getTime()-60*864e5&&(Q.prices||{})[sym]!=null)found[sym]={...v,at:now.toISOString()};
  const all={...(Q.splits||{}),...found};
  if(Object.keys(found).length){store.setDoc('quotes/latest',{...Q,splits:all}); log(`split found in the saved prices: ${Object.entries(found).map(([k,v])=>`${k} ${v.r} (${v.d})`).join(', ')}`)}
  // a split applied twice (before one event was one): the later application is undone, the units back to its "before"
  try{repairSplits(store,{now,log})}catch(e){log('split repair: '+(e&&e.message||e))}
  // apply every kept split where it was not applied yet (each portfolio keeps its record)
  return applySplits(store,Object.fromEntries(Object.entries(all).filter(([k,v])=>v&&v.d&&Date.parse(v.d)>now.getTime()-60*864e5)),{now,log,late:true});
}
export function splitRepairP(P,now=new Date()){
  const R=Object.entries((P&&P.splits)||{}).map(([k,v])=>({k,...(v||{})})).filter(x=>x.sym&&!x.undone&&(x.rows||[]).some(r=>!r.kept)).sort((a,b)=>String(a.at)<String(b.at)?-1:String(a.at)>String(b.at)?1:a.k<b.k?-1:1);
  let P2=null; const fixed=[];
  R.forEach((b,j)=>{if(!R.slice(0,j).some(a=>!fixed.includes(a.k)&&sameSplit(a,b.sym,b)))return; P2=P2||JSON.parse(JSON.stringify(P));
    for(const row of b.rows||[]){if(row.kept)continue; const p=P2.positions.find(x=>x.sym===b.sym&&(x.acct||null)===(row.acct||null)&&Math.abs((+x.qty||0)-row.q1)<1e-6); if(p){p.qty=row.q0; if(+p.px>0)p.px=r6(+p.px*b.r)}}
    P2.splits[b.k]={...P2.splits[b.k],undone:now.toISOString(),why:'double'}; fixed.push(b.k)});
  return P2?{P:P2,fixed}:null}
export function repairSplits(store,{now=new Date(),log=()=>{}}={}){
  const ids=new Set(); try{for(const p of (store.pathsUnder?store.pathsUnder('data/users'):[])){const m=/^data\/users\/([^/]+)\//.exec(p); if(m)ids.add(m[1])}}catch(e){}
  const sets=[{port:'portfolio/main',set:'settings/main',who:'owner'},...[...ids].map(id=>({port:`data/users/${id}/portfolio`,set:`data/users/${id}/settings`,who:id}))], out=[];
  const Q=(store.getDoc('quotes/latest').data)||{};
  for(const w of sets){const P=store.getDoc(w.port); if(!P.exists)continue; const r=splitRepairP(P.data,now); if(!r)continue; store.setDoc(w.port,r.P); out.push({who:w.who,fixed:r.fixed}); log(`split applied twice, undone for ${w.who}: ${r.fixed.join(', ')}`);
    // the price alerts divided twice: once back
    const S=store.getDoc(w.set); if(S.exists&&S.data&&S.data.pxAlerts){const S2=JSON.parse(JSON.stringify(S.data)); let ch=false;
      for(const k of r.fixed){const sym=k.split(':')[0], rr=+((r.P.splits[k]||{}).r)||+((Q.splits||{})[sym]||{}).r, t=S2.pxAlerts[sym]; if(!t||!(rr>0)||!(S2.splits||{})[k])continue;
        for(const f of ['above','below'])if(+t[f]>0)t[f]=Math.round(+t[f]*rr*100)/100; delete S2.splits[k]; ch=true}
      if(ch)store.setDoc(w.set,S2)}}
  return out}
