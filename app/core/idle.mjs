// F03: turns samples of "ms since the last input anywhere" into stretches without input.
// Each sample fixes when the last input happened (now - idleMs). When that moment moves
// forward, the person is back: the stretch ran from the previous last input to the new one.
// Only the moment of input matters, so late or throttled samples still give the right stretch.
export function createIdleWatch(minimumMs){
  let lastInput=null;
  return {
    reset(){lastInput=null;},
    sample({idleMs,now}){
      if(!Number.isFinite(idleMs)||idleMs<0||!Number.isFinite(now))return null;
      const input=now-idleMs,previous=lastInput;lastInput=input;
      // Clock rounding between samples moves the moment by a few ms; that is not input.
      if(previous===null||input-previous<1000)return null;
      return input-previous>=minimumMs()?{from:previous,to:input}:null;
    },
  };
}
