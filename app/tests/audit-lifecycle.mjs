import fs from 'node:fs/promises';import path from 'node:path';import {connect} from './audit-harness.mjs';
const page=await connect(),results=[],out=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260911/lifecycle.json');
try{
 await page.host('hide');await page.host('show');
 await page.evaluate(`(()=>{window.auditMessages=[];chrome.webview.addEventListener('message',e=>{const m=e.data;window.auditMessages.push({id:m.id,event:m.event,ok:m.ok,error:m.error,revision:m.result?.revision});if(window.auditMessages.length>80)window.auditMessages.shift();});})()`);
 for(let run=1;run<=3;run++){
  await page.evaluate(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);
  try{const result=await page.evaluate(await fs.readFile(path.join(import.meta.dirname,'ui-undo.js'),'utf8'));results.push({run,pass:result.checks.every(c=>c.pass),result});}
  catch(error){const details=await page.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const data=await new HostBridge().request('load');return {messages:window.auditMessages,tasks:data.state.tasks.filter(t=>t.title.startsWith('Lifecycle')).map(t=>({id:t.id,title:t.title,lifecycle:t.lifecycle})),busy:document.querySelector('#widget').getAttribute('aria-busy'),errorVisible:!document.querySelector('#error').hidden,confirmation:document.querySelector('#confirmation').open};})()`);results.push({run,pass:false,error:error.message,details});break;}
  console.log(JSON.stringify({run,pass:results.at(-1).pass}));
 }
}finally{await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(results,null,2));page.close();}
if(results.some(r=>!r.pass))process.exitCode=1;
