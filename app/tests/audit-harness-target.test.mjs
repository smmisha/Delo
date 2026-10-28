import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connect} from './audit-harness.mjs';

test('audit pointer targets are checked before native input',{timeout:30000},async t=>{
 let child,page;const originalFetch=globalThis.fetch,NativeWebSocket=globalThis.WebSocket;
 t.after(async()=>{
  page?.close();globalThis.fetch=originalFetch;globalThis.WebSocket=NativeWebSocket;
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}
 });
 const source=`
 globalThis.innerWidth=800;globalThis.innerHeight=600;globalThis.__diagnostics=0;globalThis.__scrolled=[];
 const element=(name,rect={x:20,y:30,width:100,height:40})=>({scrollIntoView(){__scrolled.push(name)},getBoundingClientRect(){return rect},contains(node){return node===this||node?.owner===this}});
 const elements={'#task-input':element('ready'),'#visible':element('visible'),'#svg-child':element('svg-child'),'#inert-drag':element('inert-drag'),'#covered':element('covered'),'#closed-dialog':element('closed-dialog',{x:0,y:0,width:0,height:0}),'#zero-height':element('zero-height',{x:20,y:30,width:100,height:0}),'#offscreen':element('offscreen',{x:-200,y:30,width:20,height:20})};
 let selected;
 globalThis.document={readyState:'complete',querySelector(selector){selected=selector;return elements[selector]??null},elementFromPoint(x,y){if(x<0||y<0||x>=innerWidth||y>=innerHeight)return null;const target=elements[selected];if(['#covered','#inert-drag'].includes(selected))return {};return selected==='#svg-child'?{owner:target}:target}};
 setInterval(()=>{},1000);
 `;
 child=spawn(process.execPath,['--inspect=127.0.0.1:0','--input-type=module','--eval',source],{stdio:['ignore','ignore','pipe'],windowsHide:true});
 const endpoint=await new Promise((resolve,reject)=>{
  let stderr='';const timer=setTimeout(()=>reject(Error('Inspector startup timeout: '+stderr)),5000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Inspector exited: '+code));});
  child.stderr.on('data',data=>{stderr+=data;const match=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(match){clearTimeout(timer);resolve(match[0]);}});
 });
 globalThis.fetch=async(url,...args)=>url==='http://127.0.0.1:9223/json/list'?{json:async()=>[{url:'https://delo.local/ui/index.html',webSocketDebuggerUrl:endpoint}]}:originalFetch(url,...args);
 // Only the native diagnostics boundary is doubled; target geometry runs through real CDP.
 globalThis.WebSocket=function(url,options){
  const socket=new NativeWebSocket(url,options),send=socket.send.bind(socket);
  socket.send=data=>{
   const request=JSON.parse(data);
   if(request.method==='Runtime.callFunctionOn'&&request.params.arguments?.[0]?.value==='diagnostics'&&request.params.functionDeclaration.includes('__deloHarnessBridge.window')){
    request.params.functionDeclaration='function(){globalThis.__diagnostics++;return {window:111,x:100,y:200,width:800,height:600};}';
    send(JSON.stringify(request));
   }else send(data);
  };
  return socket;
 };
 page=await connect();
 for(const selector of ['#visible','#svg-child'])await t.test('click coordinates accept '+selector,async()=>{
  assert.deepEqual(await page.point(selector,true),{window:111,x:170,y:250});
 });
 await t.test('inert drag handles can still be measured',async()=>{
  assert.deepEqual(await page.point('#inert-drag'),{window:111,x:170,y:250});
 });
 for(const selector of ['#missing','#closed-dialog','#zero-height','#covered','#offscreen','#inert-drag'])await t.test('refuses an invalid click target '+selector,async()=>{
  const before=await page.evaluate('globalThis.__diagnostics');
  await assert.rejects(page.point(selector,true),/Harness target .* (missing|hidden|covered)/);
  assert.equal(await page.evaluate('globalThis.__diagnostics'),before,'Reject before resolving a native window');
 });
 await t.test('hidden geometry is rejected for drag coordinates too',async()=>{
  await assert.rejects(page.point('#closed-dialog'),/Harness target .* hidden/);
 });
 await t.test('click refuses a covered target before invoking a native helper',async()=>{
  const before=await page.evaluate('globalThis.__diagnostics');
  await assert.rejects(page.click('#covered'),/Harness target .* covered/);
  assert.equal(await page.evaluate('globalThis.__diagnostics'),before);
 });
});
