#!/usr/bin/env python3
"""Build site/index.html from the page (live.html).

The page is kept as it is. The build wraps it in a full HTML document, adds config.js and a small bootstrap that
gives the page `window.claude.use` (served by runtime.js over Firebase), and copies the shared encoder next to it.
usage: python3 tools/build.py [path/to/live.html]
"""
import sys, os, re, shutil, hashlib
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC=sys.argv[1] if len(sys.argv)>1 else os.path.join(ROOT,'page','live.html')
h=open(SRC,encoding='utf-8').read()
ver=re.search(r'גרסה (\d+)',h)
# a stale sentence from the artifact world
h=h.replace("נתוני התיק שמורים בחשבון שלך. פתח את הדף כשאתה מחובר ל-Claude כדי לראות אותם.","נתוני התיק שמורים בחשבון שלך. היכנס כדי לראות אותם.")
boot='''<script src="config.js"></script>
<script>
// The page asks for window.claude.use(name). Here that is served by runtime.js over Firebase and this site's functions.
(function(){
  if(window.claude&&window.claude.use)return; // a test harness put its own runtime in place
  var p=null; function rt(){return p||(p=import('./runtime.js').then(function(m){return m.boot(window.TC_CONFIG||{})}))}
  window.claude={use:function(n){return rt().then(function(r){return r.use(n)})}};
})();
</script>
'''
# the published page is a whole document: keep its reset style, take the body
m=re.search(r'<head>(.*?)</head>\s*<body>',h,re.S)
reset=re.search(r'<style>(.*?)</style>',m.group(1),re.S).group(1) if m else ''
body=h[m.end():] if m else h
end=body.rfind('</body></html>')
if end>=0: body=body[:end]
t=re.search(r'<title>(.*?)</title>\s*',body,re.S)
title=t.group(1) if t else 'תיק צ׳יק'
if t: body=body[:t.start()]+body[t.end():]
out='<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="robots" content="noindex">\n<meta name="theme-color" content="#1e344e">\n<title>'+title+'</title>\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n<link rel="manifest" href="manifest.webmanifest">\n<style>'+reset+'</style>\n'+boot+'</head>\n<body>\n'+body.strip()+'\n</body>\n</html>\n'
os.makedirs(os.path.join(ROOT,'site'),exist_ok=True)
open(os.path.join(ROOT,'site','index.html'),'w',encoding='utf-8').write(out)
shutil.copy(os.path.join(ROOT,'shared','docenc.js'),os.path.join(ROOT,'site','docenc.js'))
print('site/index.html written:',len(out),'bytes, page version',ver.group(1) if ver else '?')
