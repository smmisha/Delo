import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait,screenshot,ready} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/sessions/tooltip-audit'),main=await connect(),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
async function until(expression,ms=5000){const end=Date.now()+ms;while(Date.now()<end){if(await main.evaluate(expression))return;await wait(50);}throw Error(`Timeout: ${expression}`);}
try{
  await main.host('show');await main.host('pin',{pinned:true});
  // Earlier audits can leave a sheet open over the list; it would take every hover.
  await main.evaluate(`(()=>{document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());if(document.querySelector('#app-menu').matches(':popover-open'))document.querySelector('#app-menu').hidePopover();return true;})()`);
  // Earlier audits leave the window at its 320 x 360 minimum, where the new row can sit
  // under the sticky group heading. Start from a known size.
  {const d=await main.host('diagnostics'),scale=d.width/await main.evaluate('innerWidth');native(d.window,'resize',{Width:Math.round(420*scale),Height:Math.round(620*scale)});await ready(main);}
  // The dwell starts on pointer movement, so every hover first leaves to a neutral spot.
  const hover=async selector=>{
    await main.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const away=await main.point('#today');native(away.window,'move',{X:away.x,Y:away.y});await wait(60);
    const point=await main.point(selector);
    const hit=await main.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(selector)}),r=t.getBoundingClientRect(),n=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!n&&t.contains(n);})()`);
    if(!hit)throw Error(`${selector} is covered at its centre; refusing to hover`);
    native(point.window,'move',{X:point.x,Y:point.y});await wait(1150);
  };
  const title=`Harness tooltip ${Date.now()}`;
  await main.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
  await until(`([...document.querySelectorAll('.task-title')].some(node=>node.textContent===${JSON.stringify(title)}))`);
  // Hover this test's own row: the first row in the list belongs to whichever audit ran before.
  const taskId=await main.evaluate(`[...document.querySelectorAll('.task[data-task]')].find(row=>row.querySelector('.task-title')?.textContent===${JSON.stringify(title)}).dataset.task`);
  const row=`.task[data-task="${taskId}"]`;
  for(const dark of [false,true]){
    const theme=dark?'dark':'light';await main.evaluate(`document.body.classList.toggle('dark',${dark})`);
    for(const control of [{name:'stopwatch',selector:`${row} .timer`},{name:'more',selector:`${row} .task-more`}]){
      await hover(control.selector);
      const result=await main.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(control.selector)}),layer=document.querySelector('#tooltip-layer'),widget=document.querySelector('#widget').getBoundingClientRect(),rect=layer?.getBoundingClientRect();return {target:target?.getAttribute('aria-label'),targetOpen:target?.classList.contains('tip-open')||false,open:layer?.classList.contains('tip-open')||false,text:layer?.textContent||'',rect:rect&&{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},widget:{left:widget.left,top:widget.top,right:widget.right,bottom:widget.bottom}};})()`);
      check(`${theme}: ${control.name} tooltip stays fully visible above the masked task list`,result.open&&result.text===result.target&&result.rect&&result.rect.left>=result.widget.left&&result.rect.right<=result.widget.right&&result.rect.top>=result.widget.top&&result.rect.bottom<=result.widget.bottom,result);
      await fs.mkdir(output,{recursive:true});await screenshot(main,path.join(output,`${theme}-${control.name}-tooltip.png`));
    }
  }
  // Sheets are modal and live in the top layer; their header labels must be painted above
  // them, beside the close button, clear of the first content row.
  await main.evaluate(`document.body.classList.toggle('dark',true)`);
  for(const sheet of [{name:'settings',open:`document.querySelector('#settings-open').click();document.querySelector('#open-settings').click()`,first:'#settings .settings-fields label'},{name:'reputation',open:`document.querySelector('#reputation').click()`,first:'#history .reputation-rules div'}]){
    await main.evaluate(`(()=>{${sheet.open};return true;})()`);await wait(400);
    const selector=`#${sheet.name==='settings'?'settings':'history'} [data-close]`;
    await hover(selector);
    const result=await main.evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),layer=document.querySelector('#tooltip-layer'),rect=layer.getBoundingClientRect(),dialog=document.querySelector('dialog[open]'),head=dialog.querySelector('.capture-head').getBoundingClientRect(),first=[...dialog.querySelectorAll(${JSON.stringify(sheet.first)})].map(n=>n.getBoundingClientRect()).find(r=>r.bottom>head.bottom)||head;return {modal:dialog?.matches(':modal'),open:layer.classList.contains('tip-open'),popover:layer.matches(':popover-open'),text:layer.textContent,placement:layer.dataset.placement,rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},button:{left:button.left,top:button.top,bottom:button.bottom},head:{top:head.top,bottom:head.bottom},firstTop:Math.max(first.top,head.bottom)};})()`);
    const centred=Math.abs((result.rect.top+result.rect.bottom)/2-(result.button.top+result.button.bottom)/2)<=1;
    check(`${sheet.name}: close label is in the top layer beside the button, clear of the first row`,result.modal&&result.open&&result.popover&&result.placement==='left'&&result.rect.right<=result.button.left&&centred&&result.rect.top>=result.head.top&&result.rect.bottom<=result.head.bottom&&result.rect.bottom<=result.firstTop,result);
    await screenshot(main,path.join(output,`${sheet.name}-close-tooltip.png`));
    await main.evaluate(`(()=>{document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.querySelector(${JSON.stringify(selector)}).click();return true;})()`);await wait(300);
  }
}finally{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'tooltip.json'),JSON.stringify(checks,null,2));main.close();}
if(checks.some(check=>!check.pass))process.exitCode=1;
