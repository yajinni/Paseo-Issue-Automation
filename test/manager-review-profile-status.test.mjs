import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerReviewProfileStatus } from '../src/manager-review-profile-status.mjs';
import { saveSetupSessionStore } from '../src/setup-wizard/store.mjs';

function tempRoot(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-manager-review-profile-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

function savedReviewSession(rootDir, {
  repository = 'example/repo',
  workflow = 'quick-web-chatgpt',
  conversationUrl = 'https://chatgpt.com/c/example',
  ok = true,
} = {}) {
  const [owner, name] = repository.split('/');
  saveSetupSessionStore({
    version: 1,
    activeSession: null,
    completedSessions: [{
      id: 'completed-review-setup',
      status: 'completed',
      currentPage: 'readiness',
      repository: { owner, name },
      pages: {
        review: {
          selections: { workflow, conversationUrl, reviewChatMode: 'existing' },
          lastCheck: {
            ok,
            checkedAt: '2026-08-07T10:00:00.000Z',
            summary: ok ? 'Review workflow and selected full-review method are ready.' : 'ChatGPT Profile needs attention.',
            blockers: ok ? [] : [{ code: 'chatgpt-profile-not-ready', message: 'Recheck ChatGPT Profile.' }],
          },
          completed: ok,
          updatedAt: '2026-08-07T10:00:00.000Z',
        },
      },
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
      completedAt: '2026-08-07T10:00:00.000Z',
    }],
  }, { rootDir });
}

test('ChatGPT Profile is explicitly not required outside Web ChatGPT workflow', () => {
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-manual' } });
  assert.equal(status.required, false);
  assert.equal(status.ready, null);
  assert.equal(status.passwordStored, false);
});

test('Web ChatGPT reports unknown and not ready when no saved repository verification exists', (t) => {
  const rootDir = tempRoot(t);
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, { rootDir });
  assert.equal(status.required, true);
  assert.equal(status.known, false);
  assert.equal(status.ready, false);
  assert.equal(status.setupPath, '/setup/review');
});

test('manager reuses a successful saved Review setup verification for the same repository', (t) => {
  const rootDir = tempRoot(t);
  savedReviewSession(rootDir);
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, { rootDir });
  assert.equal(status.required, true);
  assert.equal(status.known, true);
  assert.equal(status.repositoryMatches, true);
  assert.equal(status.conversationUrlConfigured, true);
  assert.equal(status.ready, true);
  assert.equal(status.checkedAt, '2026-08-07T10:00:00.000Z');
  assert.deepEqual(status.blockers, []);
  assert.equal(status.passwordStored, false);
});

test('saved verification for a different repository is never reused', (t) => {
  const rootDir = tempRoot(t);
  savedReviewSession(rootDir, { repository: 'example/other' });
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, { rootDir });
  assert.equal(status.known, false);
  assert.equal(status.ready, false);
  assert.equal(status.repositoryMatches, false);
});

test('failed saved verification exposes only non-secret blocker guidance', (t) => {
  const rootDir = tempRoot(t);
  savedReviewSession(rootDir, { ok: false });
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, { rootDir });
  assert.equal(status.known, true);
  assert.equal(status.ready, false);
  assert.deepEqual(status.blockers, [{
    code: 'chatgpt-profile-not-ready',
    message: 'Recheck ChatGPT Profile.',
    recoveryAction: null,
  }]);
  assert.equal(status.passwordStored, false);
});
