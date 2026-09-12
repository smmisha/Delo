(()=>{
  const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
  const input=document.querySelector('#task-input'),capsule=document.querySelector('#entry');input.focus();
  const field=getComputedStyle(input),surface=getComputedStyle(capsule);
  check('entry textarea has no rectangular focus outline',field.outlineStyle==='none'||field.outlineWidth==='0px');
  check('focus remains visible on the rounded capsule',surface.boxShadow!=='none'&&surface.borderRadius!=='0px');
  input.blur();return {checks};
})()
