// 1.11 TikChik Management Center, stage D: running the company. The support tickets and their conversation (a user
// writes from the site, the management answers here), the product roadmap from an idea to a launch and what happened
// after it, the content the site shows (system and maintenance messages, announcements to all or to a group, guides,
// questions and answers), and the money: the costs entered by hand or computed (the AI), the revenue when there is any.
// Nothing here is made up: a figure with no entry is "not available".
import {audit} from './core.js';
import {aiCost} from './metrics.js';
import {ilParts} from '../../shared/market.js';

const now=()=>new Date().toISOString();
const str=(v,n)=>String(v==null?'':v).trim().slice(0,n);
const pick=(v,L,d)=>L.includes(v)?v:d;

export function bizSchema(store){
  store.db.exec(`
    create table if not exists tickets(id integer primary key autoincrement, uid text not null, type text not null, subject text not null, status text not null default 'new',
      priority text not null default 'normal', topic text, assignee text, screen text, ver text, ua text, created_at text not null, updated_at text not null,
      first_reply_at text, resolved_at text, user_seen_at text, staff_seen_at text, roadmap_id integer);
    create index if not exists tickets_status on tickets(status); create index if not exists tickets_uid on tickets(uid);
    create table if not exists ticket_msgs(id integer primary key autoincrement, ticket_id integer not null, at text not null, uid text, role text not null, body text not null);
    create index if not exists tmsg_t on ticket_msgs(ticket_id);
    create table if not exists roadmap(id integer primary key autoincrement, title text not null, descr text, kind text not null, status text not null, priority text not null default 'normal',
      owner text, due text, launched_at text, metric_key text, success text, created_at text not null, updated_at text not null, created_by text);
    create table if not exists content(id integer primary key autoincrement, kind text not null, title text not null, body text not null, audience text not null default 'all',
      starts_at text, ends_at text, status text not null default 'draft', level text not null default 'info', created_by text, updated_at text not null, published_by text, published_at text, sort integer not null default 0);
    create table if not exists ledger(id integer primary key autoincrement, month text not null, kind text not null, category text not null, vendor text, amount real not null, ccy text not null default 'USD', note text, created_by text, created_at text not null);`);
}

// ================= support =================
export const T_TYPES=['question','bug','idea','request'], T_STATUS=['new','open','waiting','resolved','closed'], T_PRIO=['low','normal','high','urgent'];
// the topic, by the words in the message: a rough class to see what comes back, never a judgment of the person
const TOPICS=[['login','כניסה|סיסמ|קוד אימות|דו.שלבי|התחבר|נעול|חשבון'],['statement','דוח|קובץ|העלא|PDF|אקסל|צילום מסך|קריאה של'],['prices','מחיר|שער|דולר|לא מתעדכן|מעודכן|ציטוט'],
  ['chiko','צ׳יקו|צ\'יקו|שאלתי|תשובה|AI'],['news','חדשות|כתב|התרא|פוש|מייל'],['plan','תוכני|הפקד|יעד|קצב|מטרה'],['portfolio','תיק|החזק|מניה|נייר|קרן|עלות'],['speed','איטי|נתקע|לא נטען|טוען|קורס|נפל']];
