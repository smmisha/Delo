import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const audit=fileURLToPath(new URL('./audit-voice.mjs',import.meta.url));
const offline='data:text/javascript,'+encodeURIComponent("globalThis.fetch=()=>{throw Error('Unexpected CDP connection in voice CLI test')}");
for(const [name,args] of [
 ['PowerShell scalar splat splitting a fixture flag',['output',...'--fixtures-only']],
 ['an unknown option',['--fixture-only']]
])test('voice audit rejects '+name+' before connecting',()=>{
 const result=spawnSync(process.execPath,['--import',offline,audit,...args],{encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(result.status,1,result.error?.message);
 assert.match(result.stderr,/Usage: audit-voice\.mjs/);
 assert.doesNotMatch(result.stderr,/fetch failed|ECONNREFUSED|Named Delo harness/);
});