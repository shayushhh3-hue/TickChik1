// A local server for testing the site: serves site/, injects the fake Firebase with seed documents and a signed-in
// user into index.html, and answers /api/ask and /api/prices with stubs. No network, no real Firebase.
const http=require('http'), fs=require('fs'), path=require('path');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css'};
const FAKE=fs.readFileSync(path.join(__dirname,'fakefb.js'),'utf8');

function startServer(opts){
  const dir=opts.dir||path.join(__dirname,'..','site');
  const state={asks:[],prices:[],opts};
  const srv=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://x');
    if(u.pathname.startsWith('/api/')){
      let body='';for await(const ch of req)body+=ch;
      const auth=req.headers['authorization']||'';
      const name=u.pathname.slice(5);
      const deny=opts.apiDeny&&opts.apiDeny(name,auth);
      if(deny){res.writeHead(deny.status||401,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:deny.code||'not_granted',message:'denied'}}));return}
      if(name==='ask'){const j=JSON.parse(body);state.asks.push({auth,body:j});
        const text=await opts.answer(j);
        if(opts.askDelay)await new Promise(r=>setTimeout(r,opts.askDelay));
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'msg_1',type:'message',role:'assistant',model:j.model,content:[{type:'text',text}],stop_reason:'end_turn'}));return}
      if(name==='prices'){state.prices.push({auth,body:body?JSON.parse(body):null});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,n:3,updatedAt:new Date().toISOString()}));return}
      res.writeHead(404);res.end('no');return;
    }
    let p=u.pathname==='/'?'/index.html':u.pathname; const f=path.join(dir,p);
    if(!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);res.end('not found');return}
    let data=fs.readFileSync(f);
    if(p==='/index.html'){
      const cfg=opts.config||{firebase:{apiKey:'x',authDomain:'x.firebaseapp.com',projectId:'test-proj',appId:'1:1:web:1'},ownerEmail:'owner@example.com',api:'/api'};
      const inj=`<script>window.TC_CONFIG=${JSON.stringify(cfg)};window.__D=${JSON.stringify(opts.seeds||{})};window.__FAKEUSER=${JSON.stringify(opts.user===undefined?null:opts.user)};window.__FAKEPOPUP=${JSON.stringify(opts.popup||null)};try{${Object.entries(opts.ls||{}).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}${opts.pre||''}</script><script>${FAKE}</script>`;
      data=Buffer.from(data.toString('utf8').replace('<script src="config.js"></script>',inj));
    }
    res.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
  });
  return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r({srv,port:srv.address().port,url:'http://127.0.0.1:'+srv.address().port+'/index.html',state,close:()=>new Promise(x=>srv.close(x))})));
}
module.exports={startServer};