export const TOPIC_HE={login:'כניסה וחשבון',statement:'דוחות וקבצים',prices:'מחירים ושער',chiko:'צ׳יקו',news:'חדשות והתראות',plan:'תוכנית ויעדים',portfolio:'התיק',speed:'מהירות ותקיעות',other:'אחר'};
export function topicOf(text){const t=String(text||''); for(const [k,re] of TOPICS)if(new RegExp(re,'i').test(t))return k; return 'other'}
export function ticketCreate(store,user,b,{ua=''}={}){
  const type=pick(b.type,T_TYPES,'question'), subject=str(b.subject,120), body=str(b.body,4000);
  if(subject.length<3||body.length<5)throw new Error('short');
  const recent=store.db.prepare('select count(*) n from tickets where uid=? and created_at>?').get(user.id,new Date(Date.now()-36e5).toISOString()).n; if(recent>=5)throw new Error('rate');
  const iso=now(), r=store.db.prepare('insert into tickets(uid,type,subject,status,priority,topic,screen,ver,ua,created_at,updated_at,user_seen_at) values(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(user.id,type,subject,'new',type==='bug'?'high':'normal',topicOf(subject+' '+body),str(b.screen,40),str(b.ver,20),str(ua,160),iso,iso,iso);
  store.db.prepare('insert into ticket_msgs(ticket_id,at,uid,role,body) values(?,?,?,?,?)').run(r.lastInsertRowid,iso,user.id,'user',body);
  return ticketGet(store,r.lastInsertRowid);
}
export function ticketGet(store,id,{withNotes=true}={}){const t=store.db.prepare('select * from tickets where id=?').get(+id); if(!t)return null;
  const msgs=store.db.prepare('select id,at,uid,role,body from ticket_msgs where ticket_id=? order by id').all(t.id).filter(m=>withNotes||m.role!=='note'); return {...t,msgs}}
// a user's own tickets: what they wrote and the answers; never the management's internal notes or who handles it
export function ticketsOfUser(store,uid){return store.db.prepare('select id,type,subject,status,created_at,updated_at,user_seen_at from tickets where uid=? order by updated_at desc limit 100').all(uid).map(t=>{
  const last=store.db.prepare("select at, role from ticket_msgs where ticket_id=? and role!='note' order by id desc limit 1").get(t.id)||{}; return {...t,unread:last.role==='staff'&&(!t.user_seen_at||last.at>t.user_seen_at)}})}
export function ticketUserView(store,user,id){const t=ticketGet(store,id,{withNotes:false}); if(!t||t.uid!==user.id)return null;
  store.db.prepare('update tickets set user_seen_at=? where id=?').run(now(),t.id);
  return {id:t.id,type:t.type,subject:t.subject,status:t.status,created_at:t.created_at,msgs:t.msgs.map(m=>({at:m.at,role:m.role,body:m.body}))}}
export function ticketUserReply(store,user,id,body){const t=store.db.prepare('select * from tickets where id=?').get(+id); if(!t||t.uid!==user.id)throw new Error('not_found');
  const b=str(body,4000); if(b.length<2)throw new Error('short'); const iso=now();
  store.db.prepare('insert into ticket_msgs(ticket_id,at,uid,role,body) values(?,?,?,?,?)').run(t.id,iso,user.id,'user',b);
  store.db.prepare("update tickets set updated_at=?, user_seen_at=?, status=case when status in ('resolved','closed','waiting') then 'open' else status end where id=?").run(iso,iso,t.id)}
export function ticketStaff(store,user,id,b,ip){const t=store.db.prepare('select * from tickets where id=?').get(+id); if(!t)throw new Error('not_found'); const iso=now(), ch={};
  if(b.reply){const body=str(b.reply,4000); if(body.length<2)throw new Error('short'); const role=b.internal?'note':'staff';
    store.db.prepare('insert into ticket_msgs(ticket_id,at,uid,role,body) values(?,?,?,?,?)').run(t.id,iso,user.id,role,body);
    if(role==='staff'){ch.reply=true; if(!t.first_reply_at)store.db.prepare('update tickets set first_reply_at=? where id=?').run(iso,t.id); if(!b.status&&['new','open'].includes(t.status))b.status='waiting'} else ch.note=true}
  for(const [k,L] of [['status',T_STATUS],['priority',T_PRIO],['type',T_TYPES]])if(b[k]&&L.includes(b[k])&&b[k]!==t[k])ch[k]=[t[k],b[k]];
  if(b.topic&&TOPIC_HE[b.topic]&&b.topic!==t.topic)ch.topic=[t.topic,b.topic];
  if(b.assignee!==undefined&&(b.assignee||null)!==t.assignee){if(b.assignee&&!store.userById(b.assignee))throw new Error('not_found'); ch.assignee=[t.assignee,b.assignee||null]}
  const set={status:ch.status?ch.status[1]:t.status,priority:ch.priority?ch.priority[1]:t.priority,type:ch.type?ch.type[1]:t.type,topic:ch.topic?ch.topic[1]:t.topic,assignee:ch.assignee?ch.assignee[1]:t.assignee};
  const resolved=['resolved','closed'].includes(set.status)?(t.resolved_at||iso):null;
  store.db.prepare('update tickets set status=?, priority=?, type=?, topic=?, assignee=?, resolved_at=?, updated_at=?, staff_seen_at=? where id=?').run(set.status,set.priority,set.type,set.topic,set.assignee,resolved,iso,iso,t.id);
  audit(store,{user,action:'ticket.update',target:'tkt:'+t.id,detail:{subject:t.subject,...Object.fromEntries(Object.entries(ch).map(([k,v])=>[k,Array.isArray(v)?v.join(' → '):v]))},ip});
  return ticketGet(store,t.id);
}
export function ticketsList(store,{from=null}={}){
  const L=store.db.prepare('select t.*, (select count(*) from ticket_msgs m where m.ticket_id=t.id and m.role!=\'note\') n_msgs, (select role from ticket_msgs m where m.ticket_id=t.id and m.role!=\'note\' order by id desc limit 1) last_role from tickets t order by t.updated_at desc limit 500').all();
  const U=Object.fromEntries(store.users().map(u=>[u.id,u])); return L.filter(t=>!from||t.created_at>=from).map(t=>({...t,email:(U[t.uid]||{}).email||'(משתמש שהוסר)',name:(U[t.uid]||{}).name||'',assigneeEmail:t.assignee?(U[t.assignee]||{}).email||null:null,awaitingStaff:t.last_role==='user'&&!['resolved','closed'].includes(t.status)}))}
const hrs=(a,b)=>(Date.parse(b)-Date.parse(a))/36e5, median=L=>{if(!L.length)return null; const s=[...L].sort((a,b)=>a-b), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2};
export function supportStats(store,{from,to}){
  const L=ticketsList(store).filter(t=>t.created_at.slice(0,10)>=from&&t.created_at.slice(0,10)<=to), all=ticketsList(store);
  const open=all.filter(t=>!['resolved','closed'].includes(t.status)), fr=L.filter(t=>t.first_reply_at).map(t=>hrs(t.created_at,t.first_reply_at)), rs=L.filter(t=>t.resolved_at).map(t=>hrs(t.created_at,t.resolved_at));
  const topics={}; for(const t of L){const k=t.topic||'other'; const o=topics[k]||(topics[k]={k,name:TOPIC_HE[k]||k,n:0,people:new Set(),bugs:0}); o.n++; o.people.add(t.uid); if(t.type==='bug')o.bugs++}
  return {range:{from,to},n:L.length,open:open.length,awaiting:all.filter(t=>t.awaitingStaff).length,urgent:open.filter(t=>t.priority==='urgent'||t.priority==='high').length,
    firstReplyH:median(fr),resolveH:median(rs),answered:fr.length,resolved:rs.length,
    byType:Object.fromEntries(T_TYPES.map(k=>[k,L.filter(t=>t.type===k).length])),
    topics:Object.values(topics).map(o=>({k:o.k,name:o.name,n:o.n,people:o.people.size,bugs:o.bugs,recurring:o.people.size>=2})).sort((a,b)=>b.n-a.n)};
}

// ================= the roadmap =================
export const R_KINDS=['feature','bug','task','idea'], R_STATUS=['idea','planned','dev','test','launched','existing'], R_PRIO=['low','normal','high','urgent'];
export function roadmapSave(store,user,b,ip){const iso=now(), id=b.id?+b.id:null, old=id?store.db.prepare('select * from roadmap where id=?').get(id):null; if(id&&!old)throw new Error('not_found');
  const row={title:str(b.title,140),descr:str(b.descr,4000),kind:pick(b.kind,R_KINDS,'feature'),status:pick(b.status,R_STATUS,'idea'),priority:pick(b.priority,R_PRIO,'normal'),
    owner:b.owner&&store.userById(b.owner)?b.owner:null,due:/^\d{4}-\d{2}-\d{2}$/.test(b.due||'')?b.due:null,metric_key:/^(tab|s|go):[A-Za-z0-9_-]{1,40}$|^[a-z:]{2,24}$/.test(b.metric_key||'')?b.metric_key:null,success:str(b.success,400)};
  if(row.title.length<3)throw new Error('short');
  // launched: the day it went out, kept, so the use before and after can be compared
  const launched=row.status==='launched'?(old&&old.launched_at||ilParts(new Date()).iso):(old&&old.status==='launched'?null:old&&old.launched_at||null);
  let rid=id;
  if(old)store.db.prepare('update roadmap set title=?,descr=?,kind=?,status=?,priority=?,owner=?,due=?,metric_key=?,success=?,launched_at=?,updated_at=? where id=?').run(row.title,row.descr,row.kind,row.status,row.priority,row.owner,row.due,row.metric_key,row.success,launched,iso,id);
  else rid=store.db.prepare('insert into roadmap(title,descr,kind,status,priority,owner,due,metric_key,success,launched_at,created_at,updated_at,created_by) values(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.title,row.descr,row.kind,row.status,row.priority,row.owner,row.due,row.metric_key,row.success,launched,iso,iso,user.id).lastInsertRowid;
  const ch=old?Object.fromEntries(['title','status','priority','owner','due','kind'].filter(k=>(old[k]||null)!==(row[k]||null)).map(k=>[k,`${old[k]||'—'} → ${row[k]||'—'}`])):{created:row.title};
  if(b.ticket){const t=store.db.prepare('select id from tickets where id=?').get(+b.ticket); if(t)store.db.prepare('update tickets set roadmap_id=? where id=?').run(rid,t.id)}
  audit(store,{user,action:old?'roadmap.update':'roadmap.add',target:'rm:'+rid,detail:{title:row.title,...ch},ip});
  return store.db.prepare('select * from roadmap where id=?').get(rid)}
export function roadmapList(store){const U=Object.fromEntries(store.users().map(u=>[u.id,u]));
  return store.db.prepare('select r.*, (select count(*) from tickets t where t.roadmap_id=r.id) tickets from roadmap r order by case status when \'dev\' then 0 when \'test\' then 1 when \'planned\' then 2 when \'idea\' then 3 when \'launched\' then 4 else 5 end, case priority when \'urgent\' then 0 when \'high\' then 1 when \'normal\' then 2 else 3 end, updated_at desc').all()
    .map(r=>({...r,ownerEmail:r.owner?(U[r.owner]||{}).email||null:null,late:!!(r.due&&r.due<ilParts(new Date()).iso&&!['launched','existing'].includes(r.status))}))}
export function roadmapDelete(store,user,id,ip){const r=store.db.prepare('select * from roadmap where id=?').get(+id); if(!r)throw new Error('not_found');
  store.db.prepare('update tickets set roadmap_id=null where roadmap_id=?').run(r.id); store.db.prepare('delete from roadmap where id=?').run(r.id);
  audit(store,{user,action:'roadmap.delete',target:'rm:'+r.id,detail:{title:r.title,status:r.status},ip})}
// after a launch: the use of the part it names in the 30 days before and after (from everybody's usage documents, the
// same three-people rule as the product screen), and the tickets linked to it
export function launchImpact(store,r,{users,usageOf,k=3}){
  if(!r.launched_at||!r.metric_key)return null; const day=r.launched_at, add=(d,n)=>ilParts(new Date(Date.parse(d+'T12:00:00Z')+n*864e5)).iso;
  const bFrom=add(day,-30), aTo=add(day,29); let before=0, after=0; const pb=new Set(), pa=new Set();
  for(const u of users){const days=usageOf(u)||{}; for(const [d,D] of Object.entries(days)){const n=+((D||{})[r.metric_key]||0); if(!n)continue; if(d>=bFrom&&d<day){before+=n; pb.add(u.id)} else if(d>=day&&d<=aTo){after+=n; pa.add(u.id)}}}
  const people=new Set([...pb,...pa]).size; if(people<k)return {hidden:true,people,k};
  return {before,after,peopleBefore:pb.size,peopleAfter:pa.size,days:Math.min(30,Math.round((Date.now()-Date.parse(day))/864e5)+1)}}

// ================= content =================
export const C_KINDS=['banner','maintenance','announcement','guide','faq'], C_AUD=['all','friend','admin','new','with_pf','no_pf'], C_LEVEL=['info','warn','critical'];
export function contentSave(store,user,b,ip){const iso=now(), id=b.id?+b.id:null, old=id?store.db.prepare('select * from content where id=?').get(id):null; if(id&&!old)throw new Error('not_found');
  const row={kind:pick(b.kind,C_KINDS,'announcement'),title:str(b.title,140),body:str(b.body,8000),audience:pick(b.audience,C_AUD,'all'),level:pick(b.level,C_LEVEL,'info'),
    starts_at:/^\d{4}-\d{2}-\d{2}(T[\d:]{5})?$/.test(b.starts_at||'')?b.starts_at:null,ends_at:/^\d{4}-\d{2}-\d{2}(T[\d:]{5})?$/.test(b.ends_at||'')?b.ends_at:null,sort:Math.max(-999,Math.min(999,+b.sort||0))};
  if(row.title.length<2||(row.kind!=='banner'&&row.kind!=='maintenance'&&row.body.length<2))throw new Error('short');
  let cid=id;
  if(old)store.db.prepare('update content set kind=?,title=?,body=?,audience=?,level=?,starts_at=?,ends_at=?,sort=?,updated_at=? where id=?').run(row.kind,row.title,row.body,row.audience,row.level,row.starts_at,row.ends_at,row.sort,iso,id);
  else cid=store.db.prepare('insert into content(kind,title,body,audience,level,starts_at,ends_at,sort,status,created_by,updated_at) values(?,?,?,?,?,?,?,?,?,?,?)').run(row.kind,row.title,row.body,row.audience,row.level,row.starts_at,row.ends_at,row.sort,'draft',user.id,iso).lastInsertRowid;
  audit(store,{user,action:old?'content.update':'content.add',target:'cnt:'+cid,detail:{kind:row.kind,title:row.title,audience:row.audience},ip});
  return store.db.prepare('select * from content where id=?').get(cid)}
export function contentStatus(store,user,id,status,ip){const c=store.db.prepare('select * from content where id=?').get(+id); if(!c)throw new Error('not_found');
  const s=pick(status,['draft','published','archived'],null); if(!s)throw new Error('bad_status'); const iso=now();
  store.db.prepare('update content set status=?, published_by=case when ?=\'published\' then ? else published_by end, published_at=case when ?=\'published\' then ? else published_at end, updated_at=? where id=?').run(s,s,user.id,s,iso,iso,c.id);
  audit(store,{user,action:'content.'+(s==='published'?'publish':s==='archived'?'archive':'draft'),target:'cnt:'+c.id,detail:{kind:c.kind,title:c.title,audience:c.audience},ip});
  return store.db.prepare('select * from content where id=?').get(c.id)}
export function contentList(store){const U=Object.fromEntries(store.users().map(u=>[u.id,u]));
  return store.db.prepare('select * from content order by status=\'archived\', sort, updated_at desc').all().map(c=>({...c,byEmail:c.published_by?(U[c.published_by]||{}).email||null:null}))}
// what one person sees now: published, in its time window, for their group
export function contentFor(store,user,{hasPf,newUser,at=new Date()}={}){const iso=at.toISOString();
  const fits=c=>c.audience==='all'||(user&&((c.audience==='friend'&&user.role==='friend')||(c.audience==='admin'&&(user.role==='admin'||user.role==='owner'))||(c.audience==='new'&&newUser)||(c.audience==='with_pf'&&hasPf)||(c.audience==='no_pf'&&!hasPf)));
  const inTime=c=>(!c.starts_at||c.starts_at<=iso.slice(0,c.starts_at.length))&&(!c.ends_at||c.ends_at>=iso.slice(0,c.ends_at.length));
  return store.db.prepare("select id,kind,title,body,level,audience,starts_at,ends_at,published_at,sort from content where status='published' order by sort, published_at desc").all().filter(c=>fits(c)&&inTime(c))}

// ================= money =================
export const L_KINDS=['cost','revenue'], L_CATS={cost:['servers','ai','api','domain','mail','tools','other'],revenue:['subscription','one_time','other']};
export const CAT_HE={servers:'שרתים (Railway)',ai:'AI (חיוב ידני)',api:'ספקי נתונים / API',domain:'דומיין',mail:'שליחת מיילים',tools:'כלים ותוכנות',other:'אחר',subscription:'מנויים',one_time:'תשלום חד-פעמי'};
export function ledgerAdd(store,user,b,ip){const kind=pick(b.kind,L_KINDS,null); if(!kind)throw new Error('bad_kind');
  const month=/^\d{4}-\d{2}$/.test(b.month||'')?b.month:null, amount=+b.amount; if(!month||!(amount>=0&&amount<1e7))throw new Error('bad_amount');
  const row={month,kind,category:pick(b.category,L_CATS[kind],'other'),vendor:str(b.vendor,60),amount:Math.round(amount*100)/100,ccy:pick(b.ccy,['USD','ILS'],'USD'),note:str(b.note,200)};
  const id=store.db.prepare('insert into ledger(month,kind,category,vendor,amount,ccy,note,created_by,created_at) values(?,?,?,?,?,?,?,?,?)').run(row.month,row.kind,row.category,row.vendor,row.amount,row.ccy,row.note,user.id,now()).lastInsertRowid;
  audit(store,{user,action:'ledger.add',target:'led:'+id,detail:row,ip}); return {id,...row}}
export function ledgerDelete(store,user,id,ip){const r=store.db.prepare('select * from ledger where id=?').get(+id); if(!r)throw new Error('not_found'); store.db.prepare('delete from ledger where id=?').run(r.id);
  audit(store,{user,action:'ledger.delete',target:'led:'+r.id,detail:{month:r.month,kind:r.kind,category:r.category,amount:r.amount,ccy:r.ccy},ip})}
// the months: what was entered, the AI computed from its tokens (when its prices are set and no AI bill was entered for
// that month, so it is never counted twice), the active users of the month, the cost per user; a forecast only from at
// least three months with costs, and said as a straight line, not a promise
export function business(store,{months=12,fx=null}={}){
  const toUsd=(a,c)=>c==='USD'?a:fx>0?a/fx:null, L=store.db.prepare('select * from ledger order by month desc, id desc').all();
  const cur=ilParts(new Date()).iso.slice(0,7), M=[]; for(let i=months-1;i>=0;i--){const d=new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth()-i); M.push(d.toISOString().slice(0,7))}
  const rows=M.map(m=>{const E=L.filter(r=>r.month===m), cost=E.filter(r=>r.kind==='cost'), rev=E.filter(r=>r.kind==='revenue');
    const sum=A=>{let s=0, miss=false; for(const r of A){const v=toUsd(r.amount,r.ccy); if(v==null)miss=true; else s+=v} return {s:Math.round(s*100)/100,miss}};
    const c=sum(cost), r=sum(rev), aiBill=cost.some(x=>x.category==='ai');
    const last=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate(), ai=aiBill?null:aiCost(store,m+'-01',m+'-'+String(last).padStart(2,'0'));
    const aiUsd=ai&&ai.total!=null?Math.round(ai.total*100)/100:null, aiUsed=ai&&ai.by.some(x=>x.calls>0);
    const active=store.db.prepare('select count(distinct uid) n from active_days where day like ?').get(m+'%').n;
    const total=c.s+(aiUsd||0), known=cost.length>0||aiUsd!=null;
    return {month:m,entered:c.s,ai:aiUsd,aiMissing:!aiBill&&aiUsed&&aiUsd==null,cost:known?Math.round(total*100)/100:null,revenue:rev.length?r.s:null,fxMissing:c.miss||r.miss,
      active,perUser:known&&active?Math.round(100*total/active)/100:null,byCat:Object.fromEntries(L_CATS.cost.map(k=>[k,Math.round(cost.filter(x=>x.category===k).reduce((a,x)=>a+(toUsd(x.amount,x.ccy)||0),0)*100)/100]))}});
  const withCost=rows.filter(r=>r.cost!=null&&r.month<cur).slice(-6);
  let forecast=null; if(withCost.length>=3){const n=withCost.length, xs=withCost.map((_,i)=>i), ys=withCost.map(r=>r.cost), mx=xs.reduce((a,b)=>a+b)/n, my=ys.reduce((a,b)=>a+b)/n;
    const b=xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0)/Math.max(1e-9,xs.reduce((a,x)=>a+(x-mx)**2,0)), a=my-b*mx; forecast={next:Math.max(0,Math.round((a+b*n)*100)/100),slope:Math.round(b*100)/100,from:n}}
  const featCost=(()=>{const P=JSON.parse(store.getMeta('aiPrices')||'{}'), by={}; const from=M[M.length-3]+'-01';
    for(const k of ['ai_in','ai_out'])for(const r of store.db.prepare('select key, sum(n) n from counters where kind=? and day>=? group by key').all(k,from)){const [f,m]=r.key.split('|'), p=P[m]; const o=by[f]||(by[f]={feature:f,cost:0,missing:false}); if(!p){o.missing=true;continue} o.cost+=r.n*(k==='ai_in'?p.in:p.out)/1e6}
    return Object.values(by).map(o=>({...o,cost:o.missing?null:Math.round(o.cost*100)/100}))})();
  return {months:rows,ledger:L.slice(0,200),forecast,featCost,hasRevenue:L.some(r=>r.kind==='revenue'),fx,cur,
    notes:['עלות ה-AI מחושבת מהטוקנים ומהמחירים שהוזנו, אלא אם הוזן לחודש חשבון AI ידני (אז רק הוא נספר).','עלות שרתים וספקים: רק מה שהוזן ידנית. אין חיבור לחיוב של Railway או של הספקים.','עלות לפיצ׳ר: רק ל-AI (שאר העלויות לא מתחלקות לפי פיצ׳ר).','רווחיות לפי סוג חשבון: לא זמינה. אין מנויים ואין הכנסות לפי סוג חשבון.']}
}
