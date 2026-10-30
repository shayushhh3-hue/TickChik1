// The schedule, in Israel time, checked every 20 seconds inside the server. One job at a time (the headless page is
// heavy); a job that is due while another runs waits its turn. 25.10: the prices (and the check that they are flowing)
// have a lane of their own (lane:'px'), so a long run of company figures never holds the live prices back. A missed run (the server was down) is not made up.
import {ilParts, pxDue} from '../shared/market.js';
import {pricesTask, nightlyTask, morningTask, monthlyTask, reportTask} from './tasks.js';
import {backupTask} from './backup.js';
import {researchTask, earningsTask, takeQueued} from './research.js';
import {benchTask} from './bench.js';
import {ilSymsTask} from './ilsyms.js';
import {pxWatchTask} from './pxwatch.js';
import {newsTask} from './newsfeed.js';
import {newsxTask} from './newsx.js';
import {xTask} from './xfeed.js';
import {liveTask} from './livealert.js';
import {newsSyms} from './newsfeed.js';
import {jobNote, healthCheck} from './health.js';

export const SCHEDULE=[
  // prices: every 5 minutes while Tel Aviv or New York trades, every 15 minutes at all other hours (fund prices come out at
  // night), on the hour's :40 from 10:40 to 23:40 (closing prices), and four
  // catch-up runs on Saturday and Sunday (a close the source delivered late, PXRUN in shared/market.js)
  {name:'prices',  lane:'px', when:(p,d)=>pxDue(p,d), run:(s,o)=>pricesTask(s,o)},
  {name:'nightly', when:p=>p.wd>=1&&p.wd<=5&&p.h===23&&p.min===50, run:(s,o)=>nightlyTask(s,o)},
  {name:'morning', when:p=>p.h===7&&p.min===50, run:(s,o)=>morningTask(s,o)},
  {name:'monthly', when:p=>p.d===1&&p.h===8&&p.min===50, run:async(s,o)=>{await monthlyTask(s,o); await reportTask(s,{...o,kind:'month'})}},
  {name:'weekly',  when:p=>p.wd===5&&p.h===13&&p.min===50, run:(s,o)=>reportTask(s,{...o,kind:'week'})},
  {name:'backup',  when:p=>p.h===2&&p.min===30, run:(s,o)=>backupTask(s,o)},
  // analysts' views and company figures, after the US close: Tuesday to Saturday at 01:15
  {name:'research',when:p=>p.wd>=2&&p.wd<=6&&p.h===1&&p.min===15, run:(s,o)=>researchTask(s,o)},
  // a company's report soon after it is out: only the securities whose report date has come (and the reports of the last
  // days still waiting for their revenue, the e-mail or the share's move). Every 20 minutes when the US reports come out
  // (before the open: 13:00-16:40, after the close: 22:00-01:40, Israel time), and in the morning and the evening
  {name:'earnings',when:p=>(p.min%20===0&&((p.h>=13&&p.h<=16)||p.h>=22||p.h<=1))||([7,10,19].includes(p.h)&&p.min===20), run:(s,o)=>earningsTask(s,o)},
  // the indices for "האם אני עושה טוב?", after New York's close
  {name:'bench',   when:p=>p.h===0&&p.min===35, run:(s,o)=>benchTask(s,o)},
  // the Israeli securities for the search (with a TASE key), before the morning
  {name:'ilsyms',  when:p=>p.h===5&&p.min===10, run:(s,o)=>ilSymsTask(s,o)},
  // something stopped: every half hour from 09:05 to 23:35, an e-mail to the owner (with consent) about a new problem
  // 30.10: the owner's live alerts (prices set, a big day, the dollar, a critical reading), every 10 minutes by day
  {name:'live',    lane:'px', when:p=>p.h>=9&&p.h<=23&&p.min%10===3, run:(s,o)=>liveTask(s,o)},
  {name:'pxwatch', lane:'px', when:p=>p.h>=9&&p.h<=23&&(p.min===5||p.min===35), run:(s,o)=>pxWatchTask(s,o)},
  // the articles about everybody's securities, every half hour by day (research/news, the "חדשות" tab)
  // 29.10: ...and read right after they are gathered (what happened, whom it may touch, how sure); 'newsx' alone is the
  // owner's "read now" and a catch-up a quarter of an hour later
  {name:'news',    when:p=>p.h>=7&&p.h<=23&&p.min%30===10, run:async(s,o)=>{await newsTask(s,o); await newsxTask(s,o)}},
  {name:'newsx',   when:p=>p.h>=7&&p.h<=23&&p.min%30===25, run:(s,o)=>newsxTask(s,o)},
  // 29.10: what investors post on X about the securities (with a token that may read), twice a day, before the readings
  {name:'x',       when:p=>(p.h===9||p.h===17)&&p.min===15, run:(s,o)=>xTask(s,{...o,newsSyms})},
  {name:'quarterly',when:p=>p.d===1&&[1,4,7,10].includes(p.m)&&p.h===9&&p.min===25, run:(s,o)=>reportTask(s,{...o,kind:'quarter'})},
  // never on the clock: the securities of a portfolio just saved, so their figures do not wait for the night
  {name:'research-new',when:()=>false, run:(s,o)=>{const only=takeQueued(); return only.length?researchTask(s,{...o,only,budgetMs:6*60e3}):Promise.resolve(null)}}
];

