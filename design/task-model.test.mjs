import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask, start, pause, stop, elapsed, toggleDone, groupFor, validDate, workWithoutTimer } from './task-model.mjs';
test('pause and stop freeze elapsed; restarting continues accumulated time', () => {
  const t=createTask('a','Task'); start(t,[t],1000); pause(t,5000);
  assert.equal(t.state,'paused'); assert.equal(elapsed(t,9000),4000);
  start(t,[t],10000); stop(t,13000); assert.equal(t.state,'idle'); assert.equal(t.elapsed,7000);
  stop(t,20000); assert.equal(t.elapsed,7000);
  start(t,[t],22000); assert.equal(elapsed(t,25000),10000);
});
test('starting another task pauses previous timer without losing time', () => {
  const a=createTask('a','A'), b=createTask('b','B'); start(a,[a,b],1000); start(b,[a,b],4000);
  assert.equal(a.state,'paused'); assert.equal(a.elapsed,3000); assert.equal(b.state,'running');
});
test('manual work uses amber state but does not add elapsed time', () => {
  const t=createTask('a','A'); workWithoutTimer(t,1000); assert.equal(t.state,'working'); assert.equal(elapsed(t,9000),0);
  stop(t,12000); assert.equal(t.elapsed,0); assert.equal(t.state,'idle');
});
test('completion freezes timer and reversing it reverses the actual award', () => {
  const t=createTask('a','A','2026-09-08'); start(t,[t],1000);
  assert.equal(toggleDone(t,4000,'2026-09-09'),2); assert.equal(t.elapsed,3000);
  t.due='2026-09-12'; assert.equal(toggleDone(t,9000,'2026-09-09'),-2); assert.equal(t.elapsed,3000);
  assert.equal(toggleDone(t,12000,'2026-09-09'),5);
});
test('deadline group independent of work state; invalid calendar dates rejected', () => {
  const t=createTask('a','A','2026-09-08'); t.state='running'; assert.equal(groupFor(t,'2026-09-09'),'late');
  t.due='2026-09-09';assert.equal(groupFor(t,'2026-09-09'),'today');
  t.due='2026-09-10';assert.equal(groupFor(t,'2026-09-09'),'upcoming');
  t.due='';assert.equal(groupFor(t,'2026-09-09'),'any');
  assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);assert.equal(validDate(''),true);
});
