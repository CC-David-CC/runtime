import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandRegistry} from '../active-system/assets/desktop/command-registry.mjs';

function fixture() {
 let owner='alice',session={},open=true;
 const registry=createCommandRegistry({currentSubject:()=>owner,currentSession:()=>session});
 const scope=registry.scope({windowId:'cad',appId:'jsketcher',owner:'alice',isOpen:()=>open});
 return {registry,scope,close:()=>{open=false;},replaceSession:()=>{session={};},changeAccount:()=>{owner='bob';},run:()=>registry.execute({windowId:'cad',command:'replace'})};
}
for(const invalidation of ['close','replaceSession','changeAccount'])test('accepted replacement retains committed marker on queued '+invalidation,async()=>{
 const f=fixture();f.scope.register({id:'replace',description:'Replace inspected document'},()=>{
  queueMicrotask(f[invalidation]);return Object.freeze({status:'opened',committed:true,path:'/private.jsketcher.json'});
 });
 await assert.rejects(f.run(),error=>{
  assert.match(error.message,/changed/);assert.equal(error.committed,true);
  assert.equal(Object.hasOwn(error,'result'),false);assert.equal(Object.hasOwn(error,'path'),false);
  assert.equal(error.message.includes('private.jsketcher'),false);return true;
 });
});

test('replaced registration after accepted mutation retains marker and rejects stale result',async()=>{
 const f=fixture();let remove;
 remove=f.scope.register({id:'replace',description:'Original operation'},()=>{
  queueMicrotask(()=>{remove();f.scope.register({id:'replace',description:'Different operation'},()=>({committed:false}));});
  return {committed:true};
 });
 await assert.rejects(f.run(),error=>error.committed===true);
});

test('ordinary accepted result remains exact and unchanged',async()=>{
 const f=fixture(),receipt=Object.freeze({status:'opened',committed:true});
 f.scope.register({id:'replace',description:'Replace'},()=>receipt);
 assert.equal(await f.run(),receipt);
});
for(const value of [undefined,false,'true',1])test('no commit inference from '+String(value),async()=>{
 const f=fixture();f.scope.register({id:'replace',description:'Noncommitting result'},()=>{queueMicrotask(f.close);return {status:'cancelled',committed:value};});
 await assert.rejects(f.run(),error=>!Object.hasOwn(error,'committed'));
});

test('inherited marker confers no outcome claim',async()=>{
 const f=fixture();f.scope.register({id:'replace',description:'No own marker'},()=>{queueMicrotask(f.close);return Object.create({committed:true});});
 await assert.rejects(f.run(),error=>!Object.hasOwn(error,'committed'));
});

test('outcome accessor is never invoked',async()=>{
 const f=fixture();let reads=0;
 f.scope.register({id:'replace',description:'Accessor result'},()=>{queueMicrotask(f.close);return Object.defineProperty({},'committed',{get(){reads++;return true;}});});
 await assert.rejects(f.run(),error=>!Object.hasOwn(error,'committed'));assert.equal(reads,0);
});

test('handler refusal/possibly committed error is not rewritten or retried',async()=>{
 const f=fixture();let calls=0;const failure=Object.assign(Error('Lost write reply'),{possiblyCommitted:true});
 f.scope.register({id:'replace',description:'Write'},()=>{calls++;throw failure;});
 await assert.rejects(f.run(),error=>error===failure);assert.equal(calls,1);
});
