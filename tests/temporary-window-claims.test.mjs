import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from '../active-system/assets/desktop/app-instance.mjs';

test('two anonymous windows coordinate writes to one file until the session ends', t => {
  class View { classList = {contains: name => name === 'window-content'}; }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  globalThis.HTMLElement = View;
  t.after(() => { if (original) Object.defineProperty(globalThis, 'HTMLElement', original); else delete globalThis.HTMLElement; });
  let session = {public: {kind: 'anonymous', sub: 'tab-a'}};
  const host = {session: () => session, storage: {workspaceOwner: () => session.public.sub, signedInSubject: () => null}};
  const app = {mount: () => ({element: new View(), dispose() {}})};
  const first = mountApp(app, host);
  const second = mountApp(app, host);
  t.after(() => { first.dispose(); second.dispose(); });
  const path = 'temporary:/Documents/example.cad';
  const writer = first.documentOperations.begin('save');
  const reader = second.documentOperations.begin('open');
  assert.ok(writer.claimDocument(path));
  assert.equal(reader.claimDocument(path), false);
  writer.finish();
  assert.ok(reader.claimDocument(path));
  session = {public: {kind: 'anonymous', sub: 'tab-b'}};
  assert.equal(reader.current(), false);
  const next = mountApp(app, host);
  try { assert.ok(next.documentOperations.begin('open').claimDocument(path)); }
  finally { next.dispose(); }
});
