// Trading hours, in the same terms the page uses: Tel Aviv trades Monday–Friday (Friday until 14:00) since January
// 2026; New York 9:30–16:00 Monday–Friday. Holidays are not known here (the page does not know them either).
const parts=(d,tz)=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(d);
  const g=k=>(p.find(x=>x.type===k)||{}).value; const wd={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[g('weekday')];
  return {wd,y:+g('year'),m:+g('month'),d:+g('day'),h:+g('hour')%24,min:+g('minute'),iso:`${g('year')}-${g('month')}-${g('day')}`}};
export const ilParts=d=>parts(d||new Date(),'Asia/Jerusalem');
export const nyParts=d=>parts(d||new Date(),'America/New_York');
export function ilOpen(d){const p=ilParts(d),t=p.h*60+p.min;if(p.wd===0||p.wd===6)return false;return t>=600&&t<(p.wd===5?14*60+15:17*60+30)}
export function usOpen(d){const p=nyParts(d),t=p.h*60+p.min;return p.wd>=1&&p.wd<=5&&t>=570&&t<960}
export const anyOpen=d=>ilOpen(d)||usOpen(d);
// the hourly price run: Monday–Friday, 10:40–23:40 Israel time (the page shows "the next update" from the same table)
export const PXRUN={days:[1,2,3,4,5],h0:10,h1:23,min:40};
export function inPxWindow(d){const p=ilParts(d);return PXRUN.days.includes(p.wd)&&p.h>=PXRUN.h0&&p.h<=PXRUN.h1}
// the Israel-time date of a moment, YYYY-MM-DD
export const ilDay=d=>ilParts(d).iso;
// d.m, as the page prints dates in labels
export const dm=iso=>{const [y,m,d]=String(iso).slice(0,10).split('-').map(Number);return `${d}.${m}`};
