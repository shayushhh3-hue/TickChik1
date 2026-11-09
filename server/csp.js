// 9.11 (the plan's open item: "enforce the content-security policy after the reports"): the policy decides by itself.
// It starts in report-only mode; after CLEAN days in which no browser reported a block on the site's own pages it is
// enforced; if, while enforced, a browser reports a block on our pages, it goes back to report-only for another CLEAN days
// and the run log (and so the people with the "system" permission) hears of it. CSP_ENFORCE=1 / 0 in the environment
// overrides the automatic choice either way.
const DAY=864e5;
export const CSP_CLEAN_DAYS=7;
const meta=(store,k,d)=>{try{const v=JSON.parse(store.getMeta(k)||'null'); return v==null?d:v}catch(e){return d}};

// a report that says something about the site: not an extension's own script, not an empty "about:" page
export function cspOwn(r){const b=String(r&&r.blocked||''); return !/^(chrome|moz|safari|safari-web|ms-browser)-extension:/i.test(b)&&!/^about:/i.test(b)&&!/extension/i.test(String(r&&r.source||''))}

export function cspState(store,{env=process.env,now=new Date()}={}){
  if(env.CSP_ENFORCE==='1')return {mode:'enforce',by:'env'}; if(env.CSP_ENFORCE==='0')return {mode:'report',by:'env'};
  let S=meta(store,'cspAuto',null); const t=now.getTime();
  if(!S||!S.mode){S={mode:'report',since:now.toISOString()}; store.setMeta('cspAuto',JSON.stringify(S))}
  if(S.mode==='report'){const since=Date.parse(S.since)||t, L=meta(store,'cspReports',[]).filter(cspOwn), last=L.reduce((a,x)=>Math.max(a,Date.parse(x.last||x.at)||0),0);
    if(last>since){S={mode:'report',since:new Date(last).toISOString(),waitFor:'clean'}; store.setMeta('cspAuto',JSON.stringify(S))}
    else if(t-since>=CSP_CLEAN_DAYS*DAY){S={mode:'enforce',since:now.toISOString()}; store.setMeta('cspAuto',JSON.stringify(S))}}
  const left=S.mode==='report'?Math.max(0,Math.ceil(((Date.parse(S.since)||t)+CSP_CLEAN_DAYS*DAY-t)/DAY)):0;
  return {mode:S.mode,by:'auto',since:S.since,left}}

// a browser's report: kept (one line per directive and address, with its last time and a count); while enforced, a block
// on our pages turns the policy back to report-only
export function cspReport(store,item,{env=process.env,now=new Date(),onRevert=null}={}){
  const L=meta(store,'cspReports',[]), i=L.findIndex(x=>x.directive===item.directive&&x.blocked===item.blocked), at=now.toISOString();
  if(i>=0){L[i].last=at; L[i].n=(L[i].n||1)+1; const [x]=L.splice(i,1); L.push(x)} else L.push({...item,at,last:at,n:1});
  store.setMeta('cspReports',JSON.stringify(L.slice(-40)));
  if(env.CSP_ENFORCE==='1'||env.CSP_ENFORCE==='0'||!cspOwn(item))return false;
  const S=meta(store,'cspAuto',null); if(!S||S.mode!=='enforce')return false;
  store.setMeta('cspAuto',JSON.stringify({mode:'report',since:at,reverted:{at,directive:item.directive,blocked:item.blocked}}));
  try{onRevert&&onRevert(item)}catch(e){} return true}
