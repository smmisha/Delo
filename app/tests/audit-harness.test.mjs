import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connect} from './audit-harness.mjs';

// Exercise the real CDP transport without a Windows desktop or another dependency.
// Only page discovery is replaced; Node's inspector handles every protocol request.
test('audit harness evaluates callbacks through CDP without embedding their arguments', {timeout:15000}, async t=>{
  const child=spawn(process.execPath,[
    '--inspect=127.0.0.1:0','--input-type=module','--eval',
    "globalThis.document={readyState:'complete',querySelector:()=>({})};setInterval(()=>{},1000);"
  ],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  const originalFetch=globalThis.fetch;let page;
  t.after(async()=>{
    page?.close();globalThis.fetch=originalFetch;
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  });
  const endpoint=await new Promise((resolve,reject)=>{
    let stderr='';
    const timer=setTimeout(()=>reject(Error('Inspector did not start: '+stderr)),5000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Inspector exited: '+code));});
    child.stderr.on('data',chunk=>{
      stderr+=chunk.toString();const match=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);
      if(match){clearTimeout(timer);resolve(match[0]);}
    });
  });
  globalThis.fetch=async(url,...args)=>url==='http://127.0.0.1:9223/json/list'
    ? {json:async()=>[{url:'https://delo.local/ui/index.html',webSocketDebuggerUrl:endpoint}]}
    : originalFetch(url,...args);
  page=await connect();

  await t.test('existing expression strings still work',async()=>{
    assert.equal(await page.evaluate('6 * 7'),42);
  });
  await t.test('a callback receives its fixture name',async()=>{
    assert.equal(await page.evaluate(language=>language+'.wav','uk'),'uk.wav');
  });
  await t.test('multiple selector arguments reach the callback',async()=>{
    const selectors=['#settings [data-close]','#settings .settings-fields label'];
    assert.deepEqual(await page.evaluate((close,first)=>[close,first],...selectors),selectors);
  });
  await t.test('structured arguments retain quotes, slashes and control characters',async()=>{
    const payload={title:'"Дело"\n<>&/\\\u2028\u2029',values:[null,false,0]};
    assert.deepEqual(await page.evaluate(value=>value,payload),payload);
  });
  await t.test('argument text cannot become executable source',async()=>{
    const value='");globalThis.__auditArgumentExecuted=true;//';
    assert.equal(await page.evaluate(value=>value,value),value);
    assert.equal(await page.evaluate('globalThis.__auditArgumentExecuted'),undefined);
  });
  await t.test('async callback results are awaited',async()=>{
    assert.deepEqual(await page.evaluate(async value=>({value}),42),{value:42});
  });
  await t.test('callback exceptions reach the caller',async()=>{
    await assert.rejects(page.evaluate(()=>{throw Error('audit-sentinel');}),/audit-sentinel/);
    assert.equal(await page.evaluate(()=>true),true);
  });
});
