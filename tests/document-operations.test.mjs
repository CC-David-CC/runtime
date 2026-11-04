import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentOperationCoordinator, createDocumentOperations} from '../active-system/assets/desktop/document-operations.mjs';

const setup = (key = 'account-a:/file') => {
  const coordinator = createDocumentOperationCoordinator();
  const one = createDocumentOperations({coordinator, documentKey:key});
  const two = createDocumentOperations({coordinator, documentKey:key});
  const other = createDocumentOperations({coordinator, documentKey:'account-a:/other'});
  return {coordinator, one, two, other};
};

test('synchronous admission, same-file contention, independent files and stale finish', () => {
  const {one,two,other} = setup();
  const first = one.begin('load'); assert.ok(first); assert.equal(one.begin('save'), null);
  assert.equal(two.busy,true); assert.equal(two.begin('save'),null);
  const separate = other.begin('save'); assert.ok(separate); separate.finish();
  first.finish(); const second = two.begin('save'); assert.ok(second);
  first.finish(); assert.equal(one.busy,true); assert.equal(second.current(),true);
  second.finish(); assert.equal(one.busy,false);
});

test('Save As holds both keys through completion and destination conflicts reject', () => {
  const {coordinator,one,two,other} = setup();
  const saving = one.begin('save'); const otherSave = other.begin('save');
  assert.equal(saving.claimDocument('account-a:/other'),false);
  otherSave.finish(); assert.equal(saving.claimDocument('account-a:/other'),true);
  assert.equal(other.busy,true); assert.equal(two.busy,true);
  assert.equal(saving.setDocument('account-a:/other'),true);
  assert.equal(one.setDocument('account-a:/third'),false);
  saving.finish(); assert.equal(two.busy,false); assert.equal(other.busy,false);
  const next = other.begin('load'); assert.ok(next); assert.equal(one.busy,true); next.finish();
  const third = createDocumentOperations({coordinator,documentKey:'account-b:/other'});
  assert.ok(third.begin('save')); third.dispose();
});

test('abort and account invalidation release claims and invalidate old token', () => {
  const coordinator = createDocumentOperationCoordinator(), ac = new AbortController();
  let valid = true;
  const one = createDocumentOperations({coordinator,documentKey:'x',signal:ac.signal,valid:()=>valid});
  const other = createDocumentOperations({coordinator,documentKey:'x'});
  const token = one.begin('save'); assert.equal(other.busy,true);
  valid = false; one.refresh(); assert.equal(token.signal.aborted,true); assert.equal(token.current(),false); assert.equal(other.busy,false);
  const current = other.begin('save'); token.finish(); assert.equal(current.current(),true); current.finish();
  const three = createDocumentOperations({coordinator,signal:ac.signal,documentKey:'x'});
  const pending = three.begin('load'); ac.abort(); assert.equal(pending.signal.aborted,true); assert.equal(pending.current(),false); assert.equal(other.busy,false);
});

test('listeners are isolated; reentrant admission cannot bypass claim', () => {
  const {one,two} = setup(); let attempted;
  one.subscribe(() => { throw Error('listener'); });
  one.subscribe(() => { attempted = one.begin('reentrant'); });
  const token = one.begin('save'); assert.ok(token); assert.equal(attempted,null); assert.equal(two.busy,true);
  // Unsubscribe reentrant callbacks before finishing to avoid deliberately starting a new operation.
  one.dispose(); assert.equal(token.signal.aborted,true); assert.equal(two.busy,false);
});

test('native and ARIA controls track local, peer and application-disabled state', () => {
  const {one,two} = setup(); let extra=false;
  const button={disabled:false}, menu={attributes:{},setAttribute(k,v){this.attributes[k]=v;}};
  const stop=two.bindControl(button,{disabled:()=>extra}); const stopMenu=two.bindControl(menu);
  const token=one.begin('load'); assert.equal(button.disabled,true); assert.equal(menu.attributes['aria-disabled'],'true');
  token.finish(); assert.equal(button.disabled,false); assert.equal(menu.attributes['aria-disabled'],'false');
  extra=true; two.refresh(); assert.equal(button.disabled,true);
  stop(); stopMenu(); extra=false; two.refresh(); assert.equal(button.disabled,true);
});

test('failed async work releases in finally and does not enqueue saves', async () => {
  const {one} = setup(); let starts=0;
  async function save(fail){const token=one.begin('save'); if(!token)return false; starts++; try {if(fail)throw Error('failed');} finally {token.finish();} return true;}
  await assert.rejects(save(true),/failed/); assert.equal(one.busy,false);
  const held=one.begin('load'); assert.equal(await save(false),false); held.finish();
  await Promise.resolve(); assert.equal(starts,1); assert.equal(await save(false),true);
});

test('listener disposal during claim cannot leak ownership or return a live token', () => {
  const {one,two}=setup(); one.subscribe(()=>{if(one.state.kind)one.dispose();});
  assert.equal(one.begin('load'),null); assert.equal(two.busy,false);
  const token=two.begin('save'); assert.ok(token); token.finish();
});

test('invalid input and already-aborted session fail closed', () => {
  const coordinator=createDocumentOperationCoordinator(), abort=new AbortController(); abort.abort();
  const instance=createDocumentOperations({coordinator,signal:abort.signal});
  assert.equal(instance.busy,true); assert.equal(instance.begin('save'),null);
  assert.throws(()=>createDocumentOperations({coordinator,documentKey:{path:'x'}}),TypeError);
  const valid=createDocumentOperations({coordinator}); assert.throws(()=>valid.begin(''),TypeError); assert.throws(()=>valid.setDocument(''),TypeError);
});

test('dispose notifies controls disabled once and releases subscriptions', () => {
  const {one} = setup(); let count=0;
  const button={disabled:false}; one.bindControl(button); one.subscribe(()=>count++);
  one.dispose(); assert.equal(button.disabled,true); assert.equal(count,1);
  one.refresh(); assert.equal(count,1);
});
