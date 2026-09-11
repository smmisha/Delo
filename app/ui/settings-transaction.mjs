export async function saveSettings(host,previous,next,persist){
  let keysChanged=false,autostartChanged=false;
  try{
    await host.window('hotkeys',{list:next.listShortcut,quick:next.quickShortcut});keysChanged=true;
    await host.window('autostart',{enabled:next.autostart});autostartChanged=true;
    if(!await persist())throw new Error('settingsSaveError');
  }catch(error){
    const failures=[];
    if(autostartChanged)try{await host.window('autostart',{enabled:previous.autostart});}catch(e){failures.push(e);}
    if(keysChanged)try{await host.window('hotkeys',{list:previous.listShortcut,quick:previous.quickShortcut});}catch(e){failures.push(e);}
    if(failures.length)throw new Error('nativeRollbackError',{cause:error});
    throw error;
  }
}
