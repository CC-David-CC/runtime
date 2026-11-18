import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAutosaveRetry, createAccountAutosave, ACCOUNT_AUTOSAVE_POLICY} from '../src/account-autosave.mjs';

const settle = async () => {for (let i=0; i<12; i++) await Promise.resolve();};
function fixture(save = async () => ({status:'saved'}), random = () => 0) {
  let time=0, id=0; const timers=new Map(), calls=[], states=[];
  const scheduler=createAccountAutosave({
    save:args=>{calls.push({...args,time});return save(args);}, onState:value=>states.push(value),
    now:()=>time, random,
    setTimer:(fn,delay)=>{timers.set(++id,{at:time+delay,fn});return id;}, clearTimer:key=>timers.delete(key)
  });
  async function tick(ms) {
    const until=time+ms;
    for (;;) {
      const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
      if (!next) break;
      time=next[1].at;timers.delete(next[0]);next[1].fn();await settle();
    }
    time=until;await settle();
  }
  const observe=(value={})=>scheduler.observe({identity:'account/session/document/path',version:'1',dirty:true,eligible:true,...value});
  return {scheduler,calls,states,timers,tick,observe};
}

test('typing is debounced, repeated polling cannot postpone a save, and unchanged content stays idle', async () => {
  const f=fixture(); f.observe(); await f.tick(9000); f.observe({version:'2'});
  await f.tick(9000); assert.equal(f.calls.length,0); f.observe({version:'2'});
  await f.tick(1000); assert.equal(f.calls.length,1); assert.equal(f.calls[0].version,'2');
  f.observe({version:'2',dirty:false}); await f.tick(900_000); assert.equal(f.calls.length,1);
  f.scheduler.dispose();
});

test('successful writes are throttled and continuous committed edits get a bounded checkpoint', async () => {
  const f=fixture(); f.observe(); await f.tick(10_000);
  f.observe({version:'2'}); await f.tick(59_999); assert.equal(f.calls.length,1);
  await f.tick(1); assert.equal(f.calls.length,2);
  f.scheduler.dispose();
  const busy=fixture();busy.observe();
  for(let i=1;i<=24;i++){await busy.tick(4999);busy.observe({version:String(i+1)});}
  assert.equal(busy.calls.length,0);await busy.tick(24);assert.equal(busy.calls.length,1);
  assert.equal(busy.calls[0].time,120_000);busy.scheduler.dispose();
});

test('local or unfinished editing is ineligible: no unnamed creation or draft settlement', async () => {
  const f=fixture();f.observe({identity:null,eligible:false});await f.tick(1_000_000);assert.equal(f.calls.length,0);
  f.observe({eligible:false});await f.tick(1_000_000);assert.equal(f.calls.length,0);
  f.observe({eligible:true});await f.tick(0);assert.equal(f.calls.length,1);f.scheduler.dispose();
});

test('transient known-no-write retries grow exponentially to fifteen minutes, unaffected by typing', async () => {
  const f=fixture(async()=>({status:'retry'}));f.observe();await f.tick(10_000);
  const delays=[30_000,60_000,120_000,240_000,480_000,900_000,900_000];
  for (const [i,delay] of delays.entries()) {
    const before=f.calls.length;f.observe({version:String(i+2)});
    await f.tick(delay-1);assert.equal(f.calls.length,before);await f.tick(1);assert.equal(f.calls.length,before+1);
  }
  f.scheduler.dispose();
});

test('server Retry-After is respected and positive jitter never exceeds the retry cap', async () => {
  const f=fixture(async()=>({status:'retry',retryAfterMs:1_000_000}));f.observe();await f.tick(10_000);
  await f.tick(999_999);assert.equal(f.calls.length,1);await f.tick(1);assert.equal(f.calls.length,2);f.scheduler.dispose();
  const j=fixture(async()=>({status:'retry'}),()=>1);j.observe();await j.tick(10_000);
  for (const delay of [36_000,72_000,144_000,288_000,576_000,900_000,900_000]) {
    const before=j.calls.length;await j.tick(delay-1);assert.equal(j.calls.length,before);
    await j.tick(1);assert.equal(j.calls.length,before+1);
  }
  j.scheduler.dispose();
});

