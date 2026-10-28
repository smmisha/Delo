import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const harness=pathToFileURL(path.resolve(import.meta.dirname,'audit-harness.mjs')).href;
// A separate process exposes leaked request timers that an assertion in this process misses.
const childSource=String.raw`
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const mode=process.argv[1];
const inspector=spawn(process.execPath,['--inspect=127.0.0.1:0','--input-type=module','--eval',"globalThis.document={readyState:'complete',querySelector:()=>({})};setInterval(()=>{},1000)"],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let page;
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let stderr='';const timer=setTimeout(()=>reject(Error('Inspector startup timeout')),5000);
  inspector.once('error',error=>{clearTimeout(timer);reject(error);});
  inspector.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(match){clearTimeout(timer);resolve(match[0]);}});
 });
 globalThis.fetch=async()=>({json:async()=>[{url:'https://delo.local/ui/index.html',webSocketDebuggerUrl:endpoint}]});
 const methods=[];let stalled=false;
 if(mode.startsWith('callback-')||mode==='request-timeout'){
  const NativeWebSocket=globalThis.WebSocket;
  globalThis.WebSocket=function(url,options){
   const socket=new NativeWebSocket(url,options),send=socket.send.bind(socket);
   socket.send=data=>{const request=JSON.parse(data);methods.push(request.method);if(mode==='callback-release-timeout'&&request.method==='Runtime.releaseObject')stalled=true;if(stalled||mode==='callback-timeout'&&['Runtime.callFunctionOn','Runtime.releaseObject'].includes(request.method))return;send(data);};
   return socket;
  };
  // Keep real transport and shorten only the CDP deadline for the dropped-response probe.
  if(mode.endsWith('-timeout')){const schedule=globalThis.setTimeout;globalThis.setTimeout=(callback,ms,...args)=>schedule(callback,ms===45000?2000:ms,...args);}
 }
 const {connect,wait}=await import(HARNESS_URL);page=await connect();
 if(mode==='callback-timeout'){
  const started=performance.now();let failure;
  try{await page.evaluate(value=>value,42);}catch(error){failure=error;}
  console.log(JSON.stringify({mode,elapsedMs:Math.round(performance.now()-started),code:failure?.code,methods}));
  assert.equal(methods.filter(method=>method==='Runtime.releaseObject').length,0,'Do not wait on releaseObject after callback timeout');
  assert.equal(failure?.code,'CDP_TIMEOUT');
  await assert.rejects(page.evaluate('42'),/CDP.*closed/i);
 }else if(mode==='callback-release-timeout'||mode==='request-timeout'){
  if(mode==='request-timeout')stalled=true;
  const started=performance.now();let failure;
  try{if(mode==='request-timeout')await page.evaluate('42');else await page.evaluate(value=>value,42);}catch(error){failure=error;}
  assert.equal(failure?.code,'CDP_TIMEOUT');
  const sent=methods.length,cleanupStarted=performance.now();let cleanupError;
  try{await page.host('storeDelay',{ms:0});}catch(error){cleanupError=error;}
  console.log(JSON.stringify({mode,elapsedMs:Math.round(performance.now()-started),cleanupMs:Math.round(performance.now()-cleanupStarted),methods}));
  assert.match(cleanupError?.message??'resolved',/CDP.*closed/i);
  assert.equal(methods.length,sent,'Cleanup must not send requests after a CDP timeout');
 }else if(mode==='callback-serialize'){
  const cycle={};cycle.self=cycle;
  await assert.rejects(page.evaluate(value=>value,cycle),/circular/i);
  assert.equal(methods.filter(method=>method==='Runtime.releaseObject').length,1,'Serialization failure must still release the remote object');
  assert.equal(await page.evaluate('42'),42);
 }else if(mode==='serialize'){
  const cycle={};cycle.self=cycle;
  await assert.rejects(page.call('Runtime.evaluate',{expression:'42',cycle}),/circular/i);
  assert.equal(await page.evaluate('42'),42);
 }else{
  const pending=page.evaluate('new Promise(()=>{})').then(()=>({resolved:true}),error=>({error:error.message}));
  if(mode==='peer'){const exited=once(inspector,'exit');inspector.kill();await exited;}else{page.close();}
  const outcome=await Promise.race([pending,wait(500).then(()=>({timeout:true}))]);
  assert.match(outcome.error??JSON.stringify(outcome),/CDP connection (closed|error)/i);
  await assert.rejects(page.evaluate('42'),/CDP.*closed/i);
 }
}finally{
 page?.close();
 if(inspector.exitCode===null&&inspector.signalCode===null){const exited=once(inspector,'exit');inspector.kill();await exited;}
 console.log('AUDIT_CLOSE_BODY_FINISHED');
}
`.replace('HARNESS_URL',JSON.stringify(harness));
for(const mode of ['local','peer','serialize','callback-timeout','callback-serialize','callback-release-timeout','request-timeout'])test('CDP '+mode+' cleanup releases the Node process',{timeout:15000},async()=>{
 const child=spawn(process.execPath,['--input-type=module','--eval',childSource,mode],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stdout='',stderr='',closedTimer,timeoutReason;
 const wholeTimer=setTimeout(()=>{timeoutReason='startup/body timeout';child.kill();},10000);
 child.stdout.on('data',data=>{
  stdout+=data;
  if(stdout.includes('AUDIT_CLOSE_BODY_FINISHED')&&!closedTimer)closedTimer=setTimeout(()=>{timeoutReason='process remained alive after cleanup';child.kill();},2000);
 });
 child.stderr.on('data',data=>{stderr+=data;});
 try{
  const [code,signal]=await once(child,'exit');
  assert.equal(timeoutReason,undefined,timeoutReason+'\n'+stderr);
  assert.equal(code,0,'signal='+signal+'\n'+stdout+'\n'+stderr);
 }finally{clearTimeout(wholeTimer);clearTimeout(closedTimer);if(child.exitCode===null&&child.signalCode===null)child.kill();}
});
