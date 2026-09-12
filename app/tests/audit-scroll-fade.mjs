// Run after audit-material-groups in a disposable harness with its synthetic tasks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,wait,screenshot} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/scroll-fade');await fs.mkdir(output,{recursive:true});
const page=await connect(),quick=await connect(true),checks=[];
const inspect=`(()=>{const s=document.querySelector('#task-scroll'),top=s.getBoundingClientRect().top;return {top,scroll:s.scrollTop,groups:[...s.querySelectorAll('.task-group')].map(g=>{const h=g.querySelector('h2'),r=g.querySelector('.task-group-rows'),b=h.getBoundingClientRect(),c=getComputedStyle(h);return {name:g.dataset.group,top:b.top,bottom:b.bottom,height:b.height,rowsTop:r.getBoundingClientRect().top,fade:parseFloat(r.style.getPropertyValue('--group-fade-start')),background:c.backgroundColor,blur:c.backdropFilter,shadow:c.boxShadow};})};})()`;
try{
 await page.host('quickDone');await page.host('show');
 await page.evaluate('document.activeElement?.blur()');
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:15,y:15});
 const points=await page.evaluate(`(()=>{const s=document.querySelector('#task-scroll');s.scrollTop=0;const groups=s.querySelectorAll('.task-group');const boundary=groups[1].offsetTop;return [0,150,boundary-22,boundary+22,s.scrollHeight];})()`);
 for(const [i,y] of points.entries()){
  await page.evaluate(`document.querySelector('#task-scroll').scrollTop=${y}`);await wait(100);
  const state=await page.evaluate(inspect);
  for(const g of state.groups){
   assert.equal(g.background,'rgba(0, 0, 0, 0)');assert.equal(g.blur,'none');assert.equal(g.shadow,'none');
   if(state.scroll>0&&g.top<=state.top+.5&&g.bottom>state.top){
    assert(Math.abs(g.rowsTop+g.fade-g.bottom)<1,'Row fade must track the sticky heading, including push-off');
   }
  }
  checks.push({name:'scroll position '+i,state});
  if(i===2||i===3)await screenshot(page,path.join(output,`group-transition-${i}.png`));
 }
 await page.evaluate(`document.querySelector('.task-group .task-title').focus()`);await wait(150);
 const focus=await page.evaluate(`(()=>{const e=document.activeElement,r=e.closest('.task-group-rows'),y=e.getBoundingClientRect().top;return {className:e.className,visible:y>=r.getBoundingClientRect().top+parseFloat(r.style.getPropertyValue('--group-fade-start'))+14-1};})()`);
 assert(focus.visible,'Keyboard focus must not sit in the faded part');checks.push({name:'keyboard focus is readable',focus});
 const p=await page.evaluate(`(()=>{const r=document.querySelector('#task-scroll').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scroll:document.querySelector('#task-scroll').scrollTop};})()`);
 await page.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY:180});await wait(180);
 const wheel=await page.evaluate(inspect);assert(wheel.scroll>p.scroll,'Wheel scroll must remain functional');checks.push({name:'wheel scrolling',state:wheel});
 await page.host('quick');await wait(250);
 const capsule=await quick.evaluate(`['#widget','.inline-entry'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {selector:s,height:r.height,radius:parseFloat(getComputedStyle(e).borderTopLeftRadius)};})`);
 assert(capsule.every(c=>c.radius>=c.height/2));checks.push({name:'quick capsule uses round ends',capsule});
 await quick.host('quickDone');console.log(JSON.stringify({passed:checks.length,output}));
}finally{await fs.writeFile(path.join(output,'results.json'),JSON.stringify(checks,null,2));page.close();quick.close();}
