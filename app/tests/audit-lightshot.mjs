// Local Lightshot integration: real shortcut/tray input and clipboard PNGs. Never uploads.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connect,wait} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/lightshot');
await fs.mkdir(output,{recursive:true});
const page=await connect(),results=[];
const run=(script,args)=>JSON.parse(execFileSync('powershell.exe',['-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,script),...args.map(String)],{windowsHide:true,encoding:'utf8',timeout:15000}).trim());
try{
 await page.host('quickDone');await page.host('show');await page.host('pin',{pinned:true});
 for(const trigger of process.argv[3]==='OtherTray'?[]:process.argv[3]?[process.argv[3]]:['Insert','Tray']){
  assert(['Insert','Tray','WinShiftS','PrintScreen'].includes(trigger),'Choose a supported screenshot trigger');
  await page.host('finishScreenshot');await wait(300);
  await page.click('.widget-head h1');
  const before=await page.host('diagnostics'),keysBefore=await page.host('screenshotKeys');
  assert(before.healthy&&before.windowVisible&&!before.captureFrozen);
  const opened=trigger==='Tray'?run('lightshot-tray.ps1',['-Window',before.window,'-Action','Trigger']):run('screenshot-shortcut.ps1',['-Window',before.window,'-Shortcut',trigger]);
  assert.equal(opened.foregroundProcess,['Insert','Tray'].includes(trigger)?'Lightshot':'SnippingTool','Expected the actual screenshot overlay');
  const held=await page.host('diagnostics'),keysAfter=await page.host('screenshotKeys');
  // Keep failed evidence too; an overlay can be present while it omits the widget.
  const result={trigger,before,keysBefore,opened,held,keysAfter};results.push(result);
  try{
   assert(keysAfter.prepared>keysBefore.prepared,'No screenshot preparation before Lightshot');
   assert.equal(keysAfter.timeouts,keysBefore.timeouts);assert(held.captureFrozen&&held.displayAffinity===0&&held.healthy);
   const filename=path.join(output,`${trigger.toLowerCase()}-clipboard.png`);
   result.clipboard=run('screenshot-shortcut.ps1',['-Window',before.window,'-Action','SelectCapture','-OverlayWindow',opened.foreground,'-X',before.x+2,'-Y',before.y+2,'-Width',before.width-4,'-Height',before.height-4,'-OutputPath',filename]);
   assert(result.clipboard.clipboardChanged);
   await wait(16000);
   result.after=await page.host('diagnostics');
   assert(!result.after.captureFrozen&&result.after.displayAffinity===17&&result.after.healthy);
   assert.equal(result.after.errors,before.errors);
   result.pass=true;console.log(JSON.stringify({trigger,pass:true,prepared:keysAfter.prepared-keysBefore.prepared,waitMs:keysAfter.lastWaitMs,png:filename}));
  }catch(error){result.error=error.message;try{run('screenshot-shortcut.ps1',['-Window',before.window,'-Action','Escape','-OverlayWindow',opened.foreground]);}catch{}throw error;}
 }
 if(!process.argv[3]||process.argv[3]==='OtherTray'){
  const before=await page.host('screenshotKeys'),window=await page.host('diagnostics');
  const opened=run('lightshot-tray.ps1',['-Window',window.window,'-Action','OtherTray']);
  const after=await page.host('screenshotKeys'),state=await page.host('diagnostics');
  results.push({trigger:'OtherTray',before,after,state,opened});
  assert.equal(after.prepared,before.prepared,'An unrelated tray button must not pause glass');
  assert(after.skipped>before.skipped);assert.equal(after.timeouts,before.timeouts);
  assert(!state.captureFrozen&&state.displayAffinity===17);
  run('lightshot-tray.ps1',['-Window',window.window,'-Action','OtherTray']);
  console.log('PASS: other tray button leaves live glass unchanged');
 }
}finally{await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));page.close();}
