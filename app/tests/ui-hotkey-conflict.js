(async()=>{
 const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
 const before=await host.request('load');document.querySelector('#settings-open').click();
 const form=document.querySelector('#settings-form');form.elements.listShortcut.value='Ctrl+Alt+Shift+Z';form.requestSubmit();
 const error=document.querySelector('#settings-error'),end=Date.now()+5000;
 while(error.hidden&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
 const {translator}=await import('./i18n.mjs');
 if(error.hidden||error.textContent!==translator(before.state.settings.language)('hotkeyError'))throw Error('Missing localized shortcut conflict');
 const after=await host.request('load');
 if(JSON.stringify(after.native.hotkeys)!==JSON.stringify(before.native.hotkeys)||after.state.settings.listShortcut!==before.state.settings.listShortcut)throw Error('Failed setting changed saved shortcuts');
 document.querySelector('#settings [data-close]').click();
 return {conflictVisible:true,oldShortcutsPreserved:true,text:error.textContent};
})()
