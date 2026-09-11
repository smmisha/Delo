import test from 'node:test';import assert from 'node:assert/strict';
import {saveSettings} from '../ui/settings-transaction.mjs';
const old={listShortcut:'Ctrl+Alt+Space',quickShortcut:'Ctrl+Alt+N',autostart:false};
const next={listShortcut:'Ctrl+Alt+A',quickShortcut:'Ctrl+Alt+B',autostart:true};
test('settings commit only after both native operations succeed',async()=>{const calls=[];await saveSettings({window:async(action,value)=>calls.push([action,value])},old,next,async()=>{calls.push(['persist']);return true;});assert.deepEqual(calls.map(c=>c[0]),['hotkeys','autostart','persist']);});
test('failed data write restores applied native settings',async()=>{const calls=[];await assert.rejects(saveSettings({window:async(action,value)=>calls.push([action,value])},old,next,async()=>false),/settingsSaveError/);assert.deepEqual(calls.slice(2),[['autostart',{enabled:false}],['hotkeys',{list:old.listShortcut,quick:old.quickShortcut}]]);});
test('autostart error restores keys and never writes domain state',async()=>{const calls=[];await assert.rejects(saveSettings({window:async(action,value)=>{calls.push([action,value]);if(action==='autostart')throw Error('denied');}},old,next,async()=>assert.fail('must not persist')),/denied/);assert.equal(calls.at(-1)[1].list,old.listShortcut);});
test('rollback failure is not hidden behind original error',async()=>{let calls=0;await assert.rejects(saveSettings({window:async()=>{if(++calls>2)throw Error('unavailable');}},old,next,async()=>false),/nativeRollbackError/);assert.equal(calls,4);});
