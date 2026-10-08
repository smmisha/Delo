import {stateFromLoad} from './state-loader.mjs';
import {saveSettings} from './settings-transaction.mjs';
import {createState,applyCommand,validateState,recoverState,makeDeadline,groups,elapsed,formatElapsed,dateKey,timeStats,idleMinutes,dueReminders,timerToggle} from '../core/model.mjs';
import {createIdleWatch} from '../core/idle.mjs';
import {parseDueText} from '../core/due-text.mjs';
import {searchTerms,matchesSearch} from '../core/search.mjs';
import {exportData,exportName,parseImport,summarize} from '../core/transfer.mjs';
import {HostBridge} from './bridge.mjs';
import {translator,localeFor} from './i18n.mjs';
import {notificationFor} from './notification-policy.mjs';
import {installGroupFade} from './group-fade.mjs';
import {VoiceInput} from './voice.mjs';
import {createDraft} from './draft.mjs';
const $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
const refreshGroupFade=installGroupFade($('#task-scroll'));
const host=new HostBridge();
const quick=new URLSearchParams(location.search).get('view')==='quick';
let clockOffset=0;
const mono=()=>clockOffset+performance.now();
function syncClock(result){if(Number.isFinite(result.monotonicMs))clockOffset=result.monotonicMs-performance.now();}
function assertState(value){const result=validateState(value);if(!result.valid)throw new Error(result.error);}
const context=()=>({now:Date.now(),monotonic:mono(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
let state=null,revision=0,busy=false,ready=false,native={},latestExternal=null;
let resyncPending=false,resyncing=false,lastResync=0,silentError=false;
let t=translator('ru'),locale='ru-RU',editorId=null,editorZone=null,collectionType='archive';
let menuTrigger=null,menuId=null,lastTheme=null,retryAction=null;
const dialogFocus=new WeakMap();
let idleSupported=true,lastIdle=0;const idleWatch=createIdleWatch(()=>idleMinutes(state?.settings)*60000||Infinity);
let undoHover=false,nativeVisible=true,lastUndo=performance.now(),lastTick=0,lastCheckpoint=performance.now();
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
document.body.classList.toggle('quick',quick);
function text(node,value){node.textContent=value;return node;}
function element(tag,className,value){const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)text(node,value);return node;}
const tooltipLayer=element('div','tooltip-layer');
tooltipLayer.id='tooltip-layer';
tooltipLayer.setAttribute('role','tooltip');
tooltipLayer.setAttribute('aria-hidden','true');
// Sheets open with showModal() and live in the top layer, which paints over everything in
// body. A manual popover joins that layer and, shown after the sheet, stacks above it.
tooltipLayer.popover='manual';
document.body.append(tooltipLayer);
function icon(name){const node=document.createElementNS('http://www.w3.org/2000/svg','svg');node.setAttribute('aria-hidden','true');const use=document.createElementNS(node.namespaceURI,'use');use.setAttribute('href',`#i-${name}`);node.append(use);return node;}
function button(className,label,handler,iconName){const node=element('button',className);node.type='button';node.setAttribute('aria-label',label);if(iconName)node.dataset.tooltip=label;if(iconName)node.append(icon(iconName));else text(node,label);if(handler)node.addEventListener('click',handler);return node;}
function report(error,action=null,target=$('#error')){retryAction=action;const damaged=/dataCorrupt|invalidState/.test(String(error?.message||error));$('#restore-backup').hidden=!damaged;const key=damaged?'dataCorrupt':/hotkey|Repeated modifier/i.test(String(error?.message||error))?'hotkeyError':['startupBlocked','nativeRollbackError','noHost','conflict','invalidDate','nativeError'].find(k=>String(error?.message||error).includes(k))||'saveError';if(target===$('#error')){text($('#error-text'),t(key));$('#retry').hidden=!action;target.hidden=false;}else{text(target,t(key));target.hidden=false;}}
function clearError(){ $('#error').hidden=true;$('#restore-backup').hidden=true;retryAction=null;silentError=false; }
function announce(value){text($('#status'),value);}
function setDisabled(node,value){if(node.disabled!==value)node.disabled=value;}
function setBusy(value){busy=value;const hasDraft=!!$('#task-input').value.trim();$('#add-task').classList.toggle('has-draft',hasDraft);setDisabled($('#add-task'),!ready||busy||!hasDraft);setDisabled($('#editor-save'),busy);setDisabled($('#settings-form .save'),busy);$('#widget').setAttribute('aria-busy',String(value));}
// Collapsed groups live only in the UI layer: persisting them would mean touching the
// stored schema, which carries its own version and tests. localStorage is per-window
// and may be unavailable, so every access is guarded and a failure just means the
// groups reopen next launch.
const collapsedGroups=new Set((()=>{try{return JSON.parse(localStorage.getItem('delo.collapsedGroups'))||[];}catch{return [];}})());
function persistCollapsed(){try{localStorage.setItem('delo.collapsedGroups',JSON.stringify([...collapsedGroups]));}catch{}}
function toggleGroup(key,section,toggle){const next=!section.classList.contains('collapsed');section.classList.toggle('collapsed',next);toggle.setAttribute('aria-expanded',String(!next));if(next)collapsedGroups.add(key);else collapsedGroups.delete(key);persistCollapsed();}
function localize(){t=translator(state?.settings.language);locale=localeFor(state?.settings.language);document.documentElement.lang=state?.settings.language||'ru';$$('[data-text]').forEach(node=>text(node,t(node.dataset.text)));$$('[data-label]').forEach(node=>{const label=t(node.dataset.label);node.setAttribute('aria-label',label);node.removeAttribute('title');if(node.tagName==='BUTTON'&&!node.textContent.trim())node.dataset.tooltip=label;else delete node.dataset.tooltip;});$$('[data-placeholder]').forEach(node=>node.placeholder=t(node.dataset.placeholder));applyTheme();renderDueHint();if(native.storeManagedUpdates)renderUpdate();}
function applyTheme(){const theme=state?.settings.theme||'system',dark=theme==='dark'||(theme==='system'&&systemTheme.matches);document.body.classList.toggle('dark',dark);document.body.classList.toggle('reduced',!!state?.settings.reducedMotion);if(dark!==lastTheme){lastTheme=dark;host.window('theme',{dark}).catch(()=>{});}}
systemTheme.addEventListener('change',applyTheme);
function dateText(task){if(!task.due)return t('dueNone');const due=task.due;let value=new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${due.date}T12:00:00Z`));if(due.time)value+=` · ${due.time}`;if(due.timeZone!==context().timeZone)value+=` · ${due.timeZone}`;return value;}
function animate(node,frames,duration=220){if(!document.body.classList.contains('reduced')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)node.animate(frames,{duration,easing:'cubic-bezier(.2,.8,.2,1)'});}
// Own tone, not MessageBeep: the stock Windows alert belongs to the OS, not to this
// widget, and it reads as an error even on completion. Two short sine notes rising for
// a finished task, falling for an overdue one.
let audioContext;
function tone(steps){
  try{
    audioContext??=new (globalThis.AudioContext||globalThis.webkitAudioContext)();
    audioContext.resume().catch(()=>{});
    const start=audioContext.currentTime;
    steps.forEach(([frequency,delay],index)=>{
      const osc=audioContext.createOscillator(),gain=audioContext.createGain();
      osc.type='sine';osc.frequency.value=frequency;
      const at=start+delay;
      gain.gain.setValueAtTime(0,at);
      gain.gain.linearRampToValueAtTime(index?.028:.035,at+.015);
      gain.gain.exponentialRampToValueAtTime(.001,at+.27);
      osc.connect(gain);gain.connect(audioContext.destination);
      osc.start(at);osc.stop(at+.3);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
    });
  }catch{}
}
function play(kind){
  if(!state?.settings[kind==='complete'?'completionSound':'overdueSound'])return;
  tone(kind==='complete'?[[660,0],[880,.07]]:[[520,0],[392,.09]]);
}
// Presenting: the host has released the windows to screen capture and switched the glass off,
// so the interface supplies its own matte material (see body.demo in the stylesheet).
const setDemo=on=>document.body.classList.toggle('demo',!!on);
host.addEventListener('demo',event=>setDemo(event.detail?.on));
async function load({startup=false}={}){const result=await host.request('load');setDemo(result.demoMode);syncClock(result);state=stateFromLoad(result);revision=result.revision??0;/* The host's answer is the newest state; anything that arrived before it is older. */latestExternal=null;native=result.native??native;ready=true;localize();render();if(startup&&!quick){const recovered=recoverState(state);if(JSON.stringify(recovered)!==JSON.stringify(state))await commitState(recovered);await mutate({type:'tick'},{silent:true});}setBusy(false);if(native.hotkeyError&&!quick)report(Error(native.hotkeyError));return state;}
async function commitState(candidate){const sentRevision=revision;const result=await host.request('save',{state:candidate,revision:sentRevision});state=candidate;revision=result?.revision??sentRevision+1;if(latestExternal&&latestExternal.revision>revision){state=latestExternal.state;revision=latestExternal.revision;}latestExternal=null;render();return true;}
// The page stops waiting for a reply after 15 s, but a host thread that was held up still
// handles the request afterwards: a save the page counted as failed can land, and the page's
// revision is then stale. Only the host knows its state, so after a timeout or a refused
// revision the page reloads it. Until a reload succeeds nothing can be saved; the page keeps
// trying by itself (see the interval below) instead of staying stuck.
async function resync(){try{await load();resyncPending=false;return true;}catch{resyncPending=true;ready=false;return false;}}
async function transaction(commands,options={}){const outcome=await attemptTransaction(commands,options);return outcome==='again'?await attemptTransaction(commands,{...options,again:true})===true:outcome;}
async function attemptTransaction(commands,{silent=false,errorTarget=null,notifyOverdue=false,again=false}={}){if(busy||!ready)return false;/* A no-op tick must not briefly disable every action once per second. */if(commands.length===1&&commands[0].type==='tick'&&JSON.stringify(applyCommand(state,commands[0],context()))===JSON.stringify(state))return true;setBusy(true);const before=state;let candidate=null;const succeeded=()=>{if(!silent){clearError();announce(t('saved'));}else if(silentError)clearError();const notification=notificationFor(before,state,commands,{notifyOverdue});if(notification)play(notification);return true;};try{syncClock(await host.request('clock'));candidate=state;for(const command of commands)candidate=applyCommand(candidate,command,context());if(JSON.stringify(candidate)===JSON.stringify(state))return true;await commitState(candidate);return succeeded();}catch(error){const message=String(error?.message||error);let shown=error;if(message.includes('conflict')||message==='timeout'){if(!await resync())shown=Error('saveError');/* The save the page stopped waiting for landed after all. */else if(candidate&&JSON.stringify(state)===JSON.stringify(candidate))return succeeded();/* The commands are applied once more to the fresh state, without troubling the user: background work is simply recomputed, and a user's action (say, a task added in the quick window while a slow write from the list was still landing) keeps its intent. Only a second refusal is shown. */else if(!again)return 'again';}report(shown,()=>transaction(commands,{silent,errorTarget,notifyOverdue}),errorTarget||$('#error'));silentError=silent;return false;}finally{setBusy(false);if(latestExternal&&latestExternal.revision>revision){state=latestExternal.state;revision=latestExternal.revision;localize();render();}latestExternal=null;}}
const mutate=(command,options)=>transaction([command],options);
// П15. While the pointer is over the list, rows of the group without a deadline keep their places,
// so a task that goes into work does not slip out from under the cursor. It moves up once the
// pointer leaves the list or the window hides. New rows take their place by the model's order.
// П15. While the pointer is over the list, or a task menu is open, rows of the group without a deadline
// keep their places: a task going into work does not slip out from under the pointer or the menu. Once
// both are over, the model's order is shown (releaseOrder). orderHeld records that a render was held back,
// so closing a menu redraws the list only when something changed meanwhile.
let pointerOverList=false,orderHeld=false;
const holdingOrder=()=>pointerOverList||menuTrigger!==null;
function heldOrder(group){if(!holdingOrder()||group.key!=='any')return group.tasks;orderHeld=true;const index=new Map($$('.task-group[data-group="any"] .task[data-task]').map((node,i)=>[node.dataset.task,i]));const known=group.tasks.filter(task=>index.has(task.id)).sort((a,b)=>index.get(a.id)-index.get(b.id));let next=0;return group.tasks.map(task=>index.has(task.id)?known[next++]:task);}
function releaseOrder(){if(holdingOrder()||!orderHeld)return;orderHeld=false;render();}
function render(){if(!state)return;if(tipNode&&!tipNode.isConnected)closeTooltip();const active=$(':focus');const focusedTask=active?.closest('[data-task]')?.dataset.task;const focusedAction=active?.dataset.action;const previous=new Map($$('.task[data-task]').map(node=>[node.dataset.task,node.getBoundingClientRect().top]));const scroll=$('#task-scroll').scrollTop;localize();text($('#today'),new Intl.DateTimeFormat(locale,{weekday:'long',day:'numeric',month:'long'}).format(new Date()));text($('#score'),String(state.reputation));const pinned=native.pinned??state.settings.pinned;$('#pin').setAttribute('aria-pressed',String(pinned));const pinLabel=t(pinned?'unpin':'pin');$('#pin').dataset.tooltip=pinLabel;$('#pin').removeAttribute('title');$('#pin').setAttribute('aria-label',pinLabel);if(!quick){const fragment=document.createDocumentFragment();for(const group of groups(state,context())){if(!group.tasks.length)continue;const section=element('section','task-group');section.dataset.group=group.key;const collapsed=collapsedGroups.has(group.key);if(collapsed)section.classList.add('collapsed');const heading=element('h2',`${group.key}-label`);const toggle=element('button','group-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed));toggle.append(icon('chevron'),element('span','group-name',t(group.key)),element('span','',String(group.tasks.length)));toggle.addEventListener('click',()=>toggleGroup(group.key,section,toggle));heading.append(toggle);section.append(heading);const rows=element('div','task-group-rows');for(const task of heldOrder(group))rows.append(taskRow(task,group.key));section.append(rows);fragment.append(section);}if(!fragment.childNodes.length)fragment.append(element('p','empty',t('empty')));$('#task-scroll').replaceChildren(fragment);$('#task-scroll').scrollTop=scroll;refreshGroupFade();for(const node of $$('.task[data-task]')){const old=previous.get(node.dataset.task);if(old===undefined)animate(node,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}]);else{const delta=Math.max(-60,Math.min(60,old-node.getBoundingClientRect().top));if(Math.abs(delta)>1)animate(node,[{transform:`translateY(${delta}px)`},{transform:'none'}],260);}}if(focusedTask&&focusedAction){const replacement=$$('.task[data-task]').find(n=>n.dataset.task===focusedTask)?.querySelector(`[data-action="${focusedAction}"]`);replacement?.focus({preventScroll:true});}renderUndo();if($('#collection').open)renderCollection();if($('#time-sheet').open)renderTime();if($('#history').open)renderHistory();}keepMenuBound();setBusy(busy);}
function keepMenuBound(){if(!menuTrigger||menuTrigger.isConnected)return;const row=rowMore(menuId);if(row){menuTrigger=row;row.setAttribute('aria-expanded','true');return;}$('#task-menu').hidePopover();menuTrigger=null;menuId=null;}
function taskRow(task,key){const late=key==='late'||key==='pinned'&&task.completedAt===null&&task.due&&Date.now()>=task.due.at;const row=element('article',`task ${late?'late ':''}${task.completedAt!==null?'done ':''}${['running','paused','working'].includes(task.workState)?'in-work':''}`);row.dataset.task=task.id;const completed=task.completedAt!==null;const check=button('complete',t(completed?'uncomplete':'complete'),()=>mutate({type:completed?'uncomplete':'complete',id:task.id}));check.dataset.action='complete';check.setAttribute('aria-pressed',String(completed));const circle=element('span','circle');circle.append(icon('check'));check.replaceChildren(circle);const copy=element('div','task-copy');const title=button('task-title',task.title,()=>openEditor(task));title.dataset.action='edit';const due=button('deadline',completed?(task.due?`${t('completed')} · ${dateText(task)}`:t('completed')):dateText(task),()=>openEditor(task,true));due.dataset.action='date';// An undated task sits under a heading that already reads "no due date", so the row
// repeating it line after line is noise. The date is still reachable from the row's
// own menu. A completed row keeps the line for the deadline it was closed against;
// with no deadline there is nothing to add, and "Done · No date" under a heading that
// already says "Done today" repeated the same emptiness twice.
copy.append(title);if(task.due||completed)copy.append(due);const actions=element('div','task-actions');const timer=button('timer',t(task.workState==='running'?'pause':'start'),()=>mutate({type:task.workState==='running'?'pause':'start',id:task.id}),task.workState==='running'?'pause':'play');timer.dataset.action='timer';timer.disabled=completed;timer.setAttribute('aria-pressed',String(task.workState==='running'));const more=button('task-more',t('actions'),event=>openMenu(task,event.currentTarget),'more');more.dataset.action='more';more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded',String(menuId===task.id));actions.append(timer,more);row.append(check,copy,actions);if(task.elapsedMs>0||task.workState!=='idle'){const strip=element('div',`work-strip${task.idle?' idle-question':''}`);strip.append(element('span','work-status',task.idle?fill('idleFor',{time:duration(task.idle.ms)}):t(completed?'completed':task.workState)),element('span','elapsed',formatElapsed(elapsed(task,mono()))));if(task.idle){/* F03: the question stays in the task's own strip (variant A); one press answers it. */const subtract=button('idle-answer idle-subtract',t('idleSubtract'),()=>mutate({type:'idleSubtract',id:task.id}));subtract.dataset.action='idleSubtract';const keep=button('idle-answer',t('idleKeep'),()=>mutate({type:'idleKeep',id:task.id}));keep.dataset.action='idleKeep';strip.append(subtract,keep);}else if(!completed&&task.workState!=='idle'){const stop=button('stop-work',t('stop'),()=>mutate({type:'stop',id:task.id}),'stop');stop.dataset.action='stop';strip.append(stop);}row.append(strip);}return row;}
function updateTimes(){for(const row of $$('.task[data-task]')){const task=state.tasks.find(task=>task.id===row.dataset.task);const node=row.querySelector('.elapsed');if(node&&task)text(node,formatElapsed(elapsed(task,mono())));}if($('#time-sheet').open&&state.tasks.some(task=>task.workState==='running'))renderTime();}
function pendingTasks(){return state?.tasks.filter(task=>task.lifecycle==='pending').sort((a,b)=>a.deletedAt-b.deletedAt)||[];}
function undoPaused(){return undoHover||$('#undo-bar').contains(document.activeElement)||document.hidden||!nativeVisible;}
function renderUndo(){const tasks=pendingTasks(),task=tasks.at(-1);$('#undo-bar').hidden=!task;if(!task)return;text($('#undo-text'),task.title);text($('#undo-hint'),`${t(undoPaused()?'undoPaused':'undoHint')}${tasks.length>1?` · +${tasks.length-1} ${t('moreDeleted')}`:''}`);const remaining=Math.max(0,task.undoRemaining);text($('#undo-seconds'),undoPaused()?'Ⅱ':String(Math.max(1,Math.ceil(remaining/1000))));$('#undo-arc').style.strokeDashoffset=String(100-remaining/5000*100);}
function openDialog(dialog){closeMenu();if(dialog.open)return;dialogFocus.set(dialog,document.activeElement);dialog.showModal();}
function closeDialog(dialog){dialog.close();const target=dialogFocus.get(dialog);dialogFocus.delete(dialog);if(target?.isConnected&&(!target.closest('dialog')||target.closest('dialog').open))target.focus({preventScroll:true});}
$$('[data-close]').forEach(node=>node.addEventListener('click',()=>closeDialog(node.closest('dialog'))));$$('dialog:not(#confirmation)').forEach(dialog=>dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog(dialog);}));
let confirmationResolve=null;
function settleConfirmation(value){const resolve=confirmationResolve;confirmationResolve=null;const dialog=$('#confirmation');if(dialog.open)closeDialog(dialog);$('#confirmation').classList.remove('calm');$('#confirmation-title').dataset.text='confirmAction';text($('#confirmation-title'),t('confirmAction'));$('#confirmation-cancel').dataset.text='cancel';text($('#confirmation-cancel'),t('cancel'));resolve?.(value);}
// Packaged builds: before Windows asks whether to drop the yellow capture border, say why the widget reads the screen.
async function offerCaptureIntro(){if(quick)return;const reply=await host.window('captureIntro');if(!reply?.needed)return;const accepted=await askConfirmation('captureIntro','captureIntroContinue',null,{title:'captureIntroTitle',cancel:'captureIntroLater'});await host.window('captureIntro',accepted?{accept:true}:{later:true});}
function askConfirmation(messageKey,acceptKey,message=null,{title='confirmAction',cancel='cancel'}={}){if(confirmationResolve)settleConfirmation(false);/* Title and cancel label follow the language through data-text, which localize() re-reads on every render. */$('#confirmation').classList.toggle('calm',title!=='confirmAction');$('#confirmation-title').dataset.text=title;text($('#confirmation-title'),t(title));$('#confirmation-cancel').dataset.text=cancel;text($('#confirmation-cancel'),t(cancel));text($('#confirmation-message'),message??t(messageKey));text($('#confirmation-accept'),t(acceptKey));openDialog($('#confirmation'));queueMicrotask(()=>$('#confirmation-cancel').focus());return new Promise(resolve=>{confirmationResolve=resolve;});}
$('#confirmation-cancel').addEventListener('click',()=>settleConfirmation(false));$('#confirmation-close').addEventListener('click',()=>settleConfirmation(false));$('#confirmation-accept').addEventListener('click',()=>settleConfirmation(true));$('#confirmation').addEventListener('cancel',event=>{event.preventDefault();settleConfirmation(false);});
function openEditor(task=null,dateFocus=false){editorId=task?.id??null;editorZone=task?.due?.timeZone??context().timeZone;text($('#editor-title'),t(task?'edit':'newTask'));const typed=task?null:entryDue();$('#editor-input').value=task?.title??typed?.title??$('#task-input').value;$('#due-input').value=task?.due?.date??typed?.date??'';$('#time-input').value=task?.due?.time??typed?.time??'';$('#editor-error').hidden=true;updateDateControls();openDialog($('#editor'));(dateFocus?$('#due-input'):$('#editor-input')).focus();grow($('#editor-input'));}
function updateDateControls(){if(!$('#due-input').value)$('#time-input').value='';text($('#zone-hint'),`${t('deadlineZone')}: ${editorZone||context().timeZone}`);const selected=$('#due-input').value;$$('[data-days]').forEach(button=>button.setAttribute('aria-pressed',String(selected===dateAfter(Number(button.dataset.days)))));$('#clear-date').setAttribute('aria-pressed',String(!selected));}
function dateAfter(days){const now=new Date();now.setDate(now.getDate()+days);return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
$$('[data-days]').forEach(node=>node.addEventListener('click',()=>{$('#due-input').value=dateAfter(Number(node.dataset.days));editorZone=context().timeZone;updateDateControls();}));$('#clear-date').addEventListener('click',()=>{$('#due-input').value='';updateDateControls();});$('#due-input').addEventListener('input',updateDateControls);
$('#editor-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const title=$('#editor-input').value.trim();if(!title)return;let due=null;try{if(!$('#due-input').checkValidity()||!$('#time-input').checkValidity()||($('#time-input').value&&!$('#due-input').value))throw Error();due=$('#due-input').value?makeDeadline($('#due-input').value,$('#time-input').value,editorZone):null;}catch{report(Error('invalidDate'),null,$('#editor-error'));return;}const commands=editorId?[{type:'edit',id:editorId,title},{type:'deadline',id:editorId,due}]:[{type:'create',id:crypto.randomUUID(),title,due}];if(await transaction(commands,{errorTarget:$('#editor-error')})){if(!editorId){$('#task-input').value='';grow($('#task-input'));}closeDialog($('#editor'));}});
function grow(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,input.id==='editor-input'?180:quick?125:92)}px`;}
// Both entry fields keep what is typed as a draft (see draft.mjs); the host files them per window.
const draft=createDraft(text=>host.window('draft',{text}));
async function restoreDraft(){const input=$('#task-input');if(input.value)return;const reply=await host.window('draft');if(reply?.text&&!input.value){/* A hand-edited file can hold more than the field accepts. */const kept=input.maxLength>0?reply.text.slice(0,input.maxLength):reply.text;input.value=kept;draft.known(reply.text);grow(input);setBusy(busy);renderDueHint();}}
for(const input of [$('#task-input'),$('#editor-input')]){input.addEventListener('input',()=>{grow(input);setBusy(busy);if(input.id==='task-input')draft.change(input.value);});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!busy)input.closest('form').requestSubmit();}});}
function shortcutFromEvent(event){
  const legacy=Number(event.keyCode||event.which),code=event.code||(legacy>=65&&legacy<=90?`Key${String.fromCharCode(legacy)}`:legacy>=48&&legacy<=57?`Digit${String.fromCharCode(legacy)}`:legacy===32?'Space':'');
  const key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):code==='Space'?'Space':'';
  const modifiers=[event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',event.metaKey&&'Win'].filter(Boolean);
  // Shift may join a combination but cannot carry one: a global Shift+letter would
  // swallow that capital letter in every other application.
  const anchored=event.ctrlKey||event.altKey||event.metaKey;
  return key&&anchored?[...modifiers,key].join('+'):'';
}
function syncShortcutRecording(){if(!quick)host.window('recordShortcuts',{enabled:document.hasFocus()&&document.activeElement?.matches('.shortcut-recorder')&&$('#settings').open}).catch(error=>report(error,null,$('#settings-error')));}
window.addEventListener('focus',syncShortcutRecording);window.addEventListener('blur',syncShortcutRecording);
$('#settings').addEventListener('close',syncShortcutRecording);
for(const input of $$('.shortcut-recorder')){
  // Entering the field used to select its text, which reads as an accidental selection
  // rather than "waiting for keys" — there was no way to tell whether the field was armed.
  // Now the combination is wiped the moment the field takes focus: an empty field with a
  // prompt is unambiguous, and leaving without pressing anything puts the old one back.
  let recorded=null;
  // Arming releases the host's own global shortcuts so the next keypress reaches the
  // field. It must not clear the value: on a click, pointerdown fires before the other
  // field's blur, and blur is what saves — an already-emptied neighbour was sent as a
  // blank shortcut, failed validation and rolled the whole patch back.
  const armRecording=()=>{input.classList.add('recording');queueMicrotask(syncShortcutRecording);};
  const beginRecording=()=>{
    if(recorded===null){
      recorded=input.value;
      input.value='';
      input.placeholder=t('shortcutPrompt');
    }
    armRecording();
  };
  input.addEventListener('pointerdown',armRecording);
  input.addEventListener('focus',beginRecording);
  input.addEventListener('blur',()=>{
    input.classList.remove('recording');
    input.placeholder=input.dataset.optional!==undefined?t('shortcutOff'):'';
    if(!input.value&&recorded!==null)input.value=recorded;
    recorded=null;
    queueMicrotask(syncShortcutRecording);
  });
  input.addEventListener('keydown',event=>{
    if(event.key==='Tab')return;
    event.preventDefault();event.stopPropagation();beginRecording();
    // F05: the timer shortcut may be off; Backspace or Delete empties it for good.
    if(input.dataset.optional!==undefined&&(event.key==='Backspace'||event.key==='Delete')){input.value='';recorded='';announce(t('shortcutOff'));return;}
    if(event.key==='Escape'){input.blur();return;}
    const shortcut=shortcutFromEvent(event);
    if(shortcut){input.value=shortcut;input.setCustomValidity('');announce(shortcut);}
  });
}
async function submitEntry(){if(busy||!ready||voiceInput.active)return;const input=$('#task-input'),title=input.value.trim();if(!title)return;const original=input.value,typed=entryDue();const success=await mutate({type:'create',id:crypto.randomUUID(),title:typed?.title??title,due:typed?.due??null});if(success){if(input.value===original){input.value='';dueDismissed=null;draft.change('');draft.flush();}renderDueHint();voiceInput.clearError();grow(input);setBusy(false);if(quick)await host.window('quickDone').catch(error=>report(error));else input.focus();}}
// T08: a date at the end of the draft becomes the deadline. It is shown above the field
// while typing and one click keeps it as text; that choice holds until the tail changes.
let dueDismissed=null;
const dueKey=result=>`${result.date}|${result.time}|${$('#task-input').value.slice(result.start).trim().toLowerCase()}`;
function entryDue(){if(voiceInput.active||voiceInput.phase==='error')return null;const result=parseDueText($('#task-input').value,context());return result&&dueKey(result)!==dueDismissed?result:null;}
function dueLabel(result){const today=dateKey(Date.now(),context().timeZone),days=Math.round((Date.parse(`${result.date}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/864e5);const day=days===0?t('today'):days===1?t('tomorrow'):new Intl.DateTimeFormat(locale,{weekday:days>1&&days<7?'short':undefined,day:'numeric',month:'short',year:result.date.slice(0,4)===today.slice(0,4)?undefined:'numeric',timeZone:'UTC'}).format(new Date(`${result.date}T12:00:00Z`));return `${t('dueHint')}: ${days<=1?day.toLocaleLowerCase(locale):day}${result.time?`, ${result.time}`:''}`;}
function renderDueHint(){const result=entryDue(),hint=$('#due-hint');if(result)text($('#due-hint-text'),dueLabel(result));if(hint.hidden!==!result)hint.hidden=!result;$('#entry').classList.toggle('due-active',!!result);}
$('#task-input').addEventListener('input',renderDueHint);
$('#due-hint-clear').addEventListener('click',()=>{const result=entryDue();if(result)dueDismissed=dueKey(result);renderDueHint();$('#task-input').focus();});
$('#entry').addEventListener('submit',event=>{event.preventDefault();submitEntry();});$('#new-with-date').addEventListener('click',()=>openEditor());
let voiceTicker=0;
const voiceInput=new VoiceInput({host,input:$('#task-input'),language:()=>state?.settings.language||'ru',onChange:renderVoice,onText:()=>{grow($('#task-input'));setBusy(busy);renderDueHint();draft.change($('#task-input').value);}});
$('#task-input').addEventListener('input',()=>voiceInput.clearError());
function renderVoiceTimer(){const seconds=voiceInput.recordingSeconds();text($('#voice-timer'),`0:${String(seconds).padStart(2,'0')} / 1:00`);}
function renderVoice(){
  const phase=voiceInput.phase,active=voiceInput.active,failed=phase==='error',recording=phase==='recording',mic=$('#voice-input');
  const key=recording?'voiceRecording':phase==='starting'?'voiceStarting':voiceInput.limitReached?'voiceLimit':'voiceTranscribing';
  const errorKey=['voiceMissing','voiceBusy','voiceMic','voiceNoSpeech','voiceTimeout','voiceTooLong'].includes(voiceInput.error)?voiceInput.error:'voiceFailed';
  const message=failed?t(errorKey):active?t(key):'';
  $('#entry').classList.toggle('voice-active',active);$('#entry').classList.toggle('voice-error',failed);$('#entry').classList.toggle('voice-recording',recording);
  mic.dataset.label=recording?'voiceStop':'voice';mic.setAttribute('aria-label',t(recording?'voiceStop':'voice'));mic.dataset.tooltip=t(recording?'voiceStop':'voice');
  mic.setAttribute('aria-pressed',String(recording));mic.disabled=active&&!recording;
  mic.querySelector('use').setAttribute('href',recording?'#i-stop':'#i-mic');
  $('#voice-cancel').hidden=!(active||failed);$('#voice-status').hidden=!(active||failed);text($('#voice-message'),message);$('#voice-timer').hidden=!recording;
  if(recording){renderVoiceTimer();if(!voiceTicker)voiceTicker=setInterval(renderVoiceTimer,250);}else if(voiceTicker){clearInterval(voiceTicker);voiceTicker=0;}
  renderDueHint();setBusy(busy);
  if(phase==='idle'&&nativeVisible&&document.hasFocus())$('#task-input').focus();
}
$('#voice-input').removeAttribute('aria-disabled');
$('#voice-input').addEventListener('click',()=>{if(!ready||busy)return;if(voiceInput.active)voiceInput.stop();else voiceInput.start();});
$('#voice-cancel').addEventListener('click',()=>voiceInput.cancel());
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(voiceInput.active||voiceInput.phase==='error')){event.preventDefault();event.stopImmediatePropagation();voiceInput.cancel();}},true);
host.addEventListener('visibility',event=>{if(!event.detail.visible)voiceInput.cancel();});
host.addEventListener('suspend',()=>voiceInput.cancel());
function closeMenu(focus=false){if(!menuTrigger)return;$('#task-menu').hidePopover();const id=menuId;menuTrigger=null;menuId=null;releaseOrder();const trigger=rowMore(id);if(trigger){trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}}
// The task's own "more" control in the list, which a render may have replaced.
function rowMore(id){return $$('.task[data-task]').find(node=>node.dataset.task===id)?.querySelector('.task-more')??null;}
function openMenu(task,clicked){if(menuTrigger===clicked){closeMenu(true);return;}closeMenu();const trigger=clicked.isConnected?clicked:rowMore(task.id);if(!trigger)return;menuTrigger=trigger;menuId=task.id;trigger.setAttribute('aria-expanded','true');$('#task-menu [data-action=work]').disabled=task.completedAt!==null;const pin=$('#menu-pin'),pinned=task.pinnedAt!=null;pin.dataset.action=pinned?'unpin':'pin';/* A pinned task offers the same pin crossed out. */pin.querySelector('use').setAttribute('href',pinned?'#i-unpin':'#i-pin');pin.querySelector('span').dataset.text=pinned?'unpinTask':'pinTask';text(pin.querySelector('span'),t(pin.querySelector('span').dataset.text));pin.disabled=task.completedAt!==null&&!pinned;const menu=$('#task-menu');menu.showPopover();const rect=trigger.getBoundingClientRect(),bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.right-bounds.width,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+4,innerHeight-bounds.height-8))}px`;menu.querySelector('button:not(:disabled)').focus();}
$('#task-menu').addEventListener('click',async event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;const task=state.tasks.find(item=>item.id===menuId);closeMenu();if(!task)return;if(action==='edit'||action==='date'){openEditor(task,action==='date');return;}const row=$$('.task[data-task]').find(node=>node.dataset.task===task.id);if(action==='archive'&&row)animate(row,[{opacity:1},{opacity:.2,transform:'translateX(14px)'}],180);if(await mutate({type:action,id:task.id}))$('#task-input').focus();});
$('#task-menu').addEventListener('keydown',event=>{const items=$$('#task-menu button:not(:disabled)'),index=items.indexOf(document.activeElement);let target;if(event.key==='ArrowDown')target=(index+1)%items.length;if(event.key==='ArrowUp')target=(index-1+items.length)%items.length;if(event.key==='Home')target=0;if(event.key==='End')target=items.length-1;if(target!==undefined){event.preventDefault();items[target].focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);}if(event.key==='Tab')closeMenu();});
document.addEventListener('pointerdown',event=>{if(menuTrigger&&!event.target.closest('#task-menu')&&!event.target.closest('.task-more'))closeMenu();});document.addEventListener('scroll',event=>{if(menuTrigger&&!$('#task-menu').contains(event.target))closeMenu();},true);window.addEventListener('resize',()=>closeMenu());
$('#undo-delete').addEventListener('click',()=>{const task=pendingTasks().at(-1);if(task)mutate({type:'undo',id:task.id});});$('#undo-bar').addEventListener('pointerenter',()=>{undoHover=true;renderUndo();});$('#undo-bar').addEventListener('pointerleave',()=>{undoHover=false;renderUndo();});$('#undo-bar').addEventListener('focusin',renderUndo);$('#undo-bar').addEventListener('focusout',()=>queueMicrotask(renderUndo));
$('#pin').addEventListener('click',async()=>{try{const pinned=!(native.pinned??state.settings.pinned);await host.window('pin',{pinned});native.pinned=pinned;await mutate({type:'settings',patch:{pinned}});}catch(error){report(error);}});
$('#drag-handle').addEventListener('pointerdown',event=>{if(event.button===0&&!event.target.closest('button'))host.window('drag').catch(error=>report(error));});
// The whole quick chrome drags, not four thin strips: with the capsule inset down to 8px
// the strips are too thin to aim at, and the strips now only mark the surface visually.
$('#widget').addEventListener('pointerdown',event=>{if(!quick||event.button!==0)return;if(event.target.closest('.inline-entry,button,textarea,input,select'))return;event.preventDefault();host.window('drag').catch(error=>report(error));});
// WebView2 owns the client hit test, so visible resize targets must forward the gesture.
// Quick capture keeps its compact height and exposes horizontal sizing only.
const resizeEdges=quick?['left','right']:['left','right','top','top-left','top-right','bottom','bottom-left','bottom-right'];
for(const edge of resizeEdges){
  const grip=element('div',`resize-grip resize-${edge}`);grip.setAttribute('aria-hidden','true');
  grip.addEventListener('pointerdown',event=>{if(event.button===0){event.preventDefault();event.stopPropagation();host.window('resize',{edge:{left:1,right:2,top:3,'top-left':4,'top-right':5,bottom:6,'bottom-left':7,'bottom-right':8}[edge]}).catch(error=>report(error));}});
  $('#widget').append(grip);
}
function fillSettingsForm(){const form=$('#settings-form');for(const control of form.elements){if(!control.name)continue;const value=state.settings[control.name];if(control.type==='checkbox')control.checked=!!value;else control.value=String(value??'');}form.elements.idleMinutes.value=String(idleMinutes(state.settings));form.elements.remindMinutes.value=String(state.settings.remindMinutes??15);form.elements.checkUpdates.checked=!!state.settings.checkUpdates;form.elements.timerShortcut.value=native.timerKey??'';form.elements.timerShortcut.placeholder=t('shortcutOff');renderUpdate();if(native.timerKeyError){text($('#settings-error'),t('hotkeyError'));$('#settings-error').hidden=false;}form.elements.autostart.checked=native.autostart??state.settings.autostart;form.elements.listShortcut.value=native.hotkeys?.list??state.settings.listShortcut;form.elements.quickShortcut.value=native.hotkeys?.quick??state.settings.quickShortcut;syncArchiveDays();}
async function openSettings(){if(native.storeManagedUpdates){try{native={...native,...await host.window('startupState')};}catch(error){report(error);return;}}fillSettingsForm();$('#settings-error').hidden=true;dataStatus('');openDialog($('#settings'));}
// The retention selector only means anything while auto-archive runs. Leaving it live
// with the mode off offered a setting that changed nothing.
function syncArchiveDays(){const form=$('#settings-form'),off=form.elements.autoArchive.value==='off';setDisabled(form.elements.archiveDays,off);form.elements.archiveDays.closest('label').classList.toggle('inactive',off);}
$('#settings-form').elements.autoArchive.addEventListener('change',syncArchiveDays);
// Settings apply as they are changed, the way a settings panel should: nothing is held
// hostage by a button, and closing the sheet can no longer discard what was typed. The
// risky three — autostart and the two global shortcuts — go through the same transaction
// as before, so a refused registry write or a taken hotkey rolls the whole patch back and
// reports next to the control instead of failing later at submit time.
let settingsPending=false;
async function applySettings({close=false}={}){
  // Toggling two controls quickly used to lose the second one: the first save was
  // still in flight, the guard returned, and the form went on showing a value that
  // never reached storage. Remember that another pass is owed instead of dropping
  // it — one trailing pass re-reads the whole form, so nothing needs queueing.
  if(busy){settingsPending=true;return false;}
  const form=$('#settings-form'),patch={};
  const timerInput=form.elements.timerShortcut;
  if(timerInput.value!==(native.timerKey??'')&&!(document.activeElement===timerInput)){try{await host.window('timerHotkey',{key:timerInput.value});native={...native,timerKey:timerInput.value};delete native.timerKeyError;}catch(error){timerInput.value=native.timerKey??'';report(error,null,$('#settings-error'));}}
  const updatesWere=!!state.settings.checkUpdates;
  for(const control of form.elements){
    if(!control.name||control.name==='timerShortcut')continue;
    let value=control.type==='checkbox'?control.checked:['archiveDays','idleMinutes','remindMinutes'].includes(control.name)?Number(control.value):control.value;
    // A recorder sits empty from the moment it is armed until a combination is pressed.
    // Sending that blank would fail validation and take the whole patch down with it,
    // including the shortcut the user had just finished setting in the other field.
    if(value===''&&control.classList.contains('shortcut-recorder'))
      value=(control.name==='listShortcut'?native.hotkeys?.list:native.hotkeys?.quick)??state.settings[control.name];
    patch[control.name]=value;
  }
  const previous={...state.settings,autostart:native.autostart??state.settings.autostart,listShortcut:native.hotkeys?.list??state.settings.listShortcut,quickShortcut:native.hotkeys?.quick??state.settings.quickShortcut};
  setBusy(true);
  let ok=false;
  try{
    applyCommand(state,{type:'settings',patch},context());
    await saveSettings(host,previous,patch,async()=>{
      setBusy(false);
      try{return await mutate({type:'settings',patch},{errorTarget:$('#settings-error')});}
      finally{setBusy(true);}
    });
    native.autostart=patch.autostart;clearError();$('#settings-error').hidden=true;ok=true;
    if(close)closeDialog($('#settings'));
  }catch(error){
    report(error,null,$('#settings-error'));
    // A rejected patch never took effect, so the controls must not keep showing it.
    fillSettingsForm();
  }
  finally{
    setBusy(false);
    if(latestExternal&&latestExternal.revision>revision){state=latestExternal.state;revision=latestExternal.revision;render();}
    latestExternal=null;
    if(settingsPending){settingsPending=false;setTimeout(()=>applySettings(),0);}
  }
  if(ok&&!!state.settings.checkUpdates!==updatesWere)checkUpdates(true);
  return ok;
}
function settingsChanged(event){
  const control=event.target;
  if(!control?.name)return;
  // A recorder is still mid-combination while it has focus; it commits when it is left.
  if(control.classList.contains('shortcut-recorder')&&document.activeElement===control)return;
  syncArchiveDays();
  applySettings();
}
$('#settings-form').addEventListener('change',settingsChanged);
$$('.shortcut-recorder').forEach(node=>node.addEventListener('blur',()=>{if($('#settings').open)applySettings();}));
// N12: export writes the whole state to a file the user picks; import reads one back, shows
// what it holds, and replaces the data only after confirmation. The host copies the current
// data file before writing (keepCopy) and names the copy in its reply.
const fill=(key,values)=>t(key).replace(/\{(\w+)\}/g,(match,name)=>values[name]??match);
function dataStatus(message){const node=$('#data-status');text(node,message);node.hidden=!message;}
async function exportFile(){
  if(!state)return;const name=exportName(),body=exportData(state);dataStatus('');$('#settings-error').hidden=true;
  try{
    if(typeof showSaveFilePicker==='function'){try{const handle=await showSaveFilePicker({suggestedName:name,types:[{description:'Delo',accept:{'application/json':['.json']}}]});const writable=await handle.createWritable();await writable.write(body);await writable.close();dataStatus(fill('exported',{name:handle.name}));return;}catch(error){if(error?.name==='AbortError')return;}}
    const url=URL.createObjectURL(new Blob([body],{type:'application/json'})),link=element('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);dataStatus(fill('exported',{name}));
  }catch{text($('#settings-error'),t('exportError'));$('#settings-error').hidden=false;}
}
async function importFile(file){
  dataStatus('');$('#settings-error').hidden=true;if(!file||!state)return;
  let parsed;try{if(file.size>16*1024*1024)throw Error('importTooLarge');parsed=parseImport(await file.text(),state);}catch(error){const key=['importTooLarge','importUnsupported'].includes(error.message)?error.message:'importInvalid';text($('#settings-error'),t(key));$('#settings-error').hidden=false;return;}
  const current=summarize(state),count=n=>fill('tasksCount',{n});
  if(!await askConfirmation('importConfirm','importAccept',fill('importConfirm',{current:count(current.tasks),file:count(parsed.summary.tasks),score:parsed.summary.reputation})))return;
  if(busy||!ready)return;setBusy(true);
  try{syncClock(await host.request('clock'));const result=await host.request('save',{state:parsed.state,revision,keepCopy:true});state=parsed.state;revision=result?.revision??revision+1;latestExternal=null;render();fillSettingsForm();dataStatus(result?.copy?fill('imported',{name:result.copy}):t('importedFresh'));announce(t('saved'));}
  catch(error){report(error,null,$('#settings-error'));if(/conflict|timeout/.test(String(error?.message)))await resync();}
  finally{setBusy(false);}
}
// N13: the host asks GitHub at most once a day and otherwise returns its last answer, so the
// page may ask on start and every hour. Turning the setting off makes the host forget it.
let updateInfo=null,lastUpdateAsk=0;
function renderUpdate(){const store=!!native.storeManagedUpdates;$('#settings-form').elements.checkUpdates.closest('label').hidden=store;const startup=$('#startup-status');startup.hidden=!native.startupBlocked;const autostart=$('#settings-form').elements.autostart;autostart.disabled=!!native.startupBlocked;const node=$('#update-status'),on=store||!!state?.settings.checkUpdates&&!!updateInfo?.latest;node.hidden=!on;if(!on)return;if(store){text($('#update-text'),t('storeUpdates'));text($('#open-release'),t('openStore'));$('#open-release').hidden=false;return;}text($('#open-release'),t('openRelease'));const version=String(updateInfo.newer?updateInfo.latest:updateInfo.current).replace(/^v/i,'');text($('#update-text'),fill(updateInfo.newer?'updateAvailable':'updateCurrent',{version}));$('#open-release').hidden=!updateInfo.newer;}
async function checkUpdates(force=false){if(quick||!state)return;if(native.storeManagedUpdates){renderUpdate();return;}const enabled=!!state.settings.checkUpdates;if(!force&&(!enabled||Date.now()-lastUpdateAsk<3600000))return;lastUpdateAsk=Date.now();try{const result=await host.window('updates',{enabled});updateInfo=enabled?result:null;}catch{/* Offline or refused: nothing to show, nothing breaks (V26). */}renderUpdate();}
$('#open-release').addEventListener('click',()=>host.window('openRelease').catch(()=>{}));
$('#open-privacy').addEventListener('click',()=>host.window('privacy').catch(error=>report(error)));
// T07: reminders are marked in the data first, then shown, so each deadline is announced once
// even with two windows; several at the same moment become one notification.
function reminderText(list){const at=task=>task.due.time?fill('reminderAt',{time:task.due.time}):t('today').toLocaleLowerCase(locale);if(list.length===1)return {title:t('reminderTitle'),body:`${list[0].title} — ${at(list[0])}`};return {title:t('reminderTitle'),body:fill('reminderMany',{n:list.length,titles:list.map(task=>task.title).join(', ')})};}
async function remind(){if(quick||busy||!ready||!state)return;const list=dueReminders(state,{now:Date.now()});if(!list.length)return;const message=reminderText(list);if(await mutate({type:'reminded',ids:list.map(task=>task.id)},{silent:true}))host.window('notify',{...message,kind:'reminder'}).catch(()=>{});}
// F05: the host's timer shortcut arrives here even while the widget is hidden.
host.addEventListener('timerToggle',async()=>{if(quick||!state||!ready)return;const command=timerToggle(state);if(!command)return;const task=state.tasks.find(item=>item.id===command.id);if(await mutate(command,{silent:true})){announce(fill(command.type==='pause'?'timerPaused':'timerResumed',{title:task.title}));if(state.settings.completionSound)tone(command.type==='pause'?[[587,0],[440,.08]]:[[440,0],[587,.08]]);}});
$('#export-data').addEventListener('click',exportFile);
$('#import-data').addEventListener('click',()=>{const input=$('#import-file');input.value='';input.click();});
$('#import-file').addEventListener('change',event=>{event.stopPropagation();importFile(event.target.files?.[0]);});
$('#settings-form').addEventListener('submit',async event=>{
  event.preventDefault();
  await applySettings({close:true});
});

$('#hide-widget').addEventListener('click',()=>host.window('hide').catch(error=>report(error)));
// The header's more button now opens a three-item menu. Archive and trash are places the
// list can be in, not preferences, and burying them as two unlabelled icons inside the
// settings form made them both hard to find and wrong in kind.
function closeAppMenu(focus=false){const menu=$('#app-menu');if(!menu.matches(':popover-open'))return;menu.hidePopover();$('#settings-open').setAttribute('aria-expanded','false');if(focus)$('#settings-open').focus();}
function openAppMenu(){const trigger=$('#settings-open'),menu=$('#app-menu');if(menu.matches(':popover-open')){closeAppMenu(true);return;}closeMenu();trigger.setAttribute('aria-expanded','true');menu.showPopover();const rect=trigger.getBoundingClientRect(),bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.right-bounds.width,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+6,innerHeight-bounds.height-8))}px`;menu.querySelector('button').focus();}
// Tooltips wait out a second of dwell before appearing, so passing the pointer across the
// header no longer flashes a row of labels. The delay lives here rather than in a CSS
// transition because the stylesheet disables transitions wholesale under reduced motion —
// and a dwell is timing, not movement, so it has to survive that setting.
// Movement is what starts the countdown, not the control appearing under the pointer:
// pointerover also fires when a dialog opens beneath a parked cursor, and the label that
// followed answered a question nobody asked — over the sheet's own first row, at that.
let tipTimer=null,tipNode=null;
function closeTooltip(){if(tipTimer)clearTimeout(tipTimer);tipTimer=null;if(tipNode)tipNode.classList.remove('tip-open');tipNode=null;tooltipLayer.classList.remove('tip-open');tooltipLayer.setAttribute('aria-hidden','true');if(tooltipLayer.matches(':popover-open'))tooltipLayer.hidePopover();}
function openTooltip(node){
  if(quick||tipNode!==node||!node.isConnected)return;
  const label=node.dataset.tooltip||node.getAttribute('aria-label');if(!label)return;
  node.classList.add('tip-open');tooltipLayer.textContent=label;tooltipLayer.classList.remove('tip-open');tooltipLayer.style.left='8px';tooltipLayer.style.top='8px';
  // Re-show on every open so the layer is re-stacked above a sheet opened since last time.
  if(tooltipLayer.matches(':popover-open'))tooltipLayer.hidePopover();
  tooltipLayer.showPopover();
  const target=node.getBoundingClientRect(),layer=tooltipLayer.getBoundingClientRect(),inset=8,gap=9;
  const clampX=x=>Math.max(inset,Math.min(x,innerWidth-layer.width-inset)),clampY=y=>Math.max(inset,Math.min(y,innerHeight-layer.height-inset));
  if(node.closest('.capture-head')){
    // A sheet header: above is outside the sheet, below lands on its first row. Beside the
    // button the label stays in the header band, next to the title.
    tooltipLayer.dataset.placement='left';
    tooltipLayer.style.left=`${clampX(target.left-gap-layer.width)}px`;
    tooltipLayer.style.top=`${clampY(target.top+(target.height-layer.height)/2)}px`;
  }else{
    const needsBelow=target.top-inset<layer.height+gap&&innerHeight-target.bottom-inset>=layer.height+gap;
    const below=needsBelow||node.closest('.widget-head');
    const preferredX=node.closest('.task-actions,.inline-entry .add')?target.right-layer.width:node.closest('.inline-entry .entry-mic')?target.left:target.left+(target.width-layer.width)/2;
    tooltipLayer.dataset.placement=below?'below':'above';
    tooltipLayer.style.left=`${clampX(preferredX)}px`;
    tooltipLayer.style.top=`${below?Math.min(innerHeight-layer.height-inset,target.bottom+gap):Math.max(inset,target.top-layer.height-gap)}px`;
  }
  tooltipLayer.setAttribute('aria-hidden','false');tooltipLayer.classList.add('tip-open');
}
document.addEventListener('pointermove',event=>{
  const node=event.target?.closest?.('[data-tooltip]');
  if(node===tipNode)return;
  closeTooltip();
  if(!node||node.disabled)return;
  tipNode=node;
  tipTimer=setTimeout(()=>{tipTimer=null;openTooltip(node);},1000);
});
document.addEventListener('pointerout',event=>{if(tipNode&&!event.relatedTarget?.closest?.('[data-tooltip]'))closeTooltip();});
document.addEventListener('pointerdown',closeTooltip);
document.addEventListener('focusin',event=>{const node=event.target?.closest?.('[data-tooltip]');if(!node||node.disabled||!node.matches(':focus-visible'))return;closeTooltip();tipNode=node;openTooltip(node);});
document.addEventListener('focusout',event=>{if(tipNode&&!event.relatedTarget?.closest?.('[data-tooltip]'))closeTooltip();});
$('#task-scroll').addEventListener('scroll',closeTooltip,{passive:true});
$('#task-scroll').addEventListener('pointerenter',()=>{pointerOverList=true;});$('#task-scroll').addEventListener('pointerleave',()=>{pointerOverList=false;releaseOrder();});
window.addEventListener('resize',closeTooltip);
window.addEventListener('blur',closeTooltip);
$('#settings-open').addEventListener('click',openAppMenu);
$('#app-menu').addEventListener('keydown',event=>{const items=$$('#app-menu button');const index=items.indexOf(document.activeElement);let target;if(event.key==='ArrowDown')target=(index+1)%items.length;if(event.key==='ArrowUp')target=(index-1+items.length)%items.length;if(event.key==='Home')target=0;if(event.key==='End')target=items.length-1;if(target!==undefined){event.preventDefault();items[target].focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAppMenu(true);}if(event.key==='Tab')closeAppMenu();});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#app-menu')&&!event.target.closest('#settings-open'))closeAppMenu();});
$('#open-archive').addEventListener('click',()=>{closeAppMenu(true);openCollection('archive');});
$('#open-trash').addEventListener('click',()=>{closeAppMenu(true);openCollection('trash');});
$('#open-settings').addEventListener('click',()=>{closeAppMenu(true);openSettings();});
$('#open-time').addEventListener('click',()=>{closeAppMenu(true);renderTime();openDialog($('#time-sheet'));});
// F04: the "Time" sheet. Today and this week in the current zone, then tasks by today's
// time; a running timer is counted live and the sheet refreshes with the task rows.
function duration(ms){if(!(ms>0))return '—';const minutes=Math.floor(ms/60000),hours=Math.floor(minutes/60);if(!minutes)return `< 1 ${t('minutesShort')}`;return hours?`${hours} ${t('hoursShort')} ${String(minutes%60).padStart(2,'0')} ${t('minutesShort')}`:`${minutes} ${t('minutesShort')}`;}
function renderTime(){if(!state)return;const result=timeStats(state,{...context(),monotonic:mono()}),list=$('#time-list');text($('#time-today'),duration(result.today));text($('#time-week'),duration(result.week));list.replaceChildren();if(!result.tasks.length)list.append(element('p','empty',t('timeEmpty')));const lower=key=>t(key).toLocaleLowerCase(locale);for(const item of result.tasks){const row=element('div','time-row');row.append(element('span','time-title',item.title),element('small','',`${lower('today')} ${duration(item.today)} · ${lower('week')} ${duration(item.week)}`));list.append(row);}const before=$('#time-before');before.hidden=!(result.before>=60000);if(!before.hidden)text(before,`${t('timeBefore')}: ${duration(result.before)}`);}

// A05: filtering happens on every keystroke; Escape empties a filled field first and only
// an empty field lets Escape close the sheet.
$('#collection-search').addEventListener('input',()=>renderCollection());
$('#collection-search').addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target.value){event.preventDefault();event.stopPropagation();event.target.value='';renderCollection();}});
function openCollection(type){collectionType=type;$('#collection-search').value='';closeDialog($('#settings'));renderCollection();openDialog($('#collection'));}
function renderCollection(){text($('#collection-title'),t(collectionType));text($('#collection-note'),t(collectionType==='trash'?'trashNote':'archiveNote'));const list=$('#collection-list');list.replaceChildren();const all=state.tasks.filter(task=>task.lifecycle===collectionType),terms=searchTerms($('#collection-search').value),tasks=all.filter(task=>matchesSearch(task.title,terms));$('#collection-foot').hidden=collectionType!=='trash'||!all.length;$('#collection-search').hidden=!all.length;if(!all.length)list.append(element('p','empty',t('emptyCollection')));else if(!tasks.length)list.append(element('p','empty',t('searchEmpty')));for(const task of tasks){const row=element('div','collection-row'),copy=element('span','collection-copy',task.title),actions=element('span','collection-actions');copy.append(element('small','',`${task.completedAt!==null?t('completed')+' · ':''}${dateText(task)} · ${formatElapsed(task.elapsedMs)}`));actions.append(button('',t('restore'),async()=>{if(task.due&&task.due.at<=Date.now()&&task.completedAt===null&&!await askConfirmation('restoreLate','restore'))return;await mutate({type:'restore',id:task.id});}));if(collectionType==='archive')actions.append(button('',t('deleteFromArchive'),()=>mutate({type:'trash',id:task.id})));else actions.append(button('permanent-delete',t('deletePermanently'),async()=>{if(await askConfirmation('deletePermanentlyConfirm','deletePermanently'))mutate({type:'purge',id:task.id});}));row.append(copy,actions);list.append(row);}}
$('#clear-trash').addEventListener('click',async()=>{if(await askConfirmation('clearTrashConfirm','clearTrash'))mutate({type:'clearTrash'});});
$('#reputation').addEventListener('click',()=>{renderHistory();openDialog($('#history'));});
function armHistoryDelete(row){let timer=null,anchor=null;const hide=()=>{if(timer)clearTimeout(timer);timer=null;anchor=null;row.classList.remove('delete-ready');};const start=event=>{if(event.pointerType&&event.pointerType!=='mouse')return;hide();anchor={x:event.clientX,y:event.clientY};timer=setTimeout(()=>{timer=null;row.classList.add('delete-ready');},2000);};row.addEventListener('pointerenter',start);row.addEventListener('pointermove',event=>{if(!anchor||row.classList.contains('delete-ready'))return;if(Math.hypot(event.clientX-anchor.x,event.clientY-anchor.y)>2)start(event);});row.addEventListener('pointerleave',hide);row.addEventListener('focusout',event=>{if(!row.contains(event.relatedTarget))row.classList.remove('delete-ready');});}
function renderHistory(){const list=$('#history-list');list.replaceChildren();const events=[...state.events].reverse().slice(0,100);for(const [index,event] of events.entries()){const row=element('div','history-row');row.dataset.event=String(event.id);const task=state.tasks.find(task=>task.id===event.taskId),copy=element('span','history-copy'),remove=button('history-delete',t('deleteReputationEvent'),async()=>{const saved=await mutate({type:'deleteEvent',eventId:event.id,taskId:event.taskId,kind:event.kind,at:event.at,delta:event.delta});if(!saved)return;const buttons=$$('#history-list .history-delete'),next=buttons[Math.min(index,buttons.length-1)];if(next){next.closest('.history-row').classList.add('delete-ready');next.focus();}else $('#history [data-close]').focus();},'close');remove.removeAttribute('data-tooltip');copy.append(element('span','history-title',task?.title||t('reputation')),element('span','history-date',new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(event.at??Date.now()))));row.append(copy,element('strong','history-value',`${event.delta>0?'+':''}${event.delta??0}`),remove);armHistoryDelete(row);list.append(row);}if(!state.events.length)list.append(element('p','empty',t('emptyCollection')));}
$('#retry').addEventListener('click',async()=>{if(resyncPending&&(busy||!await resync()))return;retryAction?.();});$('#error-close').addEventListener('click',clearError);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!$('dialog[open]')){if(menuTrigger){event.preventDefault();closeMenu(true);}else if(quick){/* Escape closes the capsule but keeps the unsent text: it is there next time, and after a restart. */draft.flush();host.window('quickDone').catch(error=>report(error));}else host.window('hide').catch(error=>report(error));}});
host.addEventListener('stateChanged',event=>{const payload=event.detail;if(!payload?.state||payload.revision<=revision)return;try{assertState(payload.state);}catch{return;}if(busy){latestExternal=payload;return;}state=payload.state;revision=payload.revision;render();});
host.addEventListener('nativeChanged',event=>{native={...event.detail};render();if(native.hotkeyError&&!quick)report(Error(native.hotkeyError));});host.addEventListener('visibility',event=>{nativeVisible=event.detail.visible;if(!nativeVisible){pointerOverList=false;releaseOrder();}lastUndo=performance.now();renderUndo();if(nativeVisible&&quick)$('#task-input').focus();});host.addEventListener('focusQuick',()=>$('#task-input').focus());
async function suspend(finalize=false){await draft.flush();if(quick)return;while(busy)await new Promise(resolve=>setTimeout(resolve,25));if(resyncPending)await resync();const saved=await transaction([{type:'suspend'},...(finalize?[{type:'finalizeDeletes'}]:[])],{silent:true});/* A page that cannot reach its state holds nothing newer than the host's last save, so it must not keep the app from closing. */if(finalize)await host.window(saved||!ready?'exitReady':'cancelExit');}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')draft.flush();});
host.addEventListener('suspend',()=>suspend().catch(error=>report(error)));host.addEventListener('beforeExit',()=>suspend(true).catch(error=>report(error)));
/* The loop is paced by performance.now(), which never jumps. mono() is re-derived from the host's clock at every command, and the host's clock does not count time the PC slept: after a sleep it steps back by the length of the sleep, `mono() - lastTick` then stays negative for that long and the seconds stop moving (the timer itself was right, and the true time showed up on pause). */
setInterval(async()=>{const now=performance.now(),delta=Math.max(0,now-lastUndo);lastUndo=now;if(resyncPending){if(!busy&&!resyncing&&now-lastResync>=3000){resyncing=true;lastResync=now;try{if(await resync()&&silentError)clearError();}finally{resyncing=false;}}return;}if(!state||busy||!ready||quick)return;if(pendingTasks().length){const next=applyCommand(state,{type:'advanceUndo',delta,paused:undoPaused()},context());const expired=next.tasks.some(task=>task.lifecycle==='trash'&&state.tasks.find(old=>old.id===task.id)?.lifecycle==='pending');if(expired){setBusy(true);try{await commitState(next);}catch(error){report(error);}finally{setBusy(false);}}else{state=next;renderUndo();}}if(now-lastTick>=1000){lastTick=now;updateTimes();await mutate({type:'tick'},{silent:true,notifyOverdue:true});await remind();checkUpdates();}/* F03: while a timer runs, ask the host every 5 s how long there has been no input anywhere. */if(idleSupported&&now-lastIdle>=5000){lastIdle=now;const runner=state.tasks.find(task=>task.workState==='running');if(!runner)idleWatch.reset();else{try{const found=idleWatch.sample({idleMs:(await host.window('idle')).idleMs,now:Date.now()});if(found&&!busy)await mutate({type:'idle',id:runner.id,...found},{silent:true});}catch{idleSupported=false;}}}/* A running timer is written every 15 s (N07); pause, stop, completion, sleep and exit are saved at once, so a crash loses at most that interval. */if(now-lastCheckpoint>=15000){lastCheckpoint=now;if(state.tasks.some(task=>task.workState==='running'))await mutate({type:'checkpoint'},{silent:true});}},200);
host.addEventListener('exitFailed',()=>report(Error('saveError')));
localize();load({startup:true}).then(async()=>{await restoreDraft().catch(()=>{});if(quick)$('#task-input').focus();else offerCaptureIntro().catch(()=>{});}).catch(error=>{ready=false;report(error,()=>load({startup:true}));const empty=$('#empty');if(empty)text(empty,t('loadError'));});

$('#restore-backup').addEventListener('click',async()=>{if(busy||!await askConfirmation('restoreConfirm','restoreBackup'))return;setBusy(true);try{await host.request('restoreBackup');await load({startup:true});clearError();}catch(error){ready=false;report(Error('dataCorrupt'));text($('#error-text'),t('restoreFailed'));}finally{setBusy(false);}});