test('only known no-write errors can supply a retry delay, including long server instructions',async()=>{
  const message='Transfer allowance reached; try later', retryAfterMs=3_000_000_000;
  const known={status:429,message,retryAfterMs};
  assert.equal(accountAutosaveRetry({...known,outcome:'unknown'}),null);
  assert.equal(accountAutosaveRetry({...known,message:'Unexplained 429'}),null);
  assert.equal(accountAutosaveRetry({...known,status:503}),null);
  const f=fixture(async()=>accountAutosaveRetry(known));f.observe();await f.tick(10_000);
  assert.equal([...f.timers.values()][0].at,10_000+2_147_483_647);
  await f.tick(retryAfterMs-1);assert.equal(f.calls.length,1);
  await f.tick(1);assert.equal(f.calls.length,2);
  f.scheduler.dispose();
});

test('conflicts, uncertain responses and thrown network failures pause without automatic replay', async () => {
  for(const result of [()=>({status:'paused',reason:'conflict'}),()=>({status:'unknown'}),()=>{throw Error('response lost');}]) {
    const f=fixture(result);f.observe();await f.tick(10_000);assert.equal(f.scheduler.inspect().state,'paused');
    f.observe({version:'2'});await f.tick(3_600_000);assert.equal(f.calls.length,1);
    f.scheduler.dispose();
  }
});

test('a manual confirmed Save resolves a pause and starts the account-write cooldown', async () => {
  const f=fixture();f.observe();f.scheduler.pause('conflict');
  f.scheduler.confirmed({identity:'different'});assert.equal(f.scheduler.inspect().state,'paused');
  f.scheduler.confirmed({identity:'account/session/document/path'});
  await f.tick(59_999);assert.equal(f.calls.length,0);await f.tick(1);assert.equal(f.calls.length,1);f.scheduler.dispose();
});

test('late edits remain dirty while a confirmed captured revision is saved', async () => {
  let complete;const f=fixture(()=>new Promise(resolve=>complete=resolve));f.observe();await f.tick(10_000);
  f.observe({version:'2'});complete({status:'saved'});await settle();assert.equal(f.scheduler.inspect().state,'scheduled');
  await f.tick(60_000);assert.equal(f.calls.length,2);assert.equal(f.calls[1].version,'2');
  complete({status:'saved'});await settle();f.scheduler.dispose();
});

test('resource changes fence late results; disposal prevents subsequent saves', async () => {
  let complete;const f=fixture(()=>new Promise(resolve=>complete=resolve));f.observe();await f.tick(10_000);
  f.observe({identity:'other-document'});complete({status:'paused',reason:'old-resource-conflict'});await settle();
  assert.equal(f.scheduler.inspect().state,'scheduled');f.scheduler.dispose();await f.tick(1_000_000);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].signal.aborted,true);
});

test('automatic saves share two slots; queued views revalidate state before capture', async () => {
  const completions=[];const save=()=>new Promise(resolve=>completions.push(resolve));
  const a=fixture(save), b=fixture(save), c=fixture(save);
  for (const f of [a,b,c]) {f.observe();await f.tick(10_000);}
  assert.equal(completions.length,2);c.observe({eligible:false});
  completions[0]({status:'saved'});await settle();assert.equal(c.calls.length,0);
  completions[1]({status:'saved'});await settle();for(const f of [a,b,c])f.scheduler.dispose();
});

test('public policy distinguishes browser persistence from infrequent account writes', () => {
  assert.equal(ACCOUNT_AUTOSAVE_POLICY.minimumIntervalMs,60_000);
  assert.equal(ACCOUNT_AUTOSAVE_POLICY.retryMaximumMs,900_000);
  assert.throws(()=>createAccountAutosave({save(){},policy:{idleMs:0}}),/positive/i);
});
