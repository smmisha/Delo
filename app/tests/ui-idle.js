(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
  document.activeElement?.blur();
  await new Promise(resolve=>setTimeout(resolve,1500));
  // Earlier checks resize and restyle the window; the idle window starts once that
  // work has produced its frame. Inside the window nothing may be presented or fail.
  let before=await host.window('diagnostics');
  for(const end=Date.now()+3000;!(before.healthy&&before.materialWidth===before.clientWidth&&before.materialHeight===before.clientHeight)&&Date.now()<end;before=await host.window('diagnostics'))await new Promise(resolve=>setTimeout(resolve,50));
  await new Promise(resolve=>setTimeout(resolve,500));
  before=await host.window('diagnostics');
  await new Promise(resolve=>setTimeout(resolve,10000));
  const after=await host.window('diagnostics');
  const checks=[
    {name:'renderer stays healthy',pass:before.healthy&&after.healthy&&after.errors===before.errors},
    {name:'idle produces no repeated presents',pass:after.rendered===before.rendered},
    {name:'window stays visible',pass:after.windowVisible&&!after.iconic}
  ];
  if(checks.some(check=>!check.pass))throw Error(JSON.stringify({checks,before,after}));
  return {checks,before,after};
})()
