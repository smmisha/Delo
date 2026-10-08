// F06, V28: pinning a task from the bottom of a long group through its own menu. Since 0.3.1 a new
// task enters a group at the top, so the bottom of the group is the oldest task.
(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const idle=async()=>{const end=Date.now()+3000;while(document.querySelector('#widget').getAttribute('aria-busy')==='true'&&Date.now()<end)await wait(25);await wait(60);};
  const input=document.querySelector('#task-input');
  const titles=Array.from({length:12},(_,index)=>`Pin harness ${index+1}`);
  for(const title of titles){
    input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();
    const end=Date.now()+3000;while(Date.now()<end&&input.value!=='')await wait(25);await idle();
  }
  // The long-group case: the oldest task is the one at the bottom, the one that needs pinning.
  const oldest=titles[0],newest=titles.at(-1);
  const row=title=>[...document.querySelectorAll('.task[data-task]')].find(node=>node.querySelector('.task-title')?.textContent===title);
  const groupOf=title=>row(title)?.closest('.task-group')?.dataset.group;
  const count=key=>+document.querySelector(`.task-group[data-group="${key}"] .group-toggle span:last-child`)?.textContent;
  const rowsOf=title=>[...row(title).closest('.task-group-rows').children];
  // Earlier scenarios of the audit suite leave older undated tasks in the same group, so the
  // oldest of these twelve is not necessarily the bottom row; the twelve must be in reverse creation order.
  const order=rowsOf(newest).map(node=>node.querySelector('.task-title')?.textContent).filter(title=>titles.includes(title));
  // Tasks in work from earlier scenarios lead the group (П15); the new ones come right after them.
  check('new tasks enter the top of their group, newest first',groupOf(oldest)==='any'&&rowsOf(newest).find(node=>!node.classList.contains('in-work'))===row(newest)&&order.join('|')===[...titles].reverse().join('|'));
  const anyBefore=count('any');
  let lastIcon='';
  const menuAction=async(title)=>{const node=row(title);node.scrollIntoView({block:'center'});await wait(60);node.querySelector('.task-more').click();await wait(60);const item=document.querySelector('#menu-pin');const label=item.textContent.trim();lastIcon=item.querySelector('use').getAttribute('href');item.click();await idle();return label;};

  const pinLabel=await menuAction(oldest);
  check('the menu offers to pin, with the plain pin',/^(Закрепить|Закріпити|Pin)$/.test(pinLabel)&&lastIcon==='#i-pin');
  const first=document.querySelector('#task-scroll .task-group');
  check('a pinned group leads the list',first?.dataset.group==='pinned'&&first.querySelector('.task-title')?.textContent===oldest);
  check('the pinned group is named and counted like the others',/^(Закреплено|Закріплено|Pinned)$/.test(first.querySelector('.group-name')?.textContent)&&count('pinned')===1);
  check('the task left its own group',count('any')===anyBefore-1);
  const saved=(await host.request('load')).state.tasks.find(task=>task.title===oldest);
  check('the pin is saved',Number.isFinite(saved?.pinnedAt));

  // A second pin goes after the first: pins keep their order.
  await menuAction(newest);
  check('pins keep their order',[...document.querySelectorAll('.task-group[data-group="pinned"] .task-title')].map(node=>node.textContent).join('|')===`${oldest}|${newest}`);

  const unpinLabel=await menuAction(newest);
  check('a pinned task offers to unpin, with the pin crossed out',/^(Открепить|Відкріпити|Unpin)$/.test(unpinLabel)&&lastIcon==='#i-unpin');
  check('unpinning returns the task to its group',groupOf(newest)==='any');

  // Completing a pinned task clears the pin.
  row(oldest).querySelector('.complete').click();await idle();
  check('completion clears the pin',groupOf(oldest)==='done'&&!document.querySelector('.task-group[data-group="pinned"] .task'));
  const done=(await host.request('load')).state.tasks.find(task=>task.title===oldest);
  check('the cleared pin is saved',!('pinnedAt' in done));

  // Leave one pinned task for the relaunch check.
  await menuAction(titles[1]);
  check('a task can be pinned again',groupOf(titles[1])==='pinned');
  return {checks};
})()
