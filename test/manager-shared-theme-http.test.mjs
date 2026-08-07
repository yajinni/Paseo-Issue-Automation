import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startManagerServer } from '../src/manager-server.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { loadConfig, saveConfig } from '../src/state.mjs';

function fakeWorkers() {
  return { close() {} };
}

function configuredManager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-manager-theme-'));
  const repositoryRoot = path.join(rootDir, 'Configured');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:example/Configured.git'], { cwd: repositoryRoot });
  addRepository(repositoryRoot, { rootDir });
  const config = loadConfig(repositoryRoot);
  saveConfig(repositoryRoot, { ...config, setupComplete: true, baseBranch: 'main' });
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

test('configured manager and setup routes receive the shared Paseo theme', async (t) => {
  const rootDir = configuredManager(t);
  const { server, url } = await startManagerServer({
    port: 0,
    rootDir,
    workerManager: fakeWorkers(),
    reviewWorkerManager: fakeWorkers(),
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const dashboardResponse = await fetch(`${url}/`);
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.text();
  assert.match(dashboard, /data-paseo-ui-theme="manager"/);
  assert.match(dashboard, /data-manager-ui-foundation/);
  assert.match(dashboard, /--paseo-primary:#2f6fed/);
  assert.match(dashboard, /linear-gradient\(180deg,var\(--paseo-bg\),var\(--paseo-bg-bottom\)\)/);
  assert.match(dashboard, /data-manager-setup-link/);

  const setupResponse = await fetch(`${url}/setup/paseo`);
  assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.text();
  assert.match(setup, /data-paseo-ui-theme="setup"/);
  assert.match(setup, /--paseo-primary:#2f6fed/);
  assert.match(setup, /Setup walkthrough/);
});
