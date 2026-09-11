(async()=>{
 const deadline=Date.now()+5000;while(!document.querySelector('#today')?.textContent&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 const {HostBridge}=await import('./bridge.mjs'),{translator}=await import('./i18n.mjs');
 const saved=await new HostBridge().request('load');
 const error=document.querySelector('#error'),text=document.querySelector('#error-text').textContent;
 if(!saved.native.hotkeyError||error.hidden||text!==translator('ru')('hotkeyError'))throw Error('Startup conflict was not shown');
 return {startupConflictVisible:true,settingsAvailable:!document.querySelector('#settings-open').disabled};
})()
