// Keys are explicit, session-scoped document identities supplied by the host.
// A coordinator contains active claims only; it never retains document data.
function validateTreeKey(key) {
  // These are canonical storage paths, not URLs: never decode or normalize a
  // path here. Apps obtain the path from their storage service before claiming.
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*:\//.test(key)) {
    throw new TypeError('A document tree needs a namespace and canonical absolute path.');
  }
  const path = key.slice(key.indexOf(':/') + 1);
  if (path.includes('\0') || (path !== '/' && path.slice(1).split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new TypeError('A document tree needs a canonical absolute path.');
  }
  return key;
}

function withinTree(tree, key) {
  return key.startsWith(tree.endsWith('/') ? tree : tree + '/');
}

function overlaps(key, subtree, otherKey, otherSubtree) {
  return key === otherKey || (subtree && withinTree(key, otherKey)) || (otherSubtree && withinTree(otherKey, key));
}

export function createDocumentOperationCoordinator() {
  const claims = new Map();
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch {} } };
  function available(key, owner, subtree = false) {
    if (key == null) return true;
    for (const [otherKey, holder] of claims) {
      if (holder.owner !== owner && overlaps(key, subtree, otherKey, holder.subtree)) return false;
    }
    return true;
  }
  function claim(key, owner, subtree = false) {
    if (key == null) return true;
    if (!available(key, owner, subtree)) return false;
    const previous = claims.get(key);
    if (!previous || (subtree && !previous.subtree)) {
      claims.set(key, {owner, subtree});
      notify();
    }
    return true;
  }
  return Object.freeze({
    available,
    claim,
    claimTree(key, owner) { return claim(validateTreeKey(key), owner, true); },
    release(owner) {
      let changed = false;
      for (const [key, holder] of claims) if (holder.owner === owner) { claims.delete(key); changed = true; }
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
    return Object.freeze({ busy: !!active || !usable || !coordinator.available(key, active), kind: active?.kind ?? null, phase: active?.phase ?? null, disposed: !usable });
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
    const record = { kind, phase: 'prepare', controller: new AbortController() };
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
      // Enter immediately before the local mutation. Keep the owned phase until
      // finish(), including receipt delivery and accepted baseline publication.
      // Peer contention and background server synchronization are not this phase.
      enterLocalWrite() {
        if (!isValid()) { dispose(); return false; }
        if (active !== record) return false;
        if (record.phase !== 'local-write') { record.phase = 'local-write'; notify(); }
        // Notifications may dispose/replace ownership before the caller writes.
        if (!isValid()) { dispose(); return false; }
        return active === record;
      },
      claimDocument(next) {
        validateKey(next);
        if (!isValid()) { dispose(); return false; }
        if (active !== record || !coordinator.claim(next, record)) return false;
        if (!isValid()) { dispose(); return false; }
        return active === record;
      },
      claimDocumentTree(next) {
        validateTreeKey(next);
        if (!isValid()) { dispose(); return false; }
        if (active !== record || !coordinator.claimTree(next, record)) return false;
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
  // Advisory only; actions must still begin and acquire claims synchronously.
  function canClaimDocument(next) {
    validateKey(next);
    return !state().busy && coordinator.available(next, null);
  }
  function canClaimDocumentTree(next) {
    validateTreeKey(next);
    return !state().busy && coordinator.available(next, null, true);
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
  return Object.freeze({ begin, setDocument, canClaimDocument, canClaimDocumentTree, refresh, dispose, subscribe, bindControl, get state() { return state(); }, get busy() { return state().busy; } });
}
