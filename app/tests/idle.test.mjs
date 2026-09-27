import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,applyCommand,validateState,timeStats,idleMinutes,DEFAULT_SETTINGS} from '../core/model.mjs';
import {createIdleWatch} from '../core/idle.mjs';
const M=60000,H=60*M,base=Date.parse('2026-09-26T08:00:00Z'),mono=now=>now-base+777;
const run=(s,command,now)=>applyCommand(s,command,{now,monotonic:mono(now),timeZone:'UTC'});
const sum=task=>(task.intervals??[]).reduce((total,[,ms])=>total+ms,0);
function working(){let s=run(createState(),{type:'create',id:'a',title:'A'},base);s=run(s,{type:'create',id:'b',title:'B'},base);return run(s,{type:'start',id:'a'},base);}

test('V19 a long stretch without input becomes a question with the counted part',()=>{
  let s=working();
  // Last input at 08:30, back at 09:12: 42 minutes; the timer ran through all of it.
  s=run(s,{type:'idle',id:'a',from:base+30*M,to:base+72*M},base+72*M+2000);
  assert.deepEqual(s.tasks[0].idle,{from:base+30*M,to:base+72*M,ms:42*M});
  assert.equal(s.tasks[0].workState,'running');assert.equal(validateState(s).valid,true);
  // A stretch shorter than the threshold, or with asking turned off, asks nothing.
  assert.equal(run(working(),{type:'idle',id:'a',from:base+30*M,to:base+44*M},base+44*M).tasks[0].idle,undefined);
  const off=run(run(createState(),{type:'settings',patch:{idleMinutes:0}},base),{type:'create',id:'a',title:'A'},base);
  assert.equal(run(run(off,{type:'start',id:'a'},base),{type:'idle',id:'a',from:base+10*M,to:base+70*M},base+70*M).tasks[0].idle,undefined);
});

test('V19 only the part the timer counted is offered: idle that began before the start',()=>{
  let s=run(createState(),{type:'create',id:'a',title:'A'},base);
  s=run(s,{type:'start',id:'a'},base+20*M);
  s=run(s,{type:'idle',id:'a',from:base,to:base+60*M},base+60*M);
  assert.equal(s.tasks[0].idle.ms,40*M);
});

test('V19 subtracting removes exactly the idle stretch from time and intervals',()=>{
  let s=working();
  for(let now=base+15000;now<=base+72*M;now+=15000)s=run(s,{type:'checkpoint'},now);
  s=run(s,{type:'idle',id:'a',from:base+30*M,to:base+72*M},base+72*M);
  s=run(s,{type:'idleSubtract',id:'a'},base+80*M);
  const task=s.tasks[0];
  assert.equal(task.idle,undefined);assert.equal(task.workState,'running');
  assert.equal(task.elapsedMs,80*M-42*M);assert.equal(sum(task),task.elapsedMs);
  assert.deepEqual(task.intervals,[[base,30*M],[base+72*M,8*M]]);
  // The timer goes on from here, and the day's statistics agree.
  s=run(s,{type:'pause',id:'a'},base+90*M);
  assert.equal(s.tasks[0].elapsedMs,48*M);
  assert.equal(timeStats(s,{now:base+90*M,monotonic:mono(base+90*M),timeZone:'UTC'}).today,48*M);
  assert.equal(validateState(s).valid,true);
});

test('V19 keeping leaves the time, and the question can be answered after a pause',()=>{
  let s=run(working(),{type:'idle',id:'a',from:base+10*M,to:base+50*M},base+50*M);
  const kept=run(s,{type:'idleKeep',id:'a'},base+51*M);
  assert.equal(kept.tasks[0].idle,undefined);
  assert.equal(run(kept,{type:'pause',id:'a'},base+60*M).tasks[0].elapsedMs,60*M);
  s=run(s,{type:'pause',id:'a'},base+60*M);s=run(s,{type:'idleSubtract',id:'a'},base+61*M);
  assert.equal(s.tasks[0].elapsedMs,20*M);assert.equal(sum(s.tasks[0]),20*M);
});

test('V19 completion drops the question; bad input is refused',()=>{
  let s=run(working(),{type:'idle',id:'a',from:base+10*M,to:base+50*M},base+50*M);
  assert.equal(run(s,{type:'complete',id:'a'},base+51*M).tasks[0].idle,undefined);
  assert.throws(()=>run(s,{type:'idle',id:'b',from:base,to:base+H},base+H),/not running/);
  assert.throws(()=>run(s,{type:'idle',id:'a',from:base+H,to:base},base+H),/Invalid idle/);
  assert.throws(()=>run(s,{type:'idle',id:'a',from:base,to:base+3*H},base+H),/Invalid idle/);
  assert.throws(()=>run(s,{type:'idleSubtract',id:'b'},base+H),/No idle/);
  const broken=structuredClone(s);broken.tasks[0].idle.ms=-1;assert.equal(validateState(broken).valid,false);
});

test('V19 data without the setting asks after 15 minutes; the setting accepts only the offered values',()=>{
  const old=createState();delete old.settings.idleMinutes;
  assert.equal(validateState(old).valid,true);assert.equal(idleMinutes(old.settings),15);assert.equal(DEFAULT_SETTINGS.idleMinutes,15);
  for(const value of [0,5,15,30,60])assert.equal(run(createState(),{type:'settings',patch:{idleMinutes:value}},base).settings.idleMinutes,value);
  for(const value of [10,'15',-5])assert.throws(()=>run(createState(),{type:'settings',patch:{idleMinutes:value}},base));
});

test('V19 the watcher reports a stretch once, from the previous input to the return',()=>{
  const watch=createIdleWatch(()=>15*M);let now=base;const seen=[];
  const step=(idleMs)=>{const found=watch.sample({idleMs,now});if(found)seen.push(found);};
  for(let i=0;i<10;i++){now+=5000;step(1200);}// active: input every few seconds
  for(let idle=5000;idle<=42*M;idle+=5000){now+=5000;step(idle+3);}// away, samples every 5 s
  const away=now-(42*M+3);
  now+=5000;step(2000);// back
  assert.deepEqual(seen,[{from:away,to:now-2000}]);
  assert.ok(Math.abs((now-2000)-away-(42*M+5000-2000+3))<5);
  // Throttled samples still give the same stretch, and a short break gives nothing.
  const slow=createIdleWatch(()=>15*M);now=base;slow.sample({idleMs:0,now});
  now+=10*M;assert.equal(slow.sample({idleMs:10*M,now}),null);
  now+=30*M;assert.deepEqual(slow.sample({idleMs:500,now}),{from:base,to:now-500});
  now+=60000;assert.equal(slow.sample({idleMs:50000,now}),null);
});
