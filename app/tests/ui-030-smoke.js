// 0.3.0 live smoke on the real widget: T08, A05, F04, T07, N13. Each part records what it saw;
// a failed part does not stop the others.
(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(name,pass,details)=>checks.push({name,pass:!!pass,details});
  const idle=async()=>{const end=Date.now()+3000;while(document.querySelector('#widget').getAttribute('aria-busy')==='true'&&Date.now()<end)await wait(25);await wait(80);};
  const input=document.querySelector('#task-input');
  const type=async text=>{input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(250);};
  const submit=async()=>{document.querySelector('#entry').requestSubmit();const end=Date.now()+3000;while(input.value&&Date.now()<end)await wait(25);await idle();};
  const load=async()=>(await host.request('load')).state;
  const row=title=>[...document.querySelectorAll('.task[data-task]')].find(node=>node.querySelector('.task-title')?.textContent===title);
  const part=async(name,body)=>{try{await body();}catch(error){check(name+' ran without an error',false,error.message);}};
  const pad=n=>String(n).padStart(2,'0'),date=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  await part('T08',async()=>{
    await type('Позвонить в сервис завтра в 15:00');
    const hint=document.querySelector('#due-hint');
    check('T08 a date at the end of the text shows a hint',hint&&!hint.hidden&&getComputedStyle(hint).display!=='none'&&/15:00/.test(hint.textContent),hint?.textContent);
    await submit();
    const task=(await load()).tasks.find(item=>item.title==='Позвонить в сервис');
    const tomorrow=new Date(Date.now()+86400000);
    check('T08 the task is saved without the date words and with the deadline',task?.due?.date===date(tomorrow)&&task.due.time==='15:00',task?.due);
  });

  await part('A05',async()=>{
    for(const title of ['Отчёт за август','Купить хлеб']){await type(title);await submit();row(title).querySelector('.task-more').click();await wait(80);document.querySelector('#task-menu [data-action=archive]').click();await idle();}
    document.querySelector('#settings-open').click();await wait(200);document.querySelector('#open-archive').click();await wait(500);
    const search=document.querySelector('#collection-search');
    check('A05 the archive has a search field',search&&search.offsetParent!==null);
    search.value='отчет';search.dispatchEvent(new Event('input',{bubbles:true}));await wait(250);
    const shown=[...document.querySelectorAll('#collection-list .collection-row')].filter(node=>node.offsetParent!==null).map(node=>node.querySelector('.collection-copy')?.firstChild?.textContent??node.textContent);
    check('A05 "отчет" finds "Отчёт за август" only',shown.length===1&&/Отчёт за август/.test(shown[0]),shown);
    document.querySelector('#collection').close();await wait(150);
  });

  await part('F04',async()=>{
    await type('Замер времени');await submit();
    row('Замер времени').querySelector('.timer').click();await idle();await wait(2600);
    row('Замер времени').querySelector('.timer').click();await idle();
    document.querySelector('#settings-open').click();await wait(200);
    const item=document.querySelector('#open-time');
    check('F04 the menu has a Time item',item&&item.offsetParent!==null,item?.textContent);
    item.click();await wait(700);
    const sheet=document.querySelector('#time-sheet');
    check('F04 the Time sheet opens with today and week',sheet?.open&&/\d/.test(document.querySelector('#time-today')?.textContent)&&/\d/.test(document.querySelector('#time-week')?.textContent),{today:document.querySelector('#time-today')?.textContent,week:document.querySelector('#time-week')?.textContent});
    check('F04 the timed task is listed',/Замер времени/.test(document.querySelector('#time-list')?.textContent));
    const task=(await load()).tasks.find(item=>item.title==='Замер времени');
    check('F04 the work is saved as an interval',Array.isArray(task?.intervals)&&task.intervals.length===1&&task.intervals[0][1]>=2000,task?.intervals);
    sheet?.close();await wait(150);
  });

  await part('T07',async()=>{
    const soon=new Date(Date.now()+10*60000);
    await type(`Проверить напоминание сегодня в ${pad(soon.getHours())}:${pad(soon.getMinutes())}`);await submit();
    await wait(2600);
    const task=(await load()).tasks.find(item=>item.title==='Проверить напоминание');
    check('T07 a deadline 10 minutes away is reminded once',task&&task.reminded===task.due?.at,{due:task?.due,reminded:task?.reminded});
  });

  await part('N13',async()=>{
    const reply=await host.window('updates',{enabled:true});await wait(6000);
    const again=await host.window('updates',{enabled:true});
    check('N13 the update check answers without an error',again&&!again.error,{first:reply,second:again});
    await host.window('updates',{enabled:false});
  });
  return {checks};
})()
