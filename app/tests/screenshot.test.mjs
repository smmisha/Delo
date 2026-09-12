import test from 'node:test';
import assert from 'node:assert/strict';
import {screenshot} from './audit-harness.mjs';

for(const [name,diagnostics,message] of [
 ['hidden',{windowVisible:false,iconic:false,healthy:true},/hidden Delo window/],
 ['minimized',{windowVisible:true,iconic:true,healthy:true},/hidden Delo window/],
 ['material pending',{windowVisible:true,iconic:false,healthy:false},/renderer is ready/],
])test(`screenshot rejects ${name} before attempting capture`,async()=>{
 const calls=[];
 const page={host:async action=>{calls.push(action);return diagnostics;},call:()=>assert.fail('CDP capture must not run')};
 await assert.rejects(screenshot(page,'unused.png'),message);
 assert.deepEqual(calls,['diagnostics']);
});
