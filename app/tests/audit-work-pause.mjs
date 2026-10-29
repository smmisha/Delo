// П16 live check, driven by run-work-pause.ps1 against one named harness session.
//   before  the timer shortcut from another program's window, RU/UK/EN, dark and light, the pause glyph
//   after   the same profile after a saved exit and relaunch
//   older   (harness closed) makes the profile look as if a version without П16 started C's timer
//   stale   after relaunch: that kept flag no longer decides how C resumes
// Usage: node audit-work-pause.mjs before|after|older|stale <output directory> [profile, for older]
import {connect,screenshot} from './audit-harness.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';
const [phase,outDir,profileDir]=process.argv.slice(2);
if(!['before','after','older','stale'].includes(phase)||!outDir||phase==='older'&&!profileDir)throw Error('Usage: node audit-work-pause.mjs before|after|older|stale <output> [profile]');
await fs.mkdir(outDir,{recursive:true});
const results=[],steps=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,...(pass?{}:{detail})});};
async function finish(){
 await fs.writeFile(path.join(outDir,`${phase}.json`),JSON.stringify({results,steps},null,1));
 const failed=results.filter(r=>!r.pass);
 console.log(JSON.stringify({phase,pass:results.length-failed.length,fail:failed.length,failed},null,1));
 process.exit(failed.length||!results.length?1:0);
}
if(phase==='older'){
 try{
  const file=path.join(profileDir,'tasks.json'),data=JSON.parse(await fs.readFile(file,'utf8')),c=data.state.tasks.find(t=>t.title==='P16 C');
  check('older: C is paused from "in work" before the edit',c?.workState==='paused'&&typeof c.untimed==='number',c);
  // A version without П16 starting the timer: the task runs, the unknown field stays, nothing newer is touched.
  Object.assign(c,{workState:'running',timerAnchor:12345});await fs.writeFile(file,JSON.stringify(data));steps.push({label:'older',task:c});
 }catch(error){check('older: profile edited',false,String(error?.stack??error));}
 await finish();
}
const main=await connect();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ev=expression=>main.evaluate(expression);
const bridge=`const {HostBridge}=await import('./bridge.mjs');globalThis.__deloHarnessBridge??=new HostBridge();const hostBridge=globalThis.__deloHarnessBridge;`;
const settle=()=>ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));await s(80);const end=Date.now()+5000;while(document.querySelector('#widget').getAttribute('aria-busy')==='true'&&Date.now()<end)await s(25);if(document.querySelector('#widget').getAttribute('aria-busy')==='true')throw Error('Widget did not settle');await s(80);return true;})()`);
const read=async label=>{const r=await ev(`(async()=>{${bridge}const r=await hostBridge.request('load');const tasks={};for(const t of r.state.tasks)if(t.title.startsWith('P16 '))tasks[t.title.slice(4)]={workState:t.workState,untimed:t.untimed??null,elapsedMs:t.elapsedMs};
 const rows=[...document.querySelectorAll('.task[data-task]')].filter(row=>row.querySelector('.task-title')?.textContent.startsWith('P16 ')).map(row=>({task:row.querySelector('.task-title').textContent.slice(4),status:row.querySelector('.work-status')?.textContent??null,strip:[...row.querySelectorAll('.work-strip button')].map(b=>b.dataset.action+'|'+b.getAttribute('aria-label')+'|'+(b.dataset.tooltip??''))}));
 return {lang:document.documentElement.lang,dark:document.body.classList.contains('dark'),status:document.querySelector('#status').textContent,settings:{language:r.state.settings.language,theme:r.state.settings.theme},native:{timerKey:r.native?.timerKey??null,timerKeyError:r.native?.timerKeyError??null},tasks,rows};})()`);steps.push({label,...r});return r;};
const act=js=>ev(`(async()=>{const row=t=>[...document.querySelectorAll('.task[data-task]')].find(r=>r.querySelector('.task-title')?.textContent==='P16 '+t);${js}})()`).then(settle);
const create=t=>act(`const input=document.querySelector('#task-input');input.value='P16 ${t}';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();`);
const menuWork=t=>act(`row('${t}').querySelector('[data-action=more]').click();await new Promise(r=>setTimeout(r,150));const item=document.querySelector('#task-menu [data-action=work]');if(item.disabled)throw Error('work item disabled');item.click();`);
const click=(t,action)=>act(`row('${t}').querySelector('[data-action=${action}]').click();`);
const press=async label=>{const d=await main.host('diagnostics');const out=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'foreign-shortcut.ps1'),'-Window',String(d.window),'-Keys','CTRL+ALT+SHIFT+P'],{encoding:'utf8'});const k=JSON.parse(out.trim().split(/\r?\n/).at(-1));await wait(250);await settle();
 check(`${label}: pressed while another process's window had the focus; Delo did not take it`,k.foreignBefore&&!k.deloForegroundAfter,k);steps.push({label:`${label} keys`,...k});return k;};
