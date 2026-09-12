// Measures submitted frames and crop alignment during an actual pointer-held drag.
// Submission timing is not a measurement of photon/display latency.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {connect,wait} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/pacing');await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),results=[];
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))];
try{
 await quick.host('quickDone');await main.host('show');await main.host('pin',{pinned:true});
 for(const [name,page] of [['main',main],['quick',quick]]){
  if(name==='quick')await main.host('quick');await wait(500);
  for(const interval of [16,8]){
   const before=await page.host('diagnostics');assert(before.healthy&&before.windowVisible);
   const p=await page.evaluate(name==='main'?`(()=>{const r=document.querySelector('.widget-head h1').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};})()`:`({x:6,y:innerHeight/2,width:innerWidth,height:innerHeight})`);
   const steps=Math.round(2000/interval),dx=before.x>600?-400:400;
   let done=false,driverError;
   const driver=new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-File',path.join(import.meta.dirname,'native-input.ps1'),'-Window',String(before.window),'-Action','drag','-X',String(Math.round(before.x+p.x*before.width/p.width)),'-Y',String(Math.round(before.y+p.y*before.height/p.height)),'-Width',String(dx),'-Height','0','-DragSteps',String(steps),'-DragStepMs',String(interval),'-PreciseDrag'],{windowsHide:true,timeout:20000},(error,stdout,stderr)=>{done=true;driverError=error?Error(stderr||error.message):null;resolve();}));
   const samples=[];
   while(!done){
    const d=await page.host('pacingDiagnostics');
    if(!done&&Math.abs(d.windowX-before.x)>30&&Math.abs(d.windowX-before.x)<Math.abs(dx)-20)samples.push(d);
    await wait(6);
   }
   await driver;if(driverError)throw driverError;
   assert(samples.length>20,`${name}: not enough pointer-held samples`);
   const first=samples[0],last=samples.at(-1);
   const fps=(last.rendered-first.rendered)*1000/(last.lastSubmitMs-first.lastSubmitMs);
   const work95=percentile(samples.map(d=>d.lastRenderWorkMs),.95);
   const cropError95=percentile(samples.map(d=>Math.abs(d.cropX-d.windowX)+Math.abs(d.cropY-d.windowY)),.95);
   assert(samples.every(d=>d.healthy&&d.errors===before.errors),`${name}: renderer fault during drag`);
   assert(fps>40,`${name}: submission still behaves like a 30Hz timer (${fps.toFixed(1)} fps)`);
   assert(cropError95<=12,`${name}: desktop crop lags window geometry (${cropError95}px p95)`);
   const result={name,inputIntervalMs:interval,displayHz:last.displayHz,submittedFps:fps,renderWorkP95Ms:work95,cropErrorP95Px:cropError95,samples};results.push(result);
   console.log(JSON.stringify({...result,samples:samples.length}));
  }
 }
}finally{await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));main.close();quick.close();}
