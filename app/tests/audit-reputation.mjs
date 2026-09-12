import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait,screenshot} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260912/reputation.json');
const page=await connect(),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
const createCompleted=async title=>{
 await page.evaluate(`(()=>{const input=document.querySelector('#task-input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
 await wait(250);
 await page.evaluate(`(()=>{const row=[...document.querySelectorAll('.task')].find(row=>row.querySelector('.task-title')?.textContent===${JSON.stringify(title)});if(!row)throw Error('Audit task was not created');row.querySelector('.complete').click();return true;})()`);
 await wait(250);
};

try{
 await page.host('pin',{pinned:true});
 await page.host('show');
 await page.evaluate(`document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close())`);
 await createCompleted(`R04 pointer ${Date.now()}`);
 await page.click('#reputation');
 let state=await page.evaluate(`(()=>{const row=document.querySelector('.history-row'),action=row.querySelector('.history-delete');return {ready:row.classList.contains('delete-ready'),opacity:getComputedStyle(action).opacity,label:action.getAttribute('aria-label'),score:Number(document.querySelector('#score').textContent),eventCount:document.querySelectorAll('.history-row').length};})()`);
 check('history delete action starts hidden',!state.ready&&Number(state.opacity)===0,state);

 const point=await page.evaluate(`(()=>{const rect=document.querySelector('.history-row:first-child .history-copy').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
 await wait(1100);
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+6,y:point.y});
 await wait(1100);
 state=await page.evaluate(`(()=>{const row=document.querySelector('.history-row');return {ready:row.classList.contains('delete-ready'),opacity:getComputedStyle(row.querySelector('.history-delete')).opacity};})()`);
 check('pointer movement restarts the two-second dwell',!state.ready&&Number(state.opacity)===0,state);
 await wait(1050);
 state=await page.evaluate(`(()=>{const row=document.querySelector('.history-row'),action=row.querySelector('.history-delete');return {ready:row.classList.contains('delete-ready'),opacity:getComputedStyle(action).opacity,label:action.getAttribute('aria-label')};})()`);
 check('stationary pointer reveals the compact delete action after two seconds',state.ready&&Number(state.opacity)>.9&&state.label==='Удалить запись',state);
 await screenshot(page,path.join(path.dirname(output),'reputation-hover.png'));

 const beforePointer=await page.evaluate(`Number(document.querySelector('#score').textContent)`);
 await page.click('.history-row:first-child .history-delete');
 const pointerResult=await page.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const loaded=await new HostBridge().request('load');return {score:Number(document.querySelector('#score').textContent),persistedScore:loaded.state.reputation,persistedEvents:loaded.state.events.length};})()`);
 check('pointer deletion removes +5 from both UI and persisted ledger',pointerResult.score===beforePointer-5&&pointerResult.persistedScore===pointerResult.score,pointerResult);

 await page.click('#history [data-close]');
 const removedAwardResult=await page.evaluate(`(async()=>{const row=[...document.querySelectorAll('.task')].find(row=>row.querySelector('.task-title')?.textContent.startsWith('R04 pointer '));row.querySelector('.complete').click();await new Promise(resolve=>setTimeout(resolve,250));const {HostBridge}=await import('./bridge.mjs');const loaded=await new HostBridge().request('load');return {score:Number(document.querySelector('#score').textContent),persistedScore:loaded.state.reputation,persistedEvents:loaded.state.events.length,completed:loaded.state.tasks.find(task=>task.id===row.dataset.task).completedAt!==null};})()`);
 check('uncomplete does not subtract a manually removed current award',removedAwardResult.score===pointerResult.score&&removedAwardResult.persistedScore===pointerResult.score&&removedAwardResult.persistedEvents===pointerResult.persistedEvents&&!removedAwardResult.completed,removedAwardResult);

 await createCompleted(`R04 keyboard ${Date.now()}`);
 await page.click('#reputation');
 const beforeResize=await page.host('diagnostics'),size=await page.evaluate(`({width:innerWidth,height:innerHeight})`);
 native(beforeResize.window,'resize',{Width:Math.round(320*beforeResize.width/size.width),Height:Math.round(360*beforeResize.height/size.height)});
 await wait(250);
 state=await page.evaluate(`(()=>{const dialog=document.querySelector('#history'),surface=dialog.querySelector('.trash-surface'),row=dialog.querySelector('.history-row'),action=row.querySelector('.history-delete'),sr=surface.getBoundingClientRect();return {overflowX:getComputedStyle(dialog).overflowX,dialogClientWidth:dialog.clientWidth,dialogScrollWidth:dialog.scrollWidth,rowRight:row.getBoundingClientRect().right,surfaceRight:sr.right,actionRight:action.getBoundingClientRect().right};})()`);
 check('history row has no visible horizontal overflow at minimum window width',state.overflowX==='hidden'&&state.rowRight<=state.surfaceRight&&state.actionRight<=state.surfaceRight,state);
 await screenshot(page,path.join(path.dirname(output),'reputation-narrow.png'));
 await page.evaluate(`document.querySelector('#history [data-close]').focus()`);
 const diagnostics=await page.host('diagnostics');
 native(diagnostics.window,'keys',{Keys:'TAB'});
 await wait(120);
 state=await page.evaluate(`(()=>{const action=document.activeElement;return {className:action.className,label:action.getAttribute('aria-label'),opacity:getComputedStyle(action).opacity,ready:action.closest('.history-row')?.classList.contains('delete-ready')};})()`);
 check('keyboard reaches a visible delete action without pointer dwell',state.className==='history-delete'&&state.label==='Удалить запись'&&Number(state.opacity)>.9,state);
 const beforeKeyboard=await page.evaluate(`Number(document.querySelector('#score').textContent)`);
 native(diagnostics.window,'keys',{Keys:'ENTER'});
 await wait(250);
 const keyboardResult=await page.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const loaded=await new HostBridge().request('load');return {score:Number(document.querySelector('#score').textContent),persistedScore:loaded.state.reputation,activeClass:document.activeElement.className};})()`);
 check('keyboard deletion removes +5 and keeps focus inside history',keyboardResult.score===beforeKeyboard-5&&keyboardResult.persistedScore===keyboardResult.score&&['history-delete','round'].includes(keyboardResult.activeClass),keyboardResult);
}finally{
 await fs.mkdir(path.dirname(output),{recursive:true});
 await fs.writeFile(output,JSON.stringify(checks,null,2));
 page.close();
}
if(checks.some(check=>!check.pass))process.exitCode=1;
