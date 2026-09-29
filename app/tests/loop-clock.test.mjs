import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// The page's 200 ms loop decides when to refresh the seconds, the undo countdown, checkpoints
// and retries by comparing "now" with the time of the last run. "now" must come from
// performance.now(), which never jumps. mono() is re-derived from the host's clock at every
// command, and that clock does not count time the PC slept: after a sleep it steps back by
// the length of the sleep and the seconds froze until the difference caught up. The real
// behaviour is checked in a browser with a simulated sleep; this guards the choice of clock.
const source=readFileSync(new URL('../ui/app.mjs',import.meta.url),'utf8');
// A Windows checkout has CRLF line endings, so lines are split on either.
test('the 200 ms loop is paced by performance.now(), not by the host-derived mono()',()=>{
  const loop=source.split(/\r?\n/).find(line=>line.startsWith('setInterval(async()=>{')&&line.endsWith('},200);'));
  assert.ok(loop,'the loop is on one line ending in },200);');
  assert.ok(loop.startsWith('setInterval(async()=>{const now=performance.now(),'),'now comes from performance.now()');
  assert.equal(/\bnow=mono\(\)/.test(loop),false);
  assert.match(source,/lastUndo=performance\.now\(\),lastTick=0,lastCheckpoint=performance\.now\(\)/);
  assert.equal(/lastUndo=mono\(\)/.test(source),false);
});
