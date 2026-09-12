import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait,screenshot} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260911');
await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
function check(name,pass,details){checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));}
async function until(page,expression,ms=5000){const end=Date.now()+ms;while(Date.now()<end){if(await page.evaluate(expression))return;await wait(50);}throw Error(`Timeout: ${expression}`);}
try{
 await main.host('pin',{pinned:true});await main.host('show');
 await main.evaluate(`(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());window.auditKeys=[];document.addEventListener('keydown',e=>window.auditKeys.push({key:e.key,code:e.code,keyCode:e.keyCode,trusted:e.isTrusted,target:e.target.name||e.target.id}),true);return true;})()`);
 await main.click('#settings-open');
 await main.click('#open-settings');
 await main.click('[name=listShortcut]');
 let d=await main.host('diagnostics');native(d.window,'keys',{Keys:'CTRL+ALT+Z'});await wait(200);
 let result=await main.evaluate(`({value:document.querySelector('[name=listShortcut]').value,active:document.activeElement.name,events:window.auditKeys})`);
 check('physical shortcut recorder accepts Ctrl+Alt+Z',result.value==='Ctrl+Alt+Z'&&result.events.some(e=>e.trusted&&e.code==='KeyZ'),result);
 native(d.window,'keys',{Keys:'CTRL+ALT+SHIFT+K'});await wait(250);
 result=await main.evaluate(`({value:document.querySelector('[name=listShortcut]').value,settings:document.querySelector('#settings').open,events:window.auditKeys})`);
 const qd=await quick.host('diagnostics');check('assigning an existing own hotkey does not open quick entry',!qd.visible&&result.value==='Ctrl+Alt+Shift+K',{...result,quickVisible:qd.visible});
 if(qd.visible)await quick.host('quickDone');
 await main.evaluate(`(()=>{const input=document.querySelector('[name=listShortcut]');input.value='Ctrl+Alt+Shift+J';input.blur();return true;})()`);
 await until(main,`document.querySelector('#widget').getAttribute('aria-busy')==='false'`);
 await main.click('#settings [data-close]');
 await main.host('pin',{pinned:true});await main.host('show');
 await main.evaluate(`(()=>{document.querySelector('#task-input').value='Audit completed task';document.querySelector('#task-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return true;})()`);
 await until(main,`[...document.querySelectorAll('.task-title')].some(x=>x.textContent==='Audit completed task')`);
 await main.evaluate(`(()=>{const row=[...document.querySelectorAll('.task')].find(r=>r.querySelector('.task-title').textContent==='Audit completed task');row.querySelector('.complete').click();return true;})()`);
 await until(main,`!!document.querySelector('.task.done')`);
 result=await main.evaluate(`(()=>{document.body.classList.add('dark');const row=document.querySelector('.task.done'),circle=row.querySelector('.circle'),style=getComputedStyle(circle);return {fill:style.backgroundColor,expected:getComputedStyle(document.body).getPropertyValue('--success').trim()};})()`);
 check('completed circle retains its semantic fill in dark theme',result.fill==='rgb(148, 228, 181)',result);
 await main.evaluate(`(()=>{document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();document.querySelector('#settings-form').elements.theme.value='light';document.querySelector('#settings-form').requestSubmit();return true;})()`);await wait(300);
 await main.click('#settings-open');await main.click('#open-settings');await main.evaluate(`document.querySelector('.settings-fields').scrollTop=0`);await screenshot(main,path.join(output,'settings-light.png'));await main.click('#settings [data-close]');
 await main.click('#settings-open');await main.click('#open-trash');
 await main.evaluate(`(()=>{document.querySelector('#collection [data-close]').click();const row=document.querySelector('.task');row.querySelector('.task-more').click();document.querySelector('[data-action=archive]').click();return true;})()`);await wait(250);
 await main.evaluate(`(()=>{document.querySelector('#settings-open').click();document.querySelector('#open-archive').click();document.querySelector('.collection-row button:last-child').click();return true;})()`);await wait(250);
 await main.click('#collection [data-close]');await main.click('#settings-open');await main.click('#open-trash');
 d=await main.host('diagnostics');const width=Math.round(320*d.width/(await main.evaluate('innerWidth'))),height=Math.round(360*d.height/(await main.evaluate('innerHeight')));native(d.window,'resize',{Width:width,Height:height});await wait(250);
 result=await main.evaluate(`(()=>{const row=document.querySelector('.collection-row'),copy=row.querySelector('.collection-copy'),r=copy.getBoundingClientRect(),surface=document.querySelector('#collection .trash-surface');return {copyWidth:r.width,rowWidth:row.getBoundingClientRect().width,scrollWidth:surface.scrollWidth,clientWidth:surface.clientWidth,actions:[...row.querySelectorAll('button')].map(e=>({text:e.textContent,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right})),viewport:innerWidth};})()`);
 check('trash row preserves readable task text at minimum width',result.copyWidth>=100&&result.scrollWidth<=result.clientWidth+1,result);
 await main.click('.permanent-delete');await screenshot(main,path.join(output,'confirmation-narrow.png'));
 result=await main.evaluate(`(()=>{const accept=document.querySelector('#confirmation-accept').getBoundingClientRect();return {right:accept.right,bottom:accept.bottom,width:innerWidth,height:innerHeight};})()`);
 check('confirmation fits minimum window',result.right<=result.width&&result.bottom<=result.height,result);
 await main.click('#confirmation-cancel');
 await main.click('#collection [data-close]');
 result=await main.evaluate(`({id:document.activeElement.id,tag:document.activeElement.tagName})`);
 check('closing nested confirmation then collection restores main focus',result.id==='settings-open',result);
}finally{await fs.writeFile(path.join(output,'interactions.json'),JSON.stringify(checks,null,2));main.close();quick.close();}
if(checks.some(c=>!c.pass))process.exitCode=1;
