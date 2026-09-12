// Domain defaults implement SPEC P1-P8 as provisional implementation choices.
export const DAY = 86400000;
export const DEFAULT_SETTINGS = Object.freeze({language:'ru',theme:'system',autoArchive:'all',archiveDays:30,completionSound:true,overdueSound:true,reducedMotion:false,autostart:false,pinned:false,listShortcut:'Ctrl+Alt+Space',quickShortcut:'Ctrl+Alt+N'});
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
function freeze(task,mono) { task.elapsedMs=elapsed(task,mono); task.timerAnchor=null; if(task.workState==='running') task.workState='paused'; }
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
  for(const e of events) { if(e.at>now) break; const t=e.task; if(e.kind==='purge') {state.tasks=state.tasks.filter(x=>x!==t);continue;} if(t.lifecycle!=='active') continue; if(e.kind==='archive') {freeze(t,mono);t.lifecycle='archive';} else {t.penalties[e.kind]=true;event(state,t,e.kind,e.at,e.kind==='first'?-2:-1);} }
}
function title(value) { if(typeof value!=='string' || !value.trim() || value.length>4000) fail('Invalid title'); return value.trim(); }
function deadline(value) { return value ? makeDeadline(value.date,value.time||'',value.timeZone||'UTC') : null; }
function settingsCheck(s) {
  if(!['ru','uk','en'].includes(s.language)||!['system','light','dark'].includes(s.theme)||!['all','dated','undated','off'].includes(s.autoArchive)||![1,7,30,90].includes(s.archiveDays)) fail('Invalid settings');
  for(const key of ['completionSound','overdueSound','autostart','pinned']) if(typeof s[key]!=='boolean') fail('Invalid settings');
  if(s.reducedMotion!==undefined&&typeof s.reducedMotion!=='boolean')fail('Invalid settings');
  for(const key of ['listShortcut','quickShortcut']) if(typeof s[key]!=='string'||!s[key].trim()||s[key].length>100) fail('Invalid shortcut');
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
      s.tasks.push({id:command.id,title:title(command.title),createdAt:now,lifecycle:'active',workState:'idle',elapsedMs:0,timerAnchor:null,due:deadline(command.due),completedAt:null,completedDayEnd:null,award:0,penalties:{first:false,week:false},archiveAnchor:now,deletedAt:null,undoRemaining:null}); break;
    }
    case 'edit': active();t.title=title(command.title);break;
    case 'deadline': active();t.due=deadline(command.due);break;
    case 'start': unfinished();for(const other of s.tasks)freeze(other,monotonic);t.workState='running';t.timerAnchor=monotonic;break;
    case 'pause': unfinished();freeze(t,monotonic);break;
    case 'stop': unfinished();freeze(t,monotonic);t.workState='idle';break;
    case 'work': unfinished();freeze(t,monotonic);t.workState='working';break;
    case 'complete': active();if(t.completedAt!==null)break;freeze(t,monotonic);t.workState='idle';t.completedAt=now;t.completedDayEnd=dayEnd(now,timeZone);t.award=t.due&&now>=t.due.at?2:5;event(s,t,'complete',now,t.award);break;
    case 'uncomplete': active();if(t.completedAt===null)break;event(s,t,'uncomplete',now,-t.award);t.award=0;t.completedAt=null;t.completedDayEnd=null;break;
    case 'archive': active();freeze(t,monotonic);t.lifecycle='archive';break;
    case 'delete': active();freeze(t,monotonic);t.lifecycle='pending';t.deletedAt=now;t.undoRemaining=5000;break;
    case 'undo': {const pending=command.id?t:s.tasks.filter(t=>t.lifecycle==='pending').sort((a,b)=>a.deletedAt-b.deletedAt).at(-1);if(!pending||pending.lifecycle!=='pending')fail('No pending deletion');pending.lifecycle='active';pending.deletedAt=null;pending.undoRemaining=null;break;}
    case 'advanceUndo': if(!Number.isFinite(command.delta)||command.delta<0)fail('Invalid delta');if(!command.paused)for(const p of s.tasks.filter(t=>t.lifecycle==='pending')) {p.undoRemaining=Math.max(0,p.undoRemaining-command.delta);if(p.undoRemaining===0){p.lifecycle='trash';p.undoRemaining=null;}}break;
    case 'finalizeDeletes': for(const p of s.tasks.filter(t=>t.lifecycle==='pending')) {p.lifecycle='trash';p.undoRemaining=null;}break;
    case 'trash': required();if(t.lifecycle!=='archive')fail('Only archived tasks can move to trash');freeze(t,monotonic);t.lifecycle='trash';t.deletedAt=now;t.undoRemaining=null;break;
    case 'purge': required();if(t.lifecycle!=='trash')fail('Only trash tasks can be deleted permanently');s.tasks=s.tasks.filter(task=>task!==t);break;
    case 'clearTrash': s.tasks=s.tasks.filter(task=>task.lifecycle!=='trash');break;
    case 'restore': required();if(!['archive','trash'].includes(t.lifecycle))fail('Not restorable');t.lifecycle='active';t.deletedAt=null;t.archiveAnchor=now;t.undoRemaining=null;if(t.completedAt!==null)t.completedDayEnd=dayEnd(now,timeZone);break;
    case 'settings': for(const key of Object.keys(command.patch))if(!(key in DEFAULT_SETTINGS))fail('Unknown setting');Object.assign(s.settings,command.patch);settingsCheck(s.settings);break;
    case 'suspend': for(const t of s.tasks)freeze(t,monotonic);break;
    case 'checkpoint': for(const t of s.tasks)if(t.workState==='running'){t.elapsedMs=elapsed(t,monotonic);t.timerAnchor=monotonic;}break;
    case 'tick': break;
    default: fail('Unknown command');
  }
  process(s,now,monotonic); return s;
}
export function groups(state,{now,timeZone='UTC'}) {
  const result=['late','today','upcoming','any','done'].map(key=>({key,tasks:[]}));
  for(const t of state.tasks.filter(t=>t.lifecycle==='active')) {const key=t.completedAt!==null?'done':!t.due?'any':now>=t.due.at?'late':t.due.date===dateKey(now,t.due.timeZone||timeZone)?'today':'upcoming';result.find(g=>g.key===key).tasks.push(t);}
  for(const g of result)g.tasks.sort((a,b)=>g.key==='done'?a.completedAt-b.completedAt||a.id.localeCompare(b.id):(a.due?.at??0)-(b.due?.at??0)||a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  return result.filter(g=>g.tasks.length);
}
export function validateState(s) {
  try {
    if(!s||s.schemaVersion!==1||!Array.isArray(s.tasks)||!Array.isArray(s.events)||!Number.isFinite(s.reputation))fail('Invalid database'); settingsCheck(s.settings);
    const ids=new Set();let running=0;
    for(const t of s.tasks) {if(typeof t.id!=='string'||!t.id||ids.has(t.id))fail('Invalid task id');ids.add(t.id);title(t.title);if(!['active','archive','pending','trash'].includes(t.lifecycle)||!['idle','running','paused','working'].includes(t.workState))fail('Invalid task state');for(const k of ['createdAt','archiveAnchor','elapsedMs'])if(!Number.isFinite(t[k])||t[k]<0)fail('Invalid task time');if(t.due){const d=deadline(t.due);if(d.date!==t.due.date||d.time!==t.due.time||d.timeZone!==t.due.timeZone||d.at!==t.due.at)fail('Invalid deadline');}if(!t.penalties||typeof t.penalties.first!=='boolean'||typeof t.penalties.week!=='boolean')fail('Invalid penalties');if(![0,2,5].includes(t.award))fail('Invalid award');if(t.completedAt!==null&&(!Number.isFinite(t.completedAt)||!Number.isFinite(t.completedDayEnd)||t.award===0))fail('Invalid completion');if(t.workState==='running'){running++;if(!Number.isFinite(t.timerAnchor)||t.lifecycle!=='active'||t.completedAt!==null)fail('Invalid timer');}else if(t.timerAnchor!==null)fail('Invalid timer');if(['pending','trash'].includes(t.lifecycle)&&!Number.isFinite(t.deletedAt))fail('Invalid deletion');if(t.lifecycle==='pending'&&(!Number.isFinite(t.undoRemaining)||t.undoRemaining<0||t.undoRemaining>5000))fail('Invalid undo');}
    if(running>1)fail('Multiple timers');let sum=0;const penalties=new Set();for(let i=0;i<s.events.length;i++){const e=s.events[i];if(e.id!==i+1||typeof e.taskId!=='string'||!Number.isFinite(e.at)||!({first:[-2],week:[-1],complete:[2,5],uncomplete:[-2,-5]}[e.kind]?.includes(e.delta)))fail('Invalid event');if(['first','week'].includes(e.kind)){const key=e.taskId+':'+e.kind;if(penalties.has(key))fail('Repeated penalty');penalties.add(key);}sum+=e.delta;}if(sum!==s.reputation)fail('Reputation ledger mismatch');for(const t of s.tasks){for(const k of ['first','week'])if(t.penalties[k]!==penalties.has(t.id+':'+k))fail('Penalty ledger mismatch');if(t.completedAt===null&&(t.award!==0||t.completedDayEnd!==null))fail('Invalid completion');}return {valid:true};
  } catch(error) {return {valid:false,error:error.message};}
}
export function recoverState(source) {const check=validateState(source);if(!check.valid)fail(check.error);const s=structuredClone(source);for(const t of s.tasks){if(t.workState==='running'){t.workState='paused';t.timerAnchor=null;}if(t.lifecycle==='pending'){t.lifecycle='trash';t.undoRemaining=null;}}return s;}
