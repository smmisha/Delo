(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const expected={
    ru:{placeholder:'Что нужно сделать?',settings:'Настройки',hide:'Скрыть в трей'},
    uk:{placeholder:'Що потрібно зробити?',settings:'Налаштування',hide:'Сховати в трей'},
    en:{placeholder:'What needs doing?',settings:'Settings',hide:'Hide to tray'}
  };
  const original=(await host.request('load')).state.tasks.map(task=>task.title);
  const dates=[];
  for(const language of ['uk','en','ru']){
    document.querySelector('#settings-open').click();
    const form=document.querySelector('#settings-form');form.elements.language.value=language;form.requestSubmit();
    const end=Date.now()+5000;while(document.querySelector('#settings').open&&Date.now()<end)await wait(25);
    check(`${language}: settings save closes`,!document.querySelector('#settings').open&&!document.querySelector('#settings-error').offsetParent);
    check(`${language}: document and entry localized`,document.documentElement.lang===language&&document.querySelector('#task-input').placeholder===expected[language].placeholder);
    document.querySelector('#settings-open').click();await wait(20);
    check(`${language}: dialog and action localized`,document.querySelector('#settings-title').textContent===expected[language].settings&&document.querySelector('#hide').textContent===expected[language].hide);
    document.querySelector('#settings [data-close]').click();
    dates.push(document.querySelector('#today').textContent);
    check(`${language}: task text is untouched`,JSON.stringify((await host.request('load')).state.tasks.map(task=>task.title))===JSON.stringify(original));
  }
  check('locale-specific date formatting is active',new Set(dates).size===3);
  return {checks,dates};
})()
