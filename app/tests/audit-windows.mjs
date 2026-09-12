import fs from 'node:fs/promises';import path from 'node:path';import {connect,native,wait} from './audit-harness.mjs';
const output=path.resolve(process.argv[2]||'app/test-output/sessions/audit-20260911/windows.json');
const main=await connect(),quick=await connect(true),checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});console.log(JSON.stringify(checks.at(-1)));};
try{
 await main.evaluate(`(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());return true;})()`);
 await main.host('show');await main.host('pin',{pinned:true});
 await main.click('#settings-open');await main.click('[name=listShortcut]');await main.click('#settings [data-close]');
 let d=await main.host('diagnostics');const keys=await main.evaluate(`(async()=>{const {HostBridge}=await import('./bridge.mjs');return(await new HostBridge().request('load')).native.hotkeys;})()`);
 native(d.window,'keys',{Keys:keys.quick.toUpperCase()});await wait(200);let q=await quick.host('diagnostics');check('global shortcut is restored after recorder closes',q.visible,q);
 if(!q.visible)await main.host('quick');
 for(const side of ['top','right','bottom','left']){
  const before=await quick.host('diagnostics'),p=await quick.point(`.quick-drag-${side}`);native(p.window,'drag',{X:p.x,Y:p.y,Width:22,Height:12});await wait(180);const after=await quick.host('diagnostics');
  check(`physical drag from ${side} actually moves quick window`,after.x!==before.x||after.y!==before.y,{before:{x:before.x,y:before.y},after:{x:after.x,y:after.y}});
 }
 q=await quick.host('diagnostics');native(q.window,'outside');await wait(200);q=await quick.host('diagnostics');check('outside click hides quick without reopening main',!q.visible&&!q.mainVisible,q);
 d=await main.host('diagnostics');const singleBefore=d.traySingleClicks;native(d.controlWindow,'traySingle');await wait(35);q=await quick.host('diagnostics');check('native tray single-click opens quick without double-click timeout',q.visible&&!q.mainVisible&&q.traySingleClicks===singleBefore+1,q);
 const doubleBefore=q.trayDoubleClicks,singleDoubleBefore=q.traySingleClicks;native(d.controlWindow,'trayDouble');await wait(35);q=await quick.host('diagnostics');check('native tray double-click remains one quick-capsule action',q.visible&&!q.mainVisible&&q.traySingleClicks===singleDoubleBefore+1&&q.trayDoubleClicks===doubleBefore+1,q);
 await main.host('pin',{pinned:false});await main.host('hide');await main.host('show');await main.click('#today');d=await main.host('diagnostics');
 check('temporary unpinned list opens above other windows and activates',d.visible&&d.windowVisible&&d.owner===0&&d.foreground===d.window,d);
 const overlap=native(d.window,'outsideOverlap');await wait(100);d=await main.host('diagnostics');
 check('temporary unpinned list returns behind the active ordinary window',d.visible&&d.windowVisible&&d.owner!==0&&overlap.overlap?.foreignActivated&&overlap.overlap?.coversTarget,{diagnostics:d,overlap});
 await main.host('show');await main.click('#today');d=await main.host('diagnostics');check('reopening the unpinned list raises it temporarily again',d.owner===0&&d.foreground===d.window,d);
 await main.host('pin',{pinned:true});await main.click('#today');native(d.window,'outside');await wait(100);d=await main.host('diagnostics');
 check('pinned list stays above other windows after deactivation',d.visible&&d.windowVisible&&d.owner===0,d);
 await main.click('#hide-widget');d=await main.host('diagnostics');check('one physical minimise click hides full planner',!d.visible&&!d.windowVisible,d);
}finally{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(checks,null,2));main.close();quick.close();}
if(checks.some(c=>!c.pass))process.exitCode=1;
