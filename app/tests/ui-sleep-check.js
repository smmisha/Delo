(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const deadline=Date.now()+15000;let diagnostics;
  do{diagnostics=await host.window('diagnostics');if(!diagnostics.healthy)await wait(100);}while(!diagnostics.healthy&&Date.now()<deadline);
  await wait(500);const loaded=await host.request('load'),task=loaded.state.tasks.find(item=>item.title==='Harness: production sleep');
  const wallSinceCreate=Date.now()-task.createdAt;
  const checks=[
    {name:'system suspend received',pass:diagnostics.powerSuspends>=1},
    {name:'system resume received',pass:diagnostics.powerResumes>=1},
    {name:'renderer rebuilt after resume',pass:diagnostics.recoveries>=2&&diagnostics.healthy&&diagnostics.errors===0},
    {name:'window remains visible',pass:diagnostics.windowVisible&&!diagnostics.iconic},
    {name:'running task paused for sleep',pass:task?.workState==='paused'},
    {name:'sleep time excluded from timer',pass:task?.elapsedMs>=1000&&wallSinceCreate-task.elapsedMs>=5000}
  ];
  if(checks.some(check=>!check.pass))throw Error(JSON.stringify({checks,task,diagnostics}));
  return {checks,task:{id:task.id,workState:task.workState,elapsedMs:task.elapsedMs,wallSinceCreate,excludedMs:wallSinceCreate-task.elapsedMs},revision:loaded.revision,diagnostics};
})()
