// 0.3.4: the first-run explanation before Windows' own border prompt. A packaged build cannot be driven
// from the harness, so the host's fakeCaptureIntro stands in for "undecided". Two runs of this script:
// the first arms the host and reloads the page; the second (run after the reload) checks the dialog.
(async()=>{
  const {HostBridge}=await import('./bridge.mjs');
  const host=new HostBridge(),checks=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});if(!pass)throw Error(name+' '+JSON.stringify(details));};
  const step=sessionStorage.getItem('capture-intro')||'arm';
  const dialog=()=>document.querySelector('#confirmation');
  const waitOpen=async()=>{const end=Date.now()+8000;while(!dialog().open&&Date.now()<end)await wait(100);return dialog().open;};
  if(step==='arm'){
    await host.window('fakeCaptureIntro',{on:true});sessionStorage.setItem('capture-intro','first');location.reload();return {checks:[{name:'armed and reloading',pass:true}]};
  }
  const title=()=>document.querySelector('#confirmation-title').textContent,cancel=()=>document.querySelector('#confirmation-cancel').textContent,accept=()=>document.querySelector('#confirmation-accept').textContent;
  check('the explanation opens at start',await waitOpen());
  check('it names the glass effect and says nothing is stored or sent',/Прозрачное стекло/.test(title())&&/не сохраняется и никуда не отправляется/.test(document.querySelector('#confirmation-message').textContent),{title:title(),message:document.querySelector('#confirmation-message').textContent});
  check('it offers Continue and Not now',accept()==='Продолжить'&&cancel()==='Не сейчас',{accept:accept(),cancel:cancel()});
  check('it does not change the main screen: no extra control on the widget',document.querySelectorAll('.task-group').length>=0&&!document.querySelector('[data-action=captureIntro]'));
  if(step==='first'){
    document.querySelector('#confirmation-cancel').click();await wait(400);
    check('Not now closes it and restores the usual dialog title and label',!dialog().open&&document.querySelector('#confirmation-title').dataset.text==='confirmAction'&&document.querySelector('#confirmation-cancel').dataset.text==='cancel');
    const native=(await host.request('load')).native;
    check('Not now records nothing: it asks again next start',!native.captureIntroSeen,native);
    sessionStorage.setItem('capture-intro','second');location.reload();return {checks};
  }
  document.querySelector('#confirmation-accept').click();await wait(600);
  check('Continue closes it',!dialog().open);
  const native=(await host.request('load')).native;
  check('Continue records that it was read',native.captureIntroSeen===true,native);
  await host.window('fakeCaptureIntro',{on:false});sessionStorage.removeItem('capture-intro');
  return {checks};
})()
