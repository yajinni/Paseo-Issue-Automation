import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  managerHarnessCatalog,
  managerPaseoConnectionStatus,
} from '../src/manager-paseo-configuration.mjs';
import { loadManagerPaseoConnection } from '../src/manager-paseo-connections.mjs';

function fixture(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-manager-connection-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return {
    rootDir,
    context: {
      root: rootDir,
      repository: { id: 'julies-dashboard-test', repository: 'yajinni/JuliesDashboard' },
    },
  };
}

test('manager auto-discovers and persists a Paseo connection without setup-session history', async (t) => {
  const { rootDir, context } = fixture(t);
  const status = await managerPaseoConnectionStatus(context, {
    rootDir,
    paseoContextFactory: ({ host }) => ({ host }),
    probePaseo: (connection) => ({
      ok: true,
      host: connection.host,
      cli: { ok: true, path: 'C:\\Users\\tester\\.local\\bin\\paseo.cmd' },
      daemon: { reachable: true, version: '1.0.0' },
      authentication: { required: false, supplied: false, ok: true },
      compatibility: { ok: true, reason: null },
    }),
  });

  assert.equal(status.ok, true);
  assert.equal(status.source, 'automatic discovery');
  assert.ok(status.host);
  assert.equal(loadManagerPaseoConnection(context.repository, { rootDir }).host, status.host);
});

test('harness discovery uses the durable manager connection when setup history is absent', async (t) => {
  const { rootDir, context } = fixture(t);
  await managerPaseoConnectionStatus(context, {
    rootDir,
    paseoContextFactory: ({ host }) => ({ host }),
    probePaseo: (connection) => ({
      ok: true,
      host: connection.host,
      cli: { ok: true },
      daemon: { reachable: true },
      authentication: { required: false, ok: true },
      compatibility: { ok: true },
    }),
  });

  let usedHost = null;
  const result = await managerHarnessCatalog(context, {
    rootDir,
    paseoContextFactory: ({ host }) => {
      usedHost = host;
      return { command: () => ({ ok: true, stdout: '[]', stderr: '' }) };
    },
    catalogLoader: async () => ({
      providers: [{ id: 'opencode', label: 'OpenCode', status: 'available', models: [] }],
      errors: [],
      complete: true,
      elapsedMs: 1,
    }),
  });

  assert.equal(result.host, loadManagerPaseoConnection(context.repository, { rootDir }).host);
  assert.equal(usedHost, result.host);
  assert.deepEqual(result.catalog.providers.map((provider) => provider.id), ['opencode']);
});
