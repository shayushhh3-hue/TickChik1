#!/usr/bin/env node
// Opens the encrypted full backup that the daily mail carries (server/backup.js, with BACKUP_KEY):
//   BACKUP_KEY='the passphrase' node tools/restore.js tikchik-full-2026-10-30.sqlite.gz.enc tikchik.sqlite
// The result is the site's database file as it was that night. To put it back: stop the site, and replace the file
// tikchik.sqlite in the data folder (DATA_DIR, /data on Railway) with it. Without the passphrase nothing opens it.
import fs from 'node:fs';
import {openBackup, verifyCopy} from '../server/backup.js';
const [inp,out]=process.argv.slice(2), pass=process.env.BACKUP_KEY||'';
if(!inp||!out||!pass){console.error('usage: BACKUP_KEY=... node tools/restore.js <file.sqlite.gz.enc> <out.sqlite>'); process.exit(2)}
if(fs.existsSync(out)){console.error(out+' exists: choose another name'); process.exit(2)}
try{fs.writeFileSync(out,openBackup(fs.readFileSync(inp),pass))}catch(e){console.error(e.message); process.exit(1)}
const v=verifyCopy(out); if(!v){console.error('opened, but the result is not a readable database'); process.exit(1)}
console.log(`ok: ${out}, ${v.docs} documents, ${v.users} users`);
