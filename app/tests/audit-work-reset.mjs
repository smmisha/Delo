// Named-harness integration for U09/F07. Never connects to the production profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connect,wait,screenshot,native} from './audit-harness.mjs';
const [phase,out]=process.argv.slice(2);
if(!['before','after'].includes(phase)||!out)throw Error('Usage: audit-work-reset.mjs before|after <output>');
const main=await connect(),quick=await connect(true),checks=[];await fs.mkdir(out,{recursive:true});
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log(JSON.stringify(checks.at(-1)));assert.ok(pass,name);};
const rpc=(page,type,payload={})=>page.evaluate(async(type,payload)=>{const {HostBridge}=await import('./bridge.mjs');window.__deloHarnessBridge??=new HostBridge();return window.__deloHarnessBridge.request(type,payload);},type,payload);
async function until(fn,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){if(await main.evaluate(fn))return;await wait(25);}throw Error('Timed out: '+fn.toString());}
const settle=()=>until(()=>document.querySelector('#widget').getAttribute('aria-busy')==='false');
async function click(selector){await main.evaluate(async selector=>{const b=document.querySelector(selector);if(!b||b.disabled||b.hidden)throw Error('Unavailable control: '+selector);b.scrollIntoView({block:'nearest'});b.focus();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const current=document.querySelector(selector);if(!current||current.disabled||current.hidden)throw Error('Control changed: '+selector);current.click();},selector);await settle();}
const row=id=>`.task[data-task="${id}"]`;
const load=()=>rpc(main,'load');
const find=async id=>(await load()).state.tasks.find(t=>t.id===id);
async function menu(id,action){await click(row(id)+' .task-more');await until(()=>document.querySelector('#task-menu').matches(':popover-open'));if(action)await click('#task-menu [data-action="'+action+'"]');}
async function confirmReset(id,accept=true){await menu(id,'resetTime');await until(()=>document.querySelector('#confirmation').open);check('reset opens with safe Cancel focus',await main.evaluate(()=>document.activeElement.id==='confirmation-cancel'));await click(accept?'#confirmation-accept':'#confirmation-cancel');await until(()=>!document.querySelector('#confirmation').open);await settle();}
let failure;
try{
 for(const page of [main,quick]){const identity=await page.host('osSurfaceDiagnostics');assert.match(identity.profile,/test-output[\\/]sessions[\\/]work-reset-/i);}
 await main.host('show');await main.host('pin',{pinned:true});
 if(phase==='after'){
  const a=await find('reset-a');const {state}=await load();
  check('saved zero and untimed pause survive relaunch',a.elapsedMs===0&&a.workState==='paused'&&Array.isArray(a.untimedState)&&a.untimedState[1]===0);
  check('no task restarts its timer after relaunch',!state.tasks.some(t=>t.workState==='running'));
  await menu('reset-a','work');const resumed=await find('reset-a');
  check('relaunch resume stays untimed at zero',resumed.workState==='working'&&resumed.elapsedMs===0);
 }else{
  await quick.evaluate(async()=>{
   const {createState,applyCommand}=await import('../core/model.mjs');const {HostBridge}=await import('./bridge.mjs');window.__deloHarnessBridge??=new HostBridge();const host=window.__deloHarnessBridge;
   const loaded=await host.request('load'),clock=await host.request('clock'),now=Date.now(),ctx={now,monotonic:clock.monotonicMs,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
   let state=createState();state.settings.autoArchive='off';state.settings.theme='dark';
   for(const id of ['a','b','c','d','e','f']){state=applyCommand(state,{type:'create',id:'reset-'+id,title:'Reset '+id.toUpperCase()},ctx);const t=state.tasks.at(-1);t.elapsedMs=(id==='b'?5:20)*60000;t.intervals=[[now-t.elapsedMs,t.elapsedMs]];}
   state=applyCommand(state,{type:'complete',id:'reset-c'},ctx);state=applyCommand(state,{type:'work',id:'reset-b'},ctx);state=applyCommand(state,{type:'work',id:'reset-a'},ctx);
   await host.request('save',{state,revision:loaded.revision});
  });
  await until(()=>document.querySelectorAll('.task[data-task]').length===6);await settle();
  await main.evaluate(async()=>{const {HostBridge}=await import('./bridge.mjs');const original=HostBridge.prototype.request;HostBridge.prototype.request=function(type,...args){if(type==='clock'&&this!==window.__deloHarnessBridge)window.__workApp=this;return original.call(this,type,...args);};});
  check('untimed row has passive status and no play/pause duplicate',await main.evaluate(()=>{const r=document.querySelector('[data-task="reset-a"]');return !r.querySelector('.work-toggle')&&!r.querySelector('.timer')&&r.querySelector('.work-status').tagName==='SPAN'&&r.querySelector('.work-status').textContent==='В работе без таймера';}));
  await menu('reset-a');check('working menu item offers Pause',await main.evaluate(()=>{const b=document.querySelector('#task-menu [data-action=work]');return !b.disabled&&b.textContent.trim()==='Пауза'&&b.querySelector('use').getAttribute('href')==='#i-pause';}));
  await main.click('#task-menu [data-action=work]');await settle();const paused=await find('reset-a');await wait(250);
  check('pause keeps untimed mode and does not accumulate',paused.workState==='paused'&&paused.untimedState?.[1]===paused.elapsedMs&&(await find('reset-a')).elapsedMs===paused.elapsedMs);
  check('menu toggle returns focus to the same task More button',await main.evaluate(()=>document.activeElement?.dataset.action==='more'&&document.activeElement.closest('[data-task]')?.dataset.task==='reset-a'));
  const keyWindow=(await main.host('diagnostics')).window;
  await menu('reset-a');await main.evaluate(()=>document.querySelector('#task-menu [data-action=work]').focus());
  native(keyWindow,'keys',{Keys:'SPACE'});await until(()=>!document.querySelector('#task-menu').matches(':popover-open'));await settle();
  check('Space resumes untimed work without starting a timer',(await find('reset-a')).workState==='working'&&(await find('reset-a')).elapsedMs===paused.elapsedMs);
  await menu('reset-a');await main.evaluate(()=>document.querySelector('#task-menu [data-action=work]').focus());
  native(keyWindow,'keys',{Keys:'ENTER'});await until(()=>!document.querySelector('#task-menu').matches(':popover-open'));await settle();
  check('Enter pauses the same untimed menu item',(await find('reset-a')).workState==='paused');
  native(keyWindow,'keys',{Keys:'TAB'});await until(()=>document.activeElement?.dataset.action==='stop');
  native(keyWindow,'keys',{Keys:'SHIFT+TAB'});await until(()=>document.activeElement?.dataset.action==='more');
  check('Tab navigation includes More and Stop',await main.evaluate(()=>document.activeElement?.closest('[data-task]')?.dataset.task==='reset-a'));
  await menu('reset-a','work');
  for(const language of ['ru','uk','en']){
   for(const theme of ['dark','light']){
    const current=await load();current.state.settings.language=language;current.state.settings.theme=theme;await rpc(quick,'save',{state:current.state,revision:current.revision});
    await until("document.documentElement.lang==='"+language+"'&&document.body.classList.contains('dark')==="+(theme==='dark'));
    check(language+'/'+theme+': untimed rows have no control duplicates',await main.evaluate(()=>['reset-a','reset-b'].every(id=>{const r=document.querySelector('[data-task="'+id+'"]');return !r.querySelector('.work-toggle,.timer')&&r.querySelector('.work-status').tagName==='SPAN';})));
    for(const [id,label,aria,icon] of [['reset-a',{ru:'Пауза',uk:'Пауза',en:'Pause'}[language],{ru:'Приостановить работу без таймера',uk:'Призупинити роботу без таймера',en:'Pause work without timer'}[language],'#i-pause'],['reset-b',{ru:'Продолжить',uk:'Продовжити',en:'Continue'}[language],{ru:'Продолжить без таймера',uk:'Продовжити без таймера',en:'Continue without timer'}[language],'#i-play']]){
     await menu(id);check(language+'/'+theme+': menu action '+id,await main.evaluate((label,aria,icon)=>{const b=document.querySelector('#task-menu [data-action=work]');return !b.disabled&&b.textContent.trim()===label&&b.getAttribute('aria-label')===aria&&b.querySelector('use').getAttribute('href')===icon;},label,aria,icon));
     await screenshot(main,path.join(out,'menu-'+id+'-'+language+'-'+theme+'.png'));await click(row(id)+' .task-more');
    }
    await screenshot(main,path.join(out,'work-'+language+'-'+theme+'.png'),{readyMs:10000});
   }
  }
  await menu('reset-a');
  check('untimed mode still offers explicit timer start',await main.evaluate(()=>{const b=document.querySelector('#task-menu [data-action=start]');return !b.hidden&&!b.disabled;}));
  await click('#task-menu [data-action=start]');check('menu starts the real timer', (await find('reset-a')).workState==='running');
  await click(row('reset-a')+' .timer');await menu('reset-a','work');await menu('reset-a','work');
  const beforeCancel=await find('reset-a');await confirmReset('reset-a',false);
  check('Cancel preserves the task and its measured intervals',JSON.stringify(await find('reset-a'))===JSON.stringify(beforeCancel));
  await menu('reset-a','resetTime');await until(()=>document.querySelector('#confirmation').open);
  native(keyWindow,'keys',{Keys:'ESCAPE'});await until(()=>!document.querySelector('#confirmation').open);
  check('Escape cancels a reset without changing measured time',JSON.stringify(await find('reset-a'))===JSON.stringify(beforeCancel));
  await confirmReset('reset-a');const cleared=await find('reset-a');
  check('confirmed reset clears intervals and preserves untimed pause',cleared.elapsedMs===0&&cleared.intervals.length===0&&cleared.workState==='paused'&&cleared.untimedState[1]===0);
  await main.evaluate(()=>window.__workApp.dispatchEvent(new CustomEvent('timerToggle')));await settle();
  check('keyboard-toggle handler resumes zero untimed work', (await find('reset-a')).workState==='working'&&(await find('reset-a')).elapsedMs===0);
  await main.evaluate(()=>window.__workApp.dispatchEvent(new CustomEvent('timerToggle')));await settle();
  check('keyboard-toggle handler pauses untimed work again',(await find('reset-a')).workState==='paused');
  await menu('reset-a');check('zero time cannot be reset again from the menu',await main.evaluate(()=>document.querySelector('#task-menu [data-action=resetTime]').disabled));await click(row('reset-a')+' .task-more');
  // Refused persistence must not silently replay the destructive command.
  await main.evaluate(()=>{const app=window.__workApp;window.__requestBase=app.request;window.__resetSaveCount=0;app.request=async function(type,...args){if(type==='save'&&++window.__resetSaveCount===1)throw Error('conflict');return window.__requestBase.call(this,type,...args);};});
  await confirmReset('reset-d');await until(()=>!document.querySelector('#error').hidden);
  check('a conflict sends one save and keeps nonzero persisted time',await main.evaluate(()=>window.__resetSaveCount===1)&&(await find('reset-d')).elapsedMs>0);
  await click('#retry');await until(()=>document.querySelector('#confirmation').open);
  check('Retry asks for confirmation again without another save',await main.evaluate(()=>window.__resetSaveCount===1));
  await click('#confirmation-accept');check('explicit retry can persist zero',(await find('reset-d')).elapsedMs===0);
  await main.evaluate(()=>{window.__workApp.request=window.__requestBase;});
  // A save that completed before its response timed out is discovered by resync.
  await main.evaluate(()=>{const app=window.__workApp;window.__requestBase=app.request;window.__resetSaveCount=0;app.request=async function(type,...args){const result=await window.__requestBase.call(this,type,...args);if(type==='save'){window.__resetSaveCount++;throw Error('timeout');}return result;};});
  await confirmReset('reset-e');
  check('late acknowledgement is resolved without repeating the reset',(await find('reset-e')).elapsedMs===0&&await main.evaluate(()=>window.__resetSaveCount===1&&document.querySelector('#error').hidden));
  await main.evaluate(()=>{window.__workApp.request=window.__requestBase;});
  await menu('reset-f','resetTime');await until(()=>document.querySelector('#confirmation').open);
  const changed=await rpc(quick,'load');changed.state.tasks.find(t=>t.id==='reset-f').title='Reset F changed externally';await rpc(quick,'save',{state:changed.state,revision:changed.revision});
  await until(()=>document.querySelector('[data-task="reset-f"] .task-title').textContent==='Reset F changed externally');
  await click('#confirmation-accept');
  check('a changed revision invalidates the old confirmation',(await find('reset-f')).elapsedMs>0&&await main.evaluate(()=>!document.querySelector('#error').hidden&&document.querySelector('#error-text').textContent==='Data changed. Open the time reset again.'));
  await click('#retry');await until(()=>document.querySelector('#confirmation').open);await click('#confirmation-accept');
  check('new confirmation resets the current task',(await find('reset-f')).elapsedMs===0);
  const ledgerBefore=(await load()).state;await confirmReset('reset-c');const ledgerAfter=(await load()).state;
  check('completed-task reset preserves completion and reputation',ledgerAfter.reputation===ledgerBefore.reputation&&JSON.stringify(ledgerAfter.events)===JSON.stringify(ledgerBefore.events)&&ledgerAfter.tasks.find(t=>t.id==='reset-c').completedAt!==null);
  await menu('reset-b','start');await wait(300);await menu('reset-b','resetTime');await until(()=>document.querySelector('#confirmation').open);
  check('running reset explains and offers a pause',await main.evaluate(()=>document.querySelector('#confirmation-accept').textContent==='Reset and pause'));
  const d=await main.host('diagnostics'),size=await main.evaluate(()=>({w:innerWidth,h:innerHeight}));
  native(d.window,'resize',{Width:Math.round(320*d.width/size.w),Height:Math.round(360*d.height/size.h)});await until(()=>innerWidth===320&&innerHeight===360);
  check('reset confirmation fits the minimum window',await main.evaluate(()=>{const r=document.querySelector('#confirmation .confirm-surface').getBoundingClientRect(),b=document.querySelector('#confirmation-accept').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&b.bottom<=innerHeight;}));
  await screenshot(main,path.join(out,'reset-confirm-minimum.png'),{readyMs:10000});await click('#confirmation-accept');
  let timed=await find('reset-b');
  if(timed.workState==='running'){
   check('a checkpoint during confirmation requires fresh consent',await main.evaluate(()=>!document.querySelector('#error').hidden));
   await click('#retry');await until(()=>document.querySelector('#confirmation').open);await click('#confirmation-accept');timed=await find('reset-b');
  }
  await wait(300);
  check('running reset remains exactly zero on timed pause',timed.workState==='paused'&&timed.untimed===undefined&&timed.elapsedMs===0&&(await find('reset-b')).elapsedMs===0);
  await click(row('reset-b')+' [data-action=stop]');
  const totals=await main.evaluate(async()=>{const {timeStats}=await import('../core/model.mjs');const loaded=await window.__deloHarnessBridge.request('load'),clock=await window.__deloHarnessBridge.request('clock');return timeStats(loaded.state,{now:Date.now(),monotonic:clock.monotonicMs,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});});
  check('all reset tasks contribute zero to day, week and legacy totals',totals.today===0&&totals.week===0&&totals.before===0);
  await main.evaluate(()=>{document.querySelector('#open-time').click();});await until(()=>document.querySelector('#time-sheet').open);
  check('time sheet shows its existing empty-total presentation',await main.evaluate(()=>document.querySelector('#time-today').textContent==='—'&&document.querySelector('#time-week').textContent==='—'));
  await click('#time-sheet [data-close]');
 }
}catch(error){failure=error;await fs.writeFile(path.join(out,phase+'-failure.json'),JSON.stringify({error:error.stack,ui:await main.evaluate(()=>({text:document.body.innerText,active:document.activeElement?.id,busy:document.querySelector('#widget').getAttribute('aria-busy')})).catch(()=>null)},null,2));}
finally{await fs.writeFile(path.join(out,phase+'.json'),JSON.stringify({checks,error:failure?.stack},null,2));main.close();quick.close();}
if(failure)throw failure;
