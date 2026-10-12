// A fake of the Firebase modular SDK, just the part runtime.js uses. Runs in the browser as a classic script.
// Seeds: window.__D = {path: decodedDoc}; the signed-in user: window.__FAKEUSER = {uid,email,displayName} or null;
// window.__FAKEPOPUP = the user a Google popup signs in. Inspect: window.__FBFAKE.docs (encoded), .writes [[path,data]].
(function(){
  const JKEY='_j';
  function encodeDoc(obj){const out={},rest={};let any=false;for(const [k,v] of Object.entries(obj||{})){if(v===undefined||k===JKEY)continue;if(v===null||typeof v!=='object'){out[k]=typeof v==='number'&&!Number.isFinite(v)?null:v}else{rest[k]=v;any=true}}if(any)out[JKEY]=JSON.stringify(rest);return out}
  const docs=new Map(), docL=new Map(), colL=new Map(), writes=[];
  for(const [p,d] of Object.entries(window.__D||{}))if(d)docs.set(p,encodeDoc(d));
  const parent=p=>p.slice(0,p.lastIndexOf('/')), idOf=p=>p.slice(p.lastIndexOf('/')+1);
  const snap=(p)=>{const d=docs.get(p);return {id:idOf(p),exists:()=>!!d,data:()=>d?JSON.parse(JSON.stringify(d)):undefined,metadata:{hasPendingWrites:false,fromCache:false}}};
  const fire=p=>{for(const cb of (docL.get(p)||[]))setTimeout(()=>cb(snap(p)),0);const c=parent(p);for(const q of (colL.get(c)||[]))setTimeout(()=>q.cb(runQuery(q.ref)),0)};
  function runQuery(ref){let rows=[...docs.keys()].filter(p=>parent(p)===ref.path).map(p=>snap(p));
    for(const c of ref.cons||[]){if(c.t==='where'){rows=rows.filter(s=>{const v=(s.data()||{})[c.f];return c.op==='=='?v===c.v:c.op==='!='?v!==c.v:c.op==='>'?v>c.v:c.op==='>='?v>=c.v:c.op==='<'?v<c.v:c.op==='<='?v<=c.v:true})}
      if(c.t==='orderBy'){rows.sort((a,b)=>{const x=(a.data()||{})[c.f],y=(b.data()||{})[c.f];return (x>y?1:x<y?-1:0)*(c.d==='desc'?-1:1)})}
      if(c.t==='limit')rows=rows.slice(0,c.n)}
    return {docs:rows,size:rows.length,empty:!rows.length}}
  let user=window.__FAKEUSER||null; try{if(sessionStorage.getItem('__fakeout'))user=null}catch(e){} const authL=[];
  const tok=u=>'fake.'+btoa(JSON.stringify({sub:u.uid,email:u.email}))+'.sig';
  const mkUser=u=>u?{...u,getIdToken:async()=>tok(u)}:null;
  const err=code=>{const e=new Error(code);e.code=code;return e};
  const FB={
    initializeApp:cfg=>({cfg}), getAuth:()=>({}), GoogleAuthProvider:function(){this.setCustomParameters=()=>{}},
    setPersistence:async()=>{}, browserLocalPersistence:{}, getRedirectResult:async()=>null,
    onAuthStateChanged:(a,cb)=>{authL.push(cb);setTimeout(()=>cb(mkUser(user)),0);return()=>{}},
    signInWithPopup:async()=>{if(window.__FAKEPOPUP==='blocked')throw err('auth/popup-blocked');if(!window.__FAKEPOPUP)throw err('auth/popup-closed-by-user');user=window.__FAKEPOPUP;try{sessionStorage.removeItem('__fakeout')}catch(e){}for(const cb of authL)setTimeout(()=>cb(mkUser(user)),0);return {user:mkUser(user)}},
    signInWithRedirect:async()=>{window.__REDIRECTED=true},
    signOut:async()=>{user=null;try{sessionStorage.setItem('__fakeout','1')}catch(e){}for(const cb of authL)setTimeout(()=>cb(null),0)},
    initializeFirestore:()=>({}), getFirestore:()=>({}),
    doc:(a,b)=>{const base=a&&a.path!=null&&a.kind==='col'?a.path:(a&&a.kind==='doc'?a.path:null);const p=base!=null?(base+'/'+(b||('auto'+Math.random().toString(36).slice(2,8)))):b;return {kind:'doc',path:p,id:idOf(p)}},
    collection:(a,b)=>{const base=a&&a.kind==='doc'?a.path+'/':'';return {kind:'col',path:base+b,id:idOf(base+b),cons:[]}},
    query:(ref,...cons)=>({...ref,cons:[...(ref.cons||[]),...cons]}),
    where:(f,op,v)=>({t:'where',f,op,v}), orderBy:(f,d)=>({t:'orderBy',f,d:d||'asc'}), limit:n=>({t:'limit',n}),
    getDoc:async ref=>{if(window.__FBDENY&&window.__FBDENY(ref.path,'read'))throw err('permission-denied');return snap(ref.path)},
    getDocs:async ref=>runQuery(ref),
    setDoc:async(ref,d)=>{if(window.__FBDENY&&window.__FBDENY(ref.path,'write'))throw err('permission-denied');docs.set(ref.path,JSON.parse(JSON.stringify(d)));writes.push([ref.path,d]);fire(ref.path)},
    deleteDoc:async ref=>{docs.delete(ref.path);writes.push([ref.path,null]);fire(ref.path)},
    onSnapshot:(ref,cb,onErr)=>{if(ref.kind==='doc'){if(window.__FBDENY&&window.__FBDENY(ref.path,'read')){setTimeout(()=>onErr&&onErr(err('permission-denied')),0);return()=>{}}
        const L=docL.get(ref.path)||[];L.push(cb);docL.set(ref.path,L);setTimeout(()=>cb(snap(ref.path)),0);return()=>{const i=L.indexOf(cb);if(i>=0)L.splice(i,1)}}
      const L=colL.get(ref.path)||[];const q={ref,cb};L.push(q);colL.set(ref.path,L);setTimeout(()=>cb(runQuery(ref)),0);return()=>{const i=L.indexOf(q);if(i>=0)L.splice(i,1)}}
  };
  window.__FB=FB;
  window.__FBFAKE={docs,writes,set:(p,d)=>{docs.set(p,encodeDoc(d));fire(p)},get:p=>{const d=docs.get(p);if(!d)return null;const o={};for(const [k,v] of Object.entries(d))if(k!==JKEY)o[k]=v;if(d[JKEY])Object.assign(o,JSON.parse(d[JKEY]));return o},signOut:FB.signOut};
})();
