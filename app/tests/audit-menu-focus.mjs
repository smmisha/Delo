// Delayed-write focus regression. Only disposable named profiles are accepted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,wait} from './audit-harness.mjs';
const out=path.resolve(process.argv[3]||process.argv[2]);await fs.mkdir(out,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
function check(name,pass,detail){checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name);}
async function until(fn){for(let i=0;i<200;i++){if(await main.evaluate(fn))return;await wait(25);}throw Error('Focus probe timed out');}
const settle=()=>until(()=>document.querySelector('#widget').getAttribute('aria-busy')==='false');
let failure;
try{
 for(const page of [main,quick]){const d=await page.host('osSurfaceDiagnostics');if(!/test-output[\\/]sessions[\\/]work-reset-/.test(d.profile))throw Error('Dedicated work-reset profile required');}
 await main.host('show');await main.host('pin',{pinned:true});
 await quick.evaluate(async()=>{
  const {createState,applyCommand}=await import('../core/model.mjs'),{HostBridge}=await import('./bridge.mjs'),host=new HostBridge(),saved=await host.request('load'),clock=await host.request('clock');
  let state=createState();state.settings.autoArchive='off';state.settings.checkUpdates=false;
  const ctx={now:Date.now(),monotonic:clock.monotonicMs,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  state=applyCommand(state,{type:'create',id:'focus-a',title:'Slow save focus regression'},ctx);state=applyCommand(state,{type:'work',id:'focus-a'},ctx);await host.request('save',{state,revision:saved.revision});
 });
 await main.call('Page.reload');await until(()=>!!document.querySelector('[data-task="focus-a"]'));await settle();
 for(const [action,expected] of [['pause','paused'],['continue','working']]){
  await main.evaluate(async()=>{
   const {HostBridge}=await import('./bridge.mjs'),original=HostBridge.prototype.request;
   const gate=window.__menuFocusSave={released:false,held:false,release:null,restore:()=>{HostBridge.prototype.request=original;}};
   HostBridge.prototype.request=function(type,...args){
    if(type==='save'&&!gate.held){gate.held=true;return new Promise((resolve,reject)=>{gate.release=()=>{if(gate.released)return;gate.released=true;original.call(this,type,...args).then(resolve,reject);};});}
    return original.call(this,type,...args);
   };
   document.querySelector('[data-task="focus-a"] .task-more').click();document.querySelector('#task-menu [data-action=work]').click();
  });
  try{
   await until(()=>!!window.__menuFocusSave?.release);
   check(action+': store response is held while busy',await main.evaluate(()=>document.querySelector('#widget').getAttribute('aria-busy')==='true'));
   const draft='Draft entered during '+action;
   await main.evaluate(draft=>{const input=document.querySelector('#task-input');input.focus();input.value=draft;input.dispatchEvent(new Event('input',{bubbles:true}));},draft);
   check(action+': task input accepts typing during save',await main.evaluate(()=>document.activeElement?.id==='task-input'));
   await main.evaluate(()=>{window.__menuFocusSave.release();});await settle();
   const focus=await main.evaluate(async()=>{await new Promise(requestAnimationFrame);return {active:document.activeElement?.id,action:document.activeElement?.dataset.action,draft:document.querySelector('#task-input').value};});
   check(action+': acknowledgement preserves input focus and draft',focus.active==='task-input'&&focus.draft===draft,focus);
   const task=await main.evaluate(async()=>{const {HostBridge}=await import('./bridge.mjs');return (await new HostBridge().request('load')).state.tasks.find(t=>t.id==='focus-a');});
   check(action+': intended untimed state is saved',task.workState===expected&&task.elapsedMs===0);
  }finally{await main.evaluate(()=>{const gate=window.__menuFocusSave;if(gate){gate.restore();gate.release?.();delete window.__menuFocusSave;}});await settle();}
 }
 const d=await main.host('diagnostics');check('renderer remains healthy',d.healthy&&d.errors===0);
}catch(error){failure=error;}
finally{await fs.writeFile(path.join(out,'menu-focus.json'),JSON.stringify({checks,error:failure?.stack},null,2));main.close();quick.close();}
if(failure)throw failure;console.log(JSON.stringify({passed:checks.length}));
