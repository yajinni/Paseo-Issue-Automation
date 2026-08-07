import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getWorkspaceSetupPageStatus,
  prepareWorkspaceSetupPage,
  recheckWorkspaceSetupPage,
} from '../../src/setup-wizard/workspace-page-service.mjs';
import { loadSetupSessionStore, saveSetupPage, startSetupSession } from '../../src/setup-wizard/store.mjs';

function setup(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'workspace-page-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  saveSetupPage('paseo', { selections: { host: '127.0.0.1:6767' } }, { rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' },
    baseBranch: 'main',
    selections: { host: 'github.com', account: 'octo', repository: 'octo/app', baseBranch: 'main' },
  }, { rootDir });
  return rootDir;
}

function credentialStore() { return { async read() { return { password: 'session-only' }; } }; }
function contextFactory({ host, password }) { return { host, authenticated: Boolean(password), command() { return { ok: true, stdout: '{}' }; } }; }
function emptyDiscovery() { return { candidates: [], valid: [], searchedPaths: ['/known/a'] }; }
function workspaceSuccess() {
  return {
    ok: true,
    workspace: { workspace: { id: 'ws-1', path: '/managed/octo--app' }, found: true },
    readiness: { ok: true, paidModelRequestSent: false, cleanup: { pathRemoved: true, branchRemoved: true, directoryRemoved: true } },
    blocker: null,
  };
}

test('no safe checkout automatically creates a managed clone and verifies both wizard gates', async (t) => {
  const rootDir = setup(t);
  let checkoutCalls = 0;
  const options = {
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    discover: emptyDiscovery,
    ensureCheckout() {
      checkoutCalls += 1;
      return { status: 'cloned', checkout: { path: '/managed/octo--app', remote: 'https://github.com/octo/app.git', managed: true, valid: true, safe: true, reasons: [] }, registration: { path: '/managed/octo--app' } };
    },
    ensureWorkspace: workspaceSuccess,
  };
  const result = await prepareWorkspaceSetupPage({}, options);
  assert.equal(checkoutCalls, 1);
  assert.equal(result.selection.checkoutPath, '/managed/octo--app');
  assert.equal(result.selection.checkoutManaged, true);
  assert.equal(result.selection.workspaceId, 'ws-1');
  assert.equal(result.checkoutCheck.ok, true);
  assert.equal(result.workspaceCheck.ok, true);
  assert.equal(result.technicalDetails.paidModelRequestSent, false);
  const session = loadSetupSessionStore({ rootDir }).activeSession;
  assert.equal(session.pages.checkout.completed, true);
  assert.equal(session.pages.workspace.completed, true);
  assert.deepEqual(session.managedCheckout, { path: '/managed/octo--app', managed: true, workspaceId: 'ws-1' });
});

test('multiple safe checkouts require a choice and never mutate either checkout', async (t) => {
  const rootDir = setup(t);
  let workspaceCalls = 0;
  const candidateA = { path: '/repo/a', valid: true, safe: true, managed: false, reasons: [] };
  const candidateB = { path: '/repo/b', valid: true, safe: true, managed: false, reasons: [] };
  const result = await prepareWorkspaceSetupPage({}, {
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    discover: () => ({ candidates: [candidateA, candidateB], valid: [candidateA, candidateB], searchedPaths: ['/repo/a', '/repo/b'] }),
    ensureCheckout: () => ({
      status: 'choice-required', candidates: [candidateA, candidateB], choices: [candidateA, candidateB],
      blocker: { code: 'checkout-choice-required', message: 'Multiple safe checkouts match this repository.', recoveryAction: 'Choose the checkout Paseo should manage.' },
    }),
    ensureWorkspace() { workspaceCalls += 1; return workspaceSuccess(); },
  });
  assert.equal(result.checkoutCheck.ok, false);
  assert.equal(result.checkoutCheck.blockers[0].code, 'checkout-choice-required');
  assert.equal(workspaceCalls, 0);
});

test('dirty user clone is reported by status and no preparation action runs during read-only discovery', (t) => {
  const rootDir = setup(t);
  let mutated = false;
  const dirty = { path: '/home/user/app', valid: false, safe: false, dirty: true, managed: false, reasons: [{ code: 'checkout-dirty', message: 'Checkout has uncommitted or untracked work and will not be modified.' }] };
  const status = getWorkspaceSetupPageStatus({
    rootDir,
    discover: () => ({ candidates: [dirty], valid: [], searchedPaths: ['/home/user/app'] }),
    ensureCheckout() { mutated = true; },
  });
  assert.equal(status.candidates[0].dirty, true);
  assert.match(status.candidates[0].reasons[0].message, /will not be modified/);
  assert.equal(status.automaticAction, 'clone-managed');
  assert.equal(mutated, false);
});

test('workspace failure keeps the registered checkout ready and is resumable', async (t) => {
  const rootDir = setup(t);
  const checkout = { path: '/managed/octo--app', remote: 'https://github.com/octo/app.git', managed: true, valid: true, safe: true, reasons: [] };
  let workspaceOk = false;
  const options = {
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    discover: () => ({ candidates: [checkout], valid: [checkout], searchedPaths: [checkout.path] }),
    validateCheckout: () => checkout,
    register: () => ({ path: checkout.path }),
    ensureWorkspace: () => workspaceOk ? workspaceSuccess() : ({ ok: false, blocker: { code: 'paseo-workspace-create-failed', message: 'Paseo could not create the permanent automation workspace.', recoveryAction: 'Retry.' } }),
  };
  let result = await prepareWorkspaceSetupPage({ checkoutPath: checkout.path }, options);
  assert.equal(result.checkoutCheck.ok, true);
  assert.equal(result.workspaceCheck.ok, false);
  assert.equal(result.selection.checkoutPath, checkout.path);
  workspaceOk = true;
  result = await recheckWorkspaceSetupPage(options);
  assert.equal(result.checkoutCheck.ok, true);
  assert.equal(result.workspaceCheck.ok, true);
  assert.equal(result.selection.workspaceId, 'ws-1');
});
