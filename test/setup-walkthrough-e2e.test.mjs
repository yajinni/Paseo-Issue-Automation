import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startManagerServer } from '../src/manager-server.mjs';
import { SETUP_PAGE_CATALOG } from '../src/setup-wizard/store.mjs';

function tempManager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-walkthrough-e2e-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

async function request(url, pathname, options = {}) {
  return fetch(`${url}${pathname}`, { redirect: 'manual', ...options });
}

test('first standalone-manager run outside a Git repository enters the walkthrough without live services', async (t) => {
  const rootDir = tempManager(t);
  const { server, url } = await startManagerServer({ port: 0, rootDir });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const root = await request(url, '/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/setup');

  const setup = await request(url, '/setup');
  assert.equal(setup.status, 200);
  const html = await setup.text();
  assert.match(html, /Paseo/i);
  assert.match(html, /Final readiness/i);
  assert.match(html, /Recheck/i);
  assert.match(html, /Back/i);

  for (const page of SETUP_PAGE_CATALOG) {
    assert.match(html, new RegExp(`data-page-id=["']${page.id}["']`));
  }
});

test('every explicit walkthrough page is reloadable and unknown setup routes fail closed', async (t) => {
  const rootDir = tempManager(t);
  const { server, url } = await startManagerServer({ port: 0, rootDir });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const page of SETUP_PAGE_CATALOG) {
    const response = await request(url, `/setup/${page.id}`);
    assert.equal(response.status, 200, page.id);
    const html = await response.text();
    assert.match(html, new RegExp(`data-requested-page=["']${page.id}["']`));
  }

  const unknown = await request(url, '/setup/not-a-real-page');
  assert.equal(unknown.status, 404);
});

test('release package manager script uses the bare standalone-manager entrypoint', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts.manager, 'node ./bin/paseo-issue-automation.mjs');
});

test('default release validation remains offline for ChatGPT and paid model execution', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /PASEO_PASSWORD\s*:/i);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY\s*:/i);
  assert.doesNotMatch(workflow, /ANTHROPIC_API_KEY\s*:/i);
  assert.doesNotMatch(workflow, /GEMINI_API_KEY\s*:/i);
  assert.doesNotMatch(workflow, /paseo\s+run\b/i);
  assert.doesNotMatch(workflow, /browser\s+(login|test)\b/i);
});
