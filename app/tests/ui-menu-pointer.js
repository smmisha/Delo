// Task menu and re-renders (PR 13 review): the menu must stay bound to a row that is still in the
// list, whether the pointer leaves the list into the menu or the list is rendered again while the menu
// is open (a timer starting or the 15 s checkpoint). Escape returns focus to that row's own control.
(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});if(!pass)throw Error(name+' '+JSON.stringify(details));};
  const idle=async()=>{const end=Date.now()+3000;while(document.querySelector('#widget').getAttribute('aria-busy')==='true'&&Date.now()<end)await wait(25);await wait(60);};
  const title='Menu pointer harness';
  const input=document.querySelector('#task-input');
  const row=()=>[...document.querySelectorAll('.task[data-task]')].find(node=>node.querySelector('.task-title')?.textContent===title);
  if(!row()){input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();const end=Date.now()+3000;while(Date.now()<end&&input.value!=='')await wait(25);await idle();}
  const trigger=()=>row()?.querySelector('.task-more');
  const menu=document.querySelector('#task-menu');
  const scroll=document.querySelector('#task-scroll');
  const openExpanded=()=>[...document.querySelectorAll('.task-more[aria-expanded="true"]')].length;
  const escape=async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(150);};

  // 1. The pointer moves from the row into the menu: the list reports pointerleave.
  scroll.dispatchEvent(new PointerEvent('pointerenter'));
  trigger().click();await wait(80);
  check('the menu opens from the row',menu.matches(':popover-open')&&trigger().getAttribute('aria-expanded')==='true');
  scroll.dispatchEvent(new PointerEvent('pointerleave'));await wait(120);
  check('leaving the list keeps the menu open',menu.matches(':popover-open'));
  check('the menu is still bound to a row in the list',!!trigger()&&trigger().isConnected&&trigger().getAttribute('aria-expanded')==='true',{connected:trigger()?.isConnected,expanded:trigger()?.getAttribute('aria-expanded')});
  await escape();
  check('Escape closes the menu',!menu.matches(':popover-open'));
  check('Escape returns focus to the row that opened the menu',document.activeElement===trigger(),{active:document.activeElement?.className});
  check('no row is left reporting an open menu',openExpanded()===0,{expanded:openExpanded()});

  // 2. A render while the menu is open (the timer starts on the same row): the menu follows the row.
  trigger().click();await wait(80);
  row().querySelector('.timer').click();await idle();await wait(120);
  check('a re-render keeps the menu open and bound',menu.matches(':popover-open')&&!!trigger()&&trigger().isConnected&&trigger().getAttribute('aria-expanded')==='true',{open:menu.matches(':popover-open'),connected:trigger()?.isConnected,expanded:trigger()?.getAttribute('aria-expanded')});
  await escape();
  check('after a re-render, Escape still returns focus to the row',document.activeElement===trigger(),{active:document.activeElement?.className});
  check('after a re-render, no stale row reports an open menu',openExpanded()===0,{expanded:openExpanded()});

  // 3. Put the timer back the way it was.
  row().querySelector('.timer').click();await idle();
  scroll.dispatchEvent(new PointerEvent('pointerleave'));await wait(120);

  // 4. While the pointer is over the list, undated rows keep their places, even when one goes into work.
  const undated=()=>[...document.querySelectorAll('.task-group[data-group="any"] .task[data-task]')];
  const titleOf=node=>node.querySelector('.task-title')?.textContent;
  if(undated().length<2){input.value='Menu pointer other';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();const end=Date.now()+3000;while(Date.now()<end&&input.value!=='')await wait(25);await idle();}
  const bottomTitle=titleOf(undated().at(-1));
  const indexOf=()=>undated().findIndex(node=>titleOf(node)===bottomTitle);
  const before=indexOf();
  scroll.dispatchEvent(new PointerEvent('pointerenter'));
  undated().at(-1).querySelector('.timer').click();await idle();await wait(120);
  check('a task going into work keeps its row while the pointer is over the list',indexOf()===before,{before,during:indexOf()});
  scroll.dispatchEvent(new PointerEvent('pointerleave'));await idle();await wait(120);
  check('when the pointer leaves, the task in work moves to the top of its group',indexOf()===0,{now:indexOf()});
  undated().find(node=>titleOf(node)===bottomTitle).querySelector('.timer').click();await idle();

  return {checks};
})()
