// Hourly prices (GitHub Actions, Monday–Friday 10:40–23:40 Israel time). Outside the window it does nothing,
// unless FORCE=1. Writes quotes/latest as the bot user.
import {bot, log, opt} from './lib/env.js';
import {inPxWindow, ilParts} from '../shared/market.js';
import {refreshQuotes} from '../shared/pxjob.js';

const now=new Date(), p=ilParts(now);
if(!inPxWindow(now)&&!opt('FORCE')){log(`outside the price window (Israel ${p.iso} ${p.h}:${String(p.min).padStart(2,'0')}, weekday ${p.wd}); nothing to do`);process.exit(0)}
const fs=await bot();
const r=await refreshQuotes(fs,{now,log,reason:opt('REASON','שעתי')});
log(JSON.stringify(r));
if(r.fetched===0&&r.symbols>0){console.error('no quotes could be fetched');process.exit(1)}
