(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const waitFor=async predicate=>{const end=Date.now()+7000;while(Date.now()<end){if(await predicate())return true;await wait(30);}return false;};
  const input=document.querySelector('#task-input');
  const create=async title=>{input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();return waitFor(()=>[...document.querySelectorAll('.task-title')].some(node=>node.textContent===title));};
  const remove=async title=>{const row=[...document.querySelectorAll('.task')].find(node=>node.querySelector('.task-title')?.textContent===title);row.querySelector('.task-more').click();await wait(20);document.querySelector('#task-menu [data-action="delete"]').click();return waitFor(()=>![...document.querySelectorAll('.task-title')].some(node=>node.textContent===title));};
  const offset=()=>Number(document.querySelector('#undo-arc').style.strokeDashoffset);
  const titleA=`Undo A ${Date.now()}`,titleB=`Undo B ${Date.now()}`;
  check('creates first task',await create(titleA));check('creates second task',await create(titleB));
  check('deleting first task opens undo',await remove(titleA)&&!document.querySelector('#undo-bar').hidden);
  check('undo receives focus and pauses',await waitFor(()=>document.activeElement===document.querySelector('#undo-delete')&&document.querySelector('#undo-seconds').textContent==='Ⅱ'));

  input.focus();await wait(450);document.querySelector('#undo-bar').dispatchEvent(new PointerEvent('pointerenter',{bubbles:true}));const hoverStart=offset();await wait(1000);const hoverEnd=offset();
  check('hover pauses countdown',document.querySelector('#undo-seconds').textContent==='Ⅱ'&&Math.abs(hoverEnd-hoverStart)<2);
  document.querySelector('#undo-bar').dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}));await wait(650);
  check('leaving hover resumes countdown',offset()>hoverEnd+1);

  check('second deletion keeps both undo windows',await remove(titleB)&&document.querySelector('#undo-hint').textContent.includes('+1'));
  document.querySelector('#undo-delete').click();
  check('undo restores latest deletion first',await waitFor(()=>[...document.querySelectorAll('.task-title')].some(node=>node.textContent===titleB))&&!document.querySelector('#undo-bar').hidden);

  input.focus();await wait(250);const hiddenStart=offset();await host.window('hide');await wait(1000);await host.window('show');await wait(100);const hiddenEnd=offset();
  check('hidden window pauses countdown',Math.abs(hiddenEnd-hiddenStart)<2);
  input.focus();
  check('older deletion eventually reaches trash',await waitFor(async()=>{const task=(await host.request('load')).state.tasks.find(item=>item.title===titleA);return task?.lifecycle==='trash'&&document.querySelector('#undo-bar').hidden;}));

  document.querySelector('#settings-open').click();document.querySelector('#open-trash').click();await wait(50);
  const collection=document.querySelector('#collection');const trashRow=[...document.querySelectorAll('.collection-row')].find(node=>node.textContent.includes(titleA));
  check('trash shows deleted task and retention note',collection.open&&trashRow&&document.querySelector('#collection-note').textContent.includes('30'));
  trashRow.querySelector('button').click();
  check('restore returns task without running timer',await waitFor(async()=>{const task=(await host.request('load')).state.tasks.find(item=>item.title===titleA);return task?.lifecycle==='active'&&task.workState!=='running';}));
  document.querySelector('#collection [data-close]').click();
  return {checks};
})()
