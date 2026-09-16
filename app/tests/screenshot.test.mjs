import test from 'node:test';
import assert from 'node:assert/strict';
import {screenshot} from './audit-harness.mjs';

const sized={clientWidth:400,clientHeight:600,materialWidth:400,materialHeight:600};
for(const [name,diagnostics,message] of [
 ['hidden',{windowVisible:false,iconic:false,healthy:true,...sized},/hidden Delo window/],
 ['minimized',{windowVisible:true,iconic:true,healthy:true,...sized},/hidden Delo window/],
])test(`screenshot rejects ${name} before attempting capture`,async()=>{
 const calls=[];
 const page={host:async action=>{calls.push(action);return diagnostics;},call:()=>assert.fail('CDP capture must not run')};
 await assert.rejects(screenshot(page,'unused.png'),message);
 assert.deepEqual(calls,['diagnostics']);
});

for(const [name,diagnostics] of [
 ['a renderer that never becomes ready',{windowVisible:true,iconic:false,healthy:false,error:'Glass renderer HRESULT 0x887a0005',...sized}],
 ['material left at the previous size',{windowVisible:true,iconic:false,healthy:true,...sized,materialWidth:320}],
])test(`screenshot waits for, then rejects, ${name}`,async()=>{
 let polls=0;
 const page={host:async action=>{assert.equal(action,'diagnostics');polls++;return diagnostics;},call:()=>assert.fail('CDP capture must not run')};
 await assert.rejects(screenshot(page,'unused.png',{readyMs:150}),/did not present a frame[\s\S]*(0x887a0005|320)/);
 assert.ok(polls>1,'the renderer is polled until the deadline');
});

test('screenshot proceeds once the renderer presents a frame at the current size',async()=>{
 const states=[{healthy:false},{healthy:true,materialWidth:320},{healthy:true}].map(state=>({windowVisible:true,iconic:false,...sized,...state}));
 const actions=[];
 const page={host:async action=>{actions.push(action);return action==='diagnostics'?states.shift()??states.at(-1):undefined;},call:async()=>{throw Error('capture reached');}};
 await assert.rejects(screenshot(page,'unused.png',{readyMs:1000}),/capture reached/);
 assert.deepEqual(actions,['diagnostics','diagnostics','diagnostics','materialShot']);
});
