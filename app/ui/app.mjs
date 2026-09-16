import {stateFromLoad} from './state-loader.mjs';
import {saveSettings} from './settings-transaction.mjs';
import {createState,applyCommand,validateState,recoverState,makeDeadline,groups,elapsed,formatElapsed} from '../core/model.mjs';
import {HostBridge} from './bridge.mjs';
import {translator,localeFor} from './i18n.mjs';
import {notificationFor} from './notification-policy.mjs';
import {installGroupFade} from './group-fade.mjs';
import {VoiceInput} from './voice.mjs';
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
let t=translator('ru'),locale='ru-RU',editorId=null,editorZone=null,collectionType='archive';
let menuTrigger=null,menuId=null,lastTheme=null,retryAction=null;
const dialogFocus=new WeakMap();
let undoHover=false,nativeVisible=true,lastUndo=mono(),lastTick=0,lastCheckpoint=mono();
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
function report(error,action=null,target=$('#error')){retryAction=action;const damaged=/dataCorrupt|invalidState/.test(String(error?.message||error));$('#restore-backup').hidden=!damaged;const key=damaged?'dataCorrupt':/hotkey|Repeated modifier/i.test(String(error?.message||error))?'hotkeyError':['nativeRollbackError','noHost','conflict','invalidDate','nativeError'].find(k=>String(error?.message||error).includes(k))||'saveError';if(target===$('#error')){text($('#error-text'),t(key));$('#retry').hidden=!action;target.hidden=false;}else{text(target,t(key));target.hidden=false;}}
function clearError(){ $('#error').hidden=true;$('#restore-backup').hidden=true;retryAction=null; }
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
function localize(){t=translator(state?.settings.language);locale=localeFor(state?.settings.language);document.documentElement.lang=state?.settings.language||'ru';$$('[data-text]').forEach(node=>text(node,t(node.dataset.text)));$$('[data-label]').forEach(node=>{const label=t(node.dataset.label);node.setAttribute('aria-label',label);node.removeAttribute('title');if(node.tagName==='BUTTON'&&!node.textContent.trim())node.dataset.tooltip=label;else delete node.dataset.tooltip;});$$('[data-placeholder]').forEach(node=>node.placeholder=t(node.dataset.placeholder));applyTheme();}
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
async function load({startup=false}={}){const result=await host.request('load');syncClock(result);state=stateFromLoad(result);revision=result.revision??0;native=result.native??native;ready=true;localize();render();if(startup&&!quick){const recovered=recoverState(state);if(JSON.stringify(recovered)!==JSON.stringify(state))await commitState(recovered);await mutate({type:'tick'},{silent:true});}setBusy(false);if(native.hotkeyError&&!quick)report(Error(native.hotkeyError));return state;}
async function commitState(candidate){const sentRevision=revision;const result=await host.request('save',{state:candidate,revision:sentRevision});state=candidate;revision=result?.revision??sentRevision+1;if(latestExternal&&latestExternal.revision>revision){state=latestExternal.state;revision=latestExternal.revision;}latestExternal=null;render();return true;}
async function transaction(commands,{silent=false,errorTarget=null,notifyOverdue=false}={}){if(busy||!ready)return false;/* A no-op tick must not briefly disable every action once per second. */if(commands.length===1&&commands[0].type==='tick'&&JSON.stringify(applyCommand(state,commands[0],context()))===JSON.stringify(state))return true;setBusy(true);const before=state;try{syncClock(await host.request('clock'));let candidate=state;for(const command of commands)candidate=applyCommand(candidate,command,context());if(JSON.stringify(candidate)===JSON.stringify(state))return true;await commitState(candidate);if(!silent){clearError();announce(t('saved'));}const notification=notificationFor(before,state,commands,{notifyOverdue});if(notification)play(notification);return true;}catch(error){if(String(error.message).includes('conflict')){try{await load();}catch{ready=false;}}report(error,()=>transaction(commands,{silent,errorTarget,notifyOverdue}),errorTarget||$('#error'));return false;}finally{setBusy(false);if(latestExternal){state=latestExternal.state;revision=latestExternal.revision;latestExternal=null;localize();render();}}}
const mutate=(command,options)=>transaction([command],options);
function render(){if(!state)return;if(tipNode&&!tipNode.isConnected)closeTooltip();const active=$(':focus');const focusedTask=active?.closest('[data-task]')?.dataset.task;const focusedAction=active?.dataset.action;const previous=new Map($$('.task[data-task]').map(node=>[node.dataset.task,node.getBoundingClientRect().top]));const scroll=$('#task-scroll').scrollTop;localize();text($('#today'),new Intl.DateTimeFormat(locale,{weekday:'long',day:'numeric',month:'long'}).format(new Date()));text($('#score'),String(state.reputation));const pinned=native.pinned??state.settings.pinned;$('#pin').setAttribute('aria-pressed',String(pinned));const pinLabel=t(pinned?'unpin':'pin');$('#pin').dataset.tooltip=pinLabel;$('#pin').removeAttribute('title');$('#pin').setAttribute('aria-label',pinLabel);if(!quick){const fragment=document.createDocumentFragment();for(const group of groups(state,context())){if(!group.tasks.length)continue;const section=element('section','task-group');section.dataset.group=group.key;const collapsed=collapsedGroups.has(group.key);if(collapsed)section.classList.add('collapsed');const heading=element('h2',`${group.key}-label`);const toggle=element('button','group-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed));toggle.append(icon('chevron'),element('span','group-name',t(group.key)),element('span','',String(group.tasks.length)));toggle.addEventListener('click',()=>toggleGroup(group.key,section,toggle));heading.append(toggle);section.append(heading);const rows=element('div','task-group-rows');for(const task of group.tasks)rows.append(taskRow(task,group.key));section.append(rows);fragment.append(section);}if(!fragment.childNodes.length)fragment.append(element('p','empty',t('empty')));$('#task-scroll').replaceChildren(fragment);$('#task-scroll').scrollTop=scroll;refreshGroupFade();for(const node of $$('.task[data-task]')){const old=previous.get(node.dataset.task);if(old===undefined)animate(node,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}]);else{const delta=Math.max(-60,Math.min(60,old-node.getBoundingClientRect().top));if(Math.abs(delta)>1)animate(node,[{transform:`translateY(${delta}px)`},{transform:'none'}],260);}}if(focusedTask&&focusedAction){const replacement=$$('.task[data-task]').find(n=>n.dataset.task===focusedTask)?.querySelector(`[data-action="${focusedAction}"]`);replacement?.focus({preventScroll:true});}renderUndo();if($('#collection').open)renderCollection();if($('#history').open)renderHistory();}setBusy(busy);}
function taskRow(task,key){const row=element('article',`task ${key==='late'?'late ':''}${task.completedAt!==null?'done ':''}${['running','paused','working'].includes(task.workState)?'in-work':''}`);row.dataset.task=task.id;const completed=task.completedAt!==null;const check=button('complete',t(completed?'uncomplete':'complete'),()=>mutate({type:completed?'uncomplete':'complete',id:task.id}));check.dataset.action='complete';check.setAttribute('aria-pressed',String(completed));const circle=element('span','circle');circle.append(icon('check'));check.replaceChildren(circle);const copy=element('div','task-copy');const title=button('task-title',task.title,()=>openEditor(task));title.dataset.action='edit';const due=button('deadline',completed?(task.due?`${t('completed')} · ${dateText(task)}`:t('completed')):dateText(task),()=>openEditor(task,true));due.dataset.action='date';// An undated task sits under a heading that already reads "no due date", so the row
// repeating it line after line is noise. The date is still reachable from the row's
// own menu. A completed row keeps the line for the deadline it was closed against;
// with no deadline there is nothing to add, and "Done · No date" under a heading that
// already says "Done today" repeated the same emptiness twice.
copy.append(title);if(task.due||completed)copy.append(due);const actions=element('div','task-actions');const timer=button('timer',t(task.workState==='running'?'pause':'start'),()=>mutate({type:task.workState==='running'?'pause':'start',id:task.id}),task.workState==='running'?'pause':'play');timer.dataset.action='timer';timer.disabled=completed;timer.setAttribute('aria-pressed',String(task.workState==='running'));const more=button('task-more',t('actions'),event=>openMenu(task,event.currentTarget),'more');more.dataset.action='more';more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded',String(menuId===task.id));actions.append(timer,more);row.append(check,copy,actions);if(task.elapsedMs>0||task.workState!=='idle'){const strip=element('div','work-strip');strip.append(element('span','work-status',t(completed?'completed':task.workState)),element('span','elapsed',formatElapsed(elapsed(task,mono()))));if(!completed&&task.workState!=='idle'){const stop=button('stop-work',t('stop'),()=>mutate({type:'stop',id:task.id}),'stop');stop.dataset.action='stop';strip.append(stop);}row.append(strip);}return row;}
function updateTimes(){for(const row of $$('.task[data-task]')){const task=state.tasks.find(task=>task.id===row.dataset.task);const node=row.querySelector('.elapsed');if(node&&task)text(node,formatElapsed(elapsed(task,mono())));}}
function pendingTasks(){return state?.tasks.filter(task=>task.lifecycle==='pending').sort((a,b)=>a.deletedAt-b.deletedAt)||[];}
function undoPaused(){return undoHover||$('#undo-bar').contains(document.activeElement)||document.hidden||!nativeVisible;}
function renderUndo(){const tasks=pendingTasks(),task=tasks.at(-1);$('#undo-bar').hidden=!task;if(!task)return;text($('#undo-text'),task.title);text($('#undo-hint'),`${t(undoPaused()?'undoPaused':'undoHint')}${tasks.length>1?` · +${tasks.length-1} ${t('moreDeleted')}`:''}`);const remaining=Math.max(0,task.undoRemaining);text($('#undo-seconds'),undoPaused()?'Ⅱ':String(Math.max(1,Math.ceil(remaining/1000))));$('#undo-arc').style.strokeDashoffset=String(100-remaining/5000*100);}
function openDialog(dialog){closeMenu();if(dialog.open)return;dialogFocus.set(dialog,document.activeElement);dialog.showModal();}
function closeDialog(dialog){dialog.close();const target=dialogFocus.get(dialog);dialogFocus.delete(dialog);if(target?.isConnected&&(!target.closest('dialog')||target.closest('dialog').open))target.focus({preventScroll:true});}
$$('[data-close]').forEach(node=>node.addEventListener('click',()=>closeDialog(node.closest('dialog'))));$$('dialog:not(#confirmation)').forEach(dialog=>dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog(dialog);}));
let confirmationResolve=null;
function settleConfirmation(value){const resolve=confirmationResolve;confirmationResolve=null;const dialog=$('#confirmation');if(dialog.open)closeDialog(dialog);resolve?.(value);}
function askConfirmation(messageKey,acceptKey){if(confirmationResolve)settleConfirmation(false);text($('#confirmation-message'),t(messageKey));text($('#confirmation-accept'),t(acceptKey));openDialog($('#confirmation'));queueMicrotask(()=>$('#confirmation-cancel').focus());return new Promise(resolve=>{confirmationResolve=resolve;});}
$('#confirmation-cancel').addEventListener('click',()=>settleConfirmation(false));$('#confirmation-close').addEventListener('click',()=>settleConfirmation(false));$('#confirmation-accept').addEventListener('click',()=>settleConfirmation(true));$('#confirmation').addEventListener('cancel',event=>{event.preventDefault();settleConfirmation(false);});
function openEditor(task=null,dateFocus=false){editorId=task?.id??null;editorZone=task?.due?.timeZone??context().timeZone;text($('#editor-title'),t(task?'edit':'newTask'));$('#editor-input').value=task?.title??$('#task-input').value;$('#due-input').value=task?.due?.date??'';$('#time-input').value=task?.due?.time??'';$('#editor-error').hidden=true;updateDateControls();openDialog($('#editor'));(dateFocus?$('#due-input'):$('#editor-input')).focus();grow($('#editor-input'));}
function updateDateControls(){if(!$('#due-input').value)$('#time-input').value='';text($('#zone-hint'),`${t('deadlineZone')}: ${editorZone||context().timeZone}`);const selected=$('#due-input').value;$$('[data-days]').forEach(button=>button.setAttribute('aria-pressed',String(selected===dateAfter(Number(button.dataset.days)))));$('#clear-date').setAttribute('aria-pressed',String(!selected));}
function dateAfter(days){const now=new Date();now.setDate(now.getDate()+days);return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
$$('[data-days]').forEach(node=>node.addEventListener('click',()=>{$('#due-input').value=dateAfter(Number(node.dataset.days));editorZone=context().timeZone;updateDateControls();}));$('#clear-date').addEventListener('click',()=>{$('#due-input').value='';updateDateControls();});$('#due-input').addEventListener('input',updateDateControls);
$('#editor-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const title=$('#editor-input').value.trim();if(!title)return;let due=null;try{if(!$('#due-input').checkValidity()||!$('#time-input').checkValidity()||($('#time-input').value&&!$('#due-input').value))throw Error();due=$('#due-input').value?makeDeadline($('#due-input').value,$('#time-input').value,editorZone):null;}catch{report(Error('invalidDate'),null,$('#editor-error'));return;}const commands=editorId?[{type:'edit',id:editorId,title},{type:'deadline',id:editorId,due}]:[{type:'create',id:crypto.randomUUID(),title,due}];if(await transaction(commands,{errorTarget:$('#editor-error')})){if(!editorId){$('#task-input').value='';grow($('#task-input'));}closeDialog($('#editor'));}});
function grow(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,input.id==='editor-input'?180:quick?125:92)}px`;}
for(const input of [$('#task-input'),$('#editor-input')]){input.addEventListener('input',()=>{grow(input);setBusy(busy);});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!busy)input.closest('form').requestSubmit();}});}
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
    input.placeholder='';
    if(!input.value&&recorded!==null)input.value=recorded;
    recorded=null;
    queueMicrotask(syncShortcutRecording);
  });
  input.addEventListener('keydown',event=>{
    if(event.key==='Tab')return;
    event.preventDefault();event.stopPropagation();beginRecording();
    if(event.key==='Escape'){input.blur();return;}
    const shortcut=shortcutFromEvent(event);
    if(shortcut){input.value=shortcut;input.setCustomValidity('');announce(shortcut);}
  });
}
async function submitEntry(){if(busy||!ready||voiceInput.active)return;const input=$('#task-input'),title=input.value.trim();if(!title)return;const original=input.value;const success=await mutate({type:'create',id:crypto.randomUUID(),title});if(success){if(input.value===original)input.value='';voiceInput.clearError();grow(input);setBusy(false);if(quick)await host.window('quickDone').catch(error=>report(error));else input.focus();}}
$('#entry').addEventListener('submit',event=>{event.preventDefault();submitEntry();});$('#new-with-date').addEventListener('click',()=>openEditor());
let voiceTicker=0;
const voiceInput=new VoiceInput({host,input:$('#task-input'),language:()=>state?.settings.language||'ru',onChange:renderVoice,onText:()=>{grow($('#task-input'));setBusy(busy);}});
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
  setBusy(busy);
  if(phase==='idle'&&nativeVisible&&document.hasFocus())$('#task-input').focus();
}
$('#voice-input').removeAttribute('aria-disabled');
$('#voice-input').addEventListener('click',()=>{if(!ready||busy)return;if(voiceInput.active)voiceInput.stop();else voiceInput.start();});
$('#voice-cancel').addEventListener('click',()=>voiceInput.cancel());
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(voiceInput.active||voiceInput.phase==='error')){event.preventDefault();event.stopImmediatePropagation();voiceInput.cancel();}},true);
host.addEventListener('visibility',event=>{if(!event.detail.visible)voiceInput.cancel();});
host.addEventListener('suspend',()=>voiceInput.cancel());
function closeMenu(focus=false){if(!menuTrigger)return;$('#task-menu').hidePopover();const trigger=menuTrigger;trigger.setAttribute('aria-expanded','false');menuTrigger=null;menuId=null;if(focus)trigger.focus();}
function openMenu(task,trigger){if(menuTrigger===trigger){closeMenu(true);return;}closeMenu();menuTrigger=trigger;menuId=task.id;trigger.setAttribute('aria-expanded','true');$('#task-menu [data-action=work]').disabled=task.completedAt!==null;const menu=$('#task-menu');menu.showPopover();const rect=trigger.getBoundingClientRect(),bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.right-bounds.width,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+4,innerHeight-bounds.height-8))}px`;menu.querySelector('button:not(:disabled)').focus();}
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
function fillSettingsForm(){const form=$('#settings-form');for(const control of form.elements){if(!control.name)continue;const value=state.settings[control.name];if(control.type==='checkbox')control.checked=!!value;else control.value=String(value??'');}form.elements.autostart.checked=native.autostart??state.settings.autostart;form.elements.listShortcut.value=native.hotkeys?.list??state.settings.listShortcut;form.elements.quickShortcut.value=native.hotkeys?.quick??state.settings.quickShortcut;syncArchiveDays();}
function openSettings(){fillSettingsForm();$('#settings-error').hidden=true;openDialog($('#settings'));}
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
  for(const control of form.elements){
    if(!control.name)continue;
    let value=control.type==='checkbox'?control.checked:control.name==='archiveDays'?Number(control.value):control.value;
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
    if(latestExternal){state=latestExternal.state;revision=latestExternal.revision;latestExternal=null;render();}
    if(settingsPending){settingsPending=false;setTimeout(()=>applySettings(),0);}
  }
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
window.addEventListener('resize',closeTooltip);
window.addEventListener('blur',closeTooltip);
$('#settings-open').addEventListener('click',openAppMenu);
$('#app-menu').addEventListener('keydown',event=>{const items=$$('#app-menu button');const index=items.indexOf(document.activeElement);let target;if(event.key==='ArrowDown')target=(index+1)%items.length;if(event.key==='ArrowUp')target=(index-1+items.length)%items.length;if(event.key==='Home')target=0;if(event.key==='End')target=items.length-1;if(target!==undefined){event.preventDefault();items[target].focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAppMenu(true);}if(event.key==='Tab')closeAppMenu();});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#app-menu')&&!event.target.closest('#settings-open'))closeAppMenu();});
$('#open-archive').addEventListener('click',()=>{closeAppMenu(true);openCollection('archive');});
$('#open-trash').addEventListener('click',()=>{closeAppMenu(true);openCollection('trash');});
$('#open-settings').addEventListener('click',()=>{closeAppMenu(true);openSettings();});

function openCollection(type){collectionType=type;closeDialog($('#settings'));renderCollection();openDialog($('#collection'));}
function renderCollection(){text($('#collection-title'),t(collectionType));text($('#collection-note'),t(collectionType==='trash'?'trashNote':'archiveNote'));const list=$('#collection-list');list.replaceChildren();const tasks=state.tasks.filter(task=>task.lifecycle===collectionType);$('#collection-foot').hidden=collectionType!=='trash'||!tasks.length;if(!tasks.length)list.append(element('p','empty',t('emptyCollection')));for(const task of tasks){const row=element('div','collection-row'),copy=element('span','collection-copy',task.title),actions=element('span','collection-actions');copy.append(element('small','',`${task.completedAt!==null?t('completed')+' · ':''}${dateText(task)} · ${formatElapsed(task.elapsedMs)}`));actions.append(button('',t('restore'),async()=>{if(task.due&&task.due.at<=Date.now()&&task.completedAt===null&&!await askConfirmation('restoreLate','restore'))return;await mutate({type:'restore',id:task.id});}));if(collectionType==='archive')actions.append(button('',t('deleteFromArchive'),()=>mutate({type:'trash',id:task.id})));else actions.append(button('permanent-delete',t('deletePermanently'),async()=>{if(await askConfirmation('deletePermanentlyConfirm','deletePermanently'))mutate({type:'purge',id:task.id});}));row.append(copy,actions);list.append(row);}}
$('#clear-trash').addEventListener('click',async()=>{if(await askConfirmation('clearTrashConfirm','clearTrash'))mutate({type:'clearTrash'});});
$('#reputation').addEventListener('click',()=>{renderHistory();openDialog($('#history'));});
function armHistoryDelete(row){let timer=null,anchor=null;const hide=()=>{if(timer)clearTimeout(timer);timer=null;anchor=null;row.classList.remove('delete-ready');};const start=event=>{if(event.pointerType&&event.pointerType!=='mouse')return;hide();anchor={x:event.clientX,y:event.clientY};timer=setTimeout(()=>{timer=null;row.classList.add('delete-ready');},2000);};row.addEventListener('pointerenter',start);row.addEventListener('pointermove',event=>{if(!anchor||row.classList.contains('delete-ready'))return;if(Math.hypot(event.clientX-anchor.x,event.clientY-anchor.y)>2)start(event);});row.addEventListener('pointerleave',hide);row.addEventListener('focusout',event=>{if(!row.contains(event.relatedTarget))row.classList.remove('delete-ready');});}
function renderHistory(){const list=$('#history-list');list.replaceChildren();const events=[...state.events].reverse().slice(0,100);for(const [index,event] of events.entries()){const row=element('div','history-row');row.dataset.event=String(event.id);const task=state.tasks.find(task=>task.id===event.taskId),copy=element('span','history-copy'),remove=button('history-delete',t('deleteReputationEvent'),async()=>{const saved=await mutate({type:'deleteEvent',eventId:event.id,taskId:event.taskId,kind:event.kind,at:event.at,delta:event.delta});if(!saved)return;const buttons=$$('#history-list .history-delete'),next=buttons[Math.min(index,buttons.length-1)];if(next){next.closest('.history-row').classList.add('delete-ready');next.focus();}else $('#history [data-close]').focus();},'close');remove.removeAttribute('data-tooltip');copy.append(element('span','history-title',task?.title||t('reputation')),element('span','history-date',new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(event.at??Date.now()))));row.append(copy,element('strong','history-value',`${event.delta>0?'+':''}${event.delta??0}`),remove);armHistoryDelete(row);list.append(row);}if(!state.events.length)list.append(element('p','empty',t('emptyCollection')));}
$('#retry').addEventListener('click',()=>retryAction?.());$('#error-close').addEventListener('click',clearError);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!$('dialog[open]')){if(menuTrigger){event.preventDefault();closeMenu(true);}else if(quick){const input=$('#task-input');input.value='';grow(input);setBusy(busy);host.window('quickDone').catch(error=>report(error));}else host.window('hide').catch(error=>report(error));}});
host.addEventListener('stateChanged',event=>{const payload=event.detail;if(!payload?.state||payload.revision<=revision)return;try{assertState(payload.state);}catch{return;}if(busy){latestExternal=payload;return;}state=payload.state;revision=payload.revision;render();});
host.addEventListener('nativeChanged',event=>{native={...event.detail};render();if(native.hotkeyError&&!quick)report(Error(native.hotkeyError));});host.addEventListener('visibility',event=>{nativeVisible=event.detail.visible;lastUndo=mono();renderUndo();if(nativeVisible&&quick)$('#task-input').focus();});host.addEventListener('focusQuick',()=>$('#task-input').focus());
async function suspend(finalize=false){if(quick)return;while(busy)await new Promise(resolve=>setTimeout(resolve,25));const saved=await transaction([{type:'suspend'},...(finalize?[{type:'finalizeDeletes'}]:[])],{silent:true});if(finalize)await host.window(saved?'exitReady':'cancelExit');}
host.addEventListener('suspend',()=>suspend().catch(error=>report(error)));host.addEventListener('beforeExit',()=>suspend(true).catch(error=>report(error)));
setInterval(async()=>{const now=mono(),delta=Math.max(0,now-lastUndo);lastUndo=now;if(!state||busy||!ready||quick)return;if(pendingTasks().length){const next=applyCommand(state,{type:'advanceUndo',delta,paused:undoPaused()},context());const expired=next.tasks.some(task=>task.lifecycle==='trash'&&state.tasks.find(old=>old.id===task.id)?.lifecycle==='pending');if(expired){setBusy(true);try{await commitState(next);}catch(error){report(error);}finally{setBusy(false);}}else{state=next;renderUndo();}}if(now-lastTick>=1000){lastTick=now;updateTimes();await mutate({type:'tick'},{silent:true,notifyOverdue:true});}if(now-lastCheckpoint>=5000){lastCheckpoint=now;if(state.tasks.some(task=>task.workState==='running'))await mutate({type:'checkpoint'},{silent:true});}},200);
host.addEventListener('exitFailed',()=>report(Error('saveError')));
localize();load({startup:true}).then(()=>{if(quick)$('#task-input').focus();}).catch(error=>{ready=false;report(error,()=>load({startup:true}));const empty=$('#empty');if(empty)text(empty,t('loadError'));});

$('#restore-backup').addEventListener('click',async()=>{if(busy||!await askConfirmation('restoreConfirm','restoreBackup'))return;setBusy(true);try{await host.request('restoreBackup');await load({startup:true});clearError();}catch(error){ready=false;report(Error('dataCorrupt'));text($('#error-text'),t('restoreFailed'));}finally{setBusy(false);}});