const setting=async(name,value)=>{const r=await ev(`(async()=>{${bridge}const s=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await s(300);const form=document.querySelector('#settings-form');form.elements.${name}.value='${value}';form.elements.${name}.dispatchEvent(new Event('change',{bubbles:true}));const end=Date.now()+5000;let saved=false;while(Date.now()<end){saved=(await hostBridge.request('load')).state.settings.${name}==='${value}'&&document.querySelector('#widget').getAttribute('aria-busy')==='false';if(saved)break;await s(25);}document.querySelector('#settings [data-close]').click();await s(250);return {saved,closed:!document.querySelector('#settings').open,lang:document.documentElement.lang,dark:document.body.classList.contains('dark')};})()`);
 check(`settings ${name}=${value} saved and dialog closed`,r.saved&&r.closed,r);steps.push({label:`setting ${name}=${value}`,...r});return r;};
// The pause glyph in the strip is two lines; it must keep a stroke where the strip fills its glyphs.
const glyph=async theme=>{const g=await ev(`(()=>{const b=document.querySelector('.task [data-action=workToggle][aria-pressed=true]');if(!b)return null;const use=b.querySelector('use'),box=use.getBoundingClientRect();return {dark:document.body.classList.contains('dark'),strokeWidth:getComputedStyle(use).strokeWidth,width:box.width,height:box.height};})()`);
 check(`${theme}: the pause glyph in the strip is drawn`,g&&g.dark===(theme==='dark')&&parseFloat(g.strokeWidth)>0&&g.width>0&&g.height>0,g);};
const shot=async name=>{await main.host('show');await wait(300);await screenshot(main,path.join(outDir,`${name}.png`));};
const strip=(r,t)=>r.rows.find(x=>x.task===t)?.strip??[];
const status=(r,t)=>r.rows.find(x=>x.task===t)?.status;
const paused=t=>t?.workState==='paused'&&typeof t.untimed==='number';
const labels={ru:{working:'Пауза',paused:'Продолжить',pause:'Приостановить работу без таймера',resume:'Продолжить без таймера',stop:'Остановить',workPaused:'На паузе: P16 ',workResumed:'В работе: P16 '},
 uk:{working:'Пауза',paused:'Продовжити',pause:'Призупинити роботу без таймера',resume:'Продовжити без таймера',stop:'Зупинити',workPaused:'На паузі: P16 ',workResumed:'У роботі: P16 '},
 en:{working:'Pause',paused:'Continue',pause:'Pause work without timer',resume:'Continue without timer',stop:'Stop',workPaused:'Paused: P16 ',workResumed:'Working: P16 '}};
