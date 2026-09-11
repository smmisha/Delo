// Only the Windows host can acknowledge persistence. No browser-local silent fallback.
export class HostBridge extends EventTarget{
  constructor(webview=globalThis.chrome?.webview){super();this.webview=webview;this.pending=new Map();this.sequence=0;webview?.addEventListener('message',event=>{const message=event.data;if(message?.event){this.dispatchEvent(new CustomEvent(message.event,{detail:message.payload}));return;}const request=this.pending.get(message?.id);if(!request)return;clearTimeout(request.timeout);this.pending.delete(message.id);message.ok?request.resolve(message.result):request.reject(new Error(message.error||'host'));});}
  request(type,payload={}){if(!this.webview)return Promise.reject(new Error('noHost'));const id=`${Date.now()}-${++this.sequence}`;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error('timeout'));},15000);this.pending.set(id,{resolve,reject,timeout});this.webview.postMessage({id,type,payload});});}
  window(action,payload={}){return this.request('window',{action,...payload});}
}
