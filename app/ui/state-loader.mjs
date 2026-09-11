import {createState,validateState} from '../core/model.mjs';
export function stateFromLoad(result){
  if(!result||!Object.hasOwn(result,'state')||!Number.isSafeInteger(result.revision)||result.revision<0)throw new Error('invalidState');
  if(result.state===null){if(result.revision!==0)throw new Error('invalidState');return createState();}
  const validation=validateState(result.state);
  if(!validation.valid)throw new Error(`invalidState: ${validation.error}`);
  return result.state;
}
