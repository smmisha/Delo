// Runs only against the explicit development endpoint. Native helpers refuse production HWNDs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {channel} from 'node:diagnostics_channel';
import {randomUUID} from 'node:crypto';
export const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function connect(quick=false){
 const pages=await(await fetch('http://127.0.0.1:9223/json/list')).json();
 const matches=pages.filter(p=>p.url.startsWith('https://delo.local/ui/')&&p.url.includes('view=quick')===quick);
 if(matches.length>1)throw Error('Multiple Delo harness pages; close the other harness session');
 const page=matches[0];
 if(!page)throw Error('Named Delo harness page not found');
 // Match the upgrade by a per-connection nonce, including concurrent connections
 // to the same page. Keep the socket so cleanup need not await a peer's close frame.
 const nonce=randomUUID(),headers=channel('undici:client:sendHeaders');let ws,transport,openingTimer;
 const capture=event=>{if(typeof event.headers==='string'&&event.headers.toLowerCase().includes(`\r\nx-delo-audit-transport: ${nonce}\r\n`)){transport=event.socket;headers.unsubscribe(capture);}};
 headers.subscribe(capture);
 try{
  ws=new WebSocket(page.webSocketDebuggerUrl,{headers:{'x-delo-audit-transport':nonce}});
  await new Promise((resolve,reject)=>{
   openingTimer=setTimeout(()=>{const error=Error('Timeout: CDP connection');error.code='CDP_TIMEOUT';reject(error);},45000);
   ws.onopen=resolve;ws.onerror=reject;
  });
  if(!transport)throw Error('CDP transport capture unavailable; use supported Node.js 22 or later');
 }catch(error){ws?.close();transport?.destroy();throw error;}
 finally{clearTimeout(openingTimer);headers.unsubscribe(capture);}
 const pending=new Map();let seq=0,closed=false;
 const fail=error=>{closed=true;for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
 const close=()=>{fail(Error('CDP connection closed'));ws.close();transport.destroy();};
 ws.onclose=()=>fail(Error('CDP connection closed'));
 ws.onerror=()=>fail(Error('CDP connection error'));
 ws.onmessage=event=>{const data=JSON.parse(event.data),request=pending.get(data.id);if(request){pending.delete(data.id);clearTimeout(request.timer);data.error?request.reject(Error(JSON.stringify(data.error))):request.resolve(data.result);}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  if(closed||ws.readyState!==1){reject(Error('CDP connection closed'));return;}
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);const error=Error(`Timeout: ${method}`);error.code='CDP_TIMEOUT';reject(error);close();},45000);
  pending.set(id,{resolve,reject,timer});
  try{ws.send(JSON.stringify({id,method,params}));}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
 });
 const evaluate=async (expression,...args)=>{
  if(typeof expression==='function'){
   const global=await call('Runtime.evaluate',{expression:'globalThis',returnByValue:false});
   if(global.exceptionDetails)throw Error(JSON.stringify(global.exceptionDetails));
   const objectId=global.result.objectId;
   try{
    const result=await call('Runtime.callFunctionOn',{
     objectId,
     functionDeclaration:`function(...args){return (${expression.toString()})(...args);}`,
     arguments:args.map(value=>({value})),
     awaitPromise:true,
     returnByValue:true
    });
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
   }finally{if(!closed)await call('Runtime.releaseObject',{objectId}).catch(()=>{});}
  }
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const host=async(action,payload={})=>evaluate(async(action,payload)=>{
  const {HostBridge}=await import('./bridge.mjs');
  globalThis.__deloHarnessBridge??=new HostBridge();
  return globalThis.__deloHarnessBridge.window(action,payload);
 },action,payload);
 const geometry=async(selector,hitTest=false)=>evaluate((selector,hitTest)=>{
  const e=document.querySelector(selector);
  if(!e)throw Error(`Harness target is missing: ${selector}`);
  e.scrollIntoView({block:'nearest'});
  const r=e.getBoundingClientRect();
  if(r.width<=0||r.height<=0)throw Error(`Harness target is hidden: ${selector}`);
  if(hitTest){
   const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   if(!hit||!e.contains(hit))throw Error(`Harness target is covered at its centre: ${selector}`);
  }
  return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};
 },selector,hitTest);
 // Drag handles can intentionally have pointer-events:none; only clicks require a DOM hit.
 const point=async(selector,hitTest=false)=>{const p=await geometry(selector,hitTest),d=await host('diagnostics');return {window:d.window,x:Math.round(d.x+p.x*d.width/p.width),y:Math.round(d.y+p.y*d.height/p.height)};};
 // A toast or another app can briefly cover the widget. Wait for it to leave (bounded);
 // the native helper still refuses to click through anything that stays.
 const click=async selector=>{let p=await point(selector,true);for(const end=Date.now()+5000;native(p.window,'probe',{X:p.x,Y:p.y}).probe.covered&&Date.now()<end;p=await point(selector,true))await wait(200);native(p.window,'click',{X:p.x,Y:p.y});await wait(150);};
 const deadline=Date.now()+5000;
 while(!await evaluate(`document.readyState==='complete'&&!!document.querySelector('#task-input')`)){
  if(Date.now()>deadline){close();throw Error('Delo harness document did not finish loading');}
  await wait(50);
 }
 return {call,evaluate,host,point,click,close};
}
export function native(window,action,options={}){
 const script=path.join(import.meta.dirname,'native-input.ps1');
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Window',String(window),'-Action',action,...Object.entries(options).flatMap(([k,v])=>[`-${k}`,String(v)])],{encoding:'utf8',windowsHide:true,timeout:30000}).trim());
}
// A geometry, theme or visibility change is followed by a new material frame; until it
// lands the renderer is either not ready or still holds the previous size. Waiting for
// that frame is part of capturing the window, not a tolerance for a broken renderer:
// the error names the renderer state if it never arrives.
export async function ready(page,ms=3000){
 const end=Date.now()+ms;let d;
 while(true){
  d=await page.host('diagnostics');
  if(!d.windowVisible||d.iconic)throw Error('Cannot capture a hidden Delo window. Show the selected harness view first.');
  if(d.healthy&&d.materialWidth===d.clientWidth&&d.materialHeight===d.clientHeight)return d;
  if(Date.now()>end)throw Error(`Glass renderer did not present a frame at the current size within ${ms} ms: ${JSON.stringify({healthy:d.healthy,error:d.error,errors:d.errors,recoveries:d.recoveries,client:[d.clientWidth,d.clientHeight],material:[d.materialWidth,d.materialHeight]})}`);
  await wait(50);
 }
}
// The default captures the GPU material and WebView as separate transparent layers.
// Screen mode exercises Windows capture while the host briefly holds its last material.
// The caller must keep the window visible; screen mode also requires an unobscured window.
export async function screenshot(page,destination,{screen=false,readyMs=3000}={}){
 const d=await ready(page,readyMs);
 const full=path.resolve(destination);
 await fs.mkdir(path.dirname(full),{recursive:true});
 if(screen){
  try{
   await page.host('freezeForScreenshot');
   await wait(150);
   native(d.window,'capture',{OutputPath:full});
  }finally{await page.host('finishScreenshot');}
  return;
 }
 const material=full+'.material.png',document_=full+'.document.png';
 try{
  await page.host('materialShot',{path:material.split(path.sep).join('/')});
  const shot=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await fs.writeFile(document_,Buffer.from(shot.data,'base64'));
  native(d.window,'compose',{Base:material,Overlay:document_,OutputPath:full});
 } finally {
  await fs.rm(material,{force:true});await fs.rm(document_,{force:true});
 }
}
// Document-only series for checks about the page's own rendering. The material under a
// translucent control follows the live desktop, so composed frames also record whatever
// moved behind the window.
export async function documentFrames(page,directory,count,gapMs=120){
 await fs.mkdir(directory,{recursive:true});
 for(let index=0;index<count;index++){
  const shot=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await fs.writeFile(path.join(directory,`frame-${String(index).padStart(2,'0')}.png`),Buffer.from(shot.data,'base64'));
  if(index<count-1)await wait(gapMs);
 }
 const png=await fs.readFile(path.join(directory,'frame-00.png'));
 return {width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
}
// Series used by the flicker checks. Same two-layer capture, numbered like the frames the
// old screen grab produced so compare-frames.ps1 needs no change.
export async function frames(page,directory,count,gapMs=120){
 await fs.mkdir(directory,{recursive:true});
 for(let index=0;index<count;index++){
  await screenshot(page,path.join(directory,`frame-${String(index).padStart(2,'0')}.png`));
  if(index<count-1)await wait(gapMs);
 }
}
