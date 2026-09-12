(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const waitFor=async predicate=>{const end=Date.now()+7000;while(Date.now()<end){if(await predicate())return true;await wait(30);}return false;};
  const input=document.querySelector('#task-input');
  const create=async title=>{input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return waitFor(()=>[...document.querySelectorAll('.task-title')].some(node=>node.textContent===title));};
  const archive=async title=>{const row=[...document.querySelectorAll('.task')].find(node=>node.querySelector('.task-title')?.textContent===title);row.querySelector('.task-more').click();await wait(20);const action=document.querySelector('#task-menu [data-action="archive"]');check('main menu has archive and no delete',!!action&&!document.querySelector('#task-menu [data-action="delete"]'));action.click();return waitFor(()=>![...document.querySelectorAll('.task-title')].some(node=>node.textContent===title));};
  const stamp=Date.now(),titleA=`Lifecycle A ${stamp}`,titleB=`Lifecycle B ${stamp}`;
  check('creates first task',await create(titleA));check('creates second task',await create(titleB));
  check('archives first task',await archive(titleA));check('archives second task',await archive(titleB));
  document.querySelector('#settings-open').click();document.querySelector('#open-archive').click();await wait(50);
  check('archive shows both tasks',[...document.querySelectorAll('.collection-row')].filter(row=>row.textContent.includes(`Lifecycle `)).length>=2);
  for(const title of [titleA,titleB]){const row=[...document.querySelectorAll('.collection-row')].find(node=>node.textContent.includes(title));row.querySelectorAll('button')[1].click();await waitFor(async()=> (await host.request('load')).state.tasks.find(task=>task.title===title)?.lifecycle==='trash');}
  document.querySelector('#collection [data-close]').click();
  document.querySelector('#settings-open').click();document.querySelector('#open-trash').click();await wait(50);
  check('trash supports restore and permanent deletion',document.querySelectorAll('.collection-row button').length>=4&&!document.querySelector('#collection-foot').hidden);
  const rowA=[...document.querySelectorAll('.collection-row')].find(node=>node.textContent.includes(titleA));rowA.querySelector('.permanent-delete').click();
  await wait(50);check('permanent deletion uses glass confirmation',document.querySelector('#confirmation').open&&getComputedStyle(document.querySelector('.confirm-surface')).backgroundImage.includes('radial-gradient'));
  document.querySelector('#confirmation-accept').click();
  check('one task can be deleted permanently',await waitFor(async()=>!(await host.request('load')).state.tasks.some(task=>task.title===titleA)));
  document.querySelector('#clear-trash').click();
  await wait(50);check('empty trash uses the same confirmation',document.querySelector('#confirmation').open);
  document.querySelector('#confirmation-accept').click();
  check('trash can be cleared manually',await waitFor(async()=>!(await host.request('load')).state.tasks.some(task=>task.title===titleB)));
  document.querySelector('#collection [data-close]').click();
  return {checks};
})()
