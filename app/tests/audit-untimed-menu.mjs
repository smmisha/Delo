// Narrow-window regression on a disposable named harness; does not touch a personal profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait,screenshot} from './audit-harness.mjs';
const out=path.resolve(process.argv[3]||process.argv[2]||'app/test-output/untimed-menu');
await fs.mkdir(out,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
function check(name,pass,detail){checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name);}
const load=()=>main.evaluate(async()=>{const {HostBridge}=await import('./bridge.mjs');return new HostBridge().request('load');});
async function settle(){for(let i=0;i<100;i++){if(await main.evaluate(()=>document.querySelector('#widget')?.getAttribute('aria-busy')==='false'))return;await wait(50);}throw Error('UI did not settle');}
async function menu(){await main.evaluate(()=>document.querySelector('[data-task="menu-a"] .task-more').click());await wait(100);}
async function action(){await main.evaluate(()=>document.querySelector('#task-menu [data-action=work]').click());await settle();}
try{
 const identity=await main.host('osSurfaceDiagnostics');if(!/test-output[\\/]sessions[\\/]work-reset-/.test(identity.profile))throw Error('Dedicated profile required');
 await main.host('show');await main.host('pin',{pinned:true});
 await quick.evaluate(async()=>{
  const {createState,applyCommand}=await import('../core/model.mjs'),{HostBridge}=await import('./bridge.mjs'),host=new HostBridge();
  const saved=await host.request('load'),clock=await host.request('clock');let state=createState();state.settings.autoArchive='off';
  const ctx={now:Date.now(),monotonic:clock.monotonicMs,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  state=applyCommand(state,{type:'create',id:'menu-a',title:'Длинное название задачи для проверки переноса текста и управления работой без таймера в узком окне'},ctx);
  state=applyCommand(state,{type:'work',id:'menu-a'},ctx);await host.request('save',{state,revision:saved.revision});
 });
 await main.call('Page.reload');await settle();
 const d=await main.host('diagnostics'),width=await main.evaluate('innerWidth');native(d.window,'resize',{Width:Math.round(320*d.width/width),Height:Math.round(620*d.width/width)});await wait(300);
 for(const [language,theme] of ['ru','uk','en'].flatMap(language=>['dark','light'].map(theme=>[language,theme]))){
  const label=language+'/'+theme;
  await quick.evaluate(async(language,theme)=>{const {HostBridge}=await import('./bridge.mjs'),host=new HostBridge(),saved=await host.request('load');saved.state.settings.language=language;saved.state.settings.theme=theme;await host.request('save',{state:saved.state,revision:saved.revision});},language,theme);await settle();await wait(150);
  check(label+': narrow long-title row has no duplicate controls',await main.evaluate(()=>{const r=document.querySelector('[data-task="menu-a"]');return innerWidth===320&&!r.querySelector('.work-toggle')&&r.querySelector('.task-actions .timer')&&!r.querySelector('.task-actions .timer').disabled&&!document.querySelector('#task-menu [data-action=start]')&&r.querySelector('.work-status').tagName==='SPAN'&&document.documentElement.scrollWidth<=innerWidth&&r.scrollWidth<=r.clientWidth+1;}));
  await menu();check(label+': menu offers Pause',await main.evaluate(expected=>{const b=document.querySelector('#task-menu [data-action=work]'),r=b.getBoundingClientRect();return !b.disabled&&b.textContent.trim()===expected&&b.querySelector('use').getAttribute('href')==='#i-pause'&&r.left>=0&&r.right<=innerWidth&&b.scrollWidth<=b.clientWidth;},language==='en'?'Pause without timer':'Пауза без таймера'));
  await screenshot(main,path.join(out,language+'-'+theme+'-menu.png'));
  await action();let task=(await load()).state.tasks[0];check(label+': menu pauses without counting',task.workState==='paused'&&task.elapsedMs===0);
  check(label+': focus returns to task More',await main.evaluate(()=>document.activeElement?.matches('[data-task="menu-a"] .task-more')));
  await menu();check(label+': same item offers Continue',await main.evaluate(expected=>{const b=document.querySelector('#task-menu [data-action=work]');return b.textContent.trim()===expected&&b.scrollWidth<=b.clientWidth;},{ru:'Продолжить без таймера',uk:'Продовжити без таймера',en:'Continue without timer'}[language]));
  if(language==='ru')await screenshot(main,path.join(out,language+'-'+theme+'-continue.png'));
  await action();task=(await load()).state.tasks[0];check(label+': continue remains untimed',task.workState==='working'&&task.elapsedMs===0);
 }
 await main.click('[data-task="menu-a"] .timer');await settle();await wait(200);
 check('row Play starts a real timer from untimed work', (await load()).state.tasks[0].workState==='running');
 await main.evaluate(()=>document.querySelector('[data-task="menu-a"] .timer').click());await settle();
 const task=(await load()).state.tasks[0];check('row timer still pauses measured time',task.workState==='paused'&&task.elapsedMs>0);
 await menu();await action();await menu();await action();
 const untimed=(await load()).state.tasks[0];check('untimed pause preserves previously measured time',untimed.workState==='paused'&&untimed.elapsedMs===task.elapsedMs&&untimed.untimedState?.[1]===untimed.elapsedMs);
 await main.click('[data-task="menu-a"] .timer');await settle();await wait(200);
 check('row Play also starts measuring from untimed pause',(await load()).state.tasks[0].workState==='running');
 await main.click('[data-task="menu-a"] .timer');await settle();
 check('row Pause preserves timer mode and accumulated time',await main.evaluate(async()=>{const {HostBridge}=await import('./bridge.mjs'),{untimedPause}=await import('../core/model.mjs');const t=(await new HostBridge().request('load')).state.tasks[0];return t.workState==='paused'&&!untimedPause(t)&&t.elapsedMs>0;}));
 const diagnostics=await main.host('diagnostics');check('renderer remains healthy',diagnostics.healthy&&diagnostics.errors===0);
}finally{await fs.writeFile(path.join(out,'untimed-menu.json'),JSON.stringify(checks,null,2));main.close();quick.close();}
console.log(JSON.stringify({passed:checks.length}));
