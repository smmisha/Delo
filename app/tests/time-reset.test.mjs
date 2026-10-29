import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,applyCommand,elapsed,validateState,recoverState,timeStats,timerToggle,untimedPause} from '../core/model.mjs';
import {exportData,parseImport} from '../core/transfer.mjs';
const M=60000,H=60*M,T=Date.parse('2026-10-28T10:00:00Z');
const context=now=>({now,monotonic:now-T+12345,timeZone:'Europe/Kyiv'});
const run=(state,command,now=T)=>applyCommand(state,command,context(now));
const task=(state,id='a')=>state.tasks.find(t=>t.id===id);
function measured(){let s=run(createState(),{type:'create',id:'a',title:'Task A'});s=run(s,{type:'start',id:'a'});return run(s,{type:'pause',id:'a'},T+30*M);}

test('reset includes live time and pauses the timer without resurrecting its old interval',()=>{
 let s=run(createState(),{type:'create',id:'a',title:'A'});
 s=run(s,{type:'start',id:'a'});s=run(s,{type:'checkpoint'},T+M);
 assert.equal(elapsed(task(s),context(T+2*M).monotonic),2*M);
 s=run(s,{type:'resetTime',id:'a'},T+2*M);
 assert.equal(task(s).workState,'paused');assert.equal(task(s).elapsedMs,0);
 assert.equal(task(s).timerAnchor,null);assert.deepEqual(task(s).intervals,[]);
 s=run(s,{type:'checkpoint'},T+3*M);assert.equal(elapsed(task(s),context(T+4*M).monotonic),0);
 s=run(s,{type:'start',id:'a'},T+5*M);s=run(s,{type:'pause',id:'a'},T+6*M);
 assert.equal(task(s).elapsedMs,M);assert.equal(validateState(s).valid,true);
});

test('reset preserves idle, timed pause, untimed work, untimed pause and completion',()=>{
 for(const mode of ['idle','paused','working','untimed','completed']){
  let s=measured();
  if(mode==='idle')s=run(s,{type:'stop',id:'a'},T+31*M);
  if(mode==='working'||mode==='untimed'){s=run(s,{type:'work',id:'a'},T+31*M);if(mode==='untimed')s=run(s,{type:'pause',id:'a'},T+32*M);}
  if(mode==='completed')s=run(s,{type:'complete',id:'a'},T+31*M);
  const before=structuredClone(s),expected=task(s).workState;
  s=run(s,{type:'resetTime',id:'a'},T+33*M);
  assert.equal(task(s).workState,expected,mode);assert.equal(task(s).elapsedMs,0,mode);
  assert.deepEqual(s.events,before.events);assert.equal(s.reputation,before.reputation);
  for(const field of ['id','title','due','completedAt','award','pinnedAt','archiveAnchor','touchedAt'])assert.deepEqual(task(s)[field],task(before)[field],field);
  if(mode==='untimed'){
   assert.equal(untimedPause(task(s)),true);assert.deepEqual(timerToggle(s),{type:'work',id:'a'});
   assert.equal(untimedPause(task(recoverState(JSON.parse(JSON.stringify(s))))),true);
  }
  assert.equal(validateState(s).valid,true,mode);
 }
});

test('reset keeps a legacy untimed pause resumable without starting a timer',()=>{
 let s=measured();s=run(s,{type:'work',id:'a'},T+31*M);s=run(s,{type:'pause',id:'a'},T+32*M);
 delete task(s).untimedState;assert.equal(untimedPause(task(s)),true);
 s=run(s,{type:'resetTime',id:'a'},T+33*M);
 assert.equal(untimedPause(task(s)),true);s=run(s,timerToggle(s),T+34*M);
 assert.equal(task(s).workState,'working');assert.equal(elapsed(task(s),context(T+H).monotonic),0);
});

test('reset removes day, week and legacy totals only for the selected task',()=>{
 let s=measured();task(s).elapsedMs+=2*H;
 s=run(s,{type:'create',id:'b',title:'B'},T+H);
 s=run(s,{type:'start',id:'b'},T+H);s=run(s,{type:'pause',id:'b'},T+H+10*M);
 const b=structuredClone(task(s,'b')),now=T+2*H,before=timeStats(s,context(now));
 assert.equal(before.before,2*H);
 s=run(s,{type:'resetTime',id:'a'},now);
 const after=timeStats(s,context(now));assert.equal(after.today,10*M);assert.equal(after.week,10*M);assert.equal(after.before,0);
 assert.deepEqual(task(s,'b'),b);assert.equal(after.tasks.some(t=>t.id==='a'),false);
});

test('reset accepts old cumulative-only data and is idempotent after resetting',()=>{
 const s=measured();task(s).elapsedMs=30*H;delete task(s).intervals;
 const first=run(s,{type:'resetTime',id:'a'},T+H),second=run(first,{type:'resetTime',id:'a'},T+H);
 assert.deepEqual(first,second);assert.equal(timeStats(second,context(T+H)).before,0);assert.equal(validateState(second).valid,true);
});

test('reset clears the old idle question and does not pause another task',()=>{
 let s=measured();task(s).idle={from:T,to:T+20*M,ms:20*M};
 s=run(s,{type:'create',id:'b',title:'B'},T+H);s=run(s,{type:'start',id:'b'},T+H);
 const b=structuredClone(task(s,'b'));s=run(s,{type:'resetTime',id:'a'},T+H+M);
 assert.equal(task(s).idle,undefined);assert.deepEqual(task(s,'b'),b);
 assert.throws(()=>run(s,{type:'idleSubtract',id:'a'},T+H+M),/No idle question/);
});

test('reset refuses missing, archived, pending or trashed tasks without changing the source',()=>{
 for(const lifecycle of ['archive','pending','trash']){
  const s=measured();task(s).lifecycle=lifecycle;task(s).deletedAt=T+30*M;
  if(lifecycle==='pending')task(s).undoRemaining=5000;
  const before=structuredClone(s);assert.throws(()=>run(s,{type:'resetTime',id:'a'},T+H),/not active/);assert.deepEqual(s,before);
 }
 assert.throws(()=>run(measured(),{type:'resetTime',id:'missing'},T+H),/Unknown task/);
});

test('reset removes a run crossing local midnight and the Monday boundary',()=>{
 const start=Date.parse('2026-11-01T21:30:00Z'),end=start+H;
 let s=run(createState(),{type:'create',id:'a',title:'Night'});
 s=run(s,{type:'start',id:'a'},start);s=run(s,{type:'pause',id:'a'},end);
 assert.equal(timeStats(s,context(end)).today,30*M);assert.equal(timeStats(s,context(end)).week,30*M);
 s=run(s,{type:'resetTime',id:'a'},end+M);
 assert.equal(timeStats(s,context(end+M)).today,0);assert.equal(timeStats(s,context(end+M)).week,0);
 assert.equal(task(s).elapsedMs,0);
});

test('export/import keeps zero time and the untimed pause mode',()=>{
 let s=measured();s=run(s,{type:'work',id:'a'},T+31*M);s=run(s,{type:'pause',id:'a'},T+32*M);s=run(s,{type:'resetTime',id:'a'},T+33*M);
 const restored=parseImport(exportData(s,{now:T+34*M}),createState()).state;
 assert.equal(task(restored).elapsedMs,0);assert.deepEqual(task(restored).intervals,[]);
 assert.equal(untimedPause(task(restored)),true);assert.deepEqual(timerToggle(restored),{type:'work',id:'a'});
});
