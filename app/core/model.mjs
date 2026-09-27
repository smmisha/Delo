// Domain defaults implement SPEC P1-P8 as provisional implementation choices.
export const DAY = 86400000;
export const DEFAULT_SETTINGS = Object.freeze({language:'ru',theme:'system',autoArchive:'all',archiveDays:30,completionSound:true,overdueSound:true,reducedMotion:false,autostart:false,pinned:false,listShortcut:'Ctrl+Alt+Space',quickShortcut:'Ctrl+Alt+N',idleMinutes:15,remindMinutes:15,checkUpdates:false});
export const IDLE_MINUTES=Object.freeze([0,5,15,30,60]);
export const REMIND_MINUTES=Object.freeze([0,5,15,30,60]);
export const idleMinutes=settings=>settings?.idleMinutes??15;
export function createState() { return {schemaVersion:1,tasks:[],reputation:0,events:[],settings:{...DEFAULT_SETTINGS}}; }
const fail = message => { throw new Error(message); };
const formatters=new Map();
function parts(at,zone) { if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));return Object.fromEntries(formatters.get(zone).formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,p.value])); }
export function dateKey(at,zone='UTC') { const p=parts(at,zone); return `${p.year}-${p.month}-${p.day}`; }
export function validDate(date) { if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false; const d=new Date(`${date}T00:00:00Z`); return Number(date.slice(0,4))>=1900 && Number.isFinite(+d) && d.toISOString().slice(0,10)===date; }
function instant(date,time,zone) {
  const target=Date.parse(`${date}T${time}:00Z`); let guess=target;
  for(let i=0;i<6;i++) { const p=parts(guess,zone); const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); const next=guess+target-represented; if(next===guess) break; guess=next; }
  const p=parts(guess,zone); if(`${p.year}-${p.month}-${p.day}`!==date || `${p.hour}:${p.minute}`!==time) fail('Invalid local time');
  // Repeated local times resolve to the earliest matching instant.
  for(let offset=1;offset<=180;offset++) { const earlier=guess-offset*60000, q=parts(earlier,zone); if(`${q.year}-${q.month}-${q.day}`===date && `${q.hour}:${q.minute}`===time) return earlier; }
  return guess;
}
export function makeDeadline(date,time='',timeZone='UTC') {
  if(!validDate(date) || (time!=='' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) fail('Invalid deadline');
  const effective=time ? date : new Date(Date.parse(`${date}T00:00:00Z`)+DAY).toISOString().slice(0,10);
  return {date,time,timeZone,at:instant(effective,time||'00:00',timeZone)};
}
const dayEnd=(now,zone)=>makeDeadline(dateKey(now,zone),'',zone).at;
export function elapsed(task,monotonic) { return task.elapsedMs+(task.workState==='running'?Math.max(0,monotonic-task.timerAnchor):0); }
export function formatElapsed(ms) { const seconds=Math.floor(ms/1000),pad=n=>String(n).padStart(2,'0'); return `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)}`; }
// F04. Each measured run is also kept as [wall-clock start, ms] in the optional `intervals`.
// The length is the monotonic measurement added to elapsedMs, so the intervals never sum to
// more than elapsedMs; the rest is time measured before tracking began (or by a version
// without it). Runs that continue each other, such as checkpoints, extend one interval.
function record(task,now,ms) {
  if(!(ms>0)) return; const start=Math.max(0,Math.round(now-ms)), list=task.intervals??=[], last=list.at(-1);
  if(last && Math.abs(last[0]+last[1]-start)<=1000) last[1]+=ms; else list.push([start,ms]);
}
const overlap=(list,from,to)=>list.reduce((sum,[start,ms])=>sum+Math.max(0,Math.min(start+ms,to)-Math.max(start,from)),0);
function cut(task,from,to) {
  let removed=0;const kept=[];
  for(const [start,ms] of task.intervals??[]) {
    const end=start+ms,part=Math.max(0,Math.min(end,to)-Math.max(start,from));
    if(!part) {kept.push([start,ms]);continue;}
    removed+=part;if(from>start)kept.push([start,from-start]);if(end>to)kept.push([to,end-to]);
  }
  if(task.intervals)task.intervals=kept;return removed;
}
function freeze(task,mono,now) { if(task.workState==='running') record(task,now,Math.max(0,mono-task.timerAnchor)); task.elapsedMs=elapsed(task,mono); task.timerAnchor=null; if(task.workState==='running') task.workState='paused'; }
function event(state,task,kind,at,delta) { state.reputation+=delta; state.events.push({id:state.events.length+1,taskId:task.id,kind,at,delta}); }
function archiveAt(task,settings) { if(task.completedAt!==null) return task.completedDayEnd; if(settings.autoArchive==='off' || settings.autoArchive==='dated'&&!task.due || settings.autoArchive==='undated'&&task.due) return Infinity; return Math.max(task.archiveAnchor+settings.archiveDays*DAY,task.due?.at??-Infinity); }
function process(state,now,mono) {
  const events=[];
  for(const task of state.tasks) {
    if(task.lifecycle==='trash') { if(task.deletedAt+30*DAY<=now) events.push({at:task.deletedAt+30*DAY,priority:2,task,kind:'purge'}); continue; }
    if(task.lifecycle!=='active') continue;
    if(task.completedAt===null && task.due) {
      if(!task.penalties.first) events.push({at:task.due.at,priority:0,task,kind:'first'});
      if(!task.penalties.week) events.push({at:task.due.at+7*DAY,priority:0,task,kind:'week'});
    }
    events.push({at:archiveAt(task,state.settings),priority:1,task,kind:'archive'});
  }
  events.sort((a,b)=>a.at-b.at||a.priority-b.priority||a.task.createdAt-b.task.createdAt||a.task.id.localeCompare(b.task.id));
  for(const e of events) { if(e.at>now) break; const t=e.task; if(e.kind==='purge') {state.tasks=state.tasks.filter(x=>x!==t);continue;} if(t.lifecycle!=='active') continue; if(e.kind==='archive') {freeze(t,mono,now);t.lifecycle='archive';} else {t.penalties[e.kind]=true;event(state,t,e.kind,e.at,e.kind==='first'?-2:-1);} }
}
function title(value) { if(typeof value!=='string' || !value.trim() || value.length>4000) fail('Invalid title'); return value.trim(); }
function deadline(value) { return value ? makeDeadline(value.date,value.time||'',value.timeZone||'UTC') : null; }
function settingsCheck(s) {
  if(!['ru','uk','en'].includes(s.language)||!['system','light','dark'].includes(s.theme)||!['all','dated','undated','off'].includes(s.autoArchive)||![1,7,30,90].includes(s.archiveDays)) fail('Invalid settings');
  for(const key of ['completionSound','overdueSound','autostart','pinned']) if(typeof s[key]!=='boolean') fail('Invalid settings');
  if(s.reducedMotion!==undefined&&typeof s.reducedMotion!=='boolean')fail('Invalid settings');
  // F03, П9. Optional so data from before 0.3.0 loads as is; 0 means never ask.
  if(s.idleMinutes!==undefined&&!IDLE_MINUTES.includes(s.idleMinutes))fail('Invalid settings');
  // T07, П12 and N13, S01: optional for the same reason; checking for updates stays off unless chosen.
  if(s.remindMinutes!==undefined&&!REMIND_MINUTES.includes(s.remindMinutes))fail('Invalid settings');
  if(s.checkUpdates!==undefined&&typeof s.checkUpdates!=='boolean')fail('Invalid settings');
  for(const key of ['listShortcut','quickShortcut']) if(typeof s[key]!=='string'||!s[key].trim()||s[key].length>100) fail('Invalid shortcut');
}
// T07. When to remind about a deadline: `minutes` before an exact time; for a date without a
// time, 09:00 of that day in the deadline's zone. Infinity when there is nothing to remind.
export const remindMinutes=settings=>settings?.remindMinutes??15;
export function reminderAt(due,minutes) {
  if(!due||!(minutes>0)) return Infinity;
  if(due.time) return due.at-minutes*60000;
  try { return makeDeadline(due.date,'09:00',due.timeZone).at; } catch { return due.at-15*3600000; }
}
// A deadline set when its reminder moment has already passed is not announced afterwards.
function armReminder(task,now,settings) { delete task.reminded; if(task.due&&now>=reminderAt(task.due,remindMinutes(settings))) task.reminded=task.due.at; }
export function dueReminders(state,{now}) {
  const minutes=remindMinutes(state.settings);
  return state.tasks.filter(t=>t.lifecycle==='active'&&t.completedAt===null&&t.due&&t.reminded!==t.due.at&&reminderAt(t.due,minutes)<=now&&now<t.due.at).sort((a,b)=>a.due.at-b.due.at||a.id.localeCompare(b.id));
}
// F05. The global shortcut pauses the running timer, or resumes the task in work whose timer
// ran last (the latest interval end; tasks without intervals by creation time).
export function timerToggle(state) {
  const running=state.tasks.find(t=>t.workState==='running');
  if(running) return {type:'pause',id:running.id};
  const lastRun=t=>{const last=(t.intervals??[]).at(-1);return last?last[0]+last[1]:t.createdAt;};
  const next=state.tasks.filter(t=>t.lifecycle==='active'&&t.completedAt===null&&['paused','working'].includes(t.workState)).sort((a,b)=>lastRun(b)-lastRun(a)||a.id.localeCompare(b.id))[0];
  return next?{type:'start',id:next.id}:null;
}
export function applyCommand(source,command,{now,monotonic,timeZone='UTC'}={}) {
  if(!Number.isFinite(now)||!Number.isFinite(monotonic)) fail('Explicit clocks required');
  const s=structuredClone(source); process(s,now,monotonic);
  const t=s.tasks.find(t=>t.id===command.id);
  const required=()=>{if(!t) fail('Unknown task');return t;};
  const active=()=>{required();if(t.lifecycle!=='active')fail('Task is not active');};
  const unfinished=()=>{active();if(t.completedAt!==null)fail('Task is completed');};
  switch(command.type) {
    case 'create': {
      if(typeof command.id!=='string'||!command.id||s.tasks.some(t=>t.id===command.id)) fail('Unique id required');
      s.tasks.push({id:command.id,title:title(command.title),createdAt:now,lifecycle:'active',workState:'idle',elapsedMs:0,timerAnchor:null,due:deadline(command.due),completedAt:null,completedDayEnd:null,award:0,penalties:{first:false,week:false},archiveAnchor:now,deletedAt:null,undoRemaining:null}); armReminder(s.tasks.at(-1),now,s.settings); break;
    }
    case 'edit': active();t.title=title(command.title);break;
    case 'deadline': active();t.due=deadline(command.due);armReminder(t,now,s.settings);break;
    case 'start': unfinished();for(const other of s.tasks)freeze(other,monotonic,now);t.workState='running';t.timerAnchor=monotonic;break;
    case 'pause': unfinished();freeze(t,monotonic,now);break;
    case 'stop': unfinished();freeze(t,monotonic,now);t.workState='idle';break;
    case 'work': unfinished();freeze(t,monotonic,now);t.workState='working';break;
    // F06. pinnedAt is optional: data without it loads as unpinned, and older versions keep it as is.
    case 'pin': unfinished();if(t.pinnedAt==null)t.pinnedAt=now;break;
    case 'unpin': required();delete t.pinnedAt;break;
    case 'complete': active();if(t.completedAt!==null)break;delete t.idle;freeze(t,monotonic,now);t.workState='idle';t.completedAt=now;t.completedDayEnd=dayEnd(now,timeZone);t.award=t.due&&now>=t.due.at?2:5;delete t.pinnedAt;event(s,t,'complete',now,t.award);break;
    case 'uncomplete': {
      active();if(t.completedAt===null)break;
      const last=s.events.findLast(e=>e.taskId===t.id&&(e.kind==='complete'||e.kind==='uncomplete'));
      if(last?.kind==='complete') event(s,t,'uncomplete',now,-t.award);
      t.award=0;t.completedAt=null;t.completedDayEnd=null;break;
    }
    case 'archive': active();delete t.idle;freeze(t,monotonic,now);t.lifecycle='archive';break;
    case 'delete': active();delete t.idle;freeze(t,monotonic,now);t.lifecycle='pending';t.deletedAt=now;t.undoRemaining=5000;break;
    case 'undo': {const pending=command.id?t:s.tasks.filter(t=>t.lifecycle==='pending').sort((a,b)=>a.deletedAt-b.deletedAt).at(-1);if(!pending||pending.lifecycle!=='pending')fail('No pending deletion');pending.lifecycle='active';pending.deletedAt=null;pending.undoRemaining=null;break;}
    case 'advanceUndo': if(!Number.isFinite(command.delta)||command.delta<0)fail('Invalid delta');if(!command.paused)for(const p of s.tasks.filter(t=>t.lifecycle==='pending')) {p.undoRemaining=Math.max(0,p.undoRemaining-command.delta);if(p.undoRemaining===0){p.lifecycle='trash';p.undoRemaining=null;}}break;
    case 'finalizeDeletes': for(const p of s.tasks.filter(t=>t.lifecycle==='pending')) {p.lifecycle='trash';p.undoRemaining=null;}break;
    case 'trash': required();if(t.lifecycle!=='archive')fail('Only archived tasks can move to trash');freeze(t,monotonic,now);t.lifecycle='trash';t.deletedAt=now;t.undoRemaining=null;break;
    case 'purge': required();if(t.lifecycle!=='trash')fail('Only trash tasks can be deleted permanently');s.tasks=s.tasks.filter(task=>task!==t);break;
    case 'clearTrash': s.tasks=s.tasks.filter(task=>task.lifecycle!=='trash');break;
    case 'deleteEvent': {
      if(!Number.isInteger(command.eventId)||command.eventId<1)fail('Invalid event id');
      const index=s.events.findIndex(event=>event.id===command.eventId&&event.taskId===command.taskId&&event.kind===command.kind&&event.at===command.at&&event.delta===command.delta);
      if(index<0)fail('Unknown event');
      const [removed]=s.events.splice(index,1);
      s.reputation-=removed.delta;
      s.events.forEach((event,index)=>{event.id=index+1;});
      break;
    }
    case 'restore': required();if(!['archive','trash'].includes(t.lifecycle))fail('Not restorable');t.lifecycle='active';t.deletedAt=null;t.archiveAnchor=now;t.undoRemaining=null;delete t.pinnedAt;if(t.completedAt!==null)t.completedDayEnd=dayEnd(now,timeZone);break;
    case 'settings': for(const key of Object.keys(command.patch))if(!(key in DEFAULT_SETTINGS))fail('Unknown setting');Object.assign(s.settings,command.patch);settingsCheck(s.settings);break;
    case 'suspend': for(const t of s.tasks)freeze(t,monotonic,now);break;
    case 'checkpoint': for(const t of s.tasks)if(t.workState==='running'){record(t,now,Math.max(0,monotonic-t.timerAnchor));t.elapsedMs=elapsed(t,monotonic);t.timerAnchor=monotonic;}break;
    // F03. The host reports a stretch without input [from,to] while this task's timer ran. The
    // part of it the timer counted becomes a question on the task; subtracting removes exactly
    // that part from elapsedMs and from the intervals, keeping is a no-op. Completion, archive
    // and deletion drop an open question.
    case 'idle': {
      unfinished();if(t.workState!=='running')fail('Timer is not running');
      const from=command.from,to=command.to;if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to>now+1000)fail('Invalid idle');
      record(t,now,Math.max(0,monotonic-t.timerAnchor));t.elapsedMs=elapsed(t,monotonic);t.timerAnchor=monotonic;
      const counted=overlap(t.intervals??[],from,to),threshold=idleMinutes(s.settings)*60000;
      if(threshold>0&&counted>=threshold)t.idle={from,to,ms:counted};
      break;
    }
    case 'idleSubtract': {
      active();if(!t.idle)fail('No idle question');
      if(t.workState==='running'){record(t,now,Math.max(0,monotonic-t.timerAnchor));t.elapsedMs=elapsed(t,monotonic);t.timerAnchor=monotonic;}
      const removed=cut(t,t.idle.from,t.idle.to);t.elapsedMs=Math.max(0,t.elapsedMs-removed);delete t.idle;break;
    }
    case 'idleKeep': active();delete t.idle;break;
    // T07. Marks the reminders the page has just shown, so each deadline is announced once.
    case 'reminded': {if(!Array.isArray(command.ids))fail('Invalid reminder');for(const id of command.ids){const task=s.tasks.find(x=>x.id===id);if(task?.due)task.reminded=task.due.at;}break;}
    case 'tick': break;
    default: fail('Unknown command');
  }
  process(s,now,monotonic); return s;
}
export function groups(state,{now,timeZone='UTC'}) {
  const result=['pinned','late','today','upcoming','any','done'].map(key=>({key,tasks:[]}));
  for(const t of state.tasks.filter(t=>t.lifecycle==='active')) {const key=t.completedAt!==null?'done':t.pinnedAt!=null?'pinned':!t.due?'any':now>=t.due.at?'late':t.due.date===dateKey(now,t.due.timeZone||timeZone)?'today':'upcoming';result.find(g=>g.key===key).tasks.push(t);}
  for(const g of result)g.tasks.sort((a,b)=>g.key==='done'?a.completedAt-b.completedAt||a.id.localeCompare(b.id):g.key==='pinned'?a.pinnedAt-b.pinnedAt||a.id.localeCompare(b.id):(a.due?.at??0)-(b.due?.at??0)||a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  return result.filter(g=>g.tasks.length);
}
export function validateState(s) {
  try {
    if(!s||s.schemaVersion!==1||!Array.isArray(s.tasks)||!Array.isArray(s.events)||!Number.isFinite(s.reputation))fail('Invalid database'); settingsCheck(s.settings);
    const ids=new Set();let running=0;
    for(const t of s.tasks) {if(typeof t.id!=='string'||!t.id||ids.has(t.id))fail('Invalid task id');ids.add(t.id);title(t.title);if(!['active','archive','pending','trash'].includes(t.lifecycle)||!['idle','running','paused','working'].includes(t.workState))fail('Invalid task state');for(const k of ['createdAt','archiveAnchor','elapsedMs'])if(!Number.isFinite(t[k])||t[k]<0)fail('Invalid task time');if(t.pinnedAt!=null&&(!Number.isFinite(t.pinnedAt)||t.pinnedAt<0))fail('Invalid task time');if(t.reminded!==undefined&&!Number.isFinite(t.reminded))fail('Invalid reminder');if(t.idle!==undefined&&(!t.idle||!Number.isFinite(t.idle.from)||!Number.isFinite(t.idle.to)||t.idle.to<=t.idle.from||!Number.isFinite(t.idle.ms)||t.idle.ms<=0))fail('Invalid idle');if(t.intervals!==undefined){if(!Array.isArray(t.intervals))fail('Invalid intervals');let tracked=0;for(const item of t.intervals){if(!Array.isArray(item)||item.length!==2||!Number.isFinite(item[0])||item[0]<0||!Number.isFinite(item[1])||item[1]<=0)fail('Invalid intervals');tracked+=item[1];}if(tracked>t.elapsedMs+1)fail('Intervals exceed elapsed time');}if(t.due){const d=deadline(t.due);if(d.date!==t.due.date||d.time!==t.due.time||d.timeZone!==t.due.timeZone||d.at!==t.due.at)fail('Invalid deadline');}if(!t.penalties||typeof t.penalties.first!=='boolean'||typeof t.penalties.week!=='boolean')fail('Invalid penalties');if(![0,2,5].includes(t.award))fail('Invalid award');if(t.completedAt!==null&&(!Number.isFinite(t.completedAt)||!Number.isFinite(t.completedDayEnd)||t.award===0))fail('Invalid completion');if(t.workState==='running'){running++;if(!Number.isFinite(t.timerAnchor)||t.lifecycle!=='active'||t.completedAt!==null)fail('Invalid timer');}else if(t.timerAnchor!==null)fail('Invalid timer');if(['pending','trash'].includes(t.lifecycle)&&!Number.isFinite(t.deletedAt))fail('Invalid deletion');if(t.lifecycle==='pending'&&(!Number.isFinite(t.undoRemaining)||t.undoRemaining<0||t.undoRemaining>5000))fail('Invalid undo');}
    if(running>1)fail('Multiple timers');let sum=0;const penalties=new Set();for(let i=0;i<s.events.length;i++){const e=s.events[i];if(e.id!==i+1||typeof e.taskId!=='string'||!Number.isFinite(e.at)||!({first:[-2],week:[-1],complete:[2,5],uncomplete:[-2,-5]}[e.kind]?.includes(e.delta)))fail('Invalid event');if(['first','week'].includes(e.kind)){const key=e.taskId+':'+e.kind;if(penalties.has(key))fail('Repeated penalty');penalties.add(key);}sum+=e.delta;}if(sum!==s.reputation)fail('Reputation ledger mismatch');for(const t of s.tasks){for(const k of ['first','week'])if(penalties.has(t.id+':'+k)&&!t.penalties[k])fail('Penalty ledger mismatch');if(t.completedAt===null&&(t.award!==0||t.completedDayEnd!==null))fail('Invalid completion');}return {valid:true};
  } catch(error) {return {valid:false,error:error.message};}
}
export function recoverState(source) {const check=validateState(source);if(!check.valid)fail(check.error);const s=structuredClone(source);for(const t of s.tasks){if(t.workState==='running'){t.workState='paused';t.timerAnchor=null;}if(t.lifecycle==='pending'){t.lifecycle='trash';t.undoRemaining=null;}}return s;}

// F04. Time per task today and this week (from Monday) in `timeZone`, including the run in
// progress. `before` is time measured before tracking began: it belongs to no day.
const shiftDate=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
// Where a day has no local midnight (a DST jump at 00:00), it starts at 01:00.
function startOfDate(date,zone) { try { return makeDeadline(date,'00:00',zone).at; } catch { return makeDeadline(date,'01:00',zone).at; } }
export function dayStart(now,zone='UTC') { return startOfDate(dateKey(now,zone),zone); }
export function weekStart(now,zone='UTC') { const date=dateKey(now,zone); return startOfDate(shiftDate(date,-((new Date(`${date}T00:00:00Z`).getUTCDay()+6)%7)),zone); }
export function timeStats(state,{now,monotonic,timeZone='UTC'}) {
  const today=dayStart(now,timeZone), week=weekStart(now,timeZone), result={today:0,week:0,before:0,tasks:[]};
  for(const task of state.tasks) {
    const runs=[...(task.intervals??[])];
    if(task.workState==='running') { const ms=Math.max(0,monotonic-task.timerAnchor); if(ms>0) runs.push([now-ms,ms]); }
    const overlap=from=>runs.reduce((sum,[start,ms])=>sum+Math.max(0,start+ms-Math.max(start,from)),0);
    const item={id:task.id,title:task.title,lifecycle:task.lifecycle,today:overlap(today),week:overlap(week)};
    result.before+=Math.max(0,task.elapsedMs-(task.intervals??[]).reduce((sum,[,ms])=>sum+ms,0));
    result.today+=item.today; result.week+=item.week; if(item.week>0) result.tasks.push(item);
  }
  result.tasks.sort((a,b)=>b.today-a.today||b.week-a.week||a.title.localeCompare(b.title));
  return result;
}
