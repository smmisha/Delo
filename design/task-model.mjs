// Behaviour for the interactive sketch, not the production task database.
export function dateKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function offsetDate(days, from = new Date()) {
  const date = new Date(from); date.setDate(date.getDate() + days); return dateKey(date);
}
export function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number), date = new Date(y,m-1,d);
  return y >= 1900 && y <= 9999 && dateKey(date) === value;
}
export function createTask(id, title, due = '') {
  return { id, title, due, state: 'idle', elapsed: 0, started: null, stopped: false, award: 0 };
}
export function elapsed(task, now) { return task.elapsed + (task.state === 'running' ? Math.max(0, now - task.started) : 0); }
function freeze(task, now) { task.elapsed = elapsed(task, now); task.started = null; }
export function pause(task, now) {
  if (task.state !== 'running') return;
  freeze(task, now); task.state = 'paused';
}
export function start(task, tasks, now) {
  if (task.state === 'done') return;
  for (const other of tasks) if (other.state === 'running') pause(other, now);
  task.state = 'running'; task.started = now; task.stopped = false;
}
export function stop(task, now) {
  if (task.state === 'done') return;
  freeze(task, now); task.state = 'idle'; task.stopped = true;
}
export function workWithoutTimer(task, now) {
  if (task.state === 'done') return;
  freeze(task, now); task.state = 'working'; task.stopped = false;
}
export function toggleDone(task, now, today = dateKey()) {
  if (task.state === 'done') {
    const delta = -task.award; task.award = 0; task.state = 'idle'; return delta;
  }
  freeze(task, now); task.state = 'done'; task.award = task.due && task.due < today ? 2 : 5; return task.award;
}
export function groupFor(task, today = dateKey()) {
  if (task.state === 'done') return 'done';
  if (!task.due) return 'any';
  return task.due < today ? 'late' : task.due === today ? 'today' : 'upcoming';
}
export function formatElapsed(ms) {
  const s = Math.floor(ms / 1000), pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
