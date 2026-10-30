import {strictJson} from '../../network/strict-json.mjs';

// Compare structure, not JSON property order. This is not a signature encoding.
function same(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const left=Object.keys(a).sort(),right=Object.keys(b).sort();
  return left.length===right.length&&left.every((key,index)=>key===right[index]&&same(a[key],b[key]));
}
// Peer-discovery configuration is not used by this desktop. Only active
// service configuration and pinned identity matter when recovering a session.
function stable(config){const result=structuredClone(config);delete result.rtc;delete result.discovery;return result;}
export function reconcileRecoveryPolicy(previous,next){
  if(!previous||!next||previous.identity?.mode!=='server'||next.identity?.mode!=='server'||!same(stable(previous),stable(next)))throw Error('Server recovery configuration changed a pinned identity, route or service');
  return true;
}

export async function refreshRecoveryPolicy(previous){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try{
    const response=await fetch(new URL('config.json',document.baseURI),{cache:'no-store',credentials:'same-origin',mode:'same-origin',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('Recovery configuration unavailable');
    const reader=response.body.getReader(),chunks=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>131072)throw Error('Recovery configuration too large');chunks.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    const next=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:131072});
    return reconcileRecoveryPolicy(previous,next);
  }finally{clearTimeout(timer);}
}
