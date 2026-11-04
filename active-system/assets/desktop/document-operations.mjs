// Keys are explicit, session-scoped document identities supplied by the host.
// A coordinator contains active claims only; it never retains document data.
export function createDocumentOperationCoordinator() {
  const claims = new Map();
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch {} } };
  return Object.freeze({
    available(key, owner) { return key == null || !claims.has(key) || claims.get(key) === owner; },
    claim(key, owner) {
      if (key == null) return true;
      if (claims.has(key) && claims.get(key) !== owner) return false;
      if (!claims.has(key)) { claims.set(key, owner); notify(); }
      return true;
    },
    release(owner) {
      let changed = false;
      for (const [key, holder] of claims) if (holder === owner) { claims.delete(key); changed = true; }
      if (changed) notify();
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  });
}

export function createDocumentOperations({ signal, valid = () => true, coordinator, documentKey = null } = {}) {
  if (!coordinator) throw new TypeError('A session document coordinator is required.');
  const listeners = new Set();
  let disposed = false, active = null, key = validateKey(documentKey);
  function validateKey(value) {
    if (value !== null && (typeof value !== 'string' || !value)) throw new TypeError('Document key must be a nonempty string or null.');
    return value;
  }
  function isValid() { try { return !disposed && !signal?.aborted && valid() === true; } catch { return false; } }
  function state() {
    const usable = isValid();
    return Object.freeze({ busy: !!active || !usable || !coordinator.available(key, active), kind: active?.kind ?? null, disposed: !usable });
  }
  function notify() { for (const fn of [...listeners]) { try { fn(state()); } catch {} } }
  function finish(record, abort) {
    if (active !== record) return;
    active = null;
    if (abort && !record.controller.signal.aborted) record.controller.abort();
    coordinator.release(record);
    notify();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active) finish(active, true);
    signal?.removeEventListener('abort', dispose);
    unsubscribeCoordinator();
    notify();
    listeners.clear();
  }
  const unsubscribeCoordinator = coordinator.subscribe(notify);
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  function refresh() { if (!isValid()) dispose(); else notify(); }
  function begin(kind) {
    if (typeof kind !== 'string' || !kind) throw new TypeError('Operation kind is required.');
    if (!isValid()) { dispose(); return null; }
    if (active) return null;
    const record = { kind, controller: new AbortController() };
    // Set first: notification during claim may reenter this controller.
    active = record;
    if (!coordinator.claim(key, record)) { active = null; notify(); return null; }
    // A listener may invalidate/dispose while coordinator broadcasts the claim.
    if (active !== record || !isValid()) { if (active === record) dispose(); return null; }
    notify();
    if (active !== record || !isValid()) { if (active === record) dispose(); return null; }
    return Object.freeze({
      signal: record.controller.signal,
      current() { if (!isValid()) { dispose(); return false; } return active === record; },
      claimDocument(next) {
        validateKey(next);
        if (!isValid()) { dispose(); return false; }
        if (active !== record || !coordinator.claim(next, record)) return false;
        if (!isValid()) { dispose(); return false; }
        return active === record;
      },
      setDocument(next) {
        validateKey(next);
        if (!isValid()) { dispose(); return false; }
        if (active !== record || !coordinator.claim(next, record)) return false;
        if (!isValid()) { dispose(); return false; }
        if (active !== record) return false;
        key = next; notify();
        if (!isValid()) { dispose(); return false; }
        return active === record;
      },
      finish() { finish(record, false); }
    });
  }
  function setDocument(next) {
    validateKey(next);
    if (!isValid()) { dispose(); return false; }
    if (active) return false;
    key = next; notify(); return true;
  }
  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener must be a function.');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function bindControl(element, { disabled = () => false } = {}) {
    if (!element || typeof disabled !== 'function') throw new TypeError('A control and disabled predicate are required.');
    function update() {
      let extra = true;
      try { extra = !!disabled(); } catch {}
      const off = state().busy || extra;
      if ('disabled' in element) element.disabled = off;
      else element.setAttribute('aria-disabled', String(off));
    }
    const unsubscribe = subscribe(update);
    update();
    return unsubscribe;
  }
  return Object.freeze({ begin, setDocument, refresh, dispose, subscribe, bindControl, get state() { return state(); }, get busy() { return state().busy; } });
}
