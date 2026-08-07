import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startManagerServer } from '../../src/manager-server.mjs';
import { addRepository } from '../../src/repository-registry.mjs';
import { loadConfig, saveConfig } from '../../src/state.mjs';
import {
  setupPageIdFromPath,
  setupPagePath,
  setupWizardHtml,
} from '../../src/setup-wizard/ui.mjs';

function temporaryManager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-setup-shell-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

function fakeWorkers() {
  return {
    close() {},
    list: () => [],
    managerStatus: () => null,
    drain() {},
    stop() {},
  };
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
  });
}

function createConfiguredRepository(rootDir) {
  const repositoryRoot = path.join(rootDir, 'Configured');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:example/Configured.git'], { cwd: repositoryRoot });
  addRepository(repositoryRoot, { rootDir });
  const config = loadConfig(repositoryRoot);
  saveConfig(repositoryRoot, { ...config, setupComplete: true, baseBranch: 'main' });
  return repositoryRoot;
}

test('setup shell has explicit progressive pages and no legacy-dashboard DOM transformation dependency', () => {
  const html = setupWizardHtml({ requestedPage: 'repository' });
  assert.match(html, /data-requested-page="repository"/);
  assert.match(html, /Setup walkthrough/);
  assert.match(html, /data-page="paseo"/);
  assert.match(html, /data-page="readiness"/);
  assert.match(html, /id="back"/);
  assert.match(html, /id="continue"/);
  assert.match(html, /id="recheck"/);
  assert.match(html, /Technical details/);
  assert.match(html, /addEventListener\('popstate'/);
  assert.match(html, /\/api\/setup\/session/);
  assert.doesNotMatch(html, /repository-select/);
  assert.doesNotMatch(html, /replace\([^)]*legacy/i);
});

test('setup route parsing accepts only the explicit page catalog', () => {
  assert.equal(setupPageIdFromPath('/setup'), null);
  assert.equal(setupPageIdFromPath('/setup/'), null);
  assert.equal(setupPageIdFromPath('/setup/paseo'), 'paseo');
  assert.equal(setupPageIdFromPath('/setup/readiness/'), 'readiness');
  assert.equal(setupPageIdFromPath('/setup/not-a-page'), undefined);
  assert.equal(setupPagePath('harness'), '/setup/harness');
  assert.throws(() => setupPagePath('unknown'), /Unknown setup page/);
});

test('first-run standalone manager redirects the dashboard root to setup and serves direct setup reloads', async (t) => {
  const rootDir = temporaryManager(t);
  const workers = fakeWorkers();
  const reviews = fakeWorkers();
  const { server, url } = await startManagerServer({
    port: 0,
    rootDir,
    workerManager: workers,
    reviewWorkerManager: reviews,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const root = await request(`${url}/`);
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, '/setup');

  const setup = await request(`${url}/setup`);
  assert.equal(setup.status, 200);
  assert.match(setup.headers['content-type'], /text\/html/);
  assert.match(setup.body, /data-requested-page="paseo"/);

  const direct = await request(`${url}/setup/harness`);
  assert.equal(direct.status, 200);
  assert.match(direct.body, /data-requested-page="harness"/);

  const unknown = await request(`${url}/setup/not-a-page`);
  assert.equal(unknown.status, 404);
});

test('configured manager keeps the existing dashboard and exposes rerun-setup entrypoint', async (t) => {
  const rootDir = temporaryManager(t);
  createConfiguredRepository(rootDir);
  const { server, url } = await startManagerServer({
    port: 0,
    rootDir,
    workerManager: fakeWorkers(),
    reviewWorkerManager: fakeWorkers(),
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const root = await request(`${url}/`);
  assert.equal(root.status, 200);
  assert.match(root.body, /id="repository-select"/);
  assert.match(root.body, /href="\/setup" data-manager-setup-link/);

  const rerun = await request(`${url}/setup/issues`);
  assert.equal(rerun.status, 200);
  assert.match(rerun.body, /data-requested-page="issues"/);
});

test('setup shell permits only current/completed pages in the browser and keeps history changes server-neutral', () => {
  const html = setupWizardHtml();
  assert.match(html, /function permitted\(page\)/);
  assert.match(html, /page===session\.currentPage/);
  assert.match(html, /\.completed===true/);
  assert.match(html, /popstate/);
  const popstateSection = html.slice(html.indexOf("addEventListener('popstate'"));
  assert.doesNotMatch(popstateSection, /\/navigate/);
});
