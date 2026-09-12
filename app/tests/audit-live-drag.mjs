// Observe real pointer-held gestures, not just the frame after mouse-up.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {connect,wait} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/live-drag');await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),results=[];
try{
 await main.evaluate(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);
 await main.host('show');await main.host('pin',{pinned:true});
 for(const [name,page] of [['main',main],['quick',quick]]){
  if(name==='quick')await main.host('quick');await wait(400);
  const before=await page.host('diagnostics');assert(before.healthy&&before.windowVisible);
  const point=await page.evaluate(name==='main'?`(()=>{const r=document.querySelector('.widget-head h1').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};})()`:`({x:6,y:innerHeight/2,width:innerWidth,height:innerHeight})`);
  const x=Math.round(before.x+point.x*before.width/point.width),y=Math.round(before.y+point.y*before.height/point.height);
  let finished=false;
  const driver=new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-File',path.join(import.meta.dirname,'native-input.ps1'),'-Window',String(before.window),'-Action','drag','-X',String(x),'-Y',String(y),'-Width',before.x>650?'-240':'240','-Height','0','-DragSteps','30','-DragStepMs','100'],{windowsHide:true,timeout:15000},(error,stdout,stderr)=>{finished=true;error?reject(Error(stderr||error.message)):resolve(stdout);}));
  // Attach rejection immediately; it is rethrown after sampling.
  let driverError;const completion=driver.catch(error=>{driverError=error;});
  const samples=[],hashes=[];
  while(!finished){
   const d=await page.host('diagnostics');
   if(!finished&&Math.abs(d.x-before.x)>30){
    samples.push(d);
    if(samples.length===1||samples.length===12){
     const file=path.join(output,`${name}-held-${samples.length}.png`);await page.host('materialShot',{path:file});
     hashes.push(createHash('sha256').update(await fs.readFile(file)).digest('hex'));
    }
   }
   await wait(80);
  }
  await completion;if(driverError)throw driverError;
  const after=await page.host('diagnostics');
  assert(samples.length>=12,`${name}: not enough samples during a held drag`);
  assert(samples.at(-1).rendered>samples[0].rendered+3,`${name}: material froze until mouse-up`);
  assert.equal(hashes.length,2);assert.notEqual(hashes[0],hashes[1],`${name}: held GPU material did not change`);
  assert(after.healthy&&after.errors===before.errors,`${name}: renderer error after drag`);
  results.push({name,before,samples,after,hashes});
  console.log(`PASS ${name}: ${samples.at(-1).rendered-samples[0].rendered} material updates during pointer-held drag`);
 }
}finally{await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));main.close();quick.close();}
