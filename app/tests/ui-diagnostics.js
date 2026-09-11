(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  return new HostBridge().window('diagnostics');
})()
