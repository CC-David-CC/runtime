import {strictJson} from '../../network/strict-json.mjs';
import {icePreference} from '../../network/identity.mjs?originProfile=codi-session-ice-1';

// Compare structure, not JSON property order. This is not a signature encoding.
function same(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const left=Object.keys(a).sort(),right=Object.keys(b).sort();
  return left.length===right.length&&left.every((key,index)=>key===right[index]&&same(a[key],b[key]));
}
function stable(config){
  const result=structuredClone(config);
  if(result.rtc){delete result.rtc.iceTransportPolicy;delete result.rtc.preference;}
  if(result.discovery){delete result.discovery.seed;delete result.discovery.descriptor;}
  return result;
}

/** A restart may change ICE transport preference, not trusted keys or routes. */
export function reconcileRecoveryPolicy(previous,next){
  if(!previous||!next)throw Error('Recovery configuration required');
  next=structuredClone(next);
  // A stopped steward can temporarily remove its fresh public bundle. Retain
  // the old pins and expiring statements; do not invent freshness or block login.
  if(previous.discovery&&!Object.hasOwn(next,'discovery'))next.discovery=structuredClone(previous.discovery);
  if(previous.identity?.mode!=='server'||next.identity?.mode!=='server'||!same(stable(previous),stable(next)))throw Error('Server recovery configuration changed a pinned identity, route or service');
  const before=previous.rtc,after=next.rtc;
  icePreference(previous);icePreference(next);
  if(before?.preference!==undefined&&after?.preference===undefined&&after?.iceTransportPolicy!=='relay')throw Error('Legacy recovery requires relay-only policy');
  if(!same(before,after)){
    if(before?.credentialMode!=='session-turn/1'||after?.credentialMode!=='session-turn/1'||!['all','relay'].includes(before.iceTransportPolicy)||!['all','relay'].includes(after.iceTransportPolicy))throw Error('Unsupported recovery ICE policy change');
  }
  if(next.discovery){
    if(typeof next.discovery.seed!=='string'||next.discovery.seed.length>32768||typeof next.discovery.descriptor!=='string'||next.discovery.descriptor.length>8192)throw Error('Invalid recovery discovery statement');
  }
  // These statements are still verified against the retained pins by the normal
  // identity/discovery clients. Refreshing never supplies a new trust anchor.
  return {rtc:structuredClone(after),discovery:structuredClone(next.discovery)};
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
