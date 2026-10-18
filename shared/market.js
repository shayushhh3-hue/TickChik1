// Trading hours, in the same terms the page uses: Tel Aviv trades Monday–Friday (Friday until 14:00) since January
// 2026; New York 9:30–16:00 Monday–Friday. New York holidays and 13:00 early closes come from the NYSE's published
// calendar (announced Dec 2025, covers 2026–2027). Tel Aviv holidays are not listed here: a Tel Aviv holiday shows up
// in the data (no trade today), and the price document says so.
const parts=(d,tz)=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(d);
  const g=k=>(p.find(x=>x.type===k)||{}).value; const wd={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[g('weekday')];
  return {wd,y:+g('year'),m:+g('month'),d:+g('day'),h:+g('hour')%24,min:+g('minute'),iso:`${g('year')}-${g('month')}-${g('day')}`}};
export const ilParts=d=>parts(d||new Date(),'Asia/Jerusalem');
export const nyParts=d=>parts(d||new Date(),'America/New_York');
export function ilOpen(d){const p=ilParts(d),t=p.h*60+p.min;if(p.wd===0||p.wd===6)return false;return t>=600&&t<(p.wd===5?14*60:17*60+30)}
export const NYSE_CLOSED=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24']);
export const NYSE_EARLY=new Set(['2026-11-27','2026-12-24','2027-11-26']); // close at 13:00 New York time
export function usOpen(d){const p=nyParts(d),t=p.h*60+p.min;if(p.wd<1||p.wd>5||NYSE_CLOSED.has(p.iso))return false;return t>=570&&t<(NYSE_EARLY.has(p.iso)?780:960)}
export const anyOpen=d=>ilOpen(d)||usOpen(d);
// the last session a market should have reported by now: today once it has traded for half an hour, otherwise the last
// weekday before (New York skips its holidays; a Tel Aviv holiday is not known here, so that day shows as "not received")
export function lastSession(mkt,d){
  let t=(d||new Date()).getTime();
  for(let i=0;i<12;i++,t-=864e5){
    const p=mkt==='us'?nyParts(new Date(t)):ilParts(new Date(t)), m=p.h*60+p.min;
    const day=p.wd>=1&&p.wd<=5&&!(mkt==='us'&&NYSE_CLOSED.has(p.iso));
    if(day&&(i>0||m>=(mkt==='us'?600:630)))return p.iso;
  }
  return '';
}
// the price runs: Monday–Friday on the hour's :40 from 10:40 to 23:40 Israel time, plus every 5 minutes while a market
// trades; on Saturday and Sunday four catch-up runs, for closes the source delivered late (the page shows "the next update"
// from the same table)
export const PXRUN={days:[1,2,3,4,5],h0:10,h1:23,min:40,wkend:{days:[0,6],hours:[10,14,18,22]}};
export function inPxWindow(d){const p=ilParts(d);return (PXRUN.days.includes(p.wd)&&p.h>=PXRUN.h0&&p.h<=PXRUN.h1)||(PXRUN.wkend.days.includes(p.wd)&&PXRUN.wkend.hours.includes(p.h))}
export const pxDue=(p,d)=>(PXRUN.days.includes(p.wd)&&p.h>=PXRUN.h0&&p.h<=PXRUN.h1&&p.min===PXRUN.min)||(PXRUN.wkend.days.includes(p.wd)&&PXRUN.wkend.hours.includes(p.h)&&p.min===PXRUN.min)||(p.min%5===0&&anyOpen(d));
// the Israel-time date of a moment, YYYY-MM-DD
export const ilDay=d=>ilParts(d).iso;
// d.m, as the page prints dates in labels
export const dm=iso=>{const [y,m,d]=String(iso).slice(0,10).split('-').map(Number);return `${d}.${m}`};
