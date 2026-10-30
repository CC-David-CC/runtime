import {strictJson} from '../../network/strict-json.mjs';
export {mountApp} from './app-instance.mjs';
let registry;
const pending=new Map(),attempts=new Map(),styles=new Map();
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safeFile=value=>typeof value==='string'&&/^(?:[a-zA-Z0-9_@+-][a-zA-Z0-9_@+.-]*\/)*[a-zA-Z0-9_@+-][a-zA-Z0-9_@+.-]*$/.test(value)&&!value.split('/').some(p=>p==='.'||p==='..');
async function catalog(){
  registry??=(async()=>{
    const response=await fetch(new URL('apps.json',import.meta.url),{cache:'no-cache',credentials:'same-origin',redirect:'error'});
    if(!response.ok)throw Error('App catalog unavailable');
    const text=await response.text();if(text.length>2097152)throw Error('App catalog too large');
    const value=strictJson(text,{maxBytes:2097152,maxValues:65536});
    if(value.version!=='codi-public-apps/2'||value.hostAPI!==2||!Array.isArray(value.apps)||value.apps.length>32)throw Error('Invalid app catalog');
    const result=new Map();
    for(const app of value.apps){
      if(!app||typeof app.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(app.id)||result.has(app.id)||app.kind!=='browser'||!digest(app.sha256)||!digest(app.bundleSHA256)||app.path!=='assets/desktop/apps/'+app.id+'/'+app.bundleSHA256+'/index.mjs'||!app.files||Array.isArray(app.files)||Object.keys(app.files).length>4096||!Array.isArray(app.styles))throw Error('Invalid app reference');
      for(const [name,file] of Object.entries(app.files))if(!safeFile(name)||!file||!digest(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>67108864)throw Error('Invalid app file');
      if(Object.values(app.files).reduce((total,file)=>total+file.bytes,0)>100663296)throw Error('App bundle too large');
      if(app.files['index.mjs']?.sha256!==app.sha256||app.files['index.mjs']?.bytes!==app.bytes||app.styles.length>16||new Set(app.styles).size!==app.styles.length||app.styles.some(name=>!safeFile(name)||!name.endsWith('.css')||!app.files[name]))throw Error('Invalid app entry/styles');
      result.set(app.id,app);
    }
    return result;
  })().catch(error=>{registry=null;throw error;});
  return registry;
}
function loadStyle(url){
  if(!styles.has(url))styles.set(url,new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.dataset.publicAppStyle='';
    link.onload=()=>resolve();link.onerror=()=>{link.remove();styles.delete(url);reject(Error('App stylesheet unavailable'));};document.head.append(link);
  }));
  return styles.get(url);
}
export async function loadApp(id){
  const item=(await catalog()).get(id);if(!item)throw Error('App is not in the public catalog');
  if(!pending.has(id)){
    const attempt=attempts.get(id)||0;attempts.set(id,attempt+1);
    // import.meta.url gives the mount prefix independently of document base tags.
    const url=new URL('../../'+item.path,import.meta.url);if(attempt)url.searchParams.set('retry',String(attempt));
    pending.set(id,(async()=>{
      await Promise.all(item.styles.map(name=>loadStyle(new URL(name,url).href)));
      const module=await import(url.href);if(typeof module.mount!=='function')throw Error('App has no mount function');return module;
    })().catch(error=>{pending.delete(id);throw error;}));
  }
  return pending.get(id);
}
