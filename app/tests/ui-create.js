(async()=>{
  const input=document.querySelector('#task-input');input.value='Harness: задача сохраняется после перезапуска';input.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#entry').requestSubmit();document.querySelector('#entry').requestSubmit();
  const end=Date.now()+5000;while(Date.now()<end&&!document.querySelector('[data-task]'))await new Promise(r=>setTimeout(r,50));
  return {rows:[...document.querySelectorAll('.task-title')].map(e=>e.textContent),error:document.querySelector('#error').hidden?null:document.querySelector('#error-text').textContent,input:input.value};
})()
