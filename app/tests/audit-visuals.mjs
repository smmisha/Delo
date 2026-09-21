import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {connect,native,wait,screenshot,documentFrames} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260911/visuals');await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
// The arrow check is about the page's own pixels, so frames are document-only: the glass
// under the translucent capsule follows the live desktop and changed between frames
// whenever anything moved behind the window.
async function quickFrames(page,directory,count){let size;for(let index=0;index<count;index++){if(!(await page.host('diagnostics')).windowVisible){await main.host('quick');await page.click('#task-input');await wait(150);}const name=path.join(directory,`single-${index}`);size=await documentFrames(page,name,1,0);await fs.rename(path.join(name,'frame-00.png'),path.join(directory,`frame-${String(index).padStart(2,'0')}.png`));await fs.rm(name,{recursive:true,force:true});if(index<count-1)await wait(120);}return size;}
try{
 await main.host('pin',{pinned:true});
 for(const theme of ['light','dark']){
  await main.host('show');await main.host('pin',{pinned:true});
  await main.evaluate(`(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(!document.querySelector('#app-menu').matches(':popover-open'))document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();return true;})()`);await wait(300);
  await main.evaluate(`(()=>{const theme=document.querySelector('[name=theme]');theme.value=${JSON.stringify(theme)};theme.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  const end=Date.now()+5000;let applied=false;
  while(Date.now()<end){applied=await main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');globalThis.__deloHarnessBridge??=new HostBridge();const value=await globalThis.__deloHarnessBridge.request('load');return value.state?.settings?.theme===${JSON.stringify(theme)}&&document.body.classList.contains('dark')===${theme==='dark'}&&document.querySelector('#widget').getAttribute('aria-busy')==='false'&&document.querySelector('#settings-error').hidden;})()`);if(applied)break;await wait(25);}
  check(`${theme}: theme auto-saves and reaches the actual view`,applied);
  if(!applied)throw Error(`${theme} theme did not apply; refusing mislabeled screenshots`);
  await main.evaluate(`document.querySelector('#settings [data-close]').click()`);
  for(const [mode,page] of [['main',main],['quick',quick]]){
   if(mode==='quick')await main.host('quick');else{await quick.host('quickDone');await main.host('show');await main.host('pin',{pinned:true});}
   let d=await page.host('diagnostics');const vw=await page.evaluate('innerWidth'),vh=await page.evaluate('innerHeight');native(d.window,'resize',{Width:Math.round((mode==='quick'?414:420)*d.width/vw),Height:Math.round((mode==='quick'?83:620)*d.height/vh)});await wait(150);
   for(const filled of [false,true]){
    await page.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value=${JSON.stringify(filled?'Тест стрелки':'')};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await page.click('#task-input');
    const name=`${theme}-${mode}-${filled?'filled':'empty'}`,directory=path.join(output,name);await fs.mkdir(directory,{recursive:true});
    const boxes=await page.evaluate(`(()=>{const a=document.querySelector('#add-task').getBoundingClientRect(),i=document.querySelector('#task-input').getBoundingClientRect();return {width:innerWidth,height:innerHeight,arrow:{x:a.x+3,y:a.y+3,width:a.width-6,height:a.height-6},input:{x:i.x+2,y:i.y+2,width:i.width-4,height:i.height-4}};})()`);
    if(!filled){
     // The maker's mark lives in the bezel band under the capsule: never over it, never in
     // the fixed-height quick capsule, and never as anything a pointer or reader can reach.
     const mark=await page.evaluate(`(()=>{const e=document.querySelector('.engraving'),c=document.querySelector('#entry').getBoundingClientRect(),w=document.querySelector('#widget').getBoundingClientRect(),s=getComputedStyle(e),r=e.getBoundingClientRect();return {display:s.display,text:e.textContent,ariaHidden:e.getAttribute('aria-hidden'),pointer:s.pointerEvents,top:r.top,bottom:r.bottom,capsuleBottom:c.bottom,widgetBottom:w.bottom,centre:Math.abs((r.left+r.right)/2-(w.left+w.right)/2)};})()`);
     check(`${name}: engraved mark ${mode==='quick'?'is absent from the fixed-height capsule':'sits in the bezel band clear of the capsule'}`,mode==='quick'?mark.display==='none':mark.display!=='none'&&mark.text==='socialmediamisha'&&mark.ariaHidden==='true'&&mark.pointer==='none'&&mark.top>=mark.capsuleBottom-0.5&&mark.bottom<=mark.widgetBottom+0.5&&mark.centre<=1,mark);
    }
    const size=mode==='quick'?await quickFrames(page,directory,20):await documentFrames(page,directory,20);
    const sx=size.width/boxes.width,sy=size.height/boxes.height,regions=Object.fromEntries(['arrow','input'].map(k=>[k,{x:Math.ceil(boxes[k].x*sx),y:Math.ceil(boxes[k].y*sy),width:Math.floor(boxes[k].width*sx),height:Math.floor(boxes[k].height*sy)}]));
    const regionsFile=path.join(directory,'regions.json');await fs.writeFile(regionsFile,JSON.stringify(regions));
    const stats=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',path.join(import.meta.dirname,'compare-frames.ps1'),'-Directory',directory,'-RegionsFile',regionsFile],{encoding:'utf8',windowsHide:true,timeout:30000}));
    check(`${name}: arrow stable during observed caret changes`,stats.arrow.maxChangedPixels===0&&stats.input.maxChangedPixels>0,stats);
   }
   if(mode==='quick'){await screenshot(page,path.join(output,`${theme}-quick.png`));await quick.host('quickDone');}
  }
  await main.host('show');await main.host('pin',{pinned:true});await main.click('#settings-open');await main.click('#open-settings');await main.evaluate(`document.querySelector('.settings-fields').scrollTop=0`);await screenshot(main,path.join(output,`${theme}-settings.png`));
  await main.click('#settings [data-close]');await main.click('#settings-open');await wait(200);
  const nav=await main.evaluate(`(()=>[...document.querySelectorAll('#app-menu button')].map(b=>({id:b.id,label:b.textContent.trim(),icon:!!b.querySelector('use'),title:b.title})))()`);
  check(`${theme}: archive and trash are labelled menu items`,nav.length===3&&nav.every(i=>i.label&&i.icon&&!i.title)&&nav.some(i=>i.id==='open-archive')&&nav.some(i=>i.id==='open-trash'),nav);
  await screenshot(main,path.join(output,`${theme}-menu.png`));await main.click('#settings-open');
 }
}finally{await fs.writeFile(path.join(output,'visuals.json'),JSON.stringify(checks,null,2));main.close();quick.close();}
if(checks.some(c=>!c.pass))process.exitCode=1;
