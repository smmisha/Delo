import test from 'node:test';
import assert from 'node:assert/strict';
import {stateFromLoad} from '../ui/state-loader.mjs';
import {createState,applyCommand,validateState} from '../core/model.mjs';
import {messages} from '../ui/i18n.mjs';
test('only explicitly absent initial data creates an empty state',()=>{
  assert.equal(stateFromLoad({state:null,revision:0}).tasks.length,0);
  for(const result of [null,{}, {revision:0}, {state:null,revision:3},{state:{},revision:0},{state:createState(),revision:NaN}])assert.throws(()=>stateFromLoad(result),/invalidState/);
});
test('valid saved state is retained and corrupted ledger rejected',()=>{
  const state=applyCommand(createState(),{type:'create',id:'keep',title:'Сохранить задачу'},{now:1000,monotonic:0});
  assert.equal(stateFromLoad({state,revision:3}).tasks[0].title,'Сохранить задачу');
  const broken=structuredClone(state);broken.reputation=123;assert.throws(()=>stateFromLoad({state:broken,revision:3}),/invalidState/);
  assert.equal(broken.tasks.length,1);
});
test('reduced motion setting persists and rejects invalid type',()=>{
  const state=applyCommand(createState(),{type:'settings',patch:{reducedMotion:true}},{now:1000,monotonic:0});
  assert.equal(stateFromLoad({state,revision:1}).settings.reducedMotion,true);
  const broken=structuredClone(state);broken.settings.reducedMotion='yes';assert.equal(validateState(broken).valid,false);
});
test('task text limit accepts boundary and rejects overlong input without mutation',()=>{
  const state=createState();const clock={now:1000,monotonic:0};assert.equal(applyCommand(state,{type:'create',id:'a',title:'x'.repeat(4000)},clock).tasks[0].title.length,4000);
  assert.throws(()=>applyCommand(state,{type:'create',id:'b',title:'x'.repeat(4001)},clock),/Invalid title/);assert.equal(state.tasks.length,0);
});
test('backup recovery explanations are present in all supported languages',()=>{
  for(const language of ['ru','uk','en'])for(const key of ['restoreBackup','dataCorrupt','restoreConfirm','restoreFailed'])assert.ok(messages[language][key]?.length>5,`${language}.${key}`);
});
