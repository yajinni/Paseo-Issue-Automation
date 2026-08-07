import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { githubSetupPageApiRequest } from '../../src/setup-wizard/github-page-api.mjs';
import { issuesSetupPageApiRequest } from '../../src/setup-wizard/issues-page-api.mjs';
import { paseoSetupPageApiRequest } from '../../src/setup-wizard/paseo-page-api.mjs';
import { reviewSetupPageApiRequest } from '../../src/setup-wizard/review-page-api.mjs';
import {
  loadSetupSessionStore,
  saveSetupPage,
  startSetupSession,
} from '../../src/setup-wizard/store.mjs';

function manager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'setup-auto-check-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  return rootDir;
}

function completed(rootDir, pageId) {
  return loadSetupSessionStore({ rootDir }).activeSession.pages[pageId].completed;
}

test('ordinary Paseo status load records a successful check without Recheck', async (t) => {
  const rootDir = manager(t);
  const result = await paseoSetupPageApiRequest({ method: 'GET', pathname: '/api/setup/paseo/status' }, {
    rootDir,
    resolver: () => ({ available: true, path: '/test/paseo', source: 'path' }),
    credentialStore: {
      async status() { return { persistentAvailable: false, sessionAvailable: true }; },
      async read() { return null; },
    },
    contextFactory: ({ host }) => ({ host }),
    probe: (context) => ({
      ok: true,
      host: context.host,
      authentication: { required: false, supplied: false, ok: true },
      cli: { ok: true, version: '1.0.0', path: '/test/paseo' },
      daemon: { reachable: true, version: '1.0.0' },
      compatibility: { ok: true, reason: null },
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.check.ok, true);
  assert.equal(completed(rootDir, 'paseo'), true);
  assert.ok(loadSetupSessionStore({ rootDir }).activeSession.pages.paseo.selections.host);
});

test('ordinary GitHub status load records valid repository state and automatic Paseo project readiness', async (t) => {
  const rootDir = manager(t);
  saveSetupPage('paseo', { selections: { host: '127.0.0.1:6767' } }, { rootDir });
  saveSetupPage('repository', {
    selections: { host: 'github.com', account: 'example', repository: 'example/repo', baseBranch: 'main' },
  }, { rootDir });

  const result = await githubSetupPageApiRequest({ method: 'GET', pathname: '/api/setup/github/status' }, {
    rootDir,
    accountStatus: () => ({
      cli: { installed: true, path: '/test/gh', version: '2.0.0' },
      auth: {
        ok: true,
        activeAccount: { host: 'github.com', login: 'example' },
        accounts: [{ host: 'github.com', login: 'example', active: true }],
      },
    }),
    repositoryLoader: () => ({
      ok: true,
      repositories: [{
        id: '1', owner: 'example', name: 'repo', nameWithOwner: 'example/repo',
        url: 'https://github.com/example/repo', selectable: true, defaultBranch: 'main', disabledReasons: [],
      }],
    }),
    branchLoader: () => ({ ok: true, branches: [{ name: 'main', recommended: true }], recommended: 'main' }),
    contextFactory: () => ({}),
    ensurePaseoProjectWorkspace: () => ({
      ok: true,
      project: { id: 'project-1', name: 'repo', checkoutPath: '/safe/repo' },
      workspace: { id: 'workspace-1', name: 'Issue Coding Automation' },
      createdProject: false,
      createdWorkspace: false,
      blocker: null,
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.check.ok, true);
  assert.equal(result.body.paseoReady, true);
  assert.equal(result.body.paseo.workspaceName, 'Issue Coding Automation');
  assert.equal(completed(rootDir, 'repository'), true);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.repository.selections.checkoutPath, '/safe/repo');
});

test('ordinary Issues status load validates safe defaults and preview without Recheck', (t) => {
  const rootDir = manager(t);
  saveSetupPage('repository', { selections: { repository: 'example/repo', baseBranch: 'main' } }, { rootDir });
  saveSetupPage('checkout', { selections: { checkoutPath: '/safe/repo' } }, { rootDir });

  const result = issuesSetupPageApiRequest({ method: 'GET', pathname: '/api/setup/issues/status' }, {
    rootDir,
    previewLoader: () => ({
      labels: [],
      labelSummary: { missing: 0, reused: 0 },
      template: { path: '.github/ISSUE_TEMPLATE/automated-coding-task.md', status: 'current', setupPrChangeRequired: false, message: 'Current.' },
      directGitHubChanges: [],
      setupPullRequestChanges: [],
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.check.ok, true);
  assert.equal(completed(rootDir, 'issues'), true);
});

test('ordinary Review status load validates Quick to Manual defaults without Recheck', async (t) => {
  const rootDir = manager(t);
  const result = await reviewSetupPageApiRequest({ method: 'GET', pathname: '/api/setup/review/status' }, { rootDir });

  assert.equal(result.status, 200);
  assert.equal(result.body.check.ok, true);
  assert.equal(result.body.selection.workflow, 'quick-manual');
  assert.equal(completed(rootDir, 'review'), true);
});
