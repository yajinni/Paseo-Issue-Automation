import assert from 'node:assert/strict';
import test from 'node:test';
import { managerReviewProfileStatus } from '../src/manager-review-profile-status.mjs';

test('ChatGPT Profile is explicitly not required outside Web ChatGPT workflow', () => {
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-manual' } });
  assert.equal(status.required, false);
  assert.equal(status.ready, null);
  assert.equal(status.passwordStored, false);
});

test('Web ChatGPT uses live Playwright Chromium and review-chat prerequisites', () => {
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, {
    prerequisiteStatus: () => ({
      libraryInstalled: true,
      chromiumInstalled: true,
      conversationUrl: 'https://chatgpt.com/c/example',
    }),
  });
  assert.equal(status.required, true);
  assert.equal(status.known, true);
  assert.equal(status.repositoryMatches, true);
  assert.equal(status.conversationUrlConfigured, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.blockers, []);
  assert.equal(status.passwordStored, false);
});

test('missing Playwright Chromium and review chat are reported independently', () => {
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, {
    prerequisiteStatus: () => ({
      libraryInstalled: false,
      chromiumInstalled: false,
      conversationUrl: null,
    }),
  });
  assert.equal(status.ready, false);
  assert.deepEqual(status.blockers.map((item) => item.code), [
    'playwright-required',
    'chromium-required',
    'review-chat-required',
  ]);
  assert.equal(status.summary, 'Install Playwright for Web ChatGPT full review.');
});

test('saved review chat alone is not enough when browser prerequisites are unavailable', () => {
  const status = managerReviewProfileStatus('example/repo', { review: { workflow: 'quick-web-chatgpt' } }, {
    prerequisiteStatus: () => ({
      libraryInstalled: true,
      chromiumInstalled: false,
      conversationUrl: 'https://chatgpt.com/c/example',
    }),
  });
  assert.equal(status.conversationUrlConfigured, true);
  assert.equal(status.ready, false);
  assert.deepEqual(status.blockers, [{
    code: 'chromium-required',
    message: 'Install Chromium for Web ChatGPT full review.',
    recoveryAction: 'Install Chromium',
  }]);
});
