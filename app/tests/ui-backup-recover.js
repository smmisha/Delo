(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge(),wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  check('corruption is visible and saving is blocked',!document.querySelector('#error').hidden&&!document.querySelector('#restore-backup').hidden&&document.querySelector('#task-scroll').textContent.length>0);
  window.confirm=()=>true;document.querySelector('#restore-backup').click();
  const end=Date.now()+5000;while(Date.now()<end&&!document.querySelector('#error').hidden)await wait(25);
  const value=await host.request('load');
  check('backup recovery clears the error',document.querySelector('#error').hidden);
  check('previous saved revision is restored',value.state.tasks.length===1&&value.state.tasks[0].title.startsWith('Backup first '));
  check('restored state is rendered',document.querySelectorAll('.task').length===1&&document.querySelector('.task-title').textContent===value.state.tasks[0].title);
  return {checks,revision:value.revision,title:value.state.tasks[0].title};
})()
