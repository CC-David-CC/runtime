// Actual catalog loader admission with metadata-only fetch fixture. No app,
// browser DOM, native operation or large asset body is emulated.
import test from 'node:test';import assert from 'node:assert/strict';
const mib=1024*1024;
function catalog(sizes){const files=Object.fromEntries(sizes.map((bytes,i)=>[i?i+'.wasm':'index.mjs',{bytes,sha256:'b'.repeat(64)}]));return{version:'codi-public-apps/2',hostAPI:2,apps:[{id:'budget-test',kind:'browser',bundleSHA256:'a'.repeat(64),sha256:'b'.repeat(64),path:'assets/desktop/apps/budget-test/'+'a'.repeat(64)+'/index.mjs',bytes:sizes[0],styles:[],files}]};}
for(const [label,sizes,allowed]of [
 ['loft-sized',[1,256*mib,100*mib],true],
 ['exact512',[1,256*mib,256*mib-1],true],
 ['over512',[1,256*mib,256*mib],false],
 ['single-file-over256',[1,256*mib+1],false],
 ['exact4096-files',Array(4096).fill(1),true],
 ['over4096-files',Array(4097).fill(1),false],
])test(label,async()=>{
 const prior=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(catalog(sizes)),{status:200});};
 try{const loader=await import('../active-system/assets/desktop/apps.mjs?inventory='+label);await assert.rejects(loader.loadApp('absent'),allowed?/App is not in the public catalog/:/App bundle too large|Invalid app file|Invalid app reference/);assert.equal(calls,1);}finally{globalThis.fetch=prior;}
});
