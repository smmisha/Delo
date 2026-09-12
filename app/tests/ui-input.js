(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const load=async()=>{const value=await host.request('load');return {...value,state:value.state??{tasks:[]}};};
  const waitFor=async predicate=>{const end=Date.now()+5000;while(Date.now()<end){if(await predicate())return true;await wait(25);}return false;};
  const input=document.querySelector('#task-input');
  const initial=(await load()).state.tasks.length;

  input.value='   ';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();await wait(100);
  check('whitespace does not create a task',(await load()).state.tasks.length===initial);

  input.value='IME draft';input.dispatchEvent(new Event('input',{bubbles:true}));
  const ime=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});input.dispatchEvent(ime);await wait(100);
  check('IME Enter is not intercepted',!ime.defaultPrevented&&input.value==='IME draft'&&(await load()).state.tasks.length===initial);

  const repeated=`Repeated Enter ${Date.now()}`;input.value=repeated;input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  check('repeat Enter saves exactly once',await waitFor(async()=>{const tasks=(await load()).state.tasks;return tasks.filter(task=>task.title===repeated).length===1&&input.value==='';}));

  input.value='Первая строка\nДруга лінія';input.dispatchEvent(new Event('input',{bubbles:true}));
  const shifted=new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});input.dispatchEvent(shifted);await wait(50);
  check('Shift+Enter is left to the textarea',!shifted.defaultPrevented);
  document.querySelector('#entry').requestSubmit();
  check('multiline RU/UK text is preserved',await waitFor(async()=>input.value===''&&(await load()).state.tasks.some(task=>task.title==='Первая строка\nДруга лінія')));

  const prefix=`Boundary ${Date.now()} `,boundary=prefix+'x'.repeat(3999-prefix.length)+'Я';input.value=boundary;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();
  check('4000 character boundary saves',await waitFor(async()=>input.value===''&&(await load()).state.tasks.some(task=>task.title===boundary)));

  const tooLong='z'.repeat(4001);input.value=tooLong;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();
  check('overlong text stays for retry',await waitFor(async()=>input.value===tooLong&&!document.querySelector('#error').hidden&&!(await load()).state.tasks.some(task=>task.title.length===4001)));
  document.querySelector('#error-close').click();input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));

  const row=[...document.querySelectorAll('.task')].find(node=>node.querySelector('.task-title')?.textContent===repeated);
  row.querySelector('.task-title').click();await wait(30);const editor=document.querySelector('#editor'),editorInput=document.querySelector('#editor-input');editorInput.value='Changed but cancelled';editorInput.dispatchEvent(new Event('input',{bubbles:true}));editor.querySelector('[data-close]').click();await wait(30);
  check('editor cancel keeps original task',!editor.open&&(await load()).state.tasks.some(task=>task.title===repeated));

  // Undated rows omit the redundant deadline label; their menu still opens date editing.
  const dateRow=[...document.querySelectorAll('.task')].find(node=>node.querySelector('.task-title')?.textContent===repeated);
  dateRow.scrollIntoView({block:'nearest'});await wait(30);dateRow.querySelector('.task-more').click();
  document.querySelector('#task-menu [data-action=date]').click();await wait(30);document.querySelector('#due-input').value='';document.querySelector('#time-input').value='10:30';document.querySelector('#editor-form').requestSubmit();await wait(80);
  check('time without date is rejected without closing editor',editor.open&&!document.querySelector('#editor-error').hidden&&(await load()).state.tasks.find(task=>task.title===repeated).due===null);
  editor.querySelector('[data-close]').click();
  return {checks,total:(await load()).state.tasks.length};
})()
