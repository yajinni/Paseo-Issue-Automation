import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setupWizardApiRequest } from '../../src/setup-wizard/api.mjs';
import {
  loadSetupSessionStore,
  saveSetupPage,
  setupSessionFile,
  startSetupSession,
} from '../../src/setup-wizard/store.mjs';

function temporaryManager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-setup-wizard-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return { rootDir };
}

test('setup session persists machine-local non-secret selections and resumes current progress', (t) => {
  const options = temporaryManager(t);
  const started = startSetupSession(options);
  assert.equal(started.currentPage, 'paseo');

  let response = setupWizardApiRequest({
    method: 'POST',
    pathname: '/api/setup/session/page',
    body: { pageId: 'paseo', selections: { host: 'http://127.0.0.1:9000', rememberConnection: true } },
  }, options);
  assert.equal(response.status, 200);
  assert.equal(response.body.session.pages.paseo.selections.host, 'http://127.0.0.1:9000');

  response = setupWizardApiRequest({
    method: 'POST',
    pathname: '/api/setup/session/recheck',
    body: { pageId: 'paseo' },
  }, {
    ...options,
    recheckSetupPage: () => ({ ok: true, summary: 'Paseo ready', blockers: [] }),
  });
  assert.equal(response.body.check.ok, true);

  response = setupWizardApiRequest({
    method: 'POST',
    pathname: '/api/setup/session/navigate',
    body: { direction: 'forward' },
  }, options);
  assert.equal(response.body.session.currentPage, 'harness');

  const resumed = setupWizardApiRequest({ method: 'GET', pathname: '/api/setup/session' }, options);
  assert.equal(resumed.body.activeSession.id, started.id);
  assert.equal(resumed.body.activeSession.currentPage, 'harness');
});

test('setup session rejects secret-shaped persisted fields at every page boundary', (t) => {
  const options = temporaryManager(t);
  startSetupSession(options);
  for (const selections of [
    { password: 'do-not-store' },
    { nested: { githubToken: 'do-not-store' } },
    { browser: { cookie: 'do-not-store' } },
    { apiKey: 'do-not-store' },
  ]) {
    assert.throws(() => saveSetupPage('paseo', { selections }, options), /cannot persist secret field/);
  }
  const serialized = JSON.stringify(loadSetupSessionStore(options));
  assert.equal(serialized.includes('do-not-store'), false);
});

test('failed recheck invalidates only the affected page and returns typed blockers', (t) => {
  const options = temporaryManager(t);
  startSetupSession(options);
  const okChecker = () => ({ ok: true, summary: 'ready', blockers: [] });
  for (const pageId of ['paseo', 'harness']) {
    setupWizardApiRequest({ method: 'POST', pathname: '/api/setup/session/recheck', body: { pageId } }, {
      ...options,
      recheckSetupPage: okChecker,
    });
  }

  const failed = setupWizardApiRequest({
    method: 'POST',
    pathname: '/api/setup/session/recheck',
    body: { pageId: 'harness' },
  }, {
    ...options,
    recheckSetupPage: () => ({
      ok: false,
      summary: 'Harness unavailable',
      blockers: [{ code: 'harness-unavailable', message: 'Selected harness is unavailable.', recoveryAction: 'Open Paseo' }],
    }),
  });
  assert.equal(failed.body.session.pages.paseo.completed, true);
  assert.equal(failed.body.session.pages.harness.completed, false);
  assert.equal(failed.body.check.blockers[0].code, 'harness-unavailable');
});

test('one setup session cannot switch from repository A to repository B', (t) => {
  const options = temporaryManager(t);
  startSetupSession(options);
  saveSetupPage('repository', { repository: { owner: 'example', name: 'repo-a' } }, options);
  assert.throws(
    () => saveSetupPage('repository', { repository: { owner: 'example', name: 'repo-b' } }, options),
    /cannot switch repositories/,
  );
});

test('corrupt setup state fails closed and reset does not touch repository state', (t) => {
  const options = temporaryManager(t);
  writeFileSync(setupSessionFile(options), '{broken json', 'utf8');
  assert.throws(() => loadSetupSessionStore(options), /corrupt/);

  const reset = setupWizardApiRequest({ method: 'POST', pathname: '/api/setup/session/reset' }, options);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.activeSession, null);
  assert.deepEqual(reset.body.completedSessions, []);
});

test('forward navigation is blocked until the current page check passes', (t) => {
  const options = temporaryManager(t);
  startSetupSession(options);
  const blocked = setupWizardApiRequest({
    method: 'POST',
    pathname: '/api/setup/session/navigate',
    body: { direction: 'forward' },
  }, options);
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.code, 'setup-request-invalid');
  assert.match(blocked.body.error.message, /must pass its requirements/);
});
