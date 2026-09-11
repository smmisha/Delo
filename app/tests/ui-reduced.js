(async()=>{
  const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  document.querySelector('#settings-open').click();const form=document.querySelector('#settings-form');
  form.elements.reducedMotion.checked=true;form.requestSubmit();
  const deadline=Date.now()+5000;while(document.querySelector('#settings').open&&Date.now()<deadline)await wait(25);
  check('reduced motion setting applies',document.body.classList.contains('reduced'));
  check('button transitions are removed',getComputedStyle(document.querySelector('#settings-open')).transitionDuration==='0s');
  const title=`Reduced motion ${Date.now()}`,input=document.querySelector('#task-input');input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();
  let row;const rowDeadline=Date.now()+5000;do{await wait(25);row=[...document.querySelectorAll('.task')].find(item=>item.querySelector('.task-title')?.textContent===title);}while(!row&&Date.now()<rowDeadline);
  check('new row displacement animation is removed',row&&getComputedStyle(row).animationName==='none');
  const loaded=await host.request('load');check('reduced motion persists',loaded.state.settings.reducedMotion===true);
  return {checks};
})()
