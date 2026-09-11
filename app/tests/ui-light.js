(async()=>{
 document.querySelector('#settings-open').click();
 const form=document.querySelector('#settings-form');form.elements.theme.value='light';form.requestSubmit();
 const end=Date.now()+5000;while(document.querySelector('#settings').open&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
 if(document.querySelector('#settings').open||document.body.classList.contains('dark')||!document.querySelector('#error').hidden)throw Error('Light theme was not saved or an error remains');
 return {theme:'light',error:!document.querySelector('#error').hidden};
})()
