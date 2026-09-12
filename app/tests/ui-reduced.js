(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const clickReady=async selector=>{const button=document.querySelector(selector),end=Date.now()+5000;while(button.disabled&&Date.now()<end)await wait(25);if(button.disabled)throw Error(`${selector} stays disabled`);button.click();};
  document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));const form=document.querySelector('#settings-form');
  form.elements.reducedMotion.checked=true;form.elements.reducedMotion.dispatchEvent(new Event('change',{bubbles:true}));
  const deadline=Date.now()+5000;let saved=false;
  while(Date.now()<deadline){saved=(await host.request('load')).state.settings.reducedMotion===true&&document.body.classList.contains('reduced')&&document.querySelector('#widget').getAttribute('aria-busy')==='false';if(saved)break;await wait(25);}
  check('reduced motion auto-saves before closing',saved&&document.querySelector('#settings-error').hidden);
  document.querySelector('#settings [data-close]').click();
  check('reduced motion setting applies',!document.querySelector('#settings').open&&document.body.classList.contains('reduced'));
  check('button transitions are removed',getComputedStyle(document.querySelector('#settings-open')).transitionDuration==='0s');
  const title=`Reduced motion ${Date.now()}`,input=document.querySelector('#task-input');input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));await clickReady('#add-task');
  let row;const rowDeadline=Date.now()+5000;do{await wait(25);row=[...document.querySelectorAll('.task')].find(item=>item.querySelector('.task-title')?.textContent===title);}while(!row&&Date.now()<rowDeadline);
  check('new row displacement animation is removed',row&&getComputedStyle(row).animationName==='none');
  const loaded=await host.request('load');check('reduced motion persists',loaded.state.settings.reducedMotion===true);
  return {checks};
})()
