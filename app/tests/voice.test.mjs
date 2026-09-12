import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceInput} from '../ui/voice.mjs';
import {translator} from '../ui/i18n.mjs';
function fixture(now=()=>0){
 const host=new EventTarget();host.requests=[];host.request=async(type,payload)=>{host.requests.push({type,...payload});};
 const input={value:'Черновик'},voice=new VoiceInput({host,input,language:()=> 'ru',now});
 return {host,input,voice,receive:(state,text='',error='')=>voice.receive({session:voice.session,state,text,error})};
}
test('V02 result appends to the latest draft, without submitting a task',async()=>{
 const f=fixture();await f.voice.start();f.receive('recording');assert.equal(f.voice.phase,'recording');
 f.input.value='Обновлённый черновик';await f.voice.stop();f.receive('transcribing');f.receive('result','Купить молоко');
 assert.equal(f.input.value,'Обновлённый черновик Купить молоко');assert.equal(f.voice.phase,'idle');assert(f.host.requests.every(r=>r.type==='voice'));
});
test('V02 cancel discards late results and permits a fresh session',async()=>{
 const f=fixture();await f.voice.start();const old=f.voice.session;f.voice.cancel();await f.voice.start();
 f.voice.receive({session:old,state:'result',text:'late'});assert.equal(f.input.value,'Черновик');
 f.receive('result','новое');assert.equal(f.input.value,'Черновик новое');
});
test('V02 stop during start is not undone by delayed recording acknowledgement',async()=>{
 const f=fixture();await f.voice.start();await f.voice.stop();f.receive('recording');assert.equal(f.voice.phase,'stopping');
});
test('V02 missing engine, permission, silence and timeout preserve the draft',async()=>{
 for(const error of ['voiceMissing','voiceMic','voiceNoSpeech','voiceTimeout','voiceFailed']){
  const f=fixture();await f.voice.start();f.receive('error','',error);assert.equal(f.input.value,'Черновик');assert.equal(f.voice.error,error);
 }
});
test('V02 failed start clears the session; long results are preserved for editing',async()=>{
 const f=fixture();f.host.request=async()=>{throw Error('voiceBusy');};await f.voice.start();assert.equal(f.voice.error,'voiceBusy');assert.equal(f.voice.session,null);
 const g=fixture();await g.voice.start();g.receive('result','а'.repeat(4000));assert.equal(g.voice.error,'voiceTooLong');assert.equal(g.input.value.length,4009);
});
test('V03 recording exposes a clamped one-minute elapsed time',async()=>{
 let time=12000;const f=fixture(()=>time);await f.voice.start();f.receive('recording');
 assert.equal(f.voice.recordingSeconds(),0);time=59001;assert.equal(f.voice.recordingSeconds(),47);
 time=73000;assert.equal(f.voice.recordingSeconds(),60);
});
test('V03 the native limit signal explains automatic transcription',async()=>{
 const f=fixture();await f.voice.start();f.receive('recording');f.receive('limit');
 assert.equal(f.voice.phase,'transcribing');assert.equal(f.voice.limitReached,true);
});
test('V03 typing can dismiss an error without losing the draft',async()=>{
 const f=fixture();await f.voice.start();f.receive('error','','voiceMic');
 f.voice.clearError();assert.equal(f.voice.phase,'idle');assert.equal(f.input.value,'Черновик');
});
test('V02 voice feedback exists in RU, UK and EN',()=>{
 for(const lang of ['ru','uk','en'])for(const key of ['voice','voiceStop','voiceRecording','voiceTranscribing','voiceLimit','voiceMic','voiceNoSpeech','voiceFailed'])assert.notEqual(translator(lang)(key),key);
});
