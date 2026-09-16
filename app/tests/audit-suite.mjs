import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {connect,native,wait} from './audit-harness.mjs';
const out=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260911/suite.json'),main=await connect(),quick=await connect(true),results=[];
try{
 await quick.host('quickDone');await main.host('show');await main.host('pin',{pinned:true});
 for(const [page,width,height] of [[main,420,620],[quick,414,83]]){const d=await page.host('diagnostics'),scale=d.width/(await page.evaluate('innerWidth'));native(d.window,'resize',{Width:Math.round(width*scale),Height:Math.round(height*scale)});}
 for(const name of ['ui-dialogs','ui-glass-settings','ui-hotkey-recorder','ui-input','ui-menu','ui-locales','ui-undo','ui-focus','ui-reduced','ui-background-input','ui-idle','ui-quick','ui-hide-once']){
  const page=name==='ui-quick'?quick:main;
  try{await main.evaluate(`(async()=>{document.activeElement?.blur();const end=Date.now()+5000;while(document.querySelector('#widget').getAttribute('aria-busy')==='true'&&Date.now()<end)await new Promise(r=>setTimeout(r,25));if(document.querySelector('#widget').getAttribute('aria-busy')==='true')throw Error('Previous scenario did not finish saving');document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(document.querySelector('#app-menu').matches(':popover-open'))document.querySelector('#settings-open').click();if(document.querySelector('#task-menu').matches(':popover-open'))document.querySelector('#task-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`);await wait(30);
  // The glass follows whatever moves behind the widget, so "no presents while idle" only
  // means something over a still backdrop. The backdrop lives for the length of the check.
  let backdrop=null;
  if(name==='ui-idle'){const d=await page.host('diagnostics');backdrop=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'native-input.ps1'),'-Window',String(d.window),'-Action','backdrop','-HoldMs','20000'],{windowsHide:true,stdio:'ignore'});await wait(1500);}
  let result;
  try{result=await page.evaluate(await fs.readFile(path.join(import.meta.dirname,`${name}.js`),'utf8'));}
  finally{if(backdrop){backdrop.kill();await new Promise(resolve=>backdrop.exitCode!==null||backdrop.signalCode!==null?resolve():backdrop.once('exit',resolve));}}const pass=Array.isArray(result.checks)&&result.checks.length>0&&result.checks.every(c=>c.pass===true);results.push({name,pass,result});console.log(JSON.stringify({name,pass,checks:result.checks?.length}));}
  catch(error){const ui=await page.evaluate(`({busy:document.querySelector('#widget')?.getAttribute('aria-busy'),error:document.querySelector('#error-text')?.textContent,settingsError:document.querySelector('#settings-error')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),tasks:document.querySelectorAll('.task').length})`).catch(()=>null);results.push({name,pass:false,error:error.message,ui});console.log(JSON.stringify(results.at(-1)));}
 }
}finally{await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(results,null,2));main.close();quick.close();}
if(results.some(r=>!r.pass))process.exitCode=1;
