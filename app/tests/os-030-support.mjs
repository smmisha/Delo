// Test-only fixtures and fail-closed evidence. No Windows UI is asserted here.
import {createState,applyCommand} from '../core/model.mjs';
export const futureTag='v999.0.0';
export const releaseUrl='https://github.com/smmisha/Delo/releases/tag/v0.3.0';
export function fixtures(now=Date.now()){
 const state=applyCommand(createState(),{type:'create',id:'os-030-existing',title:'N12 existing fixture'},{now,monotonic:0,timeZone:'UTC'});
 Object.assign(state.settings,{language:'en',checkUpdates:true,pinned:true,listShortcut:'Ctrl+Alt+Shift+J',quickShortcut:'Ctrl+Alt+Shift+K'});
 const imported=applyCommand(state,{type:'create',id:'os-030-import',title:'N12 imported fixture'},{now,monotonic:0,timeZone:'UTC'});
 return {state,imported,window:{pinned:true,autostart:false,quickFrameReduced:true,hotkeys:{list:state.settings.listShortcut,quick:state.settings.quickShortcut},updateLatest:futureTag,updateUrl:releaseUrl,updateCheckedAt:now}};
}
export const requiredChecks=Object.freeze(['N12 export bytes','N12 export cancellation','N12 invalid import','N12 import cancellation','N12 import disk and copy','N13 cached native menu','N13 disabled native menu','T07 native submission']);
export function report(checks,metadata={}){
 return {metadata,checks,integration:!metadata.error&&!metadata.cleanupError&&requiredChecks.every(name=>checks.filter(c=>c.name===name&&c.pass===true).length===1)&&checks.length===requiredChecks.length?'PASS':'FAIL',live:{N12:'UNVERIFIED',T07:'UNVERIFIED',N13:'UNVERIFIED'}};
}
