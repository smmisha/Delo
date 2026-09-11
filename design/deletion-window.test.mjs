import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDeletions, countdown, UNDO_WINDOW } from './deletion-window.mjs';

test('the visible counter and expiry share the same five second window', () => {
  const entries = [{ remaining: UNDO_WINDOW }];
  assert.deepEqual(countdown(entries[0].remaining), {seconds:5, fraction:1});
  assert.deepEqual(advanceDeletions(entries, 1001), []);
  assert.equal(countdown(entries[0].remaining).seconds, 4);
  assert.equal(advanceDeletions(entries, 3998).length, 0);
  assert.equal(countdown(entries[0].remaining).seconds, 1);
  assert.equal(advanceDeletions(entries, 1).length, 1);
  assert.equal(entries.length, 0);
});
test('pausing freezes every deletion including after long inactivity', () => {
  const entries = [{remaining:2400}, {remaining:4900}];
  assert.deepEqual(advanceDeletions(entries, 60000, true), []);
  assert.deepEqual(entries.map(e => e.remaining), [2400,4900]);
  advanceDeletions(entries, 400);
  assert.deepEqual(entries.map(e => e.remaining), [2000,4500]);
});
test('multiple deletions expire independently and are emitted only once for the bin', () => {
  const entries = [{id:'a',remaining:100}, {id:'b',remaining:3000}];
  assert.deepEqual(advanceDeletions(entries, 150).map(e => e.id), ['a']);
  assert.equal(entries[0].remaining, 2850);
  assert.deepEqual(advanceDeletions(entries, 4000).map(e => e.id), ['b']);
  assert.deepEqual(advanceDeletions(entries, 4000), []);
});
