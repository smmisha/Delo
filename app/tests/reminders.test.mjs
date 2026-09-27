import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,applyCommand,validateState,dueReminders,reminderAt,timerToggle,makeDeadline} from '../core/model.mjs';
const zone='Europe/Kyiv',M=60000,H=60*M;
const at=iso=>Date.parse(iso),start=at('2026-09-26T05:00:00Z');// 08:00 in Kyiv
const run=(s,command,now=start,monotonic=now-start)=>applyCommand(s,command,{now,monotonic,timeZone:zone});
const due=(date,time='')=>({date,time,timeZone:zone});
const ids=(s,now)=>dueReminders(s,{now}).map(task=>task.id);

test('V22 an exact time is announced 15 minutes before, a date at 09:00 of that day',()=>{
  assert.equal(reminderAt(makeDeadline('2026-09-26','15:00',zone),15),at('2026-09-26T11:45:00Z'));
  assert.equal(reminderAt(makeDeadline('2026-09-27','',zone),15),at('2026-09-27T06:00:00Z'));
  assert.equal(reminderAt(makeDeadline('2026-09-27','',zone),0),Infinity);
  assert.equal(reminderAt(null,15),Infinity);
});

test('V22 each deadline is announced once, in its window, and again after it changes',()=>{
  let s=run(createState(),{type:'create',id:'call',title:'Позвонить',due:due('2026-09-26','15:00')});
  s=run(s,{type:'create',id:'pay',title:'Оплатить',due:due('2026-09-27')});
  s=run(s,{type:'create',id:'free',title:'Без срока'});
  assert.deepEqual(ids(s,at('2026-09-26T11:44:00Z')),[]);
  assert.deepEqual(ids(s,at('2026-09-26T11:45:00Z')),['call']);
  s=run(s,{type:'reminded',ids:['call']},at('2026-09-26T11:45:00Z'));
  assert.deepEqual(ids(s,at('2026-09-26T11:50:00Z')),[]);
  assert.deepEqual(ids(s,at('2026-09-26T12:00:00Z')),[],'after the deadline the overdue logic takes over');
  assert.deepEqual(ids(s,at('2026-09-27T06:00:00Z')),['pay']);
  s=run(s,{type:'deadline',id:'call',due:due('2026-09-28','10:00')},at('2026-09-26T13:00:00Z'));
  assert.deepEqual(ids(s,at('2026-09-28T06:45:00Z')),['call']);
  assert.equal(validateState(s).valid,true);
});

test('V22 no reminder for completed or archived tasks, or with reminders off',()=>{
  let s=run(createState(),{type:'create',id:'a',title:'A',due:due('2026-09-26','15:00')});
  s=run(s,{type:'create',id:'b',title:'B',due:due('2026-09-26','15:00')});
  s=run(s,{type:'create',id:'c',title:'C',due:due('2026-09-26','15:00')});
  s=run(s,{type:'complete',id:'a'});s=run(s,{type:'archive',id:'b'});
  assert.deepEqual(ids(s,at('2026-09-26T11:50:00Z')),['c']);
  s=run(s,{type:'settings',patch:{remindMinutes:0}});
  assert.deepEqual(ids(s,at('2026-09-26T11:50:00Z')),[]);
  s=run(s,{type:'settings',patch:{remindMinutes:60}});
  assert.deepEqual(ids(s,at('2026-09-26T11:00:00Z')),['c']);
  assert.throws(()=>run(s,{type:'settings',patch:{remindMinutes:10}}));
});

test('V22 a deadline set after its reminder moment is not announced late',()=>{
  // 08:00 now; "today" without a time would be reminded at 09:00, "in 10 minutes" at once.
  let s=run(createState(),{type:'create',id:'soon',title:'Скоро',due:due('2026-09-26','08:10')});
  s=run(s,{type:'create',id:'today',title:'Сегодня',due:due('2026-09-26')});
  assert.deepEqual(ids(s,start+M),[]);
  assert.deepEqual(ids(s,at('2026-09-26T06:00:00Z')),['today']);
  const old=structuredClone(s);delete old.settings.remindMinutes;delete old.tasks[1].reminded;
  assert.equal(validateState(old).valid,true);assert.deepEqual(ids(old,at('2026-09-26T06:00:00Z')),['today']);
});

test('V21 the timer shortcut pauses the running task and resumes the one that ran last',()=>{
  let s=createState();for(const id of ['a','b','c'])s=run(s,{type:'create',id,title:id},start);
  assert.equal(timerToggle(s),null);
  s=run(s,{type:'start',id:'a'},start);s=run(s,{type:'start',id:'b'},start+10*M);s=run(s,{type:'pause',id:'b'},start+20*M);
  s=run(s,{type:'work',id:'c'},start+21*M);
  assert.deepEqual(timerToggle(s),{type:'start',id:'b'});
  s=run(s,timerToggle(s),start+30*M);assert.equal(s.tasks[1].workState,'running');
  assert.deepEqual(timerToggle(s),{type:'pause',id:'b'});
  s=run(s,timerToggle(s),start+40*M);assert.equal(s.tasks[1].elapsedMs,20*M);
  s=run(s,{type:'complete',id:'b'},start+41*M);
  assert.deepEqual(timerToggle(s),{type:'start',id:'a'});
});
