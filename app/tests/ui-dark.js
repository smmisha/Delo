(async()=>{
 document.querySelector('#settings-open').click();
 const form=document.querySelector('#settings-form');form.elements.theme.value='dark';form.requestSubmit();
 const end=Date.now()+5000;while(document.querySelector('#settings').open&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
 if(document.querySelector('#settings').open||!document.body.classList.contains('dark'))throw Error('Dark theme was not saved');
 return {theme:'dark',error:!document.querySelector('#error').hidden};
})()
