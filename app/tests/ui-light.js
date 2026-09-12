(async()=>{
 const {HostBridge}=await import('./bridge.mjs'),host=new HostBridge();
 document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));
 const form=document.querySelector('#settings-form');form.elements.theme.value='light';
 form.elements.theme.dispatchEvent(new Event('change',{bubbles:true}));
 const end=Date.now()+5000;let saved=false;
 while(Date.now()<end){
  const value=await host.request('load');
  saved=value.state.settings.theme==='light'&&document.body.classList.contains('dark')===false&&document.querySelector('#widget').getAttribute('aria-busy')==='false';
  if(saved)break;await new Promise(r=>setTimeout(r,25));
 }
 if(!saved||!document.querySelector('#settings-error').hidden)throw Error('light theme was not saved');
 document.querySelector('#settings [data-close]').click();
 if(document.querySelector('#settings').open||!document.querySelector('#error').hidden)throw Error('Settings did not close cleanly');
 return {theme:'light',error:false};
})()
