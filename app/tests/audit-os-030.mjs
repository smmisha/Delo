// Real WebView2 + native host + disk. The picker is deliberately doubled and the
// import chooser bypassed by CDP: neither is evidence of a visible system dialog.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connect,wait} from './audit-harness.mjs';
import {fixtures,futureTag,releaseUrl,report} from './os-030-support.mjs';
import {exportData,DEVICE_SETTINGS} from '../core/transfer.mjs';
const [mode,profileArg,pidArg]=process.argv.slice(2);
if(!profileArg||!['--prepare','--run','--exit','--snapshot'].includes(mode))throw Error('Usage: audit-os-030.mjs --prepare|--run|--exit|--snapshot PROFILE [PID]');
const profile=path.resolve(profileArg),data=path.join(profile,'tasks.json');
if(mode==='--prepare'){
 // Caller has checked that no harness is running. Never reuse an old profile.
 await fs.mkdir(profile,{recursive:false});
 const f=fixtures();
 for(const [name,value] of Object.entries({'tasks.json':{format:1,revision:1,state:f.state},'window.json':f.window}))await fs.writeFile(path.join(profile,name),JSON.stringify(value));
 await fs.writeFile(path.join(profile,'import.json'),exportData(f.imported));
 await fs.writeFile(path.join(profile,'invalid.json'),'not JSON');
}else{
 if(process.platform!=='win32')throw Error('Windows integration requires Windows; live remains UNVERIFIED');
 if(!Number.isSafeInteger(Number(pidArg))||Number(pidArg)<=0)throw Error('Expected harness PID is required');
 const checks=[],metadata={startedAt:new Date().toISOString(),profile,pid:Number(pidArg),platform:process.platform,node:process.version};
 let page,identified=false;
 const check=async(name,fn)=>{try{const details=await fn();checks.push({name,pass:true,details});}catch(e){checks.push({name,pass:false,error:e.stack});throw e;}};
 try{
  page=await connect();
  const diagnostics=await page.host('osSurfaceDiagnostics');
  assert.equal(path.resolve(diagnostics.profile).toLowerCase(),profile.toLowerCase(),'Wrong harness profile');
  assert.equal(diagnostics.pid,Number(pidArg),'Wrong harness process');identified=true;
  if(mode==='--exit'){await page.host('exit');}else if(mode==='--snapshot'){console.log(JSON.stringify(diagnostics,null,2));}else{
  const until=async(expression)=>{const end=Date.now()+8000;while(!await page.evaluate(expression)){if(Date.now()>end)throw Error('Timed out: '+expression);await wait(50);}};
  await until(`document.querySelector('#widget').getAttribute('aria-busy')!=='true'`);
  const disk=async()=>JSON.parse(await fs.readFile(data,'utf8'));
  const copies=async()=>(await fs.readdir(profile)).filter(n=>n.startsWith('tasks.json.before-import-')).sort();
  const select=async name=>{
   const {root}=await page.call('DOM.getDocument');
   const {nodeId}=await page.call('DOM.querySelector',{nodeId:root.nodeId,selector:'#import-file'});
   assert.ok(nodeId);
   await page.call('DOM.setFileInputFiles',{nodeId,files:[path.join(profile,name)]});
  };
  await page.evaluate(`document.querySelector('#settings-open').click();document.querySelector('#open-settings').click()`);
  await until(`document.querySelector('#settings').open`);
  // Use the application's export handler, recording exactly what it writes to a
  // controlled picker. Restore the original global even on assertion failure.
  await page.evaluate(`globalThis.__osPicker=Object.getOwnPropertyDescriptor(globalThis,'showSaveFilePicker');globalThis.__osExport={};Object.defineProperty(globalThis,'showSaveFilePicker',{configurable:true,writable:true,value:async options=>{__osExport.options=options;return {name:'captured.json',createWritable:async()=>({write:async body=>{__osExport.body=body},close:async()=>{__osExport.closed=true}})}}})`);
  await check('N12 export bytes',async()=>{
   await page.evaluate(`document.querySelector('#export-data').click()`);
   await until(`globalThis.__osExport.closed===true`);
   const exported=await page.evaluate(`globalThis.__osExport`);
   assert.equal(exported.options.types[0].accept['application/json'][0],'.json');
   const parsed=JSON.parse(exported.body);assert.equal(parsed.format,'delo-export');assert.equal(parsed.version,1);
   assert.deepEqual(parsed.state,(await disk()).state);
   await fs.writeFile(path.join(profile,'captured.json'),exported.body);
   assert.equal(await fs.readFile(path.join(profile,'captured.json'),'utf8'),exported.body);
   return {picker:'test double',file:'captured.json'};
  });
  await check('N12 export cancellation',async()=>{
   const before=await fs.readFile(data,'utf8');
   await page.evaluate(`__osExport={};globalThis.showSaveFilePicker=async()=>{__osExport.cancelled=true;throw new DOMException('Cancelled','AbortError')};globalThis.__osDownloads=0;globalThis.__osAnchor=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){__osDownloads++};document.querySelector('#export-data').click()`);
   await until(`globalThis.__osExport.cancelled===true`);
   assert.equal(await page.evaluate(`globalThis.__osDownloads`),0,'Cancel must not fall back to a download');
   assert.equal(await fs.readFile(data,'utf8'),before);
   assert.equal(await page.evaluate(`document.querySelector('#settings-error').hidden`),true);
  });
  await page.evaluate(`HTMLAnchorElement.prototype.click=__osAnchor;if(__osPicker)Object.defineProperty(globalThis,'showSaveFilePicker',__osPicker);else delete globalThis.showSaveFilePicker`);
  await check('N12 invalid import',async()=>{
   const before=await fs.readFile(data,'utf8'),oldCopies=await copies();
   await select('invalid.json');await until(`!document.querySelector('#settings-error').hidden`);
   assert.equal(await page.evaluate(`document.querySelector('#confirmation').open`),false);
   assert.equal(await fs.readFile(data,'utf8'),before);assert.deepEqual(await copies(),oldCopies);
  });
  await check('N12 import cancellation',async()=>{
   const before=await fs.readFile(data,'utf8'),oldCopies=await copies();
   await select('import.json');await until(`document.querySelector('#confirmation').open`);
   await page.evaluate(`document.querySelector('#confirmation-cancel').click()`);
   await until(`!document.querySelector('#confirmation').open`);
   assert.equal(await fs.readFile(data,'utf8'),before);assert.deepEqual(await copies(),oldCopies);
  });
  await check('N12 import disk and copy',async()=>{
   const before=await fs.readFile(data,'utf8'),oldCopies=await copies();
   await page.evaluate(`document.querySelector('#import-file').value=''`);
   await select('import.json');await until(`document.querySelector('#confirmation').open`);
   await page.evaluate(`document.querySelector('#confirmation-accept').click()`);
   await until(`!document.querySelector('#data-status').hidden&&!document.querySelector('#confirmation').open&&document.querySelector('#widget').getAttribute('aria-busy')!=='true'`);
   const saved=await disk(),expected=JSON.parse(await fs.readFile(path.join(profile,'import.json'),'utf8')).state;
   for(const key of DEVICE_SETTINGS)expected.settings[key]=JSON.parse(before).state.settings[key];
   assert.deepEqual(saved.state,expected);assert.equal(saved.revision,JSON.parse(before).revision+1);
   const added=(await copies()).filter(n=>!oldCopies.includes(n));assert.equal(added.length,1);
   assert.equal(await fs.readFile(path.join(profile,added[0]),'utf8'),before);
   const loaded=await page.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');return new HostBridge().request('load')})()`);
   assert.deepEqual(loaded.state,saved.state);assert.equal(loaded.revision,saved.revision);
   return {copy:added[0],revision:saved.revision};
  });
  await check('N13 cached native menu',async()=>{
   const reply=await page.host('updates',{enabled:true});
   assert.equal(reply.cached,true);assert.equal(reply.newer,true);assert.equal(reply.latest,futureTag);assert.equal(reply.url,releaseUrl);
   const {menu}=await page.host('osSurfaceDiagnostics');
   assert.deepEqual(menu.map(i=>i.id),[6,0,1,2,4,5,0,3]);
   assert.equal(menu[0].label,'Version available: 999.0.0');assert.equal(menu[1].separator,true);
   return {source:'real HMENU, not displayed',menu};
  });
  await check('N13 disabled native menu',async()=>{
   await page.host('updates',{enabled:false});
   const {menu}=await page.host('osSurfaceDiagnostics');
   assert.deepEqual(menu.map(i=>i.id),[1,2,4,5,0,3]);return {menu};
  });
  await check('T07 native submission',async()=>{
   const before=await page.host('osSurfaceDiagnostics');
   await page.host('notify',{title:'Delo OS integration',body:'T07 synthetic notification. Visual receipt is a separate manual check.'});
   const after=await page.host('osSurfaceDiagnostics');
   assert.equal(after.notificationAccepted,before.notificationAccepted+1);
   return {before,after,meaning:'Shell_NotifyIconW accepted; visibility and click not asserted'};
  });
  }
 }catch(e){metadata.error=e.stack;process.exitCode=1;}
 finally{
  if(page&&identified&&mode==='--run'){try{await page.evaluate(`if(globalThis.__osAnchor)HTMLAnchorElement.prototype.click=__osAnchor;if(Object.hasOwn(globalThis,'__osPicker')){if(__osPicker)Object.defineProperty(globalThis,'showSaveFilePicker',__osPicker);else delete globalThis.showSaveFilePicker}`);}catch(e){metadata.cleanupError=e.message;process.exitCode=1;}}
  page?.close();
  if(mode==='--run'){
  const result=report(checks,metadata);if(result.integration!=='PASS')process.exitCode=1;
  await fs.writeFile(path.join(profile,'os-030.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  }else if(metadata.error){console.error(metadata.error);}
 }
}
