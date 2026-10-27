import test from 'node:test';
import assert from 'node:assert/strict';
import {updatePresentation} from '../ui/update-view.mjs';
import {translator} from '../ui/i18n.mjs';

test('ordinary update uses installation, while Store retains Store updates',()=>{
  const info={latest:'v0.3.8',current:'0.3.7',newer:true};
  assert.equal(updatePresentation({enabled:true,info}).action,'updateInstall');
  assert.equal(updatePresentation({store:true,enabled:true,info,download:{phase:'downloading'}}).action,'openStore');
  assert.equal(updatePresentation({enabled:false,info}).visible,false);
});
test('active downloads remain visible when notifications are switched off, without duplicate install actions',()=>{
  for(const phase of ['checking','downloading','installing','ready']){
    const view=updatePresentation({enabled:false,download:{phase,percent:47.8}});
    assert.equal(view.visible,true);assert.equal(view.action,null);
    assert.equal(view.progress,phase==='downloading'?47:null);
  }
});
test('failure exposes retry, and an already-current result exposes no installer',()=>{
  assert.equal(updatePresentation({download:{phase:'error'}}).action,'updateRetry');
  const view=updatePresentation({download:{phase:'current',current:'0.3.7'}});
  assert.equal(view.action,null);assert.equal(view.args.version,'0.3.7');
});
test('all update phases and actions have RU, UK and EN translations',()=>{
  for(const language of ['ru','uk','en']){
    const t=translator(language);
    for(const key of ['updateInstall','updateRetry','updateChecking','updateDownloading','updateInstalling','updateFailed','updateReady'])assert.notEqual(t(key),key);
  }
});
