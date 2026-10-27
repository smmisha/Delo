// Run with a named harness built with an older version than the published release.
// Downloads the real installer; the host's harness mode never executes it.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connect,wait,screenshot} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]??'test-output/update-audit');
await fs.mkdir(output,{recursive:true});
const page=await connect();let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
try{
  const initial=await page.host('updates',{enabled:true});
  check(initial.newer,'harness version is older than the public release');
  await page.evaluate(`document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();`);
  for(const end=Date.now()+10000;Date.now()<end;){if(await page.evaluate(`document.querySelector('#open-release').textContent==='Обновить'&&!document.querySelector('#open-release').hidden`))break;await wait(100);}
  const initialView=await page.evaluate(`({button:document.querySelector('#open-release').outerHTML,status:document.querySelector('#update-status').outerHTML,enabled:document.querySelector('#settings-form').elements.checkUpdates.checked,error:document.querySelector('#error').innerText})`);
  await fs.writeFile(path.join(output,'initial-view.json'),JSON.stringify(initialView,null,2));
  check(initialView.button.includes('Обновить')&&!initialView.button.includes('hidden'),'Update action replaces browser link');
  await page.evaluate(`document.querySelector('#open-release').click()`);
  const first=await page.host('updateState');check(['checking','downloading'].includes(first.phase),'update starts in the background');
  await page.host('installUpdate'); // Duplicate requests must not create another installer job.
  let status,seenProgress=false;
  for(const end=Date.now()+180000;Date.now()<end;){
    status=await page.host('updateState');
    if(status.phase==='downloading'){
      seenProgress=true;
      check(await page.evaluate(`document.querySelector('#open-release').hidden&&!document.querySelector('#update-progress').hidden`),'download has progress and no duplicate install button');
      await screenshot(page,path.join(output,'downloading-light.png'));
      break;
    }
    if(status.phase==='error')throw Error('Real update download failed; inspect the named harness native.jsonl');
    await wait(150);
  }
  check(seenProgress,'real download progress observed');
  await page.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');const bridge=new HostBridge();await Promise.all([bridge.window('exit'),bridge.window('cancelExit')]);})()`);
  check((await page.host('updateState')).phase==='error','cancelled exit leaves a retryable update state');
  await page.host('installUpdate');
  check(['checking','downloading'].includes((await page.host('updateState')).phase),'retry gets a fresh operation after exit cancellation');
  // Theme/localization checks use the same host events as the running download.
  await page.evaluate(`document.querySelector('#settings-form').elements.theme.value='dark';document.querySelector('#settings-form').elements.theme.dispatchEvent(new Event('change',{bubbles:true}));`);
  await wait(300);await screenshot(page,path.join(output,'downloading-dark.png'));
  for(const end=Date.now()+180000;Date.now()<end;){status=await page.host('updateState');if(['ready','error'].includes(status.phase))break;await wait(200);}
  check(status.phase==='ready'&&status.percent===100,'real installer downloaded and SHA-256 verified without executing it');
  check(await page.evaluate(`!document.querySelector('#update-status').hidden&&document.querySelector('#update-progress').hidden&&document.querySelector('#error').hidden`),'completed download has a stable UI');
  await screenshot(page,path.join(output,'verified-dark.png'));
  await page.evaluate(`document.querySelector('#settings-form').elements.language.value='en';document.querySelector('#settings-form').elements.language.dispatchEvent(new Event('change',{bubbles:true}));`);
  for(const end=Date.now()+5000;Date.now()<end;){if(await page.evaluate(`document.querySelector('#update-text').textContent==='Update downloaded and verified.'`))break;await wait(50);}
  check(await page.evaluate(`document.querySelector('#update-text').textContent==='Update downloaded and verified.'`),'active update status follows language changes');
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({checks,status},null,2));
  console.log(JSON.stringify({checks,status,output}));
}finally{
  await page.host('exit').catch(()=>{});page.close();
}
