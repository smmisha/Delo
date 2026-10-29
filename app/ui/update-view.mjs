export function updatePresentation({store=false,enabled=false,info=null,download={}}={}){
  if(store)return {visible:true,key:'storeUpdates',action:'openStore',disabled:false,progress:null};
  const phase=download.phase,percent=Math.max(0,Math.min(100,Math.floor(Number(download.percent)||0)));
  if(['checking','downloading','installing','ready','error','current'].includes(phase)){
    return {visible:true,key:{checking:'updateChecking',downloading:'updateDownloading',installing:'updateInstalling',ready:'updateReady',error:'updateFailed',current:'updateCurrent'}[phase],
      args:{percent,version:String(download.current??info?.current??'').replace(/^v/i,'')},
      action:phase==='error'?'updateRetry':null,disabled:phase!=='error',progress:phase==='downloading'?percent:null};
  }
  if(!enabled||!info?.latest)return {visible:false,progress:null};
  return {visible:true,key:info.newer?'updateAvailable':'updateCurrent',args:{version:String(info.newer?info.latest:info.current).replace(/^v/i,'')},action:info.newer?'updateInstall':null,disabled:false,progress:null};
}

// One automatic offer per main-view lifetime. Busy UI defers it without consuming it.
export function createUpdatePrompt(){
  let handled=false;
  return {
    get handled(){return handled;},
    offer({quick=false,store=false,enabled=false,info=null,download={},canShow=false}={}){
      if(handled||quick||store||!enabled||info?.newer!==true||!info.latest||!canShow||download.phase)return false;
      handled=true;return true;
    },
    dismiss(){handled=true;}
  };
}
