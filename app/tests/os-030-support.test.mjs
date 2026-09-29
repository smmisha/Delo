import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures,report,requiredChecks,futureTag} from './os-030-support.mjs';
import {validateState} from '../core/model.mjs';

test('OS harness evidence cannot promote integration to live PASS',()=>{
 const checks=requiredChecks.map(name=>({name,pass:true}));
 assert.equal(report(checks).integration,'PASS');
 assert.deepEqual(report(checks).live,{N12:'UNVERIFIED',T07:'UNVERIFIED',N13:'UNVERIFIED'});
 for(const name of requiredChecks){
  assert.equal(report(checks.filter(c=>c.name!==name)).integration,'FAIL',name+' missing');
  assert.equal(report(checks.map(c=>c.name===name?{...c,pass:false}:c)).integration,'FAIL',name+' failed');
 }
 assert.equal(report(checks,{cleanupError:'disconnected'}).integration,'FAIL');
 assert.equal(report(checks,{error:'wrong PID'}).integration,'FAIL');
 assert.equal(report([]).integration,'FAIL');
 assert.equal(report([...checks,checks[0]]).integration,'FAIL');
 assert.equal(report(checks.map(c=>({...c,pass:'true'}))).integration,'FAIL');
});

test('OS fixtures are valid, deterministic and use only synthetic data',()=>{
 const f=fixtures(1700000000000);
 assert.deepEqual(f,fixtures(1700000000000));
 assert.equal(validateState(f.state).valid,true);
 assert.equal(validateState(f.imported).valid,true);
 assert.equal(f.state.tasks.length,1);
 assert.equal(f.imported.tasks.length,2);
 assert.equal(f.state.settings.checkUpdates,true);
 assert.equal(f.window.updateLatest,futureTag);
 assert.equal(f.window.updateCheckedAt,1700000000000);
 assert.equal(f.window.autostart,false);
 assert.equal(f.window.hotkeys.list,f.state.settings.listShortcut);
});
