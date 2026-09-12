(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  await host.window('show');await wait(100);
  const shown=await host.window('diagnostics');
  check('temporary main window is visible before hide',shown.visible&&shown.windowVisible);
  await host.window('hide');await wait(100);
  const hidden=await host.window('diagnostics');
  check('one hide command sends the main window to tray',!hidden.visible&&!hidden.windowVisible);
  await host.window('show');await wait(100);
  check('main window can be restored after one-click hide',(await host.window('diagnostics')).windowVisible);
  return {checks};
})()
