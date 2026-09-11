(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge();
  await new Promise(resolve=>setTimeout(resolve,1500));
  const before=await host.window('diagnostics');
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
