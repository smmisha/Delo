// Seeds test-exit-request.ps1: a task whose timer has just started while every write is held
// 5 s, then prints the control window handle for the exit request.
import {connect,wait} from './audit-harness.mjs';
const main=await connect(),title='Exit request check';
try{
 await main.host('show');
 await main.evaluate(`(()=>{const i=document.querySelector('#task-input');i.value=${JSON.stringify(title)};i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
 const end=Date.now()+5000;while(Date.now()<end&&!await main.evaluate(`[...document.querySelectorAll('.task-title')].some(n=>n.textContent===${JSON.stringify(title)})`))await wait(50);
 await main.host('storeDelay',{ms:5000});
 await main.evaluate(`[...document.querySelectorAll('.task[data-task]')].find(r=>r.querySelector('.task-title').textContent===${JSON.stringify(title)}).querySelector('.timer').click()`);
 await wait(500);
 console.log(String((await main.host('diagnostics')).controlWindow));
}finally{main.close();}
