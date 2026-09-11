// Development harness only. Connects to our --harness WebView2, never production.
import fs from 'node:fs/promises';
const quick=process.argv.includes('--quick');
let page;const discoveryDeadline=Date.now()+5000;
do{
 try{const pages=await (await fetch('http://127.0.0.1:9223/json/list')).json();page=pages.find(p=>p.url.startsWith('https://delo.local/ui/')&&p.url.includes('view=quick')===quick);}catch{}
 if(!page)await new Promise(resolve=>setTimeout(resolve,100));
}while(!page&&Date.now()<discoveryDeadline);
if(!page)throw Error('Delo harness page not found');
const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let seq=0;
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id&&pending.has(data.id)){const {resolve,reject,timer}=pending.get(data.id);clearTimeout(timer);pending.delete(data.id);data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result);}};
function call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('DevTools timeout'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
try{
 const expressionFile=process.argv.indexOf('--script');
 const expression=expressionFile>=0?await fs.readFile(process.argv[expressionFile+1],'utf8'):`({text:document.body.innerText,ready:document.readyState,width:innerWidth,height:innerHeight,error:document.querySelector('#error')?.hidden===false,inputs:[...document.querySelectorAll('input,textarea')].map(e=>({id:e.id,name:e.name,value:e.value}))})`;
 const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 console.log(JSON.stringify(result.result?.value,null,2));
 const screenshot=process.argv.indexOf('--screenshot');
 if(screenshot>=0){const result=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(process.argv[screenshot+1],Buffer.from(result.data,'base64'));}
}finally{ws.close();}
