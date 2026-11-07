/** In-page commands for mounted app windows. This module opens no network endpoint. */
export const COMMAND_ARGUMENT_MAX_BYTES=65536;
export function createCommandRegistry({currentSubject,currentSession}) {
 if(typeof currentSubject!=='function'||typeof currentSession!=='function')throw TypeError('Session identity and generation sources are required.');
 const entries=new Map(),documentTokens=new WeakMap();
 const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
 const staleDocument=()=>{const error=new DOMException('The selected document changed before command dispatch.','AbortError');Object.defineProperty(error,'code',{value:'STALE_DOCUMENT',enumerable:true});return error;};
 const key=(windowId,command)=>windowId+'\0'+command;
 function scope({windowId,appId,owner,isOpen}){
  if(typeof windowId!=='string'||!windowId||typeof appId!=='string'||!appId||typeof owner!=='string'||!owner||typeof isOpen!=='function')throw TypeError('A window, app and account are required.');
  let binding=null;
  function readDocument(){
   const captured=binding;if(!captured)return null;
   let signal;try{signal=captured.readSignal();if(!signal||aborted.call(signal))return null;}catch{return null;}
   if(binding!==captured)return null;
   let token=documentTokens.get(signal);if(!token){token=crypto.randomUUID();documentTokens.set(signal,token);}
   return {binding:captured,signal,token};
  }
  return Object.freeze({
  bindDocument(readSignal){if(typeof readSignal!=='function')throw TypeError('An authoritative document signal reader is required.');const captured={readSignal};binding=captured;return()=>{if(binding===captured)binding=null;};},
  documentToken(){try{return owner===currentSubject()&&isOpen()?(readDocument()?.token??null):null;}catch{return null;}},
  register(descriptor,handler){
   if(!descriptor||typeof descriptor.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id)||typeof descriptor.description!=='string'||!descriptor.description||descriptor.description.length>512||typeof handler!=='function')throw TypeError('Invalid command registration.');
   const name=key(windowId,descriptor.id);if(entries.has(name))throw Error('Command already registered for this window.');
   let parameters;try{const text=JSON.stringify(descriptor.parameters??{});if(text.length>4096)throw Error('too large');parameters=JSON.parse(text);}catch{throw TypeError('Invalid command parameters description.');}
   const entry={windowId,appId,owner,isOpen,readDocument,ownsDocument:state=>binding===state.binding&&!aborted.call(state.signal),descriptor:Object.freeze({id:descriptor.id,description:descriptor.description,parameters}),handler};entries.set(name,entry);
   return ()=>{if(entries.get(name)===entry)entries.delete(name);};
  }});
 }
 const accessible=entry=>entry.owner===currentSubject()&&entry.isOpen();
 function list(){return [...entries.values()].filter(accessible).map(entry=>{const {windowId,appId,descriptor}=entry,documentToken=entry.readDocument()?.token??null;return{windowId,appId,...descriptor,parameters:JSON.parse(JSON.stringify(descriptor.parameters)),argumentMaxBytes:COMMAND_ARGUMENT_MAX_BYTES,...(documentToken?{documentToken}:{})};});}
 async function execute(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Reflect.ownKeys(input).some(k=>typeof k!=='string'||!['windowId','command','args','expectedDocumentToken'].includes(k)))throw TypeError('Expected own command request data.');
  const request={};for(const k of Reflect.ownKeys(input)){const d=Object.getOwnPropertyDescriptor(input,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw TypeError('Command request fields must be own data.');request[k]=d.value;}
  const {windowId,command,args}=request,guarded=Object.hasOwn(request,'expectedDocumentToken'),expected=request.expectedDocumentToken;
  if(typeof windowId!=='string'||typeof command!=='string')throw TypeError('A window and command are required.');
  if(guarded&&(typeof expected!=='string'||!expected||expected.length>256))throw TypeError('Expected an opaque document token.');
  const entry=entries.get(key(windowId,command));if(!entry||!accessible(entry))throw Error('Command is unavailable for this account or window.');
  const session=currentSession();if(!session)throw Error('Command requires an active session.');
  const before=entry.readDocument();if(guarded&&(!before||before.token!==expected))throw staleDocument();
  let safeArgs;try{const text=JSON.stringify(args??{});if(text.length>COMMAND_ARGUMENT_MAX_BYTES||new TextEncoder().encode(text).byteLength>COMMAND_ARGUMENT_MAX_BYTES)throw Error('too large');safeArgs=JSON.parse(text);}catch{throw TypeError('Command arguments exceed the bounded JSON metadata contract.');}
  // JSON getters/toJSON may reenter the host. Revalidate after every caller
  // serialization/UTF-8 boundary, with no await before actual handler dispatch.
  if(currentSession()!==session||entries.get(key(windowId,command))!==entry||!accessible(entry))throw Error('The account or window changed before command dispatch.');
  const current=entry.readDocument();
  if(currentSession()!==session||entries.get(key(windowId,command))!==entry||!accessible(entry))throw Error('The account or window changed before command dispatch.');
  if(guarded&&(!current||current.token!==expected||current.binding!==before.binding||current.signal!==before.signal||!entry.ownsDocument(current)))throw staleDocument();
  const result=await entry.handler(safeArgs);
  if(currentSession()!==session||entries.get(key(windowId,command))!==entry||!accessible(entry)){
   const error=Error('The account or window changed while the command was running.');
   // Preserve an explicit publication outcome without returning a stale
   // model/file payload across an account or window lifetime boundary.
   const marker=result!==null&&typeof result==='object'?Object.getOwnPropertyDescriptor(result,'committed'):null;
   if(marker&&Object.hasOwn(marker,'value')&&marker.value===true)Object.defineProperty(error,'committed',{value:true,enumerable:true});
   throw error;
  }
  return result;
 }
 return Object.freeze({scope,list,execute});
}
