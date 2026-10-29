import fs from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';

function ensureRunning(child){
 if(!child?.pid)throw Error('Cannot start harness backdrop');
 if(child.exitCode!==null||child.signalCode!==null)throw Error(`Harness backdrop exited before readiness (code=${child.exitCode}, signal=${child.signalCode})`);
}

/** Wait for this helper's painted-window handshake, rejecting dead or stale helpers. */
export async function waitForBackdropReady(child,file,{timeoutMs=15000}={}){
 const deadline=Date.now()+timeoutMs;
 for(;;){
  ensureRunning(child);
  let state;
  try{state=JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  ensureRunning(child);
  if(state!==undefined){
   if(state?.pid!==child.pid||!Number.isSafeInteger(state?.window)||state.window<=0)throw Error('Harness backdrop readiness identity mismatch');
   return state;
  }
  if(Date.now()>=deadline)throw Error('Harness backdrop readiness timed out');
  await wait(50);
 }
}
