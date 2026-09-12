// Live regression check; use a disposable named harness, never a personal profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait,screenshot} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/material-groups');
await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
function check(name,pass,details){checks.push({name,pass:!!pass,details});if(!pass)throw Error(name);}
try{
 await main.host('show');await main.host('pin',{pinned:true});
 // Append only synthetic tasks, preserving anything entered during manual review.
 await main.evaluate(`(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const bridge=new HostBridge();
  const {createState,applyCommand,makeDeadline}=await import('../core/model.mjs');
  const saved=await bridge.request('load');if(saved.state?.tasks.some(t=>t.id.startsWith('material-')))return;
  let state=saved.state||createState();const now=Date.now(),context={now,monotonic:saved.monotonicMs,timeZone:'UTC'};
  for(let i=0;i<20;i++)state=applyCommand(state,{type:'create',id:'material-'+i,
   title:i===4?'Длинная задача для проверки переноса заголовка и выравнивания действий в узком виджете':'Проверить задачу '+(i+1),
   due:i<10?makeDeadline(new Date(now+86400000).toISOString().slice(0,10),'','UTC'):null},context);
  await bridge.request('save',{state,revision:saved.revision});
 })()`);
 // A save acknowledgement goes to its caller; reload the app after out-of-band seeding.
 await main.call('Page.reload');
 for(let i=0;!await main.evaluate(`document.readyState==='complete'&&document.querySelector('#widget')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('.task').length>0`);i++){if(i===80)throw Error('Seeded app did not load');await wait(100);}
 for(const theme of ['light','dark']){
  await main.evaluate(`(()=>{document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();})()`);await wait(300);
  for(let i=0;!await main.evaluate(`document.querySelector('#settings').open`);i++){if(i===50)throw Error('Settings did not open');await wait(100);}
  await main.evaluate(`(()=>{const field=document.querySelector('[name=theme]');field.value=${JSON.stringify(theme)};field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  for(let i=0;!await main.evaluate(`document.body.classList.contains('dark')===${theme==='dark'}&&document.querySelector('#widget').getAttribute('aria-busy')==='false'`);i++){if(i===50)throw Error('Theme was not applied');await wait(100);}
  check(`${theme}: actual theme applied`,await main.evaluate(`document.body.classList.contains('dark')===${theme==='dark'}`));
  await main.click('#settings [data-close]');
  for(const width of [420,320]){
   const d=await main.host('diagnostics'),scale=d.width/await main.evaluate('innerWidth');
   native(d.window,'resize',{Width:Math.round(width*scale),Height:Math.round(620*scale)});await wait(200);
   const result=await main.evaluate(`(()=>{
    const pane=document.querySelector('#widget'),scroll=document.querySelector('#task-scroll');scroll.scrollTop=150;
    const group=document.querySelector('.task-group'),heading=group.querySelector('h2');
    const r=heading.getBoundingClientRect(),s=scroll.getBoundingClientRect(),p=getComputedStyle(pane);
    return {paneImage:p.backgroundImage,paneColor:p.backgroundColor,height:r.height,top:r.top,scrollTop:s.top,
     right:r.right,scrollRight:s.right,overflow:scroll.scrollWidth>scroll.clientWidth,position:getComputedStyle(heading).position};
   })()`);
   check(`${theme}/${width}: compact heading sticks inside the scroll viewport`,result.height>=44&&result.height<=48&&Math.abs(result.top-result.scrollTop)<2&&result.right<=result.scrollRight&&!result.overflow,result);
   await wait(150);await screenshot(main,path.join(output,`${theme}-${width}.png`));
  }
  await main.evaluate(`document.querySelector('#task-scroll').scrollTop=0`);
  await main.click('.task-group .group-toggle');
  const collapsed=await main.evaluate(`(()=>{const g=document.querySelector('.task-group');return g.querySelector('.group-toggle').getAttribute('aria-expanded')==='false'&&[...g.querySelectorAll('.task')].every(e=>getComputedStyle(e).display==='none');})()`);
  check(`${theme}: sticky group can collapse`,collapsed);
  const d=await main.host('diagnostics');native(d.window,'keys',{Keys:'ENTER'});await wait(150);
  check(`${theme}: keyboard reopens the focused group`,await main.evaluate(`document.querySelector('.group-toggle').getAttribute('aria-expanded')==='true'`));
  await main.host('quick');await wait(300);
  await screenshot(quick,path.join(output,`${theme}-quick.png`));await quick.host('quickDone');await main.host('show');
 }
 check('native renderer remains healthy',await main.host('diagnostics').then(d=>d.healthy&&d.errors===0));
}finally{
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify(checks,null,2));main.close();quick.close();
 console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,output}));
}
