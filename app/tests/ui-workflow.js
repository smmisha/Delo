(async()=>{
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const row=document.querySelector('.task[data-task]');if(!row)throw Error('Task missing');
  const actions=[...row.querySelectorAll('button')].map(b=>({action:b.dataset.action,label:b.getAttribute('aria-label'),cls:b.className}));
  const timer=row.querySelector('.timer');if(!timer)throw Error('Timer button missing');timer.click();await pause(1250);
  const running=document.querySelector('.task[data-task]').innerText;
  document.querySelector('.task .complete').click();await pause(250);
  const done=document.querySelector('.task[data-task]').innerText;
  const score=document.querySelector('#score').textContent;
  return {actions,running,done,score,error:document.querySelector('#error').hidden?null:document.querySelector('#error-text').textContent};
})()
