let registration,registrationTask,mountRetirement={status:'not-run'};
export async function retirePreviousMount(base=new URL('.',document.baseURI)){
  // Only the two owned desktop mounts participate. The sizing prototype and
  // unrelated workers/caches/private browser stores are outside this operation.
  if(base.origin!==location.origin||!['/','/hidden/'].includes(base.pathname))return {status:'not-applicable'};
  let config;
  try{
    const response=await fetch(new URL('config.json',base),{credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok||!response.body)return {status:'deferred'};
    const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return {status:'deferred'};}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();config=JSON.parse(text);
  }catch{return {status:'deferred'};}
  // A cached old page must not retire the current root worker after a cutover.
  // Confirm this page's mount using uncached, non-redirected server metadata.
  if(config.identity?.mode!=='server'||config.identity.issuer!==base.origin||config.identity.apiBase!==base.pathname.slice(0,-1)+'/api/v1')return {status:'not-current-mount'};
  const previous=base.pathname==='/'?'/hidden/':'/',scope=new URL(previous,base).href;
  const script=new URL('assets/desktop/offline-worker.js',scope).href;
  let workers=0,cachesRemoved=0;
  for(const candidate of await navigator.serviceWorker.getRegistrations()){
    if(candidate.scope!==scope)continue;
    const versions=[candidate.active,candidate.waiting,candidate.installing].filter(Boolean);
    if(versions.length&&versions.every(worker=>worker.scriptURL===script)&&await candidate.unregister())workers++;
  }
  for(const name of await caches.keys())if(name.startsWith('codi-public-v1|'+previous+'|')&&await caches.delete(name))cachesRemoved++;
  return {status:'retired',previousMount:previous,workers,cachesRemoved};
}
export async function registerDeviceCache(){
  if(!isSecureContext||!('serviceWorker' in navigator))return null;
  const base=new URL('.',document.baseURI);
  registrationTask??=(async()=>{
    mountRetirement=await retirePreviousMount(base);
    registration=await navigator.serviceWorker.register(new URL('assets/desktop/offline-worker.js',base),{scope:base.pathname,updateViaCache:'none'});
    return registration;
  })().catch(error=>{registrationTask=undefined;throw error;});
  return registrationTask;
}
export async function keepLoadedAppFiles(){
  const persistent=await navigator.storage?.persist?.()||false;
  registration??=await registerDeviceCache();if(!registration)throw Error('This browser does not support offline app caching');
  const ready=await navigator.serviceWorker.ready,worker=ready.active;if(!worker)throw Error('App cache is still starting');
  const urls=[...new Set(performance.getEntriesByType('resource').map(entry=>entry.name))];
  const result=await new Promise((resolve,reject)=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Cache is still downloading; try again later'));},120000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.ok?resolve(event.data):reject(Error(event.data.error));};
    worker.postMessage({type:'cache-loaded',urls},[channel.port2]);
  });
  const estimate=await navigator.storage?.estimate?.()||{};
  return {...result,persistent,usage:estimate.usage,quota:estimate.quota};
}
export async function deviceStorageInfo(){
  const estimate=await navigator.storage?.estimate?.()||{};
  return {...estimate,persistent:await navigator.storage?.persisted?.()||false,supported:!!navigator.storage&&'serviceWorker' in navigator,updateWaiting:!!registration?.waiting,mountRetirement};
}
