// 24.11: every security page with a logo and a chart: the company's logo the sheets lack (server/logos.js) and the
// chart's third source for a US share (Nasdaq's history). No test reaches the internet.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {logoTicker, logoStore} from '../server/logos.js';
import {nasdaqHistParse} from '../shared/quotes.js';

test('24.11 logos: the source\'s ticker for each kind of key, and none for a fund by number or an index',()=>{
  assert.equal(logoTicker('AAPL'),'AAPL'); assert.equal(logoTicker('BRK.B'),'BRK-B'); assert.equal(logoTicker('TLV:LUMI'),'LUMI.TA');
  assert.equal(logoTicker('TLV:TCH-F1'),'TCH-F1.TA'); assert.equal(logoTicker('0700.HK'),'0700.HK');
  for(const k of ['5129283','TLV:5129283','IDX:SPX','','../x','A/B'])assert.equal(logoTicker(k),null,k);
});

test('24.11 logos: fetched once and kept on the disk; a symbol the source lacks is not asked again for a week; a network failure is',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lg-')); const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(300,7)]);
  let asked=[], down=false, t=1e12;
  const f=async u=>{asked.push(u); if(down)throw new Error('offline'); if(/NOPE/.test(u))return new Response('not found',{status:404}); if(/HTML/.test(u))return new Response('<html>'+'x'.repeat(200)+'</html>',{status:200}); return new Response(png,{status:200})};
  const L=logoStore(dir,{fetch:f,now:()=>t});
  assert.deepEqual(await L.get('TLV:LUMI'),png); assert.match(asked[0],/image-stock\/LUMI\.TA\.png$/);
  assert.deepEqual(await L.get('TLV:LUMI'),png); assert.equal(asked.length,1,'from the disk the second time');
  assert.deepEqual(await logoStore(dir,{fetch:f}).get('TLV:LUMI'),png,'after a restart too'); assert.equal(asked.length,1);
  assert.equal(await L.get('NOPE'),null); assert.equal(await L.get('NOPE'),null); assert.equal(asked.length,2,'a 404 is remembered');
  assert.equal(await L.get('HTML'),null,'not an image: not served'); assert.equal(fs.existsSync(path.join(dir,'HTML.png')),false);
  t+=8*864e5; assert.equal(await L.get('NOPE'),null); assert.equal(asked.length,4,'asked again after a week');
  down=true; assert.equal(await L.get('MSFT'),null); down=false; assert.deepEqual(await L.get('MSFT'),png,'an offline moment is not remembered');
  assert.equal(await L.get('5129283'),null); assert.equal(asked.length,6,'a fund by number never asks the source');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('24.11 chart: Nasdaq\'s history read oldest first, dollars and commas stripped, a bad row skipped',()=>{
  const h=nasdaqHistParse({data:{tradesTable:{rows:[{date:'11/23/2026',close:'$4.03',volume:'44,714,940'},{date:'11/20/2026',close:'1,204.5',volume:'N/A'},{date:'bad',close:'$1'},{date:'11/19/2026',close:'--'}]}}});
  assert.deepEqual(h,{d:['2026-11-20','2026-11-23'],c:[1204.5,4.03],v:[null,44714940]});
  assert.deepEqual(nasdaqHistParse({data:null}),{d:[],c:[]});
});

test('24.11 logos: a photo where a logo belongs is not served (an opaque picture that compresses poorly); a logo is',async()=>{
  const {looksLikePhoto}=await import('../server/logos.js');
  const png=(w,h,ct,n)=>{const b=Buffer.alloc(n); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52]).copy(b); b.writeUInt32BE(w,16); b.writeUInt32BE(h,20); b[24]=8; b[25]=ct; return b};
  assert.equal(looksLikePhoto(png(128,96,2,26335)),true,'the head office of a bank');
  assert.equal(looksLikePhoto(png(128,128,2,5659)),false,'a logo on white'); assert.equal(looksLikePhoto(png(128,21,2,5627)),false,'a thin wordmark');
  assert.equal(looksLikePhoto(png(250,250,6,40000)),false,'with transparency: a logo');
});
