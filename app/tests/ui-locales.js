(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const expected={
    ru:{placeholder:'Что нужно сделать?',settings:'Настройки',hide:'Свернуть',close:'Закрыть',done:'Готово'},
    uk:{placeholder:'Що потрібно зробити?',settings:'Налаштування',hide:'Згорнути',close:'Закрити',done:'Готово'},
    en:{placeholder:'What needs doing?',settings:'Settings',hide:'Minimise',close:'Close',done:'Done'}
  };
  const original=(await host.request('load')).state.tasks.map(task=>task.title);
  const dates=[];
  for(const language of ['uk','en','ru']){
    document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));
    const form=document.querySelector('#settings-form');form.elements.language.value=language;
    form.elements.language.dispatchEvent(new Event('change',{bubbles:true}));
    const end=Date.now()+5000;let saved=false;
    while(Date.now()<end){saved=(await host.request('load')).state.settings.language===language&&document.documentElement.lang===language&&document.querySelector('#widget').getAttribute('aria-busy')==='false';if(saved)break;await wait(25);}
    check(`${language}: change saves before closing`,saved&&document.querySelector('#settings-error').hidden);
    document.querySelector('#settings [data-close]').click();
    check(`${language}: settings closes after saving`,!document.querySelector('#settings').open&&!document.querySelector('#settings-error').offsetParent);
    check(`${language}: document and entry localized`,document.documentElement.lang===language&&document.querySelector('#task-input').placeholder===expected[language].placeholder);
    document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,300));
    check(`${language}: dialog and action localized`,document.querySelector('#settings-title').textContent===expected[language].settings&&document.querySelector('#hide-widget').getAttribute('aria-label')===expected[language].hide);
    check(`${language}: settings close controls are localized`,form.querySelector('.save').textContent===expected[language].done&&form.querySelector('[data-close]').getAttribute('aria-label')===expected[language].close);
    document.querySelector('#settings [data-close]').click();
    dates.push(document.querySelector('#today').textContent);
    check(`${language}: task text is untouched`,JSON.stringify((await host.request('load')).state.tasks.map(task=>task.title))===JSON.stringify(original));
  }
  check('locale-specific date formatting is active',new Set(dates).size===3);
  return {checks,dates};
})()
