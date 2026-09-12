// Run against a named harness with its window visible and unobscured.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,screenshot,wait} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/screenshot-review');
await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
async function ready(page){
 for(let i=0;i<100;i++){const d=await page.host('diagnostics');if(d.healthy&&d.windowVisible)return d;await wait(100);}
 throw Error('Visible glass did not become ready');
}
try{
 await main.host('show');await main.host('pin',{pinned:true});
 // Initialize the second renderer too; its hidden capture session must also stop.
 await main.host('quick');await ready(quick);await quick.host('quickDone');await ready(main);
 for(const [name,page] of [['main',main],['quick',quick]]){
  if(name==='quick'){await main.host('quick');await ready(quick);}
  const before=await page.host('diagnostics');
  await page.host('freezeForScreenshot');
  const paused=await page.host('diagnostics');
  const held=path.join(output,`${name}-held.png`);
  await page.host('materialShot',{path:held});
  const a=await main.host('diagnostics'),b=await quick.host('diagnostics');
  assert.equal(a.captureFrozen,true);assert.equal(b.captureFrozen,true);
  assert.equal(a.displayAffinity,0);assert.equal(b.displayAffinity,0);
  await wait(250);
  const frozen=await page.host('diagnostics');
  assert.equal(frozen.healthy,true);assert.equal(frozen.copied,paused.copied);
  assert.equal(frozen.rendered,paused.rendered);assert.equal(frozen.recoveries,before.recoveries);
  await page.host('finishScreenshot');await wait(300);
  await screenshot(page,path.join(output,`${name}-composed.png`));
  await screenshot(page,path.join(output,`${name}-screen.png`),{screen:true});
  await wait(300);
  const after=await page.host('diagnostics');
  assert.equal(after.captureFrozen,false);assert.equal(after.displayAffinity,17);
  assert.equal(after.healthy,true);assert.equal(after.errors,before.errors);
  assert.equal(after.recoveries,before.recoveries);
  checks.push({name,before,frozen,after});
 }
 // The timer restores exclusion even when a caller never sends finishScreenshot.
 await quick.host('freezeForScreenshot');await wait(16000);
 for(const page of [main,quick]){const d=await page.host('diagnostics');assert.equal(d.captureFrozen,false);assert.equal(d.displayAffinity,17);}
 console.log('PASS: material retained, both captures paused, screenshots written, exclusion restored, timer recovered');
}finally{
 try{await main.host('finishScreenshot');}finally{await fs.writeFile(path.join(output,'checks.json'),JSON.stringify(checks,null,2));main.close();quick.close();}
}
