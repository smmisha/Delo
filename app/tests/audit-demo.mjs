// Demo mode, judged the way a screen share judges it: by what a real screen capture contains.
// The widget hides from capture by design (its glass is built from a capture of the desktop
// behind it); the tray's demo mode releases both windows so viewers can see them.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connect,native,wait,ready} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/demo'),main=await connect(),quick=await connect(true),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
const until=async(page,expression,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await page.evaluate(expression))return true;await wait(50);}return false;};
let backdrop;
try{
 await fs.mkdir(output,{recursive:true});
 await quick.host('quickDone');await main.host('show');await main.host('pin',{pinned:true});
 await main.evaluate(`document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close())`);
 {const d=await main.host('diagnostics'),scale=d.width/await main.evaluate('innerWidth');native(d.window,'resize',{Width:Math.round(420*scale),Height:Math.round(620*scale)});await ready(main);}
 // Text over the widget region makes the difference between "shown" and "hidden" large even
 // over a dark desktop.
 const titles=['Позвонить в сервис','Купить продукты','Оплатить интернет'];
 const counts=()=>main.evaluate(titles=>titles.map(title=>[...document.querySelectorAll('.task-title')].filter(node=>node.textContent===title).length),titles);
 const beforeCounts=await counts();
 for(const title of titles){
  await main.evaluate((taskTitle)=>{const input=document.querySelector('#task-input');input.value=taskTitle;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;},title);await wait(650);
 }
 const afterCounts=await counts();check('each demo title is added exactly once',afterCounts.every((n,i)=>n===beforeCounts[i]+1),{before:beforeCounts,after:afterCounts});
 await main.host('theme',{dark:false});await main.evaluate(`document.body.classList.toggle('dark',false)`);await wait(500);
 const window_=(await main.host('diagnostics')).window;
 // Capture exclusion reveals the desktop behind the widget. Hold it still so a
 // video or another app cannot raise the noise threshold above any possible signal.
 const backdropReady=path.join(output,'backdrop-ready.json');await fs.rm(backdropReady,{force:true});
 backdrop=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'native-input.ps1'),'-Window',String(window_),'-Action','backdrop','-HoldMs','60000','-OutputPath',backdropReady],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let backdropError='';backdrop.stderr.on('data',data=>{backdropError+=data;});backdrop.on('error',error=>{backdropError+=error.message;});
 if(!backdrop.pid)throw Error('Cannot start harness backdrop');
 let backdropState;
 for(const end=Date.now()+5000;Date.now()<end;){
  if(backdrop.exitCode!==null||backdrop.signalCode!==null)throw Error('Harness backdrop exited before capture: '+backdropError);
  try{backdropState=JSON.parse(await fs.readFile(backdropReady,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  if(backdropState?.pid===backdrop.pid&&backdropState.window>0)break;
  await wait(50);
 }
 if(backdropState?.pid!==backdrop.pid||!(backdropState.window>0))throw Error('Harness backdrop did not become ready');
 const capture=async name=>{if(backdrop.exitCode!==null||backdrop.signalCode!==null)throw Error('Harness backdrop expired before capture');const file=path.join(output,name);native(window_,'capture',{OutputPath:file});if(backdrop.exitCode!==null||backdrop.signalCode!==null)throw Error('Harness backdrop expired during capture');return file;};
 const changed=(first,second)=>native(window_,'diff',{Base:first,Overlay:second}).diff.changed;

 // 1. Ordinary state: the window is excluded, so a capture of its region is the desktop alone.
 const hiddenA=await capture('hidden-a.png');await wait(200);const hiddenB=await capture('hidden-b.png');
 const noise=changed(hiddenA,hiddenB);
 // Only the visible window is judged here: a quick capsule that has never been shown has no
 // renderer yet, so it has not been excluded yet either, and nothing shows it anyway.
 const before=await main.host('diagnostics');
 check('by default the visible window is excluded from capture and the glass runs',before.displayAffinity===17&&before.healthy&&!before.demoMode,{main:before.displayAffinity,healthy:before.healthy,demoMode:before.demoMode});

 // 2. Demo mode on.
 await main.host('demo',{enabled:true});
 const matte=await until(main,`document.body.classList.contains('demo')`);
 await wait(400);
 const on=await main.host('diagnostics'),quickOn=await quick.host('diagnostics');
 check('demo mode releases both windows to capture and switches the glass off',on.demoMode&&on.displayAffinity===0&&quickOn.displayAffinity===0&&!on.healthy,{main:on.displayAffinity,quick:quickOn.displayAffinity,healthy:on.healthy});
 check('the interface switches to its matte material',matte&&await main.evaluate(`getComputedStyle(document.querySelector('#widget')).backgroundColor!=='rgba(0, 0, 0, 0)'`),{demoClass:matte});
 const shown=await capture('shown.png');
 const visible=changed(hiddenA,shown);
 check('a real screen capture now contains the widget',visible>Math.max(0.05,noise*10),{changedShare:visible,noiseShare:noise});
 // Screenshot preparation is moot while presenting and must not undo the mode.
 await main.host('freezeForScreenshot');const prep=await main.host('diagnostics');await main.host('finishScreenshot');
 const afterPrep=await main.host('diagnostics');
 check('screenshot preparation leaves demo mode intact',!prep.captureFrozen&&afterPrep.displayAffinity===0&&afterPrep.demoMode,{frozen:prep.captureFrozen,affinity:afterPrep.displayAffinity});

 // 3. Demo mode off: hidden from capture again, the glass is back.
 await main.host('demo',{enabled:false});
 const restored=await ready(main);
 await until(main,`!document.body.classList.contains('demo')`);
 const off=await main.host('diagnostics'),quickOff=await quick.host('diagnostics');
 check('turning demo mode off hides both windows again and restores the glass',!off.demoMode&&off.displayAffinity===17&&quickOff.displayAffinity===17&&restored.healthy,{main:off.displayAffinity,quick:quickOff.displayAffinity,healthy:restored.healthy});
 await wait(400);
 const hiddenC=await capture('hidden-c.png');
 const leaked=changed(hiddenA,hiddenC);
 // The desktop behind can move on its own (a video, a clock) between the two captures, so the
 // comparison asks whether the widget is there, not whether nothing changed: a widget that
 // leaked would change nearly as many pixels as it did while shown.
 check('a real screen capture no longer contains the widget',leaked<visible*0.5,{changedShare:leaked,shownShare:visible,noiseShare:noise});
}finally{
 try{
 try{await main.host('demo',{enabled:false});}catch{}
 await fs.writeFile(path.join(output,'demo.json'),JSON.stringify(checks,null,2));
 }finally{
  main.close();quick.close();
  if(backdrop?.pid&&backdrop.exitCode===null&&backdrop.signalCode===null){const exited=once(backdrop,'exit');backdrop.kill();await exited;}
 }
}
if(checks.some(entry=>!entry.pass))process.exitCode=1;
