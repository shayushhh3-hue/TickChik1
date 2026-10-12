// A finished report, by the page's own report code: weekly (Friday 13:50), monthly (the 1st), quarterly / half-year /
// yearly (the 1st of January, April, July, October). Saved to the archive (reports/archive/items/<id>) and sent as
// a PDF by e-mail. usage: node jobs/report.js week | month | quarter | half | year   (or an explicit key: month:2026-09)
import {bot, log, opt, guard, loadOwnerDocs} from './lib/env.js';
import {withPage} from './lib/headless.js';
import {sendMail, wrapHtml, esc} from './lib/mail.js';
import {ilParts} from '../shared/market.js';

const now=new Date(), p=ilParts(now);
const arg=process.argv[2]||'week';
const prevMonth=()=>{const d=new Date(Date.UTC(p.y,p.m-1,1));d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)};
const specs=[];
guard(arg.includes(':')||(arg==='week'&&p.wd===5&&p.h===13)||(arg==='month'&&p.d===1&&p.h===8)||(arg==='quarter'&&p.d===1&&p.h===9&&[1,4,7,10].includes(p.m)),'report '+arg);
if(arg.includes(':'))specs.push(arg);
else if(arg==='week')specs.push('week');
else if(arg==='month')specs.push('month:'+prevMonth());
else if(arg==='quarter'){ // on the 1st of a quarter: the quarter that ended, plus the half year and the year when they ended too
  const m=p.m, y=m===1?p.y-1:p.y, q=m===1?4:Math.floor((m-2)/3)+1; specs.push(`quarter:${y}-Q${q}`);
  if(m===7)specs.push(`half:${p.y}-H1`); if(m===1){specs.push(`half:${y}-H2`);specs.push(`year:${y}`)}
}else specs.push(arg);
const fs=await bot();
const docs=await loadOwnerDocs(fs);
if(!docs['portfolio/main']||!docs['quotes/latest']){log('no portfolio or quotes yet');process.exit(0)}
// the archive, so the page's catalog knows what exists
try{const arc=await fs.listDocs('reports/archive/items');for(const a of arc)docs['reports/archive/items/'+a.id]=a.data}catch(e){log('archive read failed',e.message)}
const owner={uid:opt('OWNER_UID','owner'),email:opt('OWNER_EMAIL',''),owner:true};
const {out,errs}=await withPage(docs,owner,async pg=>{
  await pg.waitForFunction(()=>window.__rep.ready(),null,{timeout:45000}).catch(()=>{});
  const res=[];
  for(const spec of specs){
    const [kind,key]=spec.split(':');
    const doc=await pg.evaluate(([k,y])=>window.__rep.build(k,y),[kind,key||'']);
    if(!doc){res.push({spec,error:'no report'});continue}
    const pdf=await pg.evaluate(R=>window.__rep.pdf(R),doc.R);
    const B=doc.R.blocks||[], cards=B.find(x=>x.t==='cards'), say=B.find(x=>x.t==='say');
    const rc=cards&&cards.items&&cards.items.find(c=>c.res);
    const sg=n=>(n>=0?'+':'-')+'₪'+Math.abs(Math.round(n)).toLocaleString('en-US');
    const lines=[doc.R.title+' · '+doc.R.period, rc?`${rc.k}: ${sg(rc.gain)}${rc.pct!=null?' ('+(rc.pct>=0?'+':'')+(+rc.pct).toFixed(1)+'%)':''}`:'', say?say.text:'', cards&&cards.vals?cards.vals.map(i=>i[0]+': '+i[1]).join(' | '):''].filter(Boolean);
    res.push({spec,doc,pdf,lines});
  }
  return res;
},{fonts:true});
if(errs.length)log('page errors:',errs.slice(0,3).join(' | '));
for(const r of out){
  if(r.error){log(r.spec,'→',r.error);continue}
  const d=r.doc; await fs.setDoc('reports/archive/items/'+d.id,d);
  const file=(d.id.startsWith('week')?'doch-shvui':d.id.startsWith('month')?'doch-hodshi':d.id.startsWith('quarter')?'doch-rivoni':d.id.startsWith('half')?'doch-hatzi-shnati':'doch-shnati')+'-'+p.iso+'.pdf';
  await sendMail({subject:`תיק צ׳יק – ${d.title}${d.period?' · '+d.period:''}`,text:r.lines.join('\n')+'\n\nהדוח המלא מצורף. עובדות ומספרים בלבד; לא המלצה לקנות או למכור.',
    html:wrapHtml(d.title,`<p>${r.lines.map(esc).join('<br>')}</p><p style="color:#64748b;font-size:13px">הדוח המלא מצורף כ-PDF, וגם שמור בארכיון בדף.</p>`),
    attachments:[{filename:file,content:Buffer.from(r.pdf,'base64'),contentType:'application/pdf'}]});
  log(`${r.spec} → ${d.id} saved, ${Math.round(r.pdf.length*3/4/1024)} KB PDF`);
}
