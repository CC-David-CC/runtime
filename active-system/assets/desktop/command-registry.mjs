/** In-page commands for mounted app windows. This module opens no network endpoint. */
export function createCommandRegistry({currentSubject,currentSession}) {
 if(typeof currentSubject!=='function'||typeof currentSession!=='function')throw TypeError('Session identity and generation sources are required.');
 const entries=new Map();
 const key=(windowId,command)=>windowId+'\0'+command;
 function scope({windowId,appId,owner,isOpen}){
  if(typeof windowId!=='string'||!windowId||typeof appId!=='string'||!appId||typeof owner!=='string'||!owner||typeof isOpen!=='function')throw TypeError('A window, app and account are required.');
  return Object.freeze({register(descriptor,handler){
   if(!descriptor||typeof descriptor.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id)||typeof descriptor.description!=='string'||!descriptor.description||descriptor.description.length>512||typeof handler!=='function')throw TypeError('Invalid command registration.');
   const name=key(windowId,descriptor.id);if(entries.has(name))throw Error('Command already registered for this window.');
   let parameters;try{const text=JSON.stringify(descriptor.parameters??{});if(text.length>4096)throw Error('too large');parameters=JSON.parse(text);}catch{throw TypeError('Invalid command parameters description.');}
   const entry={windowId,appId,owner,isOpen,descriptor:Object.freeze({id:descriptor.id,description:descriptor.description,parameters}),handler};entries.set(name,entry);
   return ()=>{if(entries.get(name)===entry)entries.delete(name);};
  }});
 }
 const accessible=entry=>entry.owner===currentSubject()&&entry.isOpen();
 function list(){return [...entries.values()].filter(accessible).map(({windowId,appId,descriptor})=>({windowId,appId,...descriptor,parameters:JSON.parse(JSON.stringify(descriptor.parameters))}));}
 async function execute({windowId,command,args}={}){
  if(typeof windowId!=='string'||typeof command!=='string')throw TypeError('A window and command are required.');
  const entry=entries.get(key(windowId,command));if(!entry||!accessible(entry))throw Error('Command is unavailable for this account or window.');
  let safeArgs;try{const text=JSON.stringify(args??{});if(text.length>8192)throw Error('too large');safeArgs=JSON.parse(text);}catch{throw TypeError('Command arguments must be small JSON values.');}
  const session=currentSession();if(!session)throw Error('Command requires an active session.');const result=await entry.handler(safeArgs);if(currentSession()!==session||entries.get(key(windowId,command))!==entry||!accessible(entry))throw Error('The account or window changed while the command was running.');return result;
 }
 return Object.freeze({scope,list,execute});
}
