(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const loaded=await new HostBridge().request('load');
  return {
    reputation:loaded.state.reputation,
    eventCount:loaded.state.events.length,
    completedAuditTasks:loaded.state.tasks.filter(task=>task.title.startsWith('R04 ')&&task.completedAt!==null).length,
    revision:loaded.revision
  };
})()
