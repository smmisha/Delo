import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,applyCommand,validateState} from '../core/model.mjs';
import {exportData,exportName,parseImport,summarize,DEVICE_SETTINGS} from '../core/transfer.mjs';
const now=Date.parse('2026-09-27T10:00:00Z');
const run=(s,command,at=now,monotonic=0)=>applyCommand(s,command,{now:at,monotonic,timeZone:'UTC'});
function sample(){
  let s=createState();
  for(const id of ['a','b','c','d'])s=run(s,{type:'create',id,title:`Задача ${id}`,due:id==='a'?{date:'2026-10-01',time:'15:00',timeZone:'Europe/Kyiv'}:null});
  s=run(s,{type:'start',id:'b'},now,1000);s=run(s,{type:'pause',id:'b'},now+60000,61000);
  s=run(s,{type:'complete',id:'a'});s=run(s,{type:'pin',id:'c'});
  s=run(s,{type:'archive',id:'d'});s=run(s,{type:'trash',id:'d'});
  return run(s,{type:'settings',patch:{language:'uk',theme:'dark',listShortcut:'Ctrl+Alt+J',autostart:true}});
}

test('V25 export then import returns the same data',()=>{
  const s=sample(),text=exportData(s,{now});
  const root=JSON.parse(text);assert.equal(root.format,'delo-export');assert.equal(root.version,1);assert.equal(root.exportedAt,'2026-09-27T10:00:00.000Z');
  const {state,summary}=parseImport(text,s);
  assert.deepEqual(state,s);assert.deepEqual(summary,{tasks:4,active:3,archive:0,trash:1,reputation:5});
  assert.equal(exportName(new Date(2026,8,7)),'Delo-2026-09-07.json');
});

test('V25 import takes preferences but keeps the settings of this computer',()=>{
  const file=sample();let here=createState();
  here=run(here,{type:'settings',patch:{listShortcut:'Ctrl+Alt+K',quickShortcut:'Ctrl+Alt+Q',pinned:true}});
  const {state}=parseImport(exportData(file),here);
  assert.equal(state.settings.language,'uk');assert.equal(state.settings.theme,'dark');
  for(const key of DEVICE_SETTINGS)assert.equal(state.settings[key],here.settings[key],key);
  assert.equal(state.tasks.length,4);assert.equal(validateState(state).valid,true);
});

test('V25 the data file itself, its backup and a bare state are accepted',()=>{
  const s=sample();
  assert.equal(parseImport(JSON.stringify({format:1,revision:812,state:s}),s).state.tasks.length,4);
  assert.equal(parseImport(`﻿${JSON.stringify(s)}`,s).state.tasks.length,4);
});

test('V25 a running timer and a pending deletion are settled, as after a crash',()=>{
  let s=sample();s=run(s,{type:'start',id:'c'},now,5000);s=run(s,{type:'delete',id:'b'},now,6000);
  const {state}=parseImport(exportData(s),s);
  assert.equal(state.tasks.find(t=>t.id==='c').workState,'paused');assert.equal(state.tasks.find(t=>t.id==='b').lifecycle,'trash');
  assert.equal(summarize(state).trash,2);
});

test('V25 anything else is refused with a reason and nothing is returned',()=>{
  const s=sample(),valid=JSON.parse(exportData(s));
  const broken=structuredClone(valid);broken.state.reputation+=1;
  const cases=[['не json','importInvalid'],['[]','importInvalid'],['{"hello":1}','importInvalid'],[JSON.stringify({...valid,version:2}),'importUnsupported'],[JSON.stringify({...valid,state:{...valid.state,schemaVersion:2}}),'importUnsupported'],[JSON.stringify(broken),'importInvalid'],[JSON.stringify({format:'delo-export',version:1}),'importInvalid'],[' '.repeat(16*1024*1024+1),'importTooLarge']];
  for(const [text,code] of cases)assert.throws(()=>parseImport(text,s),{message:code},text.slice(0,40));
  assert.throws(()=>parseImport(42,s),{message:'importInvalid'});
});
