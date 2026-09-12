// Triggers one real Windows screenshot shortcut. Complete/cancel its overlay before
// running another invocation. A successful hook check alone does not verify PNG pixels.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {connect,wait} from './audit-harness.mjs';
const shortcut=process.argv[2]||'WinShiftS';
if(!['WinShiftS','PrintScreen'].includes(shortcut))throw Error('Choose WinShiftS or PrintScreen');
const page=await connect();
try{
 const before=await page.host('diagnostics'),keysBefore=await page.host('screenshotKeys');
 assert(before.windowVisible&&before.healthy,'Show an unobscured, healthy harness widget first');assert(keysBefore.installed,'Screenshot hook is not installed');
 const windows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'screenshot-shortcut.ps1'),'-Window',String(before.window),'-Shortcut',shortcut],{encoding:'utf8',windowsHide:true,timeout:10000}).trim());
 const held=await page.host('diagnostics'),keysAfter=await page.host('screenshotKeys');
 assert.equal(keysAfter.requested,keysBefore.requested+1);assert.equal(keysAfter.prepared,keysBefore.prepared+1);
 assert.equal(keysAfter.timeouts,keysBefore.timeouts);assert.equal(keysAfter.postFailures,keysBefore.postFailures);
 assert(held.captureFrozen&&held.displayAffinity===0&&held.healthy);assert.equal(held.recoveries,before.recoveries);assert.equal(held.errors,before.errors);
 console.log(JSON.stringify({shortcut,keysBefore,keysAfter,held,windows,notice:'Inspect the actual Windows snip: the widget and its glass must be present.'}));
 await wait(16000);const after=await page.host('diagnostics');
 assert(!after.captureFrozen&&after.displayAffinity===17&&after.healthy);assert.equal(after.errors,before.errors);
 console.log('PASS: ordinary shortcut detected and forwarded; material held, capture exclusion restored');
}finally{page.close();}
