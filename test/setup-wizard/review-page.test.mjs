import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getReviewSetupPageStatus,
  openChatGptProfile,
  recheckReviewSetupPage,
  saveReviewChat,
  saveReviewSetupPage,
} from '../../src/setup-wizard/review-page-service.mjs';
import { loadSetupSessionStore, saveSetupPage, startSetupSession } from '../../src/setup-wizard/store.mjs';

const CHAT = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';

function setup(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'review-page-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'octo', name: 'app', id: 'R1', url: 'https://github.com/octo/app' },
    baseBranch: 'main',
    selections: { repository: 'octo/app', baseBranch: 'main' },
  }, { rootDir });
  return rootDir;
}

const verificationRequired = () => ({
  state: 'verification-required',
  ready: false,
  action: 'recheck',
  profileExists: true,
  conversationUrl: CHAT,
});

test('review page defaults to quick then manual with independent three-round limits', (t) => {
  const rootDir = setup(t);
  const status = getReviewSetupPageStatus({ rootDir });
  assert.deepEqual(status.selection, {
    workflow: 'quick-manual',
    quickMaxRounds: 3,
    fullMaxRounds: 3,
    conversationUrl: null,
    reviewChatMode: null,
    autoMergeApproved: false,
  });
  assert.equal(status.profile, null);
  assert.equal(status.check.ok, true);
  assert.equal(status.autoMerge.available, false);
  assert.equal(status.autoMerge.approved, false);
  assert.equal(status.technicalDetails.passwordStored, false);
});

test('automatic coding PR merge is opt-in only for full-immediate or Web ChatGPT workflows', (t) => {
  const rootDir = setup(t);
  let result = saveReviewSetupPage({ workflow: 'full-immediate', autoMergeApproved: true }, { rootDir });
  assert.equal(result.autoMerge.available, true);
  assert.equal(result.selection.autoMergeApproved, true);
  result = saveReviewSetupPage({ workflow: 'quick-manual', autoMergeApproved: true }, { rootDir });
  assert.equal(result.autoMerge.available, false);
  assert.equal(result.selection.autoMergeApproved, false);
});

test('manual and full-immediate workflows can save round limits through 20 without ChatGPT Profile', (t) => {
  const rootDir = setup(t);
  let result = saveReviewSetupPage({ workflow: 'full-immediate', quickMaxRounds: 20, fullMaxRounds: 20 }, { rootDir });
  assert.equal(result.check.ok, true);
  assert.equal(result.selection.fullMaxRounds, 20);
  assert.equal(result.profile, null);
  result = saveReviewSetupPage({ workflow: 'quick-manual', quickMaxRounds: 4, fullMaxRounds: 5 }, { rootDir });
  assert.equal(result.check.ok, true);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.review.completed, true);
});

test('Web ChatGPT workflow remains blocked until a chat is saved and profile readiness is verified', async (t) => {
  const rootDir = setup(t);
  const initial = saveReviewSetupPage({ workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds: 3 }, {
    rootDir,
    prerequisiteStatus: () => ({ state: 'review-chat-required', ready: false, action: 'choose-review-chat', profileExists: true }),
  });
  assert.equal(initial.check.ok, false);
  assert.equal(initial.check.blockers[0].code, 'review-chat-required');

  const saved = await saveReviewChat({ mode: 'dedicated', conversationUrl: CHAT }, {
    rootDir,
    prerequisiteStatus: verificationRequired,
    saveBrowserConfig: (patch) => patch,
  });
  assert.equal(saved.selection.reviewChatMode, 'dedicated');
  assert.equal(saved.selection.conversationUrl, CHAT);
  assert.equal(saved.check.ok, false);

  const verified = await recheckReviewSetupPage({
    rootDir,
    prerequisiteStatus: verificationRequired,
    verifyProfile: async ({ repository, conversationUrl }) => ({
      state: 'ready',
      ready: true,
      repository,
      conversationUrl,
      githubAccessVerified: true,
      sessionPersistenceVerified: true,
    }),
  });
  assert.equal(verified.check.ok, true);
  assert.equal(verified.profile.ready, true);
  assert.equal(verified.profile.repository, 'octo/app');
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.review.completed, true);
});

test('sign-in required blocks setup but preserves active PR state semantics', async (t) => {
  const rootDir = setup(t);
  saveReviewSetupPage({ workflow: 'quick-web-chatgpt' }, { rootDir, prerequisiteStatus: verificationRequired });
  await saveReviewChat({ mode: 'existing', conversationUrl: CHAT }, {
    rootDir,
    prerequisiteStatus: verificationRequired,
    saveBrowserConfig: (patch) => patch,
  });
  const result = await recheckReviewSetupPage({
    rootDir,
    prerequisiteStatus: verificationRequired,
    verifyProfile: async () => ({
      state: 'sign-in-required',
      ready: false,
      action: 'open-chatgpt-profile',
      pauseNewWebReviews: true,
      failActivePullRequests: false,
      message: 'ChatGPT Profile needs you to sign in again.',
    }),
  });
  assert.equal(result.check.ok, false);
  assert.equal(result.profile.pauseNewWebReviews, true);
  assert.equal(result.profile.failActivePullRequests, false);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.review.completed, false);
});

test('Open ChatGPT Profile is a manual-login operation and never accepts a password', async (t) => {
  const rootDir = setup(t);
  let called = null;
  const result = await openChatGptProfile({
    rootDir,
    openProfile: async (input) => { called = input; return { leaseId: 'lease-1' }; },
  });
  assert.deepEqual(called, { conversationUrl: 'https://chatgpt.com/' });
  assert.equal(result.profileName, 'ChatGPT Profile');
  assert.equal(result.closeRequiredBeforeRecheck, true);
  assert.equal(Object.hasOwn(called, 'password'), false);
});
