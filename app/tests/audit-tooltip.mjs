import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait,screenshot} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/sessions/tooltip-audit'),main=await connect(),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
async function until(expression,ms=5000){const end=Date.now()+ms;while(Date.now()<end){if(await main.evaluate(expression))return;await wait(50);}throw Error(`Timeout: ${expression}`);}
try{
  await main.host('show');await main.host('pin',{pinned:true});
  const title=`Harness tooltip ${Date.now()}`;
  await main.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
  await until(`([...document.querySelectorAll('.task-title')].some(node=>node.textContent===${JSON.stringify(title)}))`);
  for(const dark of [false,true]){
    const theme=dark?'dark':'light';await main.evaluate(`document.body.classList.toggle('dark',${dark})`);
    for(const control of [{name:'stopwatch',selector:'.task[data-task] .timer'},{name:'more',selector:'.task[data-task] .task-more'}]){
      const point=await main.point(control.selector);native(point.window,'move',{X:point.x,Y:point.y});await wait(1150);
      const result=await main.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(control.selector)}),layer=document.querySelector('#tooltip-layer'),widget=document.querySelector('#widget').getBoundingClientRect(),rect=layer?.getBoundingClientRect();return {target:target?.getAttribute('aria-label'),targetOpen:target?.classList.contains('tip-open')||false,open:layer?.classList.contains('tip-open')||false,text:layer?.textContent||'',rect:rect&&{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},widget:{left:widget.left,top:widget.top,right:widget.right,bottom:widget.bottom}};})()`);
      check(`${theme}: ${control.name} tooltip stays fully visible above the masked task list`,result.open&&result.text===result.target&&result.rect&&result.rect.left>=result.widget.left&&result.rect.right<=result.widget.right&&result.rect.top>=result.widget.top&&result.rect.bottom<=result.widget.bottom,result);
      await fs.mkdir(output,{recursive:true});await screenshot(main,path.join(output,`${theme}-${control.name}-tooltip.png`));
    }
  }
}finally{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'tooltip.json'),JSON.stringify(checks,null,2));main.close();}
if(checks.some(check=>!check.pass))process.exitCode=1;
