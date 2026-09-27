import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,applyCommand,validateState,recoverState,timeStats,dayStart,weekStart,DAY} from '../core/model.mjs';
const zone='Europe/Kyiv',H=3600000,M=60000;
// Wall clock and a monotonic clock that started at an arbitrary other value.
const at=iso=>Date.parse(iso),mono=now=>now-at('2026-09-01T00:00:00Z')+12345;
const run=(s,command,now)=>applyCommand(s,command,{now,monotonic:mono(now),timeZone:zone});
const stats=(s,now)=>timeStats(s,{now,monotonic:mono(now),timeZone:zone});
const sum=task=>(task.intervals??[]).reduce((total,[,ms])=>total+ms,0);
const task=(s,id)=>s.tasks.find(item=>item.id===id);

test('V20 day starts at local midnight and the week on Monday',()=>{
  const sunday=at('2026-09-27T20:30:00Z');// 23:30 Sunday in Kyiv
  assert.equal(dayStart(sunday,zone),at('2026-09-26T21:00:00Z'));
  assert.equal(weekStart(sunday,zone),at('2026-09-20T21:00:00Z'));
  const monday=at('2026-09-27T21:30:00Z');// 00:30 Monday in Kyiv
  assert.equal(dayStart(monday,zone),at('2026-09-27T21:00:00Z'));
  assert.equal(weekStart(monday,zone),at('2026-09-27T21:00:00Z'));
  // Santiago skips from 00:00 to 01:00 on 6 September 2026: that day starts at 01:00.
  assert.equal(dayStart(at('2026-09-06T15:00:00Z'),'America/Santiago'),at('2026-09-06T04:00:00Z'));
});

test('V20 old data loads unchanged and its time is shown as before tracking',()=>{
  let s=run(createState(),{type:'create',id:'a',title:'Old'},at('2026-09-01T08:00:00Z'));
  const old=structuredClone(s);old.tasks[0].elapsedMs=5*H+123;// written by 0.2.0: no intervals
  assert.equal(validateState(old).valid,true);
  s=recoverState(old);
  assert.deepEqual(stats(s,at('2026-09-26T09:00:00Z')),{today:0,week:0,before:5*H+123,tasks:[]});
  s=run(s,{type:'start',id:'a'},at('2026-09-26T09:00:00Z'));
  s=run(s,{type:'pause',id:'a'},at('2026-09-26T09:40:00Z'));
  const result=stats(s,at('2026-09-26T10:00:00Z'));
  assert.equal(result.before,5*H+123);assert.equal(result.today,40*M);assert.equal(result.week,40*M);
  assert.equal(task(s,'a').elapsedMs,5*H+123+40*M);
});

test('V20 checkpoints extend one interval and intervals sum to the measured time',()=>{
  let s=run(createState(),{type:'create',id:'a',title:'A'},at('2026-09-26T08:00:00Z'));
  let now=at('2026-09-26T09:00:00Z');s=run(s,{type:'start',id:'a'},now);
  for(let i=0;i<240;i++){now+=15000;s=run(s,{type:'checkpoint'},now);}
  s=run(s,{type:'stop',id:'a'},now+7000);
  assert.equal(task(s,'a').intervals.length,1);
  assert.equal(sum(task(s,'a')),task(s,'a').elapsedMs);
  assert.equal(task(s,'a').elapsedMs,H+7000);
  // A separate run later in the day is a second interval.
  s=run(s,{type:'start',id:'a'},at('2026-09-26T12:00:00Z'));s=run(s,{type:'complete',id:'a'},at('2026-09-26T12:30:00Z'));
  assert.equal(task(s,'a').intervals.length,2);assert.equal(sum(task(s,'a')),task(s,'a').elapsedMs);
  assert.equal(validateState(s).valid,true);
});

test('V20 a run across midnight and the week boundary is split by day and week',()=>{
  let s=run(createState(),{type:'create',id:'a',title:'Night'},at('2026-09-27T10:00:00Z'));
  s=run(s,{type:'create',id:'b',title:'Weekend'},at('2026-09-27T10:00:00Z'));
  s=run(s,{type:'start',id:'b'},at('2026-09-27T10:00:00Z'));s=run(s,{type:'pause',id:'b'},at('2026-09-27T12:00:00Z'));// Sunday
  let now=at('2026-09-27T20:30:00Z');s=run(s,{type:'start',id:'a'},now);// Sunday 23:30
  let sunday=null;
  for(;now<at('2026-09-27T21:30:00Z');){now+=15000;s=run(s,{type:'checkpoint'},now);if(now===at('2026-09-27T20:59:00Z'))sunday=stats(s,now+30000);}
  s=run(s,{type:'suspend'},now);// Monday 00:30, before sleep
  const monday=stats(s,now);
  assert.equal(monday.today,30*M);assert.equal(monday.week,30*M);
  assert.deepEqual(monday.tasks.map(item=>[item.id,item.today,item.week]),[['a',30*M,30*M]]);
  // At 23:59:30 on Sunday the same run counted for Sunday, live between checkpoints.
  assert.equal(sunday.today,2*H+29*M+30000);assert.equal(sunday.week,2*H+29*M+30000);
  assert.equal(sum(task(s,'a'))+sum(task(s,'b')),task(s,'a').elapsedMs+task(s,'b').elapsedMs);
});

test('V20 the running timer counts live and tasks are ordered by today then week',()=>{
  let s=createState(),now=at('2026-09-21T08:00:00Z');// Monday
  for(const id of ['x','y','z'])s=run(s,{type:'create',id,title:id.toUpperCase()},now);
  s=run(s,{type:'start',id:'x'},now);s=run(s,{type:'pause',id:'x'},now+3*H);// Monday: 3 h on X
  now=at('2026-09-26T08:00:00Z');// Saturday
  s=run(s,{type:'start',id:'y'},now);s=run(s,{type:'stop',id:'y'},now+20*M);
  s=run(s,{type:'start',id:'z'},now+H);
  const result=stats(s,now+H+45*M);
  assert.deepEqual(result.tasks.map(item=>[item.id,item.today,item.week]),[['z',45*M,45*M],['y',20*M,20*M],['x',0,3*H]]);
  assert.equal(result.today,65*M);assert.equal(result.week,3*H+65*M);assert.equal(result.before,0);
  // Archived and deleted tasks keep their time for the week.
  s=run(s,{type:'archive',id:'x'},now+2*H);
  assert.equal(stats(s,now+2*H).week,3*H+20*M+H);
});

test('V20 damaged intervals are refused, not silently dropped',()=>{
  let s=run(createState(),{type:'create',id:'a',title:'A'},at('2026-09-26T08:00:00Z'));
  s=run(s,{type:'start',id:'a'},at('2026-09-26T09:00:00Z'));s=run(s,{type:'pause',id:'a'},at('2026-09-26T10:00:00Z'));
  for(const damage of [t=>{t.intervals='x';},t=>{t.intervals=[[1]];},t=>{t.intervals=[[-1,5]];},t=>{t.intervals=[[1,0]];},t=>{t.intervals[0][1]+=DAY;}]){
    const copy=structuredClone(s);damage(copy.tasks[0]);assert.equal(validateState(copy).valid,false);
  }
});
