// V14/V15. The window thread must not wait for the disk (N06): with every data write held for
// 5 s, the host still answers at once, the glass keeps drawing, the page shows the save as in
// progress, a second action queues behind the first and both land with the right revisions.
// A running timer is written about every 15 s (N07), not every 5.
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,wait} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/store-timing'),main=await connect(),quick=await connect(true),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
const load=()=>main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const r=await new HostBridge().request('load');return {revision:r.revision,titles:r.state.tasks.map(t=>t.title),running:r.state.tasks.filter(t=>t.workState==='running').map(t=>t.title)};})()`);
const add=(title,page=main)=>page.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
// Round trip of a request the host answers without touching the disk.
const clockMs=()=>main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const t=performance.now();await new HostBridge().request('clock');return Math.round(performance.now()-t);})()`);
const titled=title=>`[...document.querySelectorAll('.task[data-task]')].find(row=>row.querySelector('.task-title')?.textContent===${JSON.stringify(title)})`;
try{
 await fs.mkdir(output,{recursive:true});
 await main.host('show');await main.evaluate(`document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close())`);
 const stamp=Date.now(),first=`Медленный диск A ${stamp}`,second=`Медленный диск B ${stamp}`;
 const before=await load();

 // V14. Every write is held 5 s from here on.
 await main.host('storeDelay',{ms:5000});
 const rendered=(await main.host('diagnostics')).rendered;
 await add(first);await wait(300);
 const busy=await main.evaluate(`document.querySelector('#widget').getAttribute('aria-busy')`);
 const replies=[];for(let i=0;i<8;i++){replies.push(await clockMs());await wait(150);}
 const diagnostics=await main.host('diagnostics');
 check('the host answers at once while a write is held',Math.max(...replies)<200,{replies});
 check('the glass stays healthy while a write is held',diagnostics.healthy&&diagnostics.errors===0,{healthy:diagnostics.healthy,errors:diagnostics.errors,rendered:[rendered,diagnostics.rendered]});
 check('the page shows the save as in progress',busy==='true',{busy});
 // The quick window adds a task while the list's write is still held. Its save is refused once
 // (its revision is behind by then) and must be applied again by itself, not shown as an error.
 await wait(1200);await add(second,quick);
 const end=Date.now()+30000;let after;
 while(Date.now()<end){after=await load();if(after.titles.includes(first)&&after.titles.includes(second))break;await wait(250);}
 const quickError=await quick.evaluate(`document.querySelector('#error').hidden?null:document.querySelector('#error-text').textContent`);
 check('a task added in the quick window during the held write lands without an error',after.titles.includes(second)&&quickError===null,{quickError});
 const error=await main.evaluate(`document.querySelector('#error').hidden?null:document.querySelector('#error-text').textContent`);
 check('both actions land with consecutive revisions',after.titles.includes(first)&&after.titles.includes(second)&&after.revision===before.revision+2,{before:before.revision,after:after.revision});
 check('no error is shown for a slow write',error===null,{error});
 await main.host('storeDelay',{ms:0});

 // V15. A running timer checkpoints about every 15 s.
 await main.evaluate(`${titled(first)}.querySelector('.timer').click()`);await wait(1500);
 const started=await load();
 const revisions=[];const t0=Date.now();let last=started.revision;
 while(Date.now()-t0<31000){const r=(await load()).revision;if(r!==last){revisions.push({at:Date.now()-t0,revision:r});last=r;}await wait(250);}
 const gaps=revisions.map((r,i)=>r.at-(i?revisions[i-1].at:0));
 check('a running timer writes at most 3 times in 31 s',revisions.length>=1&&revisions.length<=3,{writes:revisions.length,revisions});
 check('checkpoints come about every 15 s',gaps.slice(1).every(g=>g>=13000&&g<=17000),{gaps});
 await main.evaluate(`${titled(first)}.querySelector('.stop-work')?.click()`);await wait(800);
}finally{
 try{await main.host('storeDelay',{ms:0});}catch{}
 await fs.writeFile(path.join(output,'store-timing.json'),JSON.stringify(checks,null,2));main.close();quick.close();
}
if(checks.some(entry=>!entry.pass))process.exitCode=1;
