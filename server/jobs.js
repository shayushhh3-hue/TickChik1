// The schedule, in Israel time, checked every 20 seconds inside the server. One job at a time (the headless page is
// heavy); a job that is due while another runs waits its turn. A missed run (the server was down) is not made up.
import {ilParts, ilOpen, usOpen} from '../shared/market.js';
import {pricesTask, nightlyTask, morningTask, monthlyTask, reportTask} from './tasks.js';

export const SCHEDULE=[
  // prices: every 5 minutes while Tel Aviv or New York trades, and on the hour's :40 from 10:40 to 23:40 (closing prices)
  {name:'prices',  when:(p,d)=>(p.wd>=1&&p.wd<=5&&p.h>=10&&p.h<=23&&p.min===40)||(p.min%5===0&&(ilOpen(d)||usOpen(d))), run:(s,o)=>pricesTask(s,o)},
  {name:'nightly', when:p=>p.wd>=1&&p.wd<=5&&p.h===23&&p.min===50, run:(s,o)=>nightlyTask(s,o)},
  {name:'morning', when:p=>p.h===7&&p.min===50, run:(s,o)=>morningTask(s,o)},
  {name:'monthly', when:p=>p.d===1&&p.h===8&&p.min===50, run:async(s,o)=>{await monthlyTask(s,o); await reportTask(s,{...o,kind:'month'})}},
  {name:'weekly',  when:p=>p.wd===5&&p.h===13&&p.min===50, run:(s,o)=>reportTask(s,{...o,kind:'week'})},
  {name:'quarterly',when:p=>p.d===1&&[1,4,7,10].includes(p.m)&&p.h===9&&p.min===25, run:(s,o)=>reportTask(s,{...o,kind:'quarter'})}
];

export function startJobs(store,{log=console.log,every=20000}={}){
  const done=new Set(), queue=[]; let busy=false;
  const pump=async()=>{
    if(busy||!queue.length)return; busy=true; const j=queue.shift(); const t0=Date.now();
    try{log(`job ${j.name} started`); await j.run(store,{log:(...a)=>log(`[${j.name}]`,...a)}); log(`job ${j.name} done in ${Math.round((Date.now()-t0)/1000)}s`)}
    catch(e){log(`job ${j.name} failed:`,e&&e.stack||e)}
    busy=false; setTimeout(pump,0);
  };
  const tick=()=>{const now=new Date(), p=ilParts(now); const slot=`${p.iso} ${p.h}:${p.min}`;
    for(const j of SCHEDULE){const k=j.name+'@'+slot; if(!done.has(k)&&j.when(p,now)){done.add(k);queue.push(j)}}
    if(done.size>500)for(const k of [...done].slice(0,250))done.delete(k);
    pump()};
  const iv=setInterval(tick,every); tick();
  log('scheduler on: '+SCHEDULE.map(j=>j.name).join(', ')+' (Israel time)');
  return {stop:()=>clearInterval(iv),run:name=>{const j=SCHEDULE.find(x=>x.name===name);if(!j)return false;queue.push(j);pump();return true}};
}
