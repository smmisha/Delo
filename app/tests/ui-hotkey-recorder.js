(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
  const checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));
  const form=document.querySelector('#settings-form');
  const input=form.elements.listShortcut;
  const original=input.value;
  check('shortcut field is read-only',input.readOnly);
  input.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));input.focus();
  check('focused shortcut field visibly enters recording mode',input.classList.contains('recording')&&input.value===''&&!!input.placeholder);
  const plain=new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true,cancelable:true});
  input.dispatchEvent(plain);
  check('plain text cannot be entered',plain.defaultPrevented&&input.value==='');
  const modifier=new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true,bubbles:true,cancelable:true});
  input.dispatchEvent(modifier);
  check('modifier alone is not accepted',modifier.defaultPrevented&&input.value==='');
  const combination=new KeyboardEvent('keydown',{key:'я',code:'',ctrlKey:true,altKey:true,bubbles:true,cancelable:true});
  Object.defineProperty(combination,'keyCode',{value:90});
  input.dispatchEvent(combination);
  check('physical key fallback assigns the shortcut on a Cyrillic layout',combination.defaultPrevented&&input.value==='Ctrl+Alt+Z');
  const escape=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true});
  input.dispatchEvent(escape);
  check('Escape ends recording without typing text',input.value==='Ctrl+Alt+Z'&&document.activeElement!==input);
  const savedEnd=Date.now()+5000;let committed=false;
  while(Date.now()<savedEnd){const value=await host.request('load');committed=value.native.hotkeys.list==='Ctrl+Alt+Z'&&value.state.settings.listShortcut==='Ctrl+Alt+Z'&&document.querySelector('#widget').getAttribute('aria-busy')==='false';if(committed)break;await new Promise(r=>setTimeout(r,25));}
  check('leaving recorder auto-saves the shortcut',committed&&document.querySelector('#settings-error').hidden);
  document.querySelector('#settings [data-close]').click();
  const saved=(await host.request('load')).native.hotkeys;
  check('recorded shortcut is registered and saved',!document.querySelector('#settings').open&&saved.list==='Ctrl+Alt+Z');
  document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));
  form.elements.listShortcut.value=original;form.elements.quickShortcut.value=saved.quick;form.elements.listShortcut.dispatchEvent(new Event('change',{bubbles:true}));
  const restoreEnd=Date.now()+5000;let restored=false;
  while(Date.now()<restoreEnd){const value=await host.request('load');restored=value.native.hotkeys.list===original&&value.state.settings.listShortcut===original&&document.querySelector('#widget').getAttribute('aria-busy')==='false';if(restored)break;await new Promise(r=>setTimeout(r,25));}
  check('original shortcut is restored after test',restored&&document.querySelector('#settings-error').hidden);
  document.querySelector('#settings [data-close]').click();
  return {checks};
})()
