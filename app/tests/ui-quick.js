(async()=>{
 const {HostBridge}=await import('./bridge.mjs');const host=new HostBridge(),checks=[];
 const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name);};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 // show toggles a temporary list: normalize visibility before establishing the return HWND.
 await host.window('quickDone');await host.window('hide');await host.window('show');await wait(150);
 await host.window('quick');await wait(150);
 const first=await host.window('diagnostics');
 const input=document.querySelector('#task-input');
 check('quick input receives focus',document.activeElement===input&&first.visible);
 check('main view hides while quick entry is open',!first.mainVisible&&!first.mainWindowVisible);
 const capsule=document.querySelector('#entry'),mic=document.querySelector('#voice-input'),dragZones=[...document.querySelectorAll('.quick-drag-zone')],send=document.querySelector('#add-task');
 const micRect=mic.getBoundingClientRect(),inputRect=input.getBoundingClientRect(),sendRect=send.getBoundingClientRect();
 const center=rect=>(rect.top+rect.bottom)/2;
 check('mic, text, and send action are vertically aligned',getComputedStyle(capsule).alignItems==='center'&&Math.abs(center(micRect)-center(inputRect))<4&&Math.abs(center(sendRect)-center(inputRect))<4);
 const capsuleRect=capsule.getBoundingClientRect();
 check('microphone mirrors send action at the left edge',Math.abs((micRect.left-capsuleRect.left)-(capsuleRect.right-sendRect.right))<2);
 check('placeholder is visually distinct from typed text',Number(getComputedStyle(input,'::placeholder').opacity)<1);
 check('microphone is a separate visible control',getComputedStyle(mic).display==='grid'&&!dragZones.includes(mic)&&mic.getAttribute('aria-disabled')!=='true'&&!mic.disabled);
 check('quick frame exposes drag zones on every side',dragZones.length===4&&dragZones.every(zone=>getComputedStyle(zone).cursor==='grab'&&zone.getBoundingClientRect().width>0&&zone.getBoundingClientRect().height>0));
 check('drag zones do not draw an extra frame',dragZones.every(zone=>getComputedStyle(zone).backgroundImage==='none'&&getComputedStyle(zone).backgroundColor==='rgba(0, 0, 0, 0)'));
 const dragBefore=(await host.window('diagnostics')).dragRequests;
 for(const zone of dragZones){zone.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));await wait(30);}
 check('all frame sides reach native window move command',(await host.window('diagnostics')).dragRequests===dragBefore+dragZones.length);
 const title=`Harness quick ${Date.now()}`;input.value=title;input.dispatchEvent(new Event('input',{bubbles:true}));
 await host.window('quick');await wait(100);const repeated=await host.window('diagnostics');
 check('repeated call keeps original return window',first.previous!==0&&repeated.previous===first.previous);
 check('repeated call keeps draft',input.value===title);
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 const end=Date.now()+5000;let final;
 do{await wait(50);final=await host.window('diagnostics');}while(final.visible&&Date.now()<end);
 check('Enter closes quick view after save',!final.visible&&input.value===''&&final.mainVisible&&final.mainWindowVisible);
 check('focus returns to original window',final.foreground===first.previous);
 const saved=await host.request('load');check('quick task saved exactly once',saved.state.tasks.filter(t=>t.title===title).length===1);
 await host.window('quick');await wait(100);
 const cancelTitle=`Cancelled ${Date.now()}`;input.value=cancelTitle;input.dispatchEvent(new Event('input',{bubbles:true}));
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(150);
 const cancelled=await host.window('diagnostics'),after=await host.request('load');
 check('Escape closes without saving',!cancelled.visible&&!after.state.tasks.some(t=>t.title===cancelTitle));
 check('Escape returns focus',cancelled.foreground===first.previous);
 await host.window('quick');await wait(100);
 check('Escape discards cancelled draft',input.value==='');
 await host.window('quickDone');
 return {checks};
})()
