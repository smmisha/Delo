// Stage A: closing the first version on the current build (SPEC section 12). One snapshot after
// a real Windows event that a person performs: sleep (V13), a display scale change (V10, N03),
// a monitor connected or removed or an Explorer restart (V02). Checks the harness widget and
// the user's own installed widget. Usage:
//   node lifecycle-check.mjs baseline            before the first event
//   node lifecycle-check.mjs <mode> <label>      after it; mode: sleep | scale | monitor | explorer | desktop
// Screenshots can show the user's desktop through the glass, so they stay in test-output.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connect,wait,screenshot} from './audit-harness.mjs';

const [mode='baseline',label=mode,outArg]=process.argv.slice(2);
if(!['baseline','sleep','scale','monitor','explorer','desktop'].includes(mode))throw Error(`Unknown mode ${mode}`);
const out=path.resolve(outArg||'test-output/lifecycle');await fs.mkdir(out,{recursive:true});
const TITLE='Lifecycle timer';
const main=await connect(),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify({name,pass:!!pass,details}));};
const native=(hwnd,since)=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'lifecycle-native.ps1'),'-Window',String(hwnd),...(since?['-Since',since]:[])],{encoding:'utf8',windowsHide:true}));
const load=()=>main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const r=await new HostBridge().request('load');const tasks=r.state?.tasks??[];const t=tasks.find(t=>t.title===${JSON.stringify(TITLE)});return {revision:r.revision,count:tasks.length,monotonic:r.monotonicMs,timer:t?{workState:t.workState,elapsedMs:t.elapsedMs,timerAnchor:t.timerAnchor}:null};})()`);
// Time the timer shows right now: saved time plus the running stretch since its anchor.
const shown=data=>data.timer?data.timer.elapsedMs+(data.timer.workState==='running'?data.monotonic-data.timer.timerAnchor:0):0;
const row=`[...document.querySelectorAll('.task[data-task]')].find(r=>r.querySelector('.task-title')?.textContent===${JSON.stringify(TITLE)})`;
try{
 const wall=Date.now();
 if(mode==='baseline'){
  // The widget under test carries a running timer, as a person's would during the event.
  await main.host('show');
  if(!(await load()).timer){await main.evaluate(`(()=>{const i=document.querySelector('#task-input');i.value=${JSON.stringify(TITLE)};i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);await wait(1200);}
  if((await load()).timer?.workState!=='running'){await main.evaluate(`${row}.querySelector('.timer').click()`);await wait(1200);}
 }
 // The glass may be rebuilding right after the event; the app gives itself 10 s as well.
 let d;const end=Date.now()+10000;
 do{d=await main.host('diagnostics');if(d.healthy&&d.errors===0&&d.materialWidth===d.clientWidth&&d.materialHeight===d.clientHeight)break;await wait(200);}while(Date.now()<end);
 const base=mode==='baseline'?null:JSON.parse(await fs.readFile(path.join(out,'baseline.json'),'utf8'));
 const n=native(d.window,base?.startedAt);
 const page=await main.evaluate(`(()=>{const i=document.querySelector('#task-input').getBoundingClientRect();return {dpr:devicePixelRatio,innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,input:{top:i.top,bottom:i.bottom,left:i.left,right:i.right},clipped:[...document.querySelectorAll('.task-title')].filter(e=>e.scrollWidth>e.clientWidth+1).length};})()`);
 const t0=performance.now();await main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');await new HostBridge().request('clock');return true;})()`);const clockMs=Math.round(performance.now()-t0);
 const data=await load();

 check('the widget is visible, not minimized',d.windowVisible&&n.visible&&!n.iconic,{windowVisible:d.windowVisible,visible:n.visible,iconic:n.iconic});
 check('the glass is healthy',d.healthy&&d.errors===0,{healthy:d.healthy,errors:d.errors,recoveries:d.recoveries,error:d.error});
 check('glass, window and page have one size',d.materialWidth===d.clientWidth&&d.materialHeight===d.clientHeight&&Math.abs(d.webWidth-d.clientWidth)<=1&&Math.abs(d.webHeight-d.clientHeight)<=1,{client:[d.clientWidth,d.clientHeight],material:[d.materialWidth,d.materialHeight],web:[d.webWidth,d.webHeight]});
 check('the window lies within its monitor work area',n.rect.left>=n.work.left&&n.rect.top>=n.work.top&&n.rect.right<=n.work.right&&n.rect.bottom<=n.work.bottom,{rect:n.rect,work:n.work,monitor:n.monitor,monitors:n.monitors});
 check('the page renders at the monitor scale',Math.abs(page.dpr-n.dpi/96)<0.01,{dpr:page.dpr,dpi:n.dpi,scale:`${Math.round(n.dpi/96*100)}%`});
 check('input is on screen, nothing overflows',page.input.top>=0&&page.input.bottom<=page.innerHeight+1&&page.input.left>=0&&page.input.right<=page.innerWidth+1&&page.scrollWidth<=page.innerWidth&&page.clipped===0,page);
 check('the host answers at once',clockMs<200,{clockMs});
 check("the user's own widget is up and answering",n.production.running&&n.production.visible&&!n.production.iconic&&n.production.responds,n.production);
 if(base){
  check('no Delo crash or hang was recorded',!n.crashes?.length,{crashes:n.crashes});
  check('no task was lost or added',data.count===base.data.count,{before:base.data.count,after:data.count});
  const monotonicDelta=data.monotonic-base.data.monotonic,wallDelta=wall-base.wall;
  if(mode==='sleep'){
   check('suspend and resume were received',d.powerSuspends>base.diagnostics.powerSuspends&&d.powerResumes>base.diagnostics.powerResumes,{suspends:[base.diagnostics.powerSuspends,d.powerSuspends],resumes:[base.diagnostics.powerResumes,d.powerResumes],sleepEvents:n.sleepEvents});
   // On Modern Standby laptops the unbiased clock keeps running through sleep, so it cannot show
   // the sleep; Windows' own enter/exit records can. Keeping the timer out of that time is the
   // app's pause on suspend, checked below.
   check('Windows recorded the machine going to sleep and waking',n.sleepEvents?.some(e=>/ (506|42)$/.test(e))&&n.sleepEvents?.some(e=>/ (507|107)$/.test(e)),{sleepEvents:n.sleepEvents,wallSeconds:Math.round(wallDelta/1000),unbiasedSeconds:Math.round(monotonicDelta/1000)});
   check('the timer is paused, not resumed by itself',data.timer?.workState==='paused',data.timer);
   check('sleep time is not counted',shown(data)-shown(base.data)<=monotonicDelta+2000,{addedSeconds:Math.round((shown(data)-shown(base.data))/1000),awakeSeconds:Math.round(monotonicDelta/1000)});
  }else{
   check('the timer keeps running',data.timer?.workState==='running',data.timer);
   check('the timer counted the time in between',Math.abs(shown(data)-shown(base.data)-monotonicDelta)<3000,{addedSeconds:Math.round((shown(data)-shown(base.data))/1000),awakeSeconds:Math.round(monotonicDelta/1000)});
  }
 }
 await screenshot(main,path.join(out,`${label}.png`),{readyMs:10000}).catch(error=>check('a screenshot could be taken',false,{error:error.message}));
 const record={mode,label,wall,startedAt:base?.startedAt??new Date(wall).toISOString(),diagnostics:{powerSuspends:d.powerSuspends,powerResumes:d.powerResumes,recoveries:d.recoveries},native:n,page,data,checks};
 await fs.writeFile(path.join(out,`${label}.json`),JSON.stringify(record,null,2));
 if(mode==='baseline')await fs.writeFile(path.join(out,'baseline.json'),JSON.stringify(record,null,2));
 console.log(`${label}: ${checks.filter(c=>c.pass).length}/${checks.length} PASS`);
}finally{main.close();}
if(checks.some(c=>!c.pass))process.exitCode=1;