const rowsMatch=(r,lang,label)=>{const L=labels[lang],actions=t=>JSON.stringify(strip(r,t).map(s=>s.split('|').slice(0,2)));
 check(`${label}: C shows "${L.working}" with pause and stop`,status(r,'C')===L.working&&actions('C')===JSON.stringify([['workToggle',L.pause],['stop',L.stop]]),r.rows);
 check(`${label}: A shows "${L.paused}" with resume and stop`,status(r,'A')===L.paused&&actions('A')===JSON.stringify([['workToggle',L.resume],['stop',L.stop]]),r.rows);
 check(`${label}: tooltips repeat the labels`,[...strip(r,'A'),...strip(r,'C')].every(s=>{const [,text,tip]=s.split('|');return text===tip;}),r.rows);
 check(`${label}: B (timer paused) has only stop`,JSON.stringify(strip(r,'B').map(s=>s.split('|')[0]))==='["stop"]',r.rows);};
const toggleUntimed=async(lang,label)=>{const L=labels[lang];
 await press(`${label} pause`);let r=await read(`${label}: shortcut pauses C`);
 check(`${label}: shortcut pauses C from "in work", announced "${L.workPaused}C"`,paused(r.tasks.C)&&r.status===L.workPaused+'C',{C:r.tasks.C,status:r.status});
 await press(`${label} resume`);r=await read(`${label}: shortcut resumes C`);
 check(`${label}: shortcut returns C to work without the timer, announced "${L.workResumed}C"`,r.tasks.C.workState==='working'&&r.tasks.C.untimed===null&&r.tasks.C.elapsedMs===0&&r.status===L.workResumed+'C'&&!Object.values(r.tasks).some(t=>t.workState==='running'),{tasks:r.tasks,status:r.status});};
