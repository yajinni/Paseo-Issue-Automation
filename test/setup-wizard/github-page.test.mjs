import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getGitHubSetupPageStatus,
  recheckGitHubSetupPage,
  runGitHubSetupAccountAction,
  saveGitHubSetupPage,
} from '../../src/setup-wizard/github-page-service.mjs';
import { loadSetupSessionStore, startSetupSession } from '../../src/setup-wizard/store.mjs';

function root(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'github-page-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  return rootDir;
}

function accountStatus(login = 'octo') {
  return {
    cli: { installed: true, path: '/test/gh', version: 'gh version test', guidance: {} },
    auth: {
      ok: true,
      accounts: [{ host: 'github.com', login, active: true, state: 'active' }],
      activeAccount: { host: 'github.com', login, active: true, state: 'active' },
      activeAccounts: { 'github.com': { host: 'github.com', login, active: true } },
      hosts: ['github.com'],
      message: null,
    },
  };
}

const goodRepo = {
  id: 'R1', name: 'app', owner: 'octo', nameWithOwner: 'octo/app', url: 'https://github.com/octo/app',
  visibility: 'PRIVATE', defaultBranch: 'main', selectable: true, disabledReasons: [],
};
const archivedRepo = {
  id: 'R2', name: 'old', owner: 'octo', nameWithOwner: 'octo/old', url: 'https://github.com/octo/old',
  visibility: 'PRIVATE', defaultBranch: 'main', selectable: false,
  disabledReasons: [{ code: 'repository-archived', message: 'Archived repositories cannot be automated.' }],
};
function repos() { return { ok: true, repositories: [goodRepo, archivedRepo], blocker: null }; }
function branches(repository) {
  assert.equal(repository, 'octo/app');
  return {
    ok: true,
    repository,
    recommended: 'main',
    branches: [
      { name: 'feature', recommended: false, selectable: true },
      { name: 'main', recommended: true, selectable: true },
    ],
    blocker: null,
  };
}

test('repository selection loads branches, defaults to the recommended branch, and completes the page', (t) => {
  const rootDir = root(t);
  const options = { rootDir, accountStatus: () => accountStatus(), repositoryLoader: repos, branchLoader: branches };
  const initial = getGitHubSetupPageStatus(options);
  assert.equal(initial.selection.account, 'octo');
  assert.equal(initial.repositories.length, 2);
  assert.equal(initial.check.ok, false);

  const saved = saveGitHubSetupPage({ repository: 'octo/app' }, options);
  assert.equal(saved.selection.repository, 'octo/app');
  assert.equal(saved.selection.baseBranch, 'main');
  assert.equal(saved.recommendedBranch, 'main');
  assert.equal(saved.check.ok, true);
  const session = loadSetupSessionStore({ rootDir }).activeSession;
  assert.deepEqual(session.repository, { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' });
  assert.equal(session.baseBranch, 'main');
  assert.equal(session.pages.repository.completed, true);
});

test('unavailable repositories remain visible but cannot complete setup', (t) => {
  const rootDir = root(t);
  const options = { rootDir, accountStatus: () => accountStatus(), repositoryLoader: repos, branchLoader: branches };
  const saved = saveGitHubSetupPage({ repository: 'octo/old' }, options);
  assert.equal(saved.repositories.find((repo) => repo.nameWithOwner === 'octo/old').selectable, false);
  assert.equal(saved.check.ok, false);
  assert.equal(saved.check.blockers[0].code, 'github-repository-not-automatable');
});

test('account change invalidates page repository and branch selections on recheck', (t) => {
  const rootDir = root(t);
  let login = 'octo';
  let repositoryList = repos();
  const options = {
    rootDir,
    accountStatus: () => accountStatus(login),
    repositoryLoader: () => repositoryList,
    branchLoader: branches,
  };
  saveGitHubSetupPage({ repository: 'octo/app' }, options);
  login = 'other';
  repositoryList = { ok: true, repositories: [], blocker: null };
  const checked = recheckGitHubSetupPage(options);
  assert.equal(checked.selection.account, 'other');
  assert.equal(checked.selection.repository, '');
  assert.equal(checked.selection.baseBranch, '');
  assert.equal(checked.check.ok, false);
});

test('SSO catalog blockers remain actionable without hiding authentication state', (t) => {
  const rootDir = root(t);
  const options = {
    rootDir,
    accountStatus: () => accountStatus(),
    repositoryLoader: () => ({
      ok: false,
      repositories: [],
      blocker: {
        code: 'sso-authorization-required',
        message: 'GitHub access is blocked by organization SSO authorization.',
        recoveryAction: 'Authorize the active GitHub CLI account for the organization, then refresh repositories.',
      },
    }),
  };
  const status = getGitHubSetupPageStatus(options);
  assert.equal(status.auth.activeAccount.login, 'octo');
  assert.equal(status.catalogBlocker.code, 'sso-authorization-required');
  assert.match(status.catalogBlocker.recoveryAction, /Authorize/);
});

test('account actions delegate to the GitHub CLI account adapter and refresh state', (t) => {
  const rootDir = root(t);
  let called = null;
  const options = {
    rootDir,
    accountStatus: () => accountStatus(),
    repositoryLoader: repos,
    addAccount: ({ host }) => { called = ['add', host]; return { ok: true, verified: true }; },
  };
  const result = runGitHubSetupAccountAction({ action: 'add', host: 'github.com' }, options);
  assert.deepEqual(called, ['add', 'github.com']);
  assert.equal(result.result.ok, true);
  assert.equal(result.status.auth.activeAccount.login, 'octo');
});
