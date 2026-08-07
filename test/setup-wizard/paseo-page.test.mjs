import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  connectPaseoSetupPage,
  getPaseoSetupPageStatus,
  recheckPaseoSetupPage,
} from '../../src/setup-wizard/paseo-page-service.mjs';
import { loadSetupSessionStore, setupSessionFile, startSetupSession } from '../../src/setup-wizard/store.mjs';

function temporaryManager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-page-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  return rootDir;
}

function fakeCredentialStore({ persistentAvailable = true } = {}) {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    async status() {
      return {
        persistentAvailable,
        persistentBackend: persistentAvailable ? 'fake-secure' : null,
        sessionAvailable: true,
        sessionBackend: 'fake-session',
        reason: persistentAvailable ? 'Secure test backend.' : 'Session only.',
      };
    },
    async read(host) {
      const entry = values.get(host);
      return entry ? { ...entry } : null;
    },
    async write(host, password, { remember } = {}) {
      writes.push({ host, password, remember });
      const entry = { password, persistent: persistentAvailable && remember === true, backend: remember ? 'fake-secure' : 'fake-session' };
      values.set(host, entry);
      return { stored: true, ...entry };
    },
    async forget(host) {
      values.delete(host);
      return { forgotten: true };
    },
  };
}

function fakeResolver() {
  return { available: true, path: '/test/bin/paseo', source: 'path' };
}

function contextFactory({ host, password }) {
  return { host, password: password || null, authenticated: Boolean(password) };
}

function passwordProbe(expectedPassword = 'correct-horse') {
  return (context) => {
    const passwordNeeded = context.host === '127.0.0.1:6767';
    const authenticated = !passwordNeeded || context.password === expectedPassword;
    return {
      ok: authenticated,
      host: context.host,
      authentication: {
        required: passwordNeeded && !authenticated,
        supplied: Boolean(context.password),
        ok: authenticated,
      },
      cli: { ok: true, version: '1.2.3', path: '/test/bin/paseo' },
      daemon: { reachable: authenticated, version: '1.2.3' },
      compatibility: { ok: authenticated, reason: authenticated ? null : 'Authentication required.' },
      diagnostic: { stderr: context.password ? `rejected ${context.password}` : 'password required' },
    };
  };
}

test('automatic Paseo discovery exposes password UI state without leaking credentials', async (t) => {
  const rootDir = temporaryManager(t);
  const credentialStore = fakeCredentialStore();
  const status = await getPaseoSetupPageStatus({
    rootDir,
    credentialStore,
    resolver: fakeResolver,
    contextFactory,
    probe: passwordProbe(),
  });

  assert.equal(status.host, '127.0.0.1:6767');
  assert.equal(status.manualAllowed, false);
  assert.equal(status.passwordRequired, true);
  assert.equal(status.credential.persistentAvailable, true);
  assert.match(JSON.stringify(status.technicalDetails), /127\.0\.0\.1:6767/);
  assert.doesNotMatch(JSON.stringify(status.technicalDetails), /correct-horse/);
});

test('incorrect password preserves the discovered host and is never persisted', async (t) => {
  const rootDir = temporaryManager(t);
  const credentialStore = fakeCredentialStore();
  const result = await connectPaseoSetupPage({
    rootDir,
    host: '127.0.0.1:6767',
    password: 'wrong-password',
    remember: true,
    credentialStore,
    resolver: fakeResolver,
    contextFactory,
    probe: passwordProbe(),
  });

  assert.equal(result.check.ok, false);
  assert.equal(result.passwordRequired, true);
  assert.equal(credentialStore.writes.length, 0);
  const store = loadSetupSessionStore({ rootDir });
  assert.equal(store.activeSession.pages.paseo.selections.host, '127.0.0.1:6767');
  assert.equal(store.activeSession.pages.paseo.completed, false);
  const persisted = readFileSync(setupSessionFile({ rootDir }), 'utf8');
  assert.doesNotMatch(persisted, /wrong-password/);
});

test('successful authentication stores the password only in the credential backend', async (t) => {
  const rootDir = temporaryManager(t);
  const credentialStore = fakeCredentialStore();
  const result = await connectPaseoSetupPage({
    rootDir,
    host: '127.0.0.1:6767',
    password: 'correct-horse',
    remember: true,
    credentialStore,
    resolver: fakeResolver,
    contextFactory,
    probe: passwordProbe(),
  });

  assert.equal(result.check.ok, true);
  assert.equal(result.credential.savedForHost, true);
  assert.deepEqual(credentialStore.writes, [{ host: '127.0.0.1:6767', password: 'correct-horse', remember: true }]);
  const store = loadSetupSessionStore({ rootDir });
  assert.equal(store.activeSession.pages.paseo.completed, true);
  assert.equal(store.activeSession.pages.paseo.selections.host, '127.0.0.1:6767');
  const persisted = readFileSync(setupSessionFile({ rootDir }), 'utf8');
  assert.doesNotMatch(persisted, /correct-horse/);
});

test('page recheck reuses stored authentication and preserves the valid host', async (t) => {
  const rootDir = temporaryManager(t);
  const credentialStore = fakeCredentialStore({ persistentAvailable: false });
  await connectPaseoSetupPage({
    rootDir,
    host: '127.0.0.1:6767',
    password: 'correct-horse',
    remember: false,
    credentialStore,
    resolver: fakeResolver,
    contextFactory,
    probe: passwordProbe(),
  });

  const result = await recheckPaseoSetupPage({
    rootDir,
    credentialStore,
    resolver: fakeResolver,
    contextFactory,
    probe: passwordProbe(),
  });

  assert.equal(result.check.ok, true);
  assert.equal(result.host, '127.0.0.1:6767');
  assert.equal(result.authentication.ok, true);
  assert.equal(result.credential.savedForHost, false);
  assert.equal(result.credential.availableForSession, true);
});
