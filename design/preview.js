/* Delo visual study. Original renderer; references and limitations: REFERENCES.md.
   No task persistence, native integration or production reputation rules. */
'use strict';
const $ = (s) => document.querySelector(s);
const stage = $('#stage'), canvas = $('#optics'), widget = $('#widget');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let dark = false, alternate = false, lightPosition = [.25, .1], pendingFrame = 0;
const reduced = () => motionPreference.matches || $('#reduced').checked;
const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
uniform vec2 resolution; uniform vec4 panel; uniform sampler2D scene;
uniform float theme; uniform vec2 lamp; uniform vec2 offset; uniform vec2 viewSize;
float shape(vec2 p){vec2 q=abs(p-panel.xy)-panel.zw*.5+vec2(36.);return length(max(q,0.))+min(max(q.x,q.y),0.)-36.;}
vec3 sampleScene(vec2 p){return texture2D(scene,clamp(p/resolution,vec2(.001),vec2(.999))).rgb;}
void main(){
 vec2 p=vec2(gl_FragCoord.x,viewSize.y-gl_FragCoord.y)+offset; float d=shape(p);
 vec3 bg=sampleScene(p); float shadow=exp(-max(shape(p-vec2(0.,13.)),0.)/17.)*.19;
 vec3 result=bg*(1.-shadow);
 if(d<1.){
  float depth=max(-d,0.); float edge=exp(-depth/10.);
  vec2 n=normalize(vec2(shape(p+vec2(.5,0.))-shape(p-vec2(.5,0.)),shape(p+vec2(0.,.5))-shape(p-vec2(0.,.5)))+vec2(.0001));
  vec2 uv=panel.xy+(p-panel.xy)*.986-n*(edge*22.);
  vec3 base=sampleScene(uv)*.32;
  base+=(sampleScene(uv+vec2(2.5,0.))+sampleScene(uv-vec2(2.5,0.))+sampleScene(uv+vec2(0.,2.5))+sampleScene(uv-vec2(0.,2.5)))*.17;
  vec3 dispersed=vec3(sampleScene(uv-n*1.6*edge).r,base.g,sampleScene(uv+n*1.6*edge).b);
  base=mix(base,dispersed,edge*.45);
  float centerTint=mix(.60,.73,theme)*(1.-edge*.73);
  base=mix(base,mix(vec3(.94,.965,.99),vec3(.065,.105,.17),theme),centerTint);
  vec2 l=normalize(lamp*resolution-p);float highlight=pow(max(dot(n,l),0.),3.5);
  float opposite=pow(max(dot(-n,l),0.),6.)*.42;
  float rim=exp(-depth/1.45),fresnel=exp(-depth/7.);
  base+=vec3(1.,.97,.92)*(highlight+opposite)*(rim*.67+fresnel*.14);
  base+=rim*.11; base-=exp(-abs(depth-3.8)/1.5)*.065;
  result=mix(result,base,1.-smoothstep(-.7,.8,d));
 }
 gl_FragColor=vec4(result,1.);
}`;
let gl, program, texture, loc;
function fallback(message){document.body.classList.remove('optics-ready');$('#render-status').textContent=message;canvas.style.display='none';}
function compile(type, source, context=gl){const s=context.createShader(type);context.shaderSource(s,source);context.compileShader(s);if(!context.getShaderParameter(s,context.COMPILE_STATUS))throw Error(context.getShaderInfoLog(s));return s;}
function wallpaper(w,h){
 const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
 const sky=ctx.createLinearGradient(0,0,w,h);sky.addColorStop(0,alternate?'#e5b7a9':'#74a6c5');sky.addColorStop(.45,alternate?'#ceb4c7':'#a7cedc');sky.addColorStop(1,alternate?'#787eaa':'#407eb5');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
 // Sweeping strata: clear boundaries make lens refraction observable.
 const bands=alternate?['#ded6d2','#9ba5bb','#7288a7','#526b93','#364e7b']:['#a4c4d2','#729bae','#447ea2','#245d8c','#174367'];
 bands.forEach((color,i)=>{const yy=h*(.24+i*.155);const g=ctx.createLinearGradient(0,yy,0,h);g.addColorStop(0,color);g.addColorStop(1,bands[Math.min(i+1,4)]);ctx.beginPath();ctx.moveTo(-w*.1,yy+h*.22);ctx.bezierCurveTo(w*.18,yy-h*.38,w*.50,yy+h*.40,w*1.1,yy-h*.28);ctx.lineTo(w*1.1,h);ctx.lineTo(-w*.1,h);ctx.closePath();ctx.fillStyle=g;ctx.fill();ctx.strokeStyle=alternate?'#f3e4e644':'#d3eef64d';ctx.lineWidth=1.6;ctx.stroke();});
 // Diagonal ambient light, generated locally rather than copied Apple imagery.
 const light=ctx.createRadialGradient(w*.76,h*.1,0,w*.76,h*.1,w*.65);light.addColorStop(0,'#f6f7f846');light.addColorStop(1,'#ffffff00');ctx.fillStyle=light;ctx.fillRect(0,0,w,h);
 // Scrim under the hero copy: white text otherwise lands on the lightest part of the
 // gradient at 1.4-3.3:1. Applied to the scene texture rather than over the canvas, so
 // the lens refracts it correctly. Wide layout keeps the hero on the left, so the scrim
 // runs diagonally and never reaches the widget; the narrow layout stacks hero over
 // widget, so it runs top-down across the hero band instead.
 const wide=w>=760;
 const scrim=wide?ctx.createLinearGradient(0,0,w*.72,h*.2):ctx.createLinearGradient(0,0,0,h*.34);
 scrim.addColorStop(0,wide?'#0d2336bf':'#0d2336d1');scrim.addColorStop(wide?.52:.62,wide?'#0d233666':'#0d233699');scrim.addColorStop(1,'#0d233600');
 ctx.fillStyle=scrim;ctx.fillRect(0,0,w,h);
 return c;
}
function setup(){
 try{gl=canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL unavailable');program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 loc=Object.fromEntries(['resolution','panel','theme','lamp','scene','offset','viewSize'].map(n=>[n,gl.getUniformLocation(program,n)]));gl.uniform1i(loc.scene,0);document.body.classList.add('optics-ready');$('#render-status').textContent='WebGL: преломление фона, световая кромка и дисперсия. В покое отрисовка останавливается.';resize();
 }catch(error){console.error(error);fallback('WebGL недоступен. Показан упрощённый материал без преломления.');}
}
function resize(){if(!gl||!loc)return;const b=stage.getBoundingClientRect();canvas.width=Math.round(b.width);canvas.height=Math.round(b.height);gl.viewport(0,0,canvas.width,canvas.height);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,wallpaper(canvas.width,canvas.height));invalidate();}
function draw(){pendingFrame=0;if(!gl||gl.isContextLost()||document.hidden)return;const s=stage.getBoundingClientRect(),r=widget.getBoundingClientRect();gl.uniform2f(loc.resolution,canvas.width,canvas.height);gl.uniform2f(loc.viewSize,canvas.width,canvas.height);gl.uniform2f(loc.offset,0,0);gl.uniform4f(loc.panel,r.left-s.left+r.width/2,r.top-s.top+r.height/2,r.width,r.height);gl.uniform1f(loc.theme,dark?1:0);gl.uniform2f(loc.lamp,...lightPosition);gl.drawArrays(gl.TRIANGLES,0,6);}
function invalidate(){if(!pendingFrame)pendingFrame=requestAnimationFrame(draw);}
stage.addEventListener('pointermove',e=>{if(reduced())return;const r=stage.getBoundingClientRect();lightPosition=[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height];invalidate();});
stage.addEventListener('pointerleave',()=>{lightPosition=[.25,.1];invalidate();});
new ResizeObserver(resize).observe(stage);document.addEventListener('visibilitychange',invalidate);
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fallback('Графический контекст потерян. Перезагрузите страницу для восстановления преломления.');});
function theme(value){dark=value;document.body.classList.toggle('dark',dark);$('#light').setAttribute('aria-pressed',String(!dark));$('#dark').setAttribute('aria-pressed',String(dark));invalidate();}
$('#light').onclick=()=>theme(false);$('#dark').onclick=()=>theme(true);$('#background').onclick=()=>{alternate=!alternate;resize();};
$('#reduced').onchange=()=>{document.body.classList.toggle('reduced',$('#reduced').checked);lightPosition=[.25,.1];invalidate();};motionPreference.addEventListener('change',()=>{lightPosition=[.25,.1];invalidate();});
let toastTimeout;function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),2400);}
$('#pin').onclick=()=>{const value=$('#pin').getAttribute('aria-pressed')!=='true';$('#pin').setAttribute('aria-pressed',String(value));$('#pin').title=value?'Открепить от других окон':'Закрепить поверх окон';$('#pin').setAttribute('aria-label',$('#pin').title+' (демонстрация)');toast(value?'Закрепление — демонстрация состояния':'Режим рабочего стола — демонстрация');};
function closeSettings(){$('#settings').hidden=true;$('#menu').setAttribute('aria-expanded','false');}
$('#menu').onclick=()=>{const show=$('#settings').hidden;$('#settings').hidden=!show;$('#menu').setAttribute('aria-expanded',String(show));};
document.addEventListener('click',e=>{if(!$('#settings').contains(e.target)&&!$('#menu').contains(e.target))closeSettings();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#settings').hidden){closeSettings();$('#menu').focus();}});
const capture=$('#capture');
// A separate top-layer canvas lets the capture capsule retain its own refraction.
// It samples the demonstration wallpaper, not other applications or the DOM.
let captureRenderer;
function renderCapture(){
 if(!capture.open||!gl)return;
 try{
  if(!captureRenderer){
   const c=document.createElement('canvas');c.className='capture-optics';c.setAttribute('aria-hidden','true');$('.capture-surface').prepend(c);
   const g=c.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true});if(!g)throw Error('Capture WebGL unavailable');
   const p=g.createProgram();g.attachShader(p,compile(g.VERTEX_SHADER,vertex,g));g.attachShader(p,compile(g.FRAGMENT_SHADER,fragment,g));g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p));g.useProgram(p);
   const b=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),g.STATIC_DRAW);const a=g.getAttribLocation(p,'position');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,0,0);
   const tex=g.createTexture();g.bindTexture(g.TEXTURE_2D,tex);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
   const l=Object.fromEntries(['resolution','panel','theme','lamp','scene','offset','viewSize'].map(n=>[n,g.getUniformLocation(p,n)]));g.uniform1i(l.scene,0);captureRenderer={c,g,l};
  }
  const {c,g,l}=captureRenderer,s=stage.getBoundingClientRect(),r=$('.capture-surface').getBoundingClientRect();c.width=Math.round(r.width);c.height=Math.round(r.height);g.viewport(0,0,c.width,c.height);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,wallpaper(canvas.width,canvas.height));g.uniform2f(l.resolution,canvas.width,canvas.height);g.uniform2f(l.viewSize,c.width,c.height);g.uniform2f(l.offset,r.left-s.left,r.top-s.top);g.uniform4f(l.panel,r.left-s.left+r.width/2,r.top-s.top+r.height/2,r.width,r.height);g.uniform1f(l.theme,dark?1:0);g.uniform2f(l.lamp,...lightPosition);g.drawArrays(g.TRIANGLES,0,6);$('.capture-surface').classList.add('has-optics');
 }catch(error){console.error(error);$('.capture-surface').classList.remove('has-optics');}
}
$('#launch').onclick=()=>{capture.showModal();$('#capture-input').focus();renderCapture();};$('#close-capture').onclick=()=>capture.close();
capture.addEventListener('animationend',renderCapture);window.addEventListener('resize',renderCapture);
let audioContext;function chime(){if(!$('#sounds').checked)return;try{audioContext??=new AudioContext();audioContext.resume().catch(()=>{});const t=audioContext.currentTime;[660,880].forEach((f,i)=>{const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.value=f;gain.gain.setValueAtTime(0,t+i*.07);gain.gain.linearRampToValueAtTime(.035,t+i*.07+.015);gain.gain.exponentialRampToValueAtTime(.001,t+i*.07+.27);osc.connect(gain);gain.connect(audioContext.destination);osc.start(t+i*.07);osc.stop(t+i*.07+.3);osc.onended=()=>{osc.disconnect();gain.disconnect();};});}catch{toast('Задача выполнена. Звук недоступен в этом браузере.');}}
setup();
