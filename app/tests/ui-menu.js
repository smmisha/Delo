(async()=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const input=document.querySelector('#task-input');
  const expanded=document.querySelector('.task-more[aria-expanded="true"]');
  if(expanded){expanded.click();await wait(30);}
  const initialCount=document.querySelectorAll('.task').length;
  for(let index=1;index<=10;index++){
    input.value=`Menu harness ${index}`;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#entry').requestSubmit();
    const expected=initialCount+index;
    const end=Date.now()+3000;
    while(Date.now()<end&&document.querySelectorAll('.task').length<expected)await wait(25);
  }
  const menu=document.querySelector('#task-menu');
  const buttons=()=>[...document.querySelectorAll('.task-more')];
  let triggers=buttons();
  triggers[0].click();await wait(30);
  check('opens from first task',menu.matches(':popover-open'));
  let rect=menu.getBoundingClientRect();
  check('first menu stays inside viewport',rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight);
  check('first enabled item receives focus',menu.contains(document.activeElement));
  const firstFocus=document.activeElement;
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  check('ArrowDown moves focus',menu.contains(document.activeElement)&&document.activeElement!==firstFocus);
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
  check('End focuses last item',document.activeElement===[...menu.querySelectorAll('button:not(:disabled)')].at(-1));
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
  check('Home focuses first item',document.activeElement===menu.querySelector('button:not(:disabled)'));
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check('Escape closes and returns focus',!menu.matches(':popover-open')&&document.activeElement===triggers[0]);

  triggers[0].click();await wait(20);triggers[0].click();await wait(20);
  check('repeated trigger closes',!menu.matches(':popover-open'));
  triggers=buttons();triggers[0].click();await wait(20);triggers[1].click();await wait(20);
  check('switching task keeps one menu',menu.matches(':popover-open')&&triggers[0].getAttribute('aria-expanded')==='false'&&triggers[1].getAttribute('aria-expanded')==='true');
  menu.dispatchEvent(new Event('scroll',{bubbles:true}));
  check('scroll inside menu keeps it open',menu.matches(':popover-open'));
  document.querySelector('#task-scroll').dispatchEvent(new Event('scroll',{bubbles:false}));await wait(20);
  check('list scroll closes menu',!menu.matches(':popover-open'));

  const scroller=document.querySelector('#task-scroll');scroller.scrollTop=scroller.scrollHeight;scroller.dispatchEvent(new Event('scroll'));await wait(120);
  triggers=buttons();const last=triggers.at(-1);last.click();await wait(30);rect=menu.getBoundingClientRect();
  check('last menu stays inside viewport',menu.matches(':popover-open')&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight);
  window.dispatchEvent(new Event('resize'));await wait(20);
  check('resize closes menu',!menu.matches(':popover-open'));
  last.click();await wait(20);document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await wait(20);
  check('outside pointer closes menu',!menu.matches(':popover-open'));
  return {checks,count:document.querySelectorAll('.task').length};
})()
