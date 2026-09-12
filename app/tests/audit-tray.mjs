import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect,native,wait} from './audit-harness.mjs';

const output=path.resolve(process.argv[2]||'app/test-output/tray/results.json');
const main=await connect(),quick=await connect(true),results=[];
const record=(name,state)=>{results.push({name,state});console.log(`PASS ${name}`);};
const aligned=state=>state.clientWidth===state.webWidth&&state.clientHeight===state.webHeight&&state.clientWidth===state.materialWidth&&state.clientHeight===state.materialHeight;
try{
 await quick.host('quickDone');await main.host('show');await main.host('pin',{pinned:true});await main.host('hide');
 let mainState=await main.host('diagnostics'),quickState=await quick.host('diagnostics');
 assert(!mainState.windowVisible&&!quickState.windowVisible);

 const singleBefore=quickState.traySingleClicks;
 native(mainState.controlWindow,'traySingle');await wait(35);
 quickState=await quick.host('diagnostics');
 assert(quickState.visible&&!quickState.mainVisible&&quickState.traySingleClicks===singleBefore+1&&aligned(quickState));
 record('one tray button-up opens an aligned quick capsule without double-click timeout',quickState);

 const previous=quickState.previous,singleRepeated=quickState.traySingleClicks;
 native(mainState.controlWindow,'traySingle');await wait(35);
 quickState=await quick.host('diagnostics');
 assert(quickState.visible&&!quickState.mainVisible&&quickState.previous===previous&&quickState.traySingleClicks===singleRepeated+1&&aligned(quickState));
 record('repeated tray click keeps the same quick session and focus return target',quickState);

 const doubleBefore=quickState.trayDoubleClicks,singleDoubleBefore=quickState.traySingleClicks;
 native(mainState.controlWindow,'trayDouble');await wait(35);
 quickState=await quick.host('diagnostics');mainState=await main.host('diagnostics');
 assert(quickState.visible&&!mainState.visible&&!mainState.windowVisible&&quickState.traySingleClicks===singleDoubleBefore+1&&quickState.trayDoubleClicks===doubleBefore+1&&aligned(quickState));
 record('double-click sequence remains one immediate aligned quick-capsule action',quickState);
}finally{
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(results,null,2));
 main.close();quick.close();
}
