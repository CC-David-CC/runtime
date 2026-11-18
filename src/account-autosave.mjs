/** Browser recovery is independent. This scheduler only invokes an app's
 * existing conditional account Save and never interprets document contents.
 */
export const ACCOUNT_AUTOSAVE_POLICY = Object.freeze({
  idleMs: 10_000, minimumIntervalMs: 60_000, maximumWaitMs: 120_000,
  retryBaseMs: 30_000, retryMaximumMs: 15 * 60_000
});

// Bound automatic uploads across document views in this page. Manual Save and
// browser recovery do not wait for this queue. Server admission remains final.
let active = 0;
const waiting = [];
async function automaticSlot(action) {
  if (active >= 2) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await action(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}

export function createAccountAutosave({save, onState = () => {},
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  random = Math.random, policy = {}}) {
  if (typeof save !== 'function' || typeof onState !== 'function') throw TypeError('Account AutoSave callbacks required.');
  const config = {...ACCOUNT_AUTOSAVE_POLICY, ...policy};
  for (const value of Object.values(config)) if (!Number.isFinite(value) || value <= 0) throw TypeError('Positive finite AutoSave intervals required.');
  if (config.retryBaseMs > config.retryMaximumMs || config.idleMs > config.maximumWaitMs) throw TypeError('Invalid AutoSave interval bounds.');
  let current = null, epoch = 0, timer = null, running = false, disposed = false,
    dirtySince = null, lastEdit = 0, lastConfirmed = -Infinity, retryAt = 0,
    failures = 0, pauseReason = null, state = 'idle', nextAt = null, published = '';
  const abort = new AbortController();
  const inspect = () => Object.freeze({state, nextAt, failures, reason: pauseReason});
  function publish(next, due = null) {
    state = next; nextAt = due;
    const fingerprint = JSON.stringify(inspect());
    if (published !== fingerprint) {published = fingerprint; onState(inspect());}
  }
  function cancelTimer() { if (timer !== null) clearTimer(timer); timer = null; }
  function pause(reason) {
    if (disposed) return;
    pauseReason = String(reason || 'Verify the account file before resuming AutoSave.');
    cancelTimer(); publish('paused');
  }
  function schedule() {
    cancelTimer();
    if (disposed) return;
    if (pauseReason) { publish('paused'); return; }
    if (running) { publish('saving'); return; }
    if (!current?.dirty) { publish('idle'); return; }
    if (!current.identity || !current.eligible) { publish('waiting'); return; }
    const due = Math.max(retryAt, lastConfirmed + config.minimumIntervalMs,
      Math.min(lastEdit + config.idleMs, dirtySince + config.maximumWaitMs));
    publish(failures ? 'retrying' : 'scheduled', due);
    timer = setTimer(() => { timer = null; void run(); }, Math.max(0, due - now()));
  }
  async function run() {
    if (disposed || running || pauseReason || !current?.dirty || !current.eligible) return;
    const candidate = {...current}, startedEpoch = epoch;
    running = true; publish('saving');
    try {
      const outcome = await automaticSlot(async () => {
        // Queueing is not authorization. Revalidate immediately before calling
        // the domain operation; the native app must check again before capture.
        if (disposed || pauseReason || epoch !== startedEpoch || !current?.dirty || !current.eligible || current.version !== candidate.version) return {status:'busy'};
        return save({identity:candidate.identity, version:candidate.version, signal:abort.signal});
      });
      if (disposed || epoch !== startedEpoch) return;
      if (outcome?.status === 'saved' || outcome?.status === 'unchanged') {
        // 'saved' means Storage revision AND native acknowledgement confirmed,
        // never merely that a request was sent. Late edits remain dirty.
        lastConfirmed = now(); failures = 0; retryAt = 0;
        if (current.version === candidate.version) { current = {...current, dirty:false}; dirtySince = null; }
      } else if (outcome?.status === 'busy') {
        retryAt = Math.max(retryAt, now() + config.idleMs);
      } else if (outcome?.status === 'retry') {
        // Only an explicit known-no-write failure may enter this branch. A
        // lost response/timeout must be paused, even if a retry seems likely.
        failures++;
        const base = Math.min(config.retryMaximumMs, config.retryBaseMs * 2 ** Math.min(failures - 1, 30));
        const jitter = Math.max(0, Math.min(1, random())) * .2 * base;
        const retryAfter = Number.isFinite(outcome.retryAfterMs) ? Math.max(0, outcome.retryAfterMs) : 0;
        retryAt = now() + Math.max(retryAfter, Math.min(config.retryMaximumMs, base + jitter));
      } else pause(outcome?.reason || 'The account save result needs review. AutoSave is paused.');
    } catch (error) {
      if (!disposed && epoch === startedEpoch) pause(error?.message || 'The save outcome is uncertain. Verify the file before retrying.');
    } finally { running = false; schedule(); }
  }
  return Object.freeze({
    observe(value) {
      if (disposed) return;
      if (!value || value.identity !== null && typeof value.identity !== 'string' || typeof value.version !== 'string' || typeof value.dirty !== 'boolean' || typeof value.eligible !== 'boolean') throw TypeError('Explicit AutoSave identity, version, dirty and eligibility required.');
      const identityChanged = current?.identity !== value.identity;
      if (identityChanged) {
        epoch++; dirtySince = null; failures = 0; retryAt = 0; pauseReason = null;
        // Save As changes resource identity. Retain the write cooldown in this
        // view rather than allowing a newly named file to bypass throttling.
      }
      if (identityChanged || current?.version !== value.version || !current?.dirty && value.dirty) lastEdit = now();
      if (value.dirty && dirtySince === null) dirtySince = now();
      if (!value.dirty) dirtySince = null;
      current = {...value};
      if (value.blocked) { pause(value.blocked); return; }
      schedule();
    },
    // Call only after the same domain Save confirms Storage AND native adoption.
    // This also resets a prior conflict pause after explicit user resolution.
    confirmed({identity}) {
      if (disposed || current?.identity !== identity) return;
      lastConfirmed = now(); failures = 0; retryAt = 0; pauseReason = null; schedule();
    },
    pause,
    resume() { if (!disposed) {pauseReason = null; failures = 0; retryAt = 0; lastEdit = now(); schedule();} },
    inspect,
    dispose() { if (disposed) return; disposed = true; epoch++; cancelTimer(); abort.abort(); publish('disposed'); }
  });
}
