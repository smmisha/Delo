import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {waitForBackdropReady} from './audit-backdrop.mjs';

async function fixture(t,body){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'delo-backdrop-test-')),file=path.join(directory,'ready.json');
 const source=`import fs from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';const file=process.argv[1];${body}`;
 const child=spawn(process.execPath,['--input-type=module','--eval',source,file],{stdio:'ignore',windowsHide:true});
 child.on('error',()=>{});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 t.after(async()=>{if(child.pid){if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;}await fs.rm(file,{force:true});await fs.rmdir(directory);});
 assert.ok(child.pid,'fixture process starts');return {child,file,exited};
}

test('backdrop readiness waits beyond the former 1500ms pause',{timeout:15000},async t=>{
 const {child,file}=await fixture(t,"await delay(1800);await fs.writeFile(file,JSON.stringify({pid:process.pid,window:42}));setInterval(()=>{},1000);");
 const ready=await waitForBackdropReady(child,file);
 const exists=await fs.access(file).then(()=>true,()=>false);
 assert.equal(exists,true,'measurement must not start before the ready file exists');
 assert.deepEqual(ready,{pid:child.pid,window:42});
});

test('backdrop readiness tolerates a partially written handshake',{timeout:15000},async t=>{
 const {child,file}=await fixture(t,"await fs.writeFile(file,'{');await delay(1800);await fs.writeFile(file,JSON.stringify({pid:process.pid,window:43}));setInterval(()=>{},1000);");
 assert.deepEqual(await waitForBackdropReady(child,file),{pid:child.pid,window:43});
});

test('backdrop readiness refuses a handshake for a different process',async t=>{
 const {child,file}=await fixture(t,"await fs.writeFile(file,JSON.stringify({pid:process.pid+1,window:42}));setInterval(()=>{},1000);");
 await assert.rejects(waitForBackdropReady(child,file),/identity/i);
});

test('backdrop readiness refuses an invalid window handle',async t=>{
 const {child,file}=await fixture(t,"await fs.writeFile(file,JSON.stringify({pid:process.pid,window:0}));setInterval(()=>{},1000);");
 await assert.rejects(waitForBackdropReady(child,file),/identity/i);
});

test('backdrop readiness refuses a dead helper even when its file remains',async t=>{
 const {child,file,exited}=await fixture(t,"await fs.writeFile(file,JSON.stringify({pid:process.pid,window:42}));");
 await exited;
 await assert.rejects(waitForBackdropReady(child,file),/exited/i);
});

test('backdrop readiness reports early helper exit',async t=>{
 const {child,file}=await fixture(t,'process.exit(7);');
 await assert.rejects(waitForBackdropReady(child,file),/exited/i);
});

test('backdrop readiness has a bounded wait for a live unready helper',async t=>{
 const {child,file}=await fixture(t,'setInterval(()=>{},1000);');
 await assert.rejects(waitForBackdropReady(child,file,{timeoutMs:150}),/timed out/i);
 assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
});

test('backdrop readiness reports a helper that cannot start',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'delo-backdrop-missing-'));
 t.after(()=>fs.rmdir(directory));
 const child=spawn(path.join(directory,'missing.exe'),[],{stdio:'ignore',windowsHide:true});
 const error=await new Promise(resolve=>child.once('error',resolve));
 assert.equal(error.code,'ENOENT');
 await assert.rejects(waitForBackdropReady(child,path.join(directory,'ready.json')),/start/i);
});
