import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const harness=new URL('./audit-harness.mjs',import.meta.url).href;
const childSource=String.raw`
import assert from 'node:assert/strict';
const mode=process.argv[1],endpoint=process.argv[2],schedule=globalThis.setTimeout;
globalThis.setTimeout=(callback,ms,...args)=>schedule(callback,ms===45000?2000:ms,...args);
globalThis.fetch=async()=>({json:async()=>[{url:'https://delo.local/ui/index.html',webSocketDebuggerUrl:endpoint}]});
const {connect}=await import(HARNESS_URL);
if(mode==='opening-timeout')await assert.rejects(connect(),error=>error.code==='CDP_TIMEOUT');
else{const page=await connect();if(mode==='timeout')await assert.rejects(page.evaluate('42'),error=>error.code==='CDP_TIMEOUT');page.close();}
console.log('TRANSPORT_BODY_DONE');
`.replace('HARNESS_URL',JSON.stringify(harness));

for(const mode of ['close','timeout','opening-timeout'])test('CDP '+mode+' ends the transport when the peer ignores close',{timeout:15000},async()=>{
 const server=http.createServer(),sockets=new Set();let readyReplies=0,closeFrames=0;
 server.on('upgrade',(request,socket)=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  if(mode==='opening-timeout')return;
  const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  let buffer=Buffer.alloc(0),answered=false;
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   while(buffer.length>=2){
    const opcode=buffer[0]&15,masked=!!(buffer[1]&128);let size=buffer[1]&127,offset=2;
    if(size===126){if(buffer.length<4)return;size=buffer.readUInt16BE(2);offset=4;}
    if(size===127){socket.destroy(Error('Unexpected large test frame'));return;}
    if(buffer.length<offset+(masked?4:0)+size)return;
    const mask=buffer.subarray(offset,offset+4);if(masked)offset+=4;
    const payload=Buffer.from(buffer.subarray(offset,offset+size));buffer=buffer.subarray(offset+size);
    if(masked)for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
    if(opcode===8){closeFrames++;continue;} // Deliberately do not acknowledge or end TCP.
    if(opcode!==1||answered)continue;
    const message=JSON.parse(payload.toString());answered=true;readyReplies++;
    const response=Buffer.from(JSON.stringify({id:message.id,result:{result:{type:'boolean',value:true}}}));
    socket.write(Buffer.concat([Buffer.from([129,response.length]),response]));
   }
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['--input-type=module','--eval',childSource,mode,`ws://127.0.0.1:${server.address().port}/stalled`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stdout='',stderr='',afterBody,reason;
 const whole=setTimeout(()=>{reason='startup/body timeout';child.kill();},10000);
 child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('TRANSPORT_BODY_DONE')&&!afterBody)afterBody=setTimeout(()=>{reason='socket kept the process alive after cleanup';child.kill();},2000);});
 child.stderr.on('data',data=>{stderr+=data;});
 try{
  const [code]=await once(child,'exit');
  assert.equal(readyReplies,mode==='opening-timeout'?0:1,'The real WebSocket connection must finish CDP readiness');
  assert.equal(reason,undefined,reason+'; close frames='+closeFrames+'\n'+stdout+'\n'+stderr);
  assert.equal(code,0,stderr);assert(stdout.includes('TRANSPORT_BODY_DONE'));
 }finally{
  clearTimeout(whole);clearTimeout(afterBody);
  if(child.exitCode===null&&child.signalCode===null)child.kill();
  for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
 }
});
