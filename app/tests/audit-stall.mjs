// A held-up host thread. The page stops waiting for a reply after 15 s, but the host still acts
// on the request afterwards, so a save the page counted as failed can land and leave the page's
// revision stale. Before the fix the next save was refused ("data changed in another window",
// with no other window), and when the reload that followed also came late the widget stopped
// for good: no saves, no input, Retry and tray Exit did nothing. The host is really suspended
// here; the page only holds a request back so the suspension can start before it is sent.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connect,wait} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/stall'),main=await connect(),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
const stallHost=mode=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'stall-harness.ps1'),'-Mode',mode],{encoding:'utf8',windowsHide:true,timeout:30000});
const banner=()=>main.evaluate(`document.querySelector('#error').hidden?null:document.querySelector('#error-text').textContent`);
const titled=title=>`[...document.querySelectorAll('.task[data-task]')].find(row=>row.querySelector('.task-title')?.textContent===${JSON.stringify(title)})`;
const add=title=>main.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
// Only saves the host acknowledged in time are counted.
const saves=()=>main.evaluate(`window.__stallSaves`);
const arm=type=>main.evaluate(`(window.__stallRelease.delete(${JSON.stringify(type)}),window.__stallArmed.add(${JSON.stringify(type)}),true)`);
const held=async type=>{const end=Date.now()+30000;while(!await main.evaluate(`window.__stallRelease.has(${JSON.stringify(type)})`)){if(Date.now()>end)throw Error(`The page never sent ${type}`);await wait(50);}};
// Longer than the page's 15 s reply timeout.
const stall=async type=>{stallHost('suspend');try{await main.evaluate(`window.__stallRelease.get(${JSON.stringify(type)})()`);await wait(18000);}finally{stallHost('resume');}};
const savesResume=async ms=>{const from=await saves(),end=Date.now()+ms;while(Date.now()<end){if(await saves()>=from+2)return true;await wait(250);}return false;};
const timer='Проверка зависшего хоста',action='Проверка повтора после сбоя';
try{
 await fs.mkdir(output,{recursive:true});
 await main.host('show');await main.evaluate(`document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close())`);
 await main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const original=HostBridge.prototype.__stallOriginal??HostBridge.prototype.request;HostBridge.prototype.__stallOriginal=original;
  window.__stallArmed=new Set();window.__stallRelease=new Map();window.__stallSaves=0;
  HostBridge.prototype.request=function(type,payload){const send=()=>{const reply=original.call(this,type,payload);if(type==='save')reply.then(()=>window.__stallSaves++,()=>{});return reply;};
   if(!window.__stallArmed.delete(type))return send();return new Promise(resolve=>window.__stallRelease.set(type,resolve)).then(send);};return true;})()`);
 if(!await main.evaluate(`!!${titled(timer)}`)){await add(timer);await wait(700);}
 await main.evaluate(`${titled(timer)}.querySelector('.timer').click()`);
 check('a running timer checkpoints in the background',await savesResume(12000),{saves:await saves()});

 // 1. One save answered late. It landed, so it counts as saved: no conflict, no message.
 await arm('save');await held('save');await stall('save');await wait(1500);
 const late=await banner();
 check('a save answered late is recognised as landed and shows no error',late===null,{banner:late});
 check('saving carries on after a late answer',await savesResume(15000),{saves:await saves()});

 // 2. The reload after a late save is answered late too. The page reloads by itself.
 await arm('save');await held('save');await arm('load');await stall('save');await held('load');await stall('load');
 check('after a failed reload the page reloads by itself and saves again',await savesResume(20000),{saves:await saves()});
 const recovered=await banner();
 check('a background failure leaves no error once recovered',recovered===null,{banner:recovered});
 const before=await main.evaluate(`${titled(timer)}.classList.contains('done')`);
 await main.evaluate(`${titled(timer)}.querySelector('.complete').click()`);await wait(1500);
 const after=await main.evaluate(`${titled(timer)}.classList.contains('done')`);
 check('the widget responds to input again',before===false&&after===true,{before,after});
 await main.evaluate(`${titled(timer)}.querySelector('.complete').click()`);await wait(1000);

 // 3. A user's action whose reload fails: the message must not claim the data was refreshed,
 // and Retry must save the action once the host answers again.
 await arm('clock');await add(action);await held('clock');await arm('load');await stall('clock');await held('load');await stall('load');await wait(500);
 const failed=await banner();
 check('the message does not claim the data was refreshed',failed!==null&&!/Обновлены|Оновлено|refreshed/i.test(failed),{banner:failed});
 await wait(4000);await main.evaluate(`document.querySelector('#retry').click()`);await wait(2500);
 const count=await main.evaluate(`[...document.querySelectorAll('.task-title')].filter(node=>node.textContent===${JSON.stringify(action)}).length`);
 check('Retry saves the action once the host answers',count===1&&await banner()===null,{count,banner:await banner()});
}finally{
 try{stallHost('resume');}catch{}
 try{await main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');if(HostBridge.prototype.__stallOriginal)HostBridge.prototype.request=HostBridge.prototype.__stallOriginal;return true;})()`);}catch{}
 await fs.writeFile(path.join(output,'stall.json'),JSON.stringify(checks,null,2));main.close();
}
if(checks.some(entry=>!entry.pass))process.exitCode=1;
