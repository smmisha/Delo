(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const deadline=Date.now()+10000;let diagnostics;
  do{diagnostics=await host.window('diagnostics');if(!diagnostics.healthy)await wait(100);}while(!diagnostics.healthy&&Date.now()<deadline);
  const loaded=await host.request('load'),task=loaded.state.tasks.find(item=>item.title==='Harness: production sleep');
  const checks=[
    {name:'sleep task survives relaunch',pass:!!task},
    {name:'sleep task stays paused',pass:task?.workState==='paused'&&task.timerAnchor===null},
    {name:'saved elapsed survives relaunch',pass:task?.elapsedMs>=1000&&task.elapsedMs<30000},
    {name:'renderer healthy after relaunch',pass:diagnostics.healthy&&diagnostics.errors===0}
  ];
  if(checks.some(check=>!check.pass))throw Error(JSON.stringify({checks,task,diagnostics}));
  return {checks,task:{id:task.id,workState:task.workState,elapsedMs:task.elapsedMs},revision:loaded.revision,diagnostics};
})()
