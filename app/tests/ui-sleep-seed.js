(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const title='Harness: production sleep';
  const input=document.querySelector('#task-input');input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#entry').requestSubmit();
  const deadline=Date.now()+5000;let row;
  do{await wait(50);row=[...document.querySelectorAll('.task[data-task]')].find(item=>item.querySelector('.task-title')?.textContent===title);}while(!row&&Date.now()<deadline);
  if(!row)throw Error('sleep task was not created');
  row.querySelector('.timer').click();await wait(1600);
  const loaded=await host.request('load'),task=loaded.state.tasks.find(item=>item.title===title),diagnostics=await host.window('diagnostics');
  if(!task||task.workState!=='running'||task.elapsedMs<1000)throw Error(JSON.stringify({task,diagnostics}));
  return {task:{id:task.id,workState:task.workState,elapsedMs:task.elapsedMs},revision:loaded.revision,diagnostics};
})()
