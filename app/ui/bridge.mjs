// Only the Windows host can acknowledge persistence. No browser-local silent fallback.
// Every bridge on a page hears every host reply, so request ids must be unique across
// instances: a per-instance counter let two bridges created in the same millisecond share
// an id and one of them resolved with the other's answer.
let sequence=0;
export class HostBridge extends EventTarget{
  constructor(webview=globalThis.chrome?.webview){super();this.webview=webview;this.pending=new Map();webview?.addEventListener('message',event=>{const message=event.data;if(message?.event){this.dispatchEvent(new CustomEvent(message.event,{detail:message.payload}));return;}const request=this.pending.get(message?.id);if(!request)return;clearTimeout(request.timeout);this.pending.delete(message.id);message.ok?request.resolve(message.result):request.reject(new Error(message.error||'host'));});}
  request(type,payload={}){if(!this.webview)return Promise.reject(new Error('noHost'));const id=`${Date.now()}-${++sequence}`;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error('timeout'));},15000);this.pending.set(id,{resolve,reject,timeout});this.webview.postMessage({id,type,payload});});}
  window(action,payload={}){return this.request('window',{action,...payload});}
}
