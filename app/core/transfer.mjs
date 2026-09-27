// N12: export all data to a file and import it back. Dependency-free like model.mjs.
// An export carries the whole state, settings included. An import replaces tasks, history
// and reputation, and takes the preferences; settings that belong to this computer
// (autostart, pinned window, global shortcuts) stay as they are here. Nothing is written
// from this module: the page confirms first and the host keeps a copy of the current file.
import {validateState,recoverState} from './model.mjs';

export const EXPORT_FORMAT='delo-export';
export const DEVICE_SETTINGS=Object.freeze(['autostart','pinned','listShortcut','quickShortcut']);
const LIMIT=16*1024*1024;
const fail=code=>{throw new Error(code);};

export function exportData(state,{now=Date.now()}={}){
  const check=validateState(state);if(!check.valid)fail('importInvalid');
  return `${JSON.stringify({format:EXPORT_FORMAT,version:1,exportedAt:new Date(now).toISOString(),state},null,1)}\n`;
}
export function exportName(now=new Date()){const pad=n=>String(n).padStart(2,'0');return `Delo-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}.json`;}

// Accepts this module's export, the widget's own data file ({format:1,revision,state}) such
// as a copied tasks.json or its .bak, and a bare state. Throws importTooLarge, importInvalid
// or importUnsupported; returns the state to save and a summary for the confirmation.
export function parseImport(text,current){
  if(typeof text!=='string')fail('importInvalid');
  if(text.length>LIMIT)fail('importTooLarge');
  let root;try{root=JSON.parse(text.replace(/^﻿/,''));}catch{fail('importInvalid');}
  if(!root||typeof root!=='object'||Array.isArray(root))fail('importInvalid');
  let source;
  if(root.format===EXPORT_FORMAT){if(root.version!==1)fail('importUnsupported');source=root.state;}
  else if(root.format===1&&Object.hasOwn(root,'revision'))source=root.state;
  else if(Object.hasOwn(root,'schemaVersion'))source=root;
  else fail('importInvalid');
  if(!source||typeof source!=='object')fail('importInvalid');
  if(source.schemaVersion!==1)fail('importUnsupported');
  if(!validateState(source).valid)fail('importInvalid');
  const next=recoverState(source);
  if(current?.settings)for(const key of DEVICE_SETTINGS)if(key in current.settings)next.settings[key]=current.settings[key];
  if(!validateState(next).valid)fail('importInvalid');
  return {state:next,summary:summarize(next)};
}
export function summarize(state){
  const count=lifecycle=>state.tasks.filter(task=>task.lifecycle===lifecycle).length;
  return {tasks:state.tasks.length,active:count('active'),archive:count('archive'),trash:count('trash'),reputation:state.reputation};
}
