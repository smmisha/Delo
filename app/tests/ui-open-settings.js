(async()=>{
  const dialog=document.querySelector('#settings');
  if(!dialog.open){document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();}
  await new Promise(resolve=>setTimeout(resolve,120));
  const rect=document.querySelector('#settings-form').getBoundingClientRect();
  return {open:dialog.open,theme:document.body.classList.contains('dark')?'dark':'light',rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
})()
