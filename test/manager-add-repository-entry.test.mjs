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
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-manager-add-repo-'));
  const repositoryRoot = path.join(rootDir, 'Configured');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:example/Configured.git'], { cwd: repositoryRoot });
  addRepository(repositoryRoot, { rootDir });
  const config = loadConfig(repositoryRoot);
  saveConfig(repositoryRoot, { ...config, setupComplete: true, baseBranch: 'main' });
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

test('configured manager promotes setup walkthrough and demotes manual path registration', async (t) => {
  const rootDir = configuredManager(t);
  const { server, url } = await startManagerServer({
    port: 0,
    rootDir,
    workerManager: fakeWorkers(),
    reviewWorkerManager: fakeWorkers(),
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${url}/`);
  assert.equal(response.status, 200);
  const html = await response.text();

  const setupAnchor = /<a href="\/setup" data-manager-setup-link class="manager-setup-link">Add repository via setup<\/a>/g;
  assert.equal((html.match(setupAnchor) || []).length, 1);
  assert.match(html, /class="manager-setup-link">Add repository via setup<\/a>/);
  assert.doesNotMatch(html, /position:fixed;right:18px;bottom:18px/);
  assert.match(html, /data-manager-manual-registration/);
  assert.match(html, /<summary>Advanced manual registration<\/summary>/);
  assert.match(html, /Compatibility and recovery only/);
  assert.match(html, /does not run the setup walkthrough/);
  assert.match(html, /id="register-form"/);
  assert.match(html, /Register repository/);
});