// the longest a job may hold the queue: after that the next job starts (the late one may still finish in the background)
export const LIMIT={ilsyms:3*60e3,bench:3*60e3,pxwatch:60e3,prices:4*60e3,nightly:25*60e3,research:30*60e3,earnings:8*60e3,news:11*60e3,newsx:6*60e3,x:3*60e3,live:60e3};
export function startJobs(store,{log=console.log,every=20000,dataDir,limits=LIMIT,fallback=12*60e3,schedule=SCHEDULE}={}){
  const done=new Set(), L={}, lane=n=>L[n]||(L[n]={queue:[],busy:false});
  const pumpLane=async ln=>{const Q=lane(ln);
    if(Q.busy||!Q.queue.length)return; Q.busy=true; const j=Q.queue.shift(); const t0=Date.now(), ms=limits[j.name]||fallback; let to;
    try{log(`job ${j.name} started`);
      const r=await Promise.race([j.run(store,{dataDir,log:(...a)=>log(`[${j.name}]`,...a)}).then(()=>'done'),new Promise(ok=>{to=setTimeout(()=>ok('late'),ms)})]);
      log(r==='late'?`job ${j.name} still running after ${Math.round(ms/60e3)} minutes; the queue goes on`:`job ${j.name} done in ${Math.round((Date.now()-t0)/1000)}s`);
      if(r==='done')jobNote(store,j.name,{ok:true,ms:Date.now()-t0})}
    catch(e){log(`job ${j.name} failed:`,e&&e.stack||e); jobNote(store,j.name,{ok:false,ms:Date.now()-t0,err:e&&e.message||e})}
    // 30.10: what each source last did, read right after the job wrote it (the health of the data, server/health.js)
    try{healthCheck(store)}catch(e){}
    clearTimeout(to); Q.busy=false; setTimeout(()=>pumpLane(ln),0);
  };
  const pump=()=>{for(const ln of Object.keys(L))pumpLane(ln)};
  const queue=lane('main').queue;
  // a job already waiting is not queued twice (prices every 5 minutes behind a slow job)
  const enqueue=j=>{const q=lane(j.lane||'main').queue; if(!q.some(x=>x.name===j.name))q.push(j)};
  const tick=()=>{const now=new Date(), p=ilParts(now); const slot=`${p.iso} ${p.h}:${p.min}`;
    for(const j of schedule){const k=j.name+'@'+slot; if(!done.has(k)&&j.when(p,now)){done.add(k);enqueue(j)}}
    if(done.size>500)for(const k of [...done].slice(0,250))done.delete(k);
    pump()};
  const iv=setInterval(tick,every); tick();
  log('scheduler on: '+schedule.map(j=>j.name).join(', ')+' (Israel time)');
  return {stop:()=>clearInterval(iv),run:name=>{const j=schedule.find(x=>x.name===name);if(!j)return false;enqueue(j);pump();return true},queue};
}
