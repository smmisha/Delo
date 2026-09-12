// Sample HWND, WebView2 and DirectComposition geometry during a real pointer-held resize.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {connect,native,wait,screenshot} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/live-resize');
await fs.mkdir(output,{recursive:true});
const main=await connect(),results=[];
const aligned=d=>d.clientWidth===d.webWidth&&d.clientHeight===d.webHeight&&d.clientWidth===d.materialWidth&&d.clientHeight===d.materialHeight;
try{
 await main.evaluate(`document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close())`);
 await main.host('show');await main.host('pin',{pinned:true});
 for(const interval of [16,8]){
  let state=await main.host('diagnostics');
  const scale=state.width/await main.evaluate('innerWidth');
  native(state.window,'resize',{Width:Math.round(420*scale),Height:Math.round(620*scale)});await wait(180);
  const before=await main.host('diagnostics');assert(before.healthy&&before.windowVisible&&aligned(before));
  const inset=Math.round(12*scale),steps=Math.round(960/interval);
  let finished=false,driverError;
  const driver=new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-File',path.join(import.meta.dirname,'native-input.ps1'),'-Window',String(before.window),'-Action','drag','-X',String(before.x+before.width-inset),'-Y',String(before.y+before.height-inset),'-Width','220','-Height','140','-DragSteps',String(steps),'-DragStepMs',String(interval),'-PreciseDrag'],{windowsHide:true,timeout:20000},(error,stdout,stderr)=>{finished=true;driverError=error?Error(stderr||error.message):null;resolve();}));
  const samples=[];
  while(!finished){
   const d=await main.host('diagnostics');
   if(d.width!==before.width||d.height!==before.height)samples.push(d);
   await wait(3);
  }
  await driver;if(driverError)throw driverError;
  const after=await main.host('diagnostics');
  assert(samples.length>=12,`not enough ${interval} ms resize samples`);
  assert(samples.every(aligned),`geometry diverged at ${interval} ms: ${JSON.stringify(samples.find(d=>!aligned(d)))}`);
  assert(aligned(after)&&after.healthy&&after.errors===before.errors,`renderer ended resize out of sync at ${interval} ms`);
  assert(after.rendered>before.rendered+3,`material did not update during ${interval} ms resize`);
  const result={inputIntervalMs:interval,samples:samples.length,uniqueSizes:new Set(samples.map(d=>`${d.width}x${d.height}`)).size,rendered:after.rendered-before.rendered,before,after};
  results.push(result);console.log(JSON.stringify({...result,before:undefined,after:undefined}));
  await screenshot(main,path.join(output,`main-${interval}ms.png`));
 }
}finally{await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));main.close();}
