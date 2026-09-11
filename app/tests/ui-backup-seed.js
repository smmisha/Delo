(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge(),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const input=document.querySelector('#task-input'),titles=[`Backup first ${Date.now()}`,`Backup second ${Date.now()}`];
  for(const title of titles){input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();const end=Date.now()+5000;while(Date.now()<end){const value=await host.request('load');if(value.state?.tasks.some(task=>task.title===title))break;await wait(25);}}
  const value=await host.request('load');if(!titles.every(title=>value.state.tasks.some(task=>task.title===title)))throw Error('Seed save failed');
  return {titles,revision:value.revision};
})()
