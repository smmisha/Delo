(async()=>{
 const {HostBridge}=await import('./bridge.mjs'),host=new HostBridge(),checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});if(!pass)throw Error(name);};
 const input=document.querySelector('#task-input'),send=document.querySelector('#add-task');
 const fill=value=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
 const clickReady=async button=>{const end=Date.now()+5000;while(button.disabled&&Date.now()<end)await wait(25);if(button.disabled)throw Error('Button stays disabled');button.click();};
 const appearance=()=>{const s=getComputedStyle(send);return [s.color,s.backgroundColor,s.opacity,s.boxShadow].join('|');};
 fill('Draft during idle');await wait(50);
 let mutations=0;const idleObserver=new MutationObserver(()=>mutations++);idleObserver.observe(send,{attributes:true,attributeFilter:['disabled']});
 await wait(2300);idleObserver.disconnect();check('unchanged background ticks do not disable the draft',mutations===0&&input.value==='Draft during idle',{mutations});
 const title=`Checkpoint arrow ${Date.now()}`;fill(title);await clickReady(send);
 const savedDeadline=Date.now()+5000;while(input.value&&Date.now()<savedDeadline)await wait(25);
 let row=[...document.querySelectorAll('.task')].find(r=>r.querySelector('.task-title').textContent===title);if(!row)throw Error('Checkpoint fixture was not created');
 await clickReady(row.querySelector('.timer'));await wait(150);fill('Draft during checkpoint');
 const expected=appearance(),changes=[];let transitions=0;
 const observer=new MutationObserver(()=>{transitions++;const value=appearance();if(value!==expected)changes.push(value);});observer.observe(send,{attributes:true,attributeFilter:['disabled']});
 await wait(16200);observer.disconnect();
 const loaded=await host.request('load'),task=loaded.state.tasks.find(t=>t.title===title);
 check('real timer checkpoint is persisted',task?.workState==='running'&&task.elapsedMs>0,{elapsedMs:task?.elapsedMs});
 check('send appearance stays stable across checkpoint locks',transitions>=2&&changes.length===0&&input.value==='Draft during checkpoint',{transitions,changes});
 row=[...document.querySelectorAll('.task')].find(r=>r.querySelector('.task-title').textContent===title);await clickReady(row.querySelector('.stop-work'));fill('');await wait(100);
 return {checks};
})()
