// תיק צ׳יק – the service worker: only for the notifications to the phone (30.10). It keeps nothing and answers no request,
// so the site is always loaded fresh from the server.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let d={}; try{d=e.data?e.data.json():{}}catch(x){d={body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'תיק צ׳יק',{body:d.body||'',icon:'icon.svg',badge:'icon.svg',dir:'rtl',lang:'he',tag:d.tag||'tc',renotify:true,data:{url:d.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(L=>{
    for(const c of L){if(c.url.startsWith(self.registration.scope)&&'focus' in c){return c.focus().then(w=>w&&'navigate' in w?w.navigate(url):w)}}
    return self.clients.openWindow(url);
  }));
});
