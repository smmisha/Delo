// Session identity makes late native results harmless after Escape, hide or a retry.
export class VoiceInput {
  constructor({host,input,language,onChange=()=>{},onText=()=>{},now=()=>Date.now()}){
    Object.assign(this,{host,input,language,onChange,onText,now});this.phase='idle';this.session=null;this.error='';this.recordingStartedAt=null;this.limitReached=false;
    host.addEventListener('voiceState',event=>this.receive(event.detail));
  }
  get active(){return ['starting','recording','stopping','transcribing','cancelling'].includes(this.phase);}
  change(phase,error=''){this.phase=phase;this.error=error;this.onChange(this);}
  recordingSeconds(){return this.recordingStartedAt===null?0:Math.min(60,Math.max(0,Math.floor((this.now()-this.recordingStartedAt)/1000)));}
  clearError(){if(this.phase==='error')this.change('idle');}
  async start(){
    if(this.active)return;
    const session=this.session=crypto.randomUUID();this.recordingStartedAt=null;this.limitReached=false;this.change('starting');
    try{await this.host.request('voice',{action:'start',session,language:this.language()});}
    catch(error){if(this.session===session){this.session=null;this.change('error',error.message);}}
  }
  async stop(){
    if(!['starting','recording'].includes(this.phase))return;
    const session=this.session;this.change('stopping');
    try{await this.host.request('voice',{action:'stop',session});}
    catch(error){if(this.session===session){this.cancel();this.change('error',error.message);}}
  }
  cancel(){
    const session=this.session;this.session=null;this.change('idle');
    if(session)this.host.request('voice',{action:'cancel',session}).catch(()=>{});
  }
  receive(update){
    if(!update||update.session!==this.session)return;
    if(update.state==='recording'){if(this.phase==='starting'){this.recordingStartedAt=this.now();this.change('recording');}return;}
    if(update.state==='transcribing'){this.change('transcribing');return;}
    if(update.state==='limit'){this.limitReached=true;this.change('transcribing');return;}
    this.session=null;
    if(update.state==='result'){
      const result=typeof update.text==='string'?update.text.trim():'';
      if(!result){this.change('error','voiceNoSpeech');return;}
      // Append to the current draft, never restore an old snapshot over user edits.
      const draft=this.input.value;this.input.value=draft+(draft&&!/\s$/.test(draft)?' ':'')+result;
      this.change(this.input.value.length>4000?'error':'idle',this.input.value.length>4000?'voiceTooLong':'');this.onText();
    }else if(update.state==='cancelled')this.change('idle');
    else this.change('error',update.error||'voiceFailed');
  }
}
