import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryCredentialBackend,
  createPaseoCredentialStore,
  createSecretToolCredentialBackend,
  credentialStatusForApi,
  detectPersistentCredentialBackend,
} from '../../src/setup-wizard/paseo-credentials.mjs';

function fakePersistentBackend({ available = true } = {}) {
  const values = new Map();
  return {
    id: 'fake-secure-store',
    persistent: true,
    probeCalls: 0,
    async probe() {
      this.probeCalls += 1;
      return { available, persistent: true, reason: available ? 'ready' : 'unavailable' };
    },
    async read(host) { return values.get(host) || null; },
    async write(host, password) { values.set(host, password); return true; },
    async delete(host) { return values.delete(host); },
  };
}

test('persistent storage is used only after a secure backend probe succeeds', async () => {
  const persistent = fakePersistentBackend({ available: true });
  const session = createMemoryCredentialBackend({ credentials: new Map() });
  const store = createPaseoCredentialStore({ persistentBackend: persistent, sessionBackend: session });
  const status = await store.status();
  assert.equal(status.persistentAvailable, true);
  assert.equal(persistent.probeCalls, 1);

  const stored = await store.write('localhost:6767', 'secure-value', { remember: true });
  assert.deepEqual(stored, { stored: true, persistent: true, backend: 'fake-secure-store' });
  const read = await store.read('localhost:6767');
  assert.equal(read.password, 'secure-value');
  assert.equal(read.persistent, true);
  await store.forget('localhost:6767');
  assert.equal(await store.read('localhost:6767'), null);
});

test('session-only fallback works when persistent backend is unavailable', async () => {
  const persistent = fakePersistentBackend({ available: false });
  const session = createMemoryCredentialBackend({ credentials: new Map() });
  const store = createPaseoCredentialStore({ persistentBackend: persistent, sessionBackend: session });
  const stored = await store.write('localhost:6767', 'session-value', { remember: true });
  assert.equal(stored.persistent, false);
  assert.equal(stored.backend, 'session-memory');
  assert.equal((await store.read('localhost:6767')).password, 'session-value');
  const apiStatus = credentialStatusForApi(await store.status());
  assert.equal(apiStatus.persistentAvailable, false);
  assert.equal(JSON.stringify(apiStatus).includes('session-value'), false);
});

test('remember false always uses session memory even when persistent storage is ready', async () => {
  const persistent = fakePersistentBackend({ available: true });
  const session = createMemoryCredentialBackend({ credentials: new Map() });
  const store = createPaseoCredentialStore({ persistentBackend: persistent, sessionBackend: session });
  const stored = await store.write('localhost:6767', 'temporary', { remember: false });
  assert.equal(stored.persistent, false);
  const read = await store.read('localhost:6767');
  assert.equal(read.password, 'temporary');
  assert.equal(read.persistent, false);
});

test('Linux secret-tool backend sends the password through stdin, never arguments', async () => {
  const calls = [];
  const values = new Map();
  const runner = (_executable, args, options = {}) => {
    calls.push({ args: [...args], input: options.input });
    const daemonIndex = args.indexOf('daemon');
    const host = daemonIndex >= 0 ? args[daemonIndex + 1] : '';
    if (args[0] === 'store') {
      values.set(host, String(options.input || '').trimEnd());
      return { ok: true, stdout: '', stderr: '' };
    }
    if (args[0] === 'lookup') return { ok: true, stdout: values.get(host) || '', stderr: '' };
    if (args[0] === 'clear') { values.delete(host); return { ok: true, stdout: '', stderr: '' }; }
    return { ok: false, stdout: '', stderr: 'unexpected' };
  };
  const backend = createSecretToolCredentialBackend({ executable: '/usr/bin/secret-tool', runner, env: {} });
  const password = 'stdin-only-password';
  await backend.write('localhost:6767', password);
  assert.equal(await backend.read('localhost:6767'), password);
  for (const call of calls) assert.equal(call.args.some((arg) => String(arg).includes(password)), false);
  assert.ok(calls.some((call) => String(call.input || '').includes(password)));
});

test('persistent backend detection remains session-only on platforms without a safe adapter', () => {
  assert.equal(detectPersistentCredentialBackend({ platform: 'win32' }), null);
  assert.equal(detectPersistentCredentialBackend({ platform: 'darwin' }), null);
  assert.equal(detectPersistentCredentialBackend({
    platform: 'linux',
    resolver: () => ({ available: false }),
  }), null);
});

test('daemon identity keys reject password-bearing hosts', async () => {
  const session = createMemoryCredentialBackend({ credentials: new Map() });
  await assert.rejects(() => session.write('tcp://localhost:6767?password=nope', 'value'), /must not|non-secret/);
});
