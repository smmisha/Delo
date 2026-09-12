import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connect,wait,screenshot} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/voice-audit');await fs.mkdir(output,{recursive:true});
const main=await connect(),quick=await connect(true),checks=[];
function check(name,pass,details){checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));assert(pass,name);}
async function until(page,expression,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(await page.evaluate(expression))return;await wait(100);}throw Error(`Timeout: ${expression}`);}
async function prepare(page){
 await page.evaluate(`(()=>{window.voiceUpdates=[];chrome.webview.addEventListener('message',event=>{if(event.data.event==='voiceState')voiceUpdates.push({...event.data.payload,at:performance.now()});});const original=chrome.webview.postMessage.bind(chrome.webview);chrome.webview.postMessage=message=>{if(message.type==='voice'&&message.payload.action==='start'&&window.voiceFixture){message.payload.fixture=window.voiceFixture;}original(message);};document.querySelectorAll('dialog[open]').forEach(d=>d.close());return true;})()`);
}
async function fixtureRun(page,language){
 await page.evaluate(`(()=>{window.voiceUpdates=[];window.voiceFixture=${JSON.stringify(language+'.wav')};const input=document.querySelector('#task-input');input.value='Draft:';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#voice-input').click();return true;})()`);
 await until(page,`voiceUpdates.some(x=>['result','error'].includes(x.state))`);
 return page.evaluate(`({updates:voiceUpdates,draft:document.querySelector('#task-input').value})`);
}
try{
 await main.host('show');await main.host('pin',{pinned:true});await prepare(main);await prepare(quick);
 for(const language of ['ru','uk','en']){
  await main.evaluate(`(()=>{document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();const field=document.querySelector('[name=language]');field.value=${JSON.stringify(language)};field.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await until(main,`document.documentElement.lang===${JSON.stringify(language)}&&document.querySelector('#widget').getAttribute('aria-busy')==='false'`);
  await main.evaluate(`document.querySelector('#settings [data-close]').click()`);
  const start=Date.now(),result=await fixtureRun(main,language),terminal=result.updates.at(-1);
  const expected={ru:/молоко.*врачу/i,en:/milk.*doctor/i,uk:/ініціативу.*співі/i}[language];
  check(`Whisper ${language}: native process to editable draft`,terminal.state==='result'&&expected.test(result.draft)&&result.draft.startsWith('Draft:'),{...result,elapsedMs:Date.now()-start});
 }
 // Cancellation during real inference must not insert a late result into a changed draft.
 await main.evaluate(`(()=>{voiceUpdates=[];voiceFixture='en.wav';document.querySelector('#task-input').value='Keep this';document.querySelector('#voice-input').click();return true;})()`);
 await until(main,`voiceUpdates.some(x=>x.state==='transcribing')`);
 await screenshot(main,path.join(output,'main-transcribing.png'));
 await main.evaluate(`document.querySelector('#voice-cancel').click()`);await wait(750);
 let result=await main.evaluate(`({draft:document.querySelector('#task-input').value,updates:voiceUpdates,active:document.querySelector('#entry').classList.contains('voice-active')})`);
 check('cancel inference preserves draft and restores editing',result.draft==='Keep this'&&!result.active,result);
 // Actual microphone opens only for this short explicit test, then is cancelled.
 await main.evaluate(`(()=>{voiceFixture=null;voiceUpdates=[];document.querySelector('#voice-input').click();return true;})()`);
 await until(main,`voiceUpdates.some(x=>x.state==='recording'||x.state==='error')`);
 result=await main.evaluate(`voiceUpdates.at(-1)`);check('real Windows microphone opens',result.state==='recording',result);
 await main.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await main.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await wait(500);check('Escape cancels recording without clearing draft',await main.evaluate(`document.querySelector('#task-input').value==='Keep this'&&!document.querySelector('#entry').classList.contains('voice-active')`));
 await main.host('quick');await wait(150);
 await quick.evaluate(`(()=>{voiceFixture='en.wav';voiceUpdates=[];const input=document.querySelector('#task-input');input.value='Quick draft';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#voice-input').click();return true;})()`);
 await until(quick,`voiceUpdates.some(x=>x.state==='transcribing')`);
 await screenshot(quick,path.join(output,'quick-transcribing.png'));
 result=await quick.evaluate(`(()=>{const e=document.querySelector('#voice-cancel').getBoundingClientRect(),m=document.querySelector('#voice-message').getBoundingClientRect();return {right:e.right,bottom:e.bottom,messageBottom:m.bottom,width:innerWidth,height:innerHeight};})()`);
 check('quick voice controls fit unchanged capsule height',result.right<=result.width&&result.bottom<=result.height&&result.messageBottom<=result.height,result);
 await quick.host('quickDone');await wait(700);
 check('hiding quick cancels and retains draft',await quick.evaluate(`document.querySelector('#task-input').value==='Quick draft'&&!document.querySelector('#entry').classList.contains('voice-active')`));
 await main.host('show');
 await main.evaluate(`(()=>{document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();for(const [key,value] of [['language','ru'],['theme','light']])document.querySelector('[name='+key+']').value=value;document.querySelector('#settings-form').requestSubmit();return true;})()`);
 await until(main,`document.documentElement.lang==='ru'&&!document.querySelector('#settings').open`);
 await main.host('quick');
 let d=await quick.host('diagnostics');const width=await quick.evaluate('innerWidth');
 // Quick only allows horizontal resizing.
 await quick.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const {native}=await import('./audit-harness.mjs');native(d.window,'resize',{Width:Math.round(296*d.width/width),Height:d.height});await wait(200);
 await quick.evaluate(`(async()=>{voiceFixture=null;voiceUpdates=[];document.querySelector('#task-input').value='Сохранить черновик';document.querySelector('#voice-input').click();await new Promise(r=>setTimeout(r,100));document.querySelector('#voice-input').click();return true;})()`);
 await until(quick,`voiceUpdates.some(x=>x.state==='error')`);
 result=await quick.evaluate(`(()=>{const m=document.querySelector('#voice-message').getBoundingClientRect(),c=document.querySelector('#voice-cancel').getBoundingClientRect();return {draft:document.querySelector('#task-input').value,error:voiceUpdates.at(-1).error,message:document.querySelector('#voice-message').textContent,bottom:m.bottom,cancelRight:c.right,width:innerWidth,height:innerHeight};})()`);
 check('short microphone recording reports error while preserving draft at minimum width',result.error==='voiceNoSpeech'&&result.draft==='Сохранить черновик'&&result.bottom<=result.height&&result.cancelRight<=result.width,result);
 await screenshot(quick,path.join(output,'quick-error-light.png'));
 await quick.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await quick.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 result=await quick.evaluate(`({draft:document.querySelector('#task-input').value,error:document.querySelector('#entry').classList.contains('voice-error')})`);
 check('Escape dismisses voice error without clearing or hiding quick draft',result.draft==='Сохранить черновик'&&!result.error&&(await quick.host('diagnostics')).visible,result);
 await quick.host('quickDone');
 const diagnostics=await main.host('diagnostics');check('renderer remains healthy',diagnostics.healthy&&diagnostics.errors===0,{healthy:diagnostics.healthy,errors:diagnostics.errors});
}finally{await fs.writeFile(path.join(output,'checks.json'),JSON.stringify(checks,null,2));main.close();quick.close();}
