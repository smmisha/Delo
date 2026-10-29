import test from 'node:test';
import assert from 'node:assert/strict';
import * as updates from '../ui/update-view.mjs';
import {translator} from '../ui/i18n.mjs';
import {VoiceInput} from '../ui/voice.mjs';

const available={enabled:true,info:{current:'0.3.7',latest:'v0.3.8',newer:true},canShow:true};
function prompt(){assert.equal(typeof updates.createUpdatePrompt,'function');return updates.createUpdatePrompt();}

test('startup offers an available update once until the next launch',()=>{
 const first=prompt();
 assert.equal(first.handled,false);
 assert.equal(first.offer(available),true);
 assert.equal(first.handled,true);
 assert.equal(first.offer(available),false);
 assert.equal(first.offer({...available,info:{...available.info,latest:'v0.3.9'}}),false);
 assert.equal(prompt().offer(available),true);
});
test('quick, Store, disabled checks and current versions do not consume the startup offer',()=>{
 for(const change of [{quick:true},{store:true},{enabled:false},{info:null},{info:{newer:false,latest:'v0.3.7'}},{info:{newer:'false',latest:'v0.3.8'}},{info:{newer:true,latest:''}}]){
  const policy=prompt();
  assert.equal(policy.offer({...available,...change}),false);
  assert.equal(policy.offer(available),true);
 }
});
test('startup waits for a safe visible foreground instead of interrupting other work',()=>{
 const policy=prompt();
 assert.equal(policy.offer({...available,canShow:false}),false);
 assert.equal(policy.offer(available),true);
});
test('an update already in progress does not trigger a second installation prompt',()=>{
 for(const phase of ['checking','downloading','installing','ready','error','current']){
  const policy=prompt();
  assert.equal(policy.offer({...available,download:{phase}}),false);
 }
});

test('startup waits through voice recording and transcription, then offers after cancellation',async()=>{
 const policy=prompt(),offers=[],host=new EventTarget();host.request=async()=>({});
 const voice=new VoiceInput({host,input:{value:''},language:()=> 'ru',onChange:()=>offers.push(policy.offer({...available,voiceActive:voice.active}))});
 await voice.start();
 voice.receive({session:voice.session,state:'recording'});
 await voice.stop();
 voice.receive({session:voice.session,state:'transcribing'});
 assert.deepEqual(offers,[false,false,false,false]);
 voice.cancel();assert.equal(offers.at(-1),true);
});
test('starting an update from Settings consumes the automatic offer for this launch',()=>{
 const policy=prompt();policy.dismiss();
 assert.equal(policy.offer(available),false);
});
test('startup update title, explanation and deferral are translated in all languages',()=>{
 for(const language of ['ru','uk','en']){
  const t=translator(language);
  for(const key of ['updatePromptTitle','updatePromptMessage','updateLater'])assert.notEqual(t(key),key);
  assert.ok(t('updatePromptMessage').includes('{version}'));
 }
});
