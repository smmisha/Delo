// A draft of the main window's entry field, kept the way Telegram keeps an unsent message: what is
// typed there survives closing the widget, a crash or a shutdown, and comes back in the field.
// `save(text)` writes it (to the host, which keeps it in its own small file, apart from the task
// data). Typing is saved after a short pause, and at the latest every `maxWait` ms while typing
// goes on; `flush` writes at once (hide, sleep, exit). A failed write is retried with the next change.
export function createDraft(save,{delay=400,maxWait=2000}={}){
  let pending=null,timer=0,firstAt=0,written=null;
  const run=async()=>{
    timer=0;firstAt=0;
    if(pending===null)return;
    const text=pending;pending=null;
    if(text===written)return;
    try{await save(text);written=text;}catch{if(pending===null)pending=text;}
  };
  const arm=()=>{clearTimeout(timer);const waited=firstAt?Date.now()-firstAt:0;timer=setTimeout(run,Math.max(0,Math.min(delay,maxWait-waited)));};
  return {
    change(text){if(pending===null)firstAt=Date.now();pending=text;arm();},
    async flush(){clearTimeout(timer);await run();},
    // The text came from the host: nothing to write back until it changes.
    known(text){written=text;},
    get pending(){return pending!==null;}
  };
}
