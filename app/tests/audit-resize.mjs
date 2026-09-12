import fs from 'node:fs/promises';import path from 'node:path';
import {connect,native,wait,screenshot} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260911/resize');await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
try{
 await main.evaluate(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);
 await quick.host('quickDone');await main.host('hide');await main.host('show');await main.host('pin',{pinned:true});
 for(const [mode,page,width,height] of [['main',main,320,360],['quick',quick,296,null]]){
  if(mode==='quick')await main.host('quick');
  let d=await page.host('diagnostics'),scale=d.width/(await page.evaluate('innerWidth'));
  native(d.window,'resize',{Width:Math.round(width*scale),Height:height===null?d.height:Math.round(height*scale)});await wait(180);
  await page.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value='Компактный ввод';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const bounds=await page.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {width:innerWidth,height:innerHeight,mic:rect(document.querySelector('#voice-input')),input:rect(document.querySelector('#task-input')),send:rect(document.querySelector('#add-task')),scrollWidth:document.body.scrollWidth};})()`);
  check(`${mode}: minimum size keeps input and icons visible`,bounds.input.width>50&&bounds.mic.right<=bounds.input.x+1&&bounds.input.right<=bounds.send.x+1&&[bounds.mic,bounds.input,bounds.send].every(r=>r.x>=0&&r.y>=0&&r.right<=bounds.width&&r.bottom<=bounds.height)&&bounds.scrollWidth<=bounds.width,bounds);
  const grips=await page.evaluate(`[...document.querySelectorAll('.resize-grip')].map(node=>node.className)`);
  check(`${mode}: exposes the intended resize axes`,mode==='quick'?grips.length===2&&grips.every(name=>/resize-(left|right)/.test(name)):grips.length===8,grips);
  if(mode==='quick'){
   const chrome=await page.evaluate(`(()=>{const widget=document.querySelector('#widget'),style=getComputedStyle(widget);return {borderWidth:parseFloat(style.borderTopWidth),cornerContent:getComputedStyle(widget,'::after').content};})()`);
   check('quick: thin frame has no corner artifact',chrome.borderWidth<=1&&chrome.cornerContent==='none',chrome);
  }
  await screenshot(page,path.join(output,`${mode}-minimum.png`));
  // Quick capture uses its right edge at mid-height; main keeps the corner gesture.
  d=await page.host('diagnostics');const inset=Math.round((mode==='quick'?2:14)*scale);native(d.window,'drag',{X:d.x+d.width-inset,Y:mode==='quick'?d.y+Math.floor(d.height/2):d.y+d.height-inset,Width:60,Height:50});await wait(150);
  const after=await page.host('diagnostics');check(`${mode}: resize gesture changes the intended axes`,mode==='quick'?after.width>d.width&&after.height===d.height:after.width>d.width&&after.height>d.height,{before:{width:d.width,height:d.height},after:{width:after.width,height:after.height}});
  check(`${mode}: resize does not also request a window move`,after.dragRequests===d.dragRequests,{before:d.dragRequests,after:after.dragRequests});
  if(mode==='quick')check('quick: vertical size stays fixed during horizontal resize',after.height===d.height,{before:d.height,after:after.height});
  native(after.window,'drag',{X:after.x+after.width-inset,Y:mode==='quick'?after.y+Math.floor(after.height/2):after.y+after.height-inset,Width:-160,Height:-160});await wait(150);
  const smaller=await page.host('diagnostics');check(`${mode}: dragging smaller respects the readable minimum`,smaller.width===d.width&&smaller.height===d.height,{width:smaller.width,height:smaller.height});
 }
}finally{await fs.writeFile(path.join(output,'resize.json'),JSON.stringify(checks,null,2));main.close();quick.close();}
if(checks.some(c=>!c.pass))process.exitCode=1;
