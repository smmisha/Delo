(async()=>{
  const checks=[];const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const mic=document.querySelector('#voice-input'),send=document.querySelector('#add-task'),input=document.querySelector('#task-input');
  check('main entry shows microphone',getComputedStyle(mic).display==='grid'&&mic.getBoundingClientRect().width>=38);
  check('main resize edges have no painted corner artifact',document.querySelectorAll('.resize-grip').length===8&&getComputedStyle(document.querySelector('#widget'),'::after').content==='none');
  input.value='stable arrow';input.dispatchEvent(new Event('input',{bubbles:true}));
  const before=getComputedStyle(send),appearance=[before.color,before.backgroundColor,before.opacity];
  await wait(700);const after=getComputedStyle(send);
  check('send arrow has no caret-synchronised transition',before.transitionDuration.split(',').every(value=>parseFloat(value)===0)&&before.opacity==='1'&&before.backgroundColor.startsWith('rgb(')&&appearance.join('|')===[after.color,after.backgroundColor,after.opacity].join('|'));
  input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await wait(80);
  const dialog=document.querySelector('#settings'),surface=document.querySelector('#settings-form'),fields=surface.querySelector('.settings-fields'),shortcut=surface.elements.listShortcut;
  const material=getComputedStyle(surface);
  check('settings open inside viewport',dialog.open&&surface.getBoundingClientRect().bottom<=innerHeight);
  check('settings use layered glass material',material.backgroundImage.includes('radial-gradient')&&material.backdropFilter.includes('blur')&&material.boxShadow!=='none');
  check('settings reserve a stable scrollbar gutter',getComputedStyle(fields).scrollbarGutter.includes('stable')&&parseFloat(getComputedStyle(fields).paddingRight)>=10);
  shortcut.focus();const focus=getComputedStyle(shortcut),fieldRect=shortcut.getBoundingClientRect(),fieldsRect=fields.getBoundingClientRect();
  check('shortcut focus stays inside rounded field',focus.outlineStyle==='none'&&fieldRect.right<=fieldsRect.right-8);
  shortcut.blur();
  const idleEnd=Date.now()+5000;while(document.querySelector('#widget').getAttribute('aria-busy')==='true'&&Date.now()<idleEnd)await wait(25);
  check('leaving unchanged recorder finishes saving',document.querySelector('#widget').getAttribute('aria-busy')==='false'&&document.querySelector('#settings-error').hidden);
  const select=surface.elements.language,option=select.options[0],wasDark=document.body.classList.contains('dark');
  document.body.classList.remove('dark');let field=getComputedStyle(select),item=getComputedStyle(option);
  check('light select and options keep readable contrast',field.color==='rgb(25, 36, 50)'&&item.color==='rgb(25, 36, 50)'&&item.backgroundColor!=='rgba(0, 0, 0, 0)');
  document.body.classList.add('dark');field=getComputedStyle(select);item=getComputedStyle(option);
  check('dark select and options keep readable contrast',field.color==='rgb(245, 247, 252)'&&item.color==='rgb(245, 247, 252)'&&item.backgroundColor!=='rgba(0, 0, 0, 0)');
  document.body.classList.toggle('dark',wasDark);
  // Archive and trash moved out of the settings form into the header menu: they are
  // places the list can be in, not preferences. A visible label replaces the tooltip.
  dialog.querySelector('[data-close]').click();
  document.querySelector('#settings-open').click();await wait(80);
  const nav=[...document.querySelectorAll('#app-menu button')];
  const centred=node=>{const button=node.getBoundingClientRect(),glyph=node.querySelector('svg').getBoundingClientRect();return glyph.left>=button.left&&glyph.right<=button.right;};
  check('archive and trash are labelled items in the header menu',nav.length===3&&['open-archive','open-trash','open-settings'].every(id=>nav.some(n=>n.id===id))&&nav.every(n=>n.textContent.trim()&&!n.title&&centred(n)));
  check('settings form no longer carries collection shortcuts',!document.querySelector('.settings-links'));
  document.querySelector('#settings-open').click();await wait(60);
  document.querySelector('#settings-open').click();document.querySelector('#open-settings').click();await wait(120);
  check('four binary settings form a two by two grid',getComputedStyle(surface.querySelector('.settings-check-grid')).gridTemplateColumns.split(' ').length===2);
  dialog.close();
  return {checks};
})()
