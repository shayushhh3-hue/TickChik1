// The schedule, in Israel time, checked every 20 seconds inside the server. One job at a time (the headless page is
// heavy); a job that is due while another runs waits its turn. A missed run (the server was down) is not made up.
import {ilParts, pxDue} from '../shared/market.js';
import {pricesTask, nightlyTask, morningTask, monthlyTask, reportTask} from './tasks.js';
import {backupTask} from './backup.js';
import {researchTask} from './research.js';

export const SCHEDULE=[
  // prices: every 5 minutes while Tel Aviv or New York trades, every 15 minutes at all other hours (fund prices come out at
  // night), on the hour's :40 from 10:40 to 23:40 (closing prices), and four
  // catch-up runs on Saturday and Sunday (a close the source delivered late, PXRUN in shared/market.js)
  {name:'prices',  when:(p,d)=>pxDue(p,d), run:(s,o)=>pricesTask(s,o)},
  {name:'nightly', when:p=>p.wd>=1&&p.wd<=5&&p.h===23&&p.min===50, run:(s,o)=>nightlyTask(s,o)},
  {name:'morning', when:p=>p.h===7&&p.min===50, run:(s,o)=>morningTask(s,o)},
  {name:'monthly', when:p=>p.d===1&&p.h===8&&p.min===50, run:async(s,o)=>{await monthlyTask(s,o); await reportTask(s,{...o,kind:'month'})}},
  {name:'weekly',  when:p=>p.wd===5&&p.h===13&&p.min===50, run:(s,o)=>reportTask(s,{...o,kind:'week'})},
  {name:'backup',  when:p=>p.h===2&&p.min===30, run:(s,o)=>backupTask(s,o)},
  // analysts' views and company figures, after the US close: Tuesday to Saturday at 01:15
  {name:'research',when:p=>p.wd>=2&&p.wd<=6&&p.h===1&&p.min===15, run:(s,o)=>researchTask(s,o)},
  {name:'quarterly',when:p=>p.d===1&&[1,4,7,10].includes(p.m)&&p.h===9&&p.min===25, run:(s,o)=>reportTask(s,{...o,kind:'quarter'})}
];

// the longest a job may hold the queue: after that the next job starts (the late one may still finish in the background)
export const LIMIT={prices:4*60e3,nightly:25*60e3,research:30*60e3};
export function startJobs(store,{log=console.log,every=20000,dataDir,limits=LIMIT,fallback=12*60e3,schedule=SCHEDULE}={}){
  const done=new Set(), queue=[]; let busy=false;
  const pump=async()=>{
    if(busy||!queue.length)return; busy=true; const j=queue.shift(); const t0=Date.now(), ms=limits[j.name]||fallback; let to;
    try{log(`job ${j.name} started`);
      const r=await Promise.race([j.run(store,{dataDir,log:(...a)=>log(`[${j.name}]`,...a)}).then(()=>'done'),new Promise(ok=>{to=setTimeout(()=>ok('late'),ms)})]);
      log(r==='late'?`job ${j.name} still running after ${Math.round(ms/60e3)} minutes; the queue goes on`:`job ${j.name} done in ${Math.round((Date.now()-t0)/1000)}s`)}
    catch(e){log(`job ${j.name} failed:`,e&&e.stack||e)}
    clearTimeout(to); busy=false; setTimeout(pump,0);
  };
  // a job already waiting is not queued twice (prices every 5 minutes behind a slow job)
  const enqueue=j=>{if(!queue.some(q=>q.name===j.name))queue.push(j)};
  const tick=()=>{const now=new Date(), p=ilParts(now); const slot=`${p.iso} ${p.h}:${p.min}`;
    for(const j of schedule){const k=j.name+'@'+slot; if(!done.has(k)&&j.when(p,now)){done.add(k);enqueue(j)}}
    if(done.size>500)for(const k of [...done].slice(0,250))done.delete(k);
    pump()};
  const iv=setInterval(tick,every); tick();
  log('scheduler on: '+schedule.map(j=>j.name).join(', ')+' (Israel time)');
  return {stop:()=>clearInterval(iv),run:name=>{const j=schedule.find(x=>x.name===name);if(!j)return false;enqueue(j);pump();return true},queue};
}