try {
 await main.host('show');
 if(phase==='before'){
  for(const t of ['A','B','C'])await create(t);
  let r=await read('created');
  check('three tasks created',['A','B','C'].every(t=>r.tasks[t]?.workState==='idle'),r.tasks);
  check('timer shortcut registered without error',r.native.timerKey==='Ctrl+Alt+Shift+P'&&!r.native.timerKeyError,r.native);
  const dark=await setting('theme','dark');check('dark theme applied',dark.dark===true,dark);
  await menuWork('A');r=await read('A in work');
  check('A taken into work without the timer',r.tasks.A.workState==='working',r.tasks);
  await press('ru A pause');r=await read('shortcut pauses A');
  check('shortcut pauses A from "in work", announced "На паузе: P16 A"',paused(r.tasks.A)&&r.tasks.A.elapsedMs===0&&r.status==='На паузе: P16 A',{A:r.tasks.A,status:r.status});
  check('A row: one Continue control for untimed work',status(r,'A')==='Продолжить'&&strip(r,'A')[0]?.startsWith('workToggle|Продолжить без таймера'),r.rows);
  await press('ru A resume');r=await read('shortcut resumes A');
  check('shortcut returns A to work without the timer, announced "В работе: P16 A"',r.tasks.A.workState==='working'&&r.tasks.A.untimed===null&&r.tasks.A.elapsedMs===0&&r.status==='В работе: P16 A',{A:r.tasks.A,status:r.status});
  await click('B','timer');r=await read('B timer started');
  check('starting B\'s timer pauses A from "in work"',r.tasks.B.workState==='running'&&paused(r.tasks.A),r.tasks);
  await wait(1200);
  await press('ru B pause');r=await read('shortcut pauses B');
  check('shortcut pauses the running timer, announced "Таймер на паузе: P16 B"',r.tasks.B.workState==='paused'&&r.tasks.B.untimed===null&&r.tasks.B.elapsedMs>=1000&&r.status==='Таймер на паузе: P16 B',{B:r.tasks.B,status:r.status});
  await press('ru B resume');r=await read('shortcut resumes B');
  check('shortcut resumes the timer paused last (B, not A), announced "Таймер идёт: P16 B"',r.tasks.B.workState==='running'&&r.tasks.A.workState==='paused'&&r.status==='Таймер идёт: P16 B',{tasks:r.tasks,status:r.status});
  await wait(600);
  await press('ru B pause again');r=await read('shortcut pauses B again');
  check('shortcut pauses B again',r.tasks.B.workState==='paused'&&r.status==='Таймер на паузе: P16 B',{B:r.tasks.B,status:r.status});
  await menuWork('C');r=await read('C in work');
  check('C in work; A stays paused from "in work", B paused with its time',r.tasks.C.workState==='working'&&paused(r.tasks.A)&&r.tasks.B.workState==='paused'&&r.tasks.B.untimed===null,r.tasks);
  check('one task in focus',Object.values(r.tasks).filter(t=>['working','running'].includes(t.workState)).length===1,r.tasks);
  rowsMatch(r,'ru','ru');await glyph('dark');await shot('1-ru-dark');
  for(const [index,lang] of [[2,'uk'],[3,'en']]){
   await setting('language',lang);r=await read(`${lang} rows`);
   check(`${lang}: interface switched`,r.lang===lang&&r.settings.language===lang,{lang:r.lang});
   rowsMatch(r,lang,lang);await shot(`${index}-${lang}-dark`);
   await toggleUntimed(lang,lang);
  }
  const light=await setting('theme','light');check('light theme applied',light.dark===false,light);
  await glyph('light');await shot('4-en-light');
  await setting('language','ru');r=await read('ru light rows');rowsMatch(r,'ru','ru light');await shot('5-ru-light');
  await fs.writeFile(path.join(outDir,'state-before-exit.json'),JSON.stringify((await read('before exit')).tasks,null,1));
 }else if(phase==='after'){
  const saved=JSON.parse(await fs.readFile(path.join(outDir,'state-before-exit.json'),'utf8'));
  let r=await read('after relaunch');
  check('after relaunch: C still in work, A still paused from "in work", B paused with its time',r.tasks.C.workState==='working'&&paused(r.tasks.A)&&r.tasks.B.workState==='paused'&&r.tasks.B.untimed===null&&r.tasks.B.elapsedMs===saved.B.elapsedMs,{now:r.tasks,saved});
  check('after relaunch: language and light theme kept, shortcut registered',r.settings.language==='ru'&&r.settings.theme==='light'&&r.dark===false&&r.native.timerKey==='Ctrl+Alt+Shift+P'&&!r.native.timerKeyError,{settings:r.settings,native:r.native});
  rowsMatch(r,'ru','after relaunch');await shot('6-ru-light-after-relaunch');
  await toggleUntimed('ru','after relaunch');
  await click('A','workToggle');r=await read('A back to work');
  check('after relaunch: "Вернуть в работу" on A takes the focus from C',r.tasks.A.workState==='working'&&r.tasks.A.untimed===null&&paused(r.tasks.C),r.tasks);
 }else{
  let r=await read('after recovery');
  check('stale: after recovery C is a timer pause without the flag',r.tasks.C.workState==='paused'&&r.tasks.C.untimed===null,r.tasks.C);
  check('stale: C row reads "На паузе" with stop only',status(r,'C')==='На паузе'&&JSON.stringify(strip(r,'C').map(s=>s.split('|')[0]))==='["stop"]',r.rows);
  await click('A','stop');
  await press('stale resume');r=await read('shortcut resumes C');
  check('stale: shortcut resumes C with the timer, announced "Таймер идёт: P16 C"',r.tasks.C.workState==='running'&&r.status==='Таймер идёт: P16 C',{C:r.tasks.C,status:r.status});
  await press('stale pause');r=await read('shortcut pauses C');
  check('stale: shortcut pauses C\'s timer, announced "Таймер на паузе: P16 C"',r.tasks.C.workState==='paused'&&r.tasks.C.untimed===null&&r.status==='Таймер на паузе: P16 C',{C:r.tasks.C,status:r.status});
 }
} catch(error) {check(`${phase}: scenario finished without an exception`,false,String(error?.stack??error));}
await main.host('exit').catch(()=>{});
await finish();
