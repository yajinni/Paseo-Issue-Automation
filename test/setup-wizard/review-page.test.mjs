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

const browserReady = () => ({
  state: 'verification-required',
  ready: false,
  action: 'recheck',
  libraryInstalled: true,
  chromiumInstalled: true,
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

test('Web ChatGPT setup requires Playwright Chromium and a saved chat URL but not profile recheck', async (t) => {
  const rootDir = setup(t);
  let result = saveReviewSetupPage({ workflow: 'quick-web-chatgpt', quickMaxRounds: 3, fullMaxRounds: 3 }, {
    rootDir,
    prerequisiteStatus: () => ({ state: 'browser-install-required', ready: false, libraryInstalled: false, chromiumInstalled: false }),
  });
  assert.equal(result.check.ok, false);
  assert.equal(result.check.blockers[0].code, 'playwright-required');

  result = saveReviewSetupPage({ workflow: 'quick-web-chatgpt' }, {
    rootDir,
    prerequisiteStatus: () => ({ state: 'browser-install-required', ready: false, libraryInstalled: true, chromiumInstalled: false }),
  });
  assert.equal(result.check.ok, false);
  assert.equal(result.check.blockers[0].code, 'chromium-required');

  result = saveReviewSetupPage({ workflow: 'quick-web-chatgpt' }, { rootDir, prerequisiteStatus: browserReady });
  assert.equal(result.check.ok, false);
  assert.equal(result.check.blockers[0].code, 'review-chat-required');

  const saved = await saveReviewChat({ mode: 'existing', conversationUrl: CHAT }, {
    rootDir,
    prerequisiteStatus: browserReady,
    saveBrowserConfig: (patch) => patch,
  });
  assert.equal(saved.selection.conversationUrl, CHAT);
  assert.equal(saved.check.ok, true);
  assert.equal(saved.profile.ready, false);
  assert.equal(saved.technicalDetails.profileVerificationRequiredForSetup, false);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.review.completed, true);
});

test('an unverified or signed-out profile does not block setup once browser prerequisites and chat URL are ready', async (t) => {
  const rootDir = setup(t);
  saveReviewSetupPage({ workflow: 'quick-web-chatgpt' }, { rootDir, prerequisiteStatus: browserReady });
  await saveReviewChat({ mode: 'existing', conversationUrl: CHAT }, {
    rootDir,
    prerequisiteStatus: browserReady,
    saveBrowserConfig: (patch) => patch,
  });
  const result = await recheckReviewSetupPage({
    rootDir,
    prerequisiteStatus: () => ({
      state: 'sign-in-required',
      ready: false,
      action: 'open-chatgpt-profile',
      libraryInstalled: true,
      chromiumInstalled: true,
      pauseNewWebReviews: true,
      failActivePullRequests: false,
      message: 'ChatGPT Profile needs you to sign in again.',
    }),
  });
  assert.equal(result.check.ok, true);
  assert.equal(result.profile.ready, false);
  assert.equal(result.profile.pauseNewWebReviews, true);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.review.completed, true);
});

test('Log into ChatGPT Profile focuses the browser and never accepts a password or requires recheck', async (t) => {
  const rootDir = setup(t);
  let called = null;
  let focused = null;
  const page = { id: 'page-1' };
  const result = await openChatGptProfile({
    rootDir,
    openProfile: async (input) => { called = input; return { leaseId: 'lease-1', page }; },
    focusProfile: async (input) => { focused = input; return { tabFocused: true, windowFocusRequested: true, osActivated: true }; },
  });
  assert.deepEqual(called, { conversationUrl: 'https://chatgpt.com/' });
  assert.equal(focused, page);
  assert.equal(result.profileName, 'ChatGPT Profile');
  assert.equal(result.closeWhenDone, true);
  assert.equal(result.closeRequiredBeforeRecheck, false);
  assert.equal(result.foreground.osActivated, true);
  assert.equal(Object.hasOwn(called, 'password'), false);
});
