import test from 'node:test';
import assert from 'node:assert/strict';
import {HostBridge} from '../ui/bridge.mjs';
class FakeHost extends EventTarget{
  sent=[];
  postMessage(value){this.sent.push(value);}
  reply(value){this.dispatchEvent(new MessageEvent('message',{data:value}));}
}
test('bridge refuses to claim persistence without native host',async()=>{
  await assert.rejects(new HostBridge(null).request('save',{state:{}}),/noHost/);
});
test('save stays pending until matching native acknowledgement',async()=>{
  const native=new FakeHost(),bridge=new HostBridge(native);let completed=false;
  const saving=bridge.request('save',{revision:1,state:{value:'тест'}}).then(result=>{completed=true;return result;});
  native.reply({id:'wrong',ok:true,result:{revision:2}});await Promise.resolve();assert.equal(completed,false);
  const message=native.sent[0];assert.deepEqual(message.payload,{revision:1,state:{value:'тест'}});
  native.reply({id:message.id,ok:true,result:{revision:2}});assert.deepEqual(await saving,{revision:2});
});
test('out-of-order responses and native errors resolve only their requests',async()=>{
  const native=new FakeHost(),bridge=new HostBridge(native),first=bridge.request('load'),second=bridge.request('save');
  const failure=assert.rejects(second,/conflict/);native.reply({id:native.sent[1].id,ok:false,error:'conflict'});await failure;
  native.reply({id:native.sent[0].id,ok:true,result:{revision:7}});assert.deepEqual(await first,{revision:7});assert.equal(bridge.pending.size,0);
});
test('state events are distinct from acknowledgements',async()=>{
  const native=new FakeHost(),bridge=new HostBridge(native);let state;
  bridge.addEventListener('stateChanged',event=>state=event.detail);
  native.reply({event:'stateChanged',payload:{revision:8,state:{}}});assert.equal(state.revision,8);
  const request=bridge.window('pin',{pinned:true});assert.equal(native.sent[0].type,'window');assert.deepEqual(native.sent[0].payload,{action:'pin',pinned:true});
  native.reply({id:native.sent[0].id,ok:true,result:{}});await request;
});
