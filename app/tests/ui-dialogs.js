(async()=>{
  const link=document.querySelector('link[href^="app.css"]');link.href=`app.css?test=${Date.now()}`;
  await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
  const checks=[];
  function check(name,pass){checks.push({name,pass});if(!pass)throw Error(name);}
  for(const [id,trigger] of [['editor','new-with-date'],['settings','settings-open']]){
    const dialog=document.getElementById(id);
    check(`${id}: initially hidden`,!dialog.open&&getComputedStyle(dialog).display==='none');
    document.getElementById(trigger).click();if(id==='settings')document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));
    check(`${id}: opens`,dialog.open&&getComputedStyle(dialog).display==='flex');
    const button=dialog.querySelector('.save'),rect=button.getBoundingClientRect();
    check(`${id}: save visible`,rect.top>=0&&rect.bottom<=innerHeight);
    dialog.querySelector('[data-close]').click();
    check(`${id}: closes`,!dialog.open&&getComputedStyle(dialog).display==='none');
  }
  const {HostBridge}=await import('./bridge.mjs');
  return {checks,renderer:await new HostBridge().window('diagnostics')};
})()
