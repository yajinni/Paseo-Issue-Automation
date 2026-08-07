import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATGPT_PROFILE_NAME,
  CHATGPT_PROFILE_STATES,
  chatGptProfilePrerequisites,
  chatGptProfileUiModel,
  configureChatGptReviewChat,
  expiredProfileSession,
  verifyChatGptProfileReadiness,
} from '../src/chatgpt-profile-readiness.mjs';

function prerequisites(overrides = {}) {
  return chatGptProfilePrerequisites({
    library: { installed: true },
    chromium: { installed: true },
    profile: { profileExists: true, locked: false },
    config: { globalConversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' },
    ...overrides,
  });
}

test('profile directory existence alone never makes ChatGPT Profile ready', () => {
  assert.deepEqual(prerequisites({ chromium: { installed: false } }), {
    state: CHATGPT_PROFILE_STATES.missingBrowser,
    ready: false,
    action: 'install-chromium',
    libraryInstalled: true,
    chromiumInstalled: false,
    profileExists: true,
    conversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
  });
  assert.equal(prerequisites().ready, false);
  assert.equal(prerequisites().state, 'verification-required');
});

test('locked profile and missing review chat produce explicit recovery actions', () => {
  assert.equal(prerequisites({ profile: { profileExists: true, locked: true } }).state, CHATGPT_PROFILE_STATES.profileBusy);
  assert.equal(prerequisites({ config: {} }).state, CHATGPT_PROFILE_STATES.chatRequired);
});

test('dedicated and existing review chat choices persist stable conversation URLs', async () => {
  const writes = [];
  const save = (patch) => {
    writes.push(patch);
    return patch;
  };
  const existing = await configureChatGptReviewChat({
    mode: 'existing',
    conversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
    save,
  });
  assert.equal(existing.stableIdentifierStored, true);
  assert.match(existing.conversationUrl, /chatgpt\.com\/c\//);

  const dedicated = await configureChatGptReviewChat({
    mode: 'dedicated',
    createDedicatedChat: async () => ({ conversationUrl: 'https://chatgpt.com/c/abcdefab-cdef-abcd-efab-cdefabcdefab' }),
    save,
  });
  assert.equal(dedicated.mode, 'dedicated');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].globalConversationUrl, dedicated.conversationUrl);
});

test('readiness verifies authentication, composer, repository access, and persistence without sending prompts', async () => {
  const calls = [];
  const result = await verifyChatGptProfileReadiness({
    repository: 'owner/repo',
    conversationUrl: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
    prerequisiteStatus: () => prerequisites(),
    inspect: async (input) => {
      calls.push(input);
      return { ok: true, authenticated: true, composerFound: true, testPromptSent: false };
    },
    repositoryAccessProbe: async (input) => {
      calls.push(input);
      return { ok: true, repository: 'owner/repo', mutated: false, promptSent: false };
    },
  });
  assert.equal(result.state, CHATGPT_PROFILE_STATES.ready);
  assert.equal(result.sessionPersistenceVerified, true);
  assert.equal(result.githubAccessVerified, true);
  assert.equal(result.promptSent, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].sendTestPrompt, false);
  assert.equal(calls[1].sendPrompt, false);
  assert.equal(calls[2].sendTestPrompt, false);
});

test('repository access must match the selected repository and remain read-only', async () => {
  const base = {
    repository: 'owner/repo',
    prerequisiteStatus: () => prerequisites(),
    inspect: async () => ({ authenticated: true, composerFound: true, testPromptSent: false }),
  };
  const missingProbe = await verifyChatGptProfileReadiness(base);
  assert.equal(missingProbe.state, CHATGPT_PROFILE_STATES.repositoryAccessRequired);

  const wrongRepo = await verifyChatGptProfileReadiness({
    ...base,
    repositoryAccessProbe: async () => ({ ok: true, repository: 'owner/other', mutated: false, promptSent: false }),
  });
  assert.equal(wrongRepo.ready, false);

  const mutation = await verifyChatGptProfileReadiness({
    ...base,
    repositoryAccessProbe: async () => ({ ok: true, repository: 'owner/repo', mutated: true, promptSent: false }),
  });
  assert.equal(mutation.ready, false);
});

test('expired session pauses new Web ChatGPT reviews without failing active pull requests', async () => {
  const status = expiredProfileSession(new Error('ChatGPT redirected to login or home; authenticate the dedicated profile first.'));
  assert.deepEqual(status, {
    state: CHATGPT_PROFILE_STATES.signInRequired,
    ready: false,
    action: 'open-chatgpt-profile',
    pauseNewWebReviews: true,
    failActivePullRequests: false,
    message: 'ChatGPT Profile needs you to sign in again. Existing pull requests remain active; new Web ChatGPT submissions are paused.',
  });

  const verified = await verifyChatGptProfileReadiness({
    repository: 'owner/repo',
    prerequisiteStatus: () => prerequisites(),
    inspect: async () => { throw new Error('ChatGPT redirected to login.'); },
    repositoryAccessProbe: async () => ({ ok: true, repository: 'owner/repo' }),
  });
  assert.equal(verified.state, CHATGPT_PROFILE_STATES.signInRequired);
  assert.equal(verified.failActivePullRequests, false);
});

test('normal UI calls the feature ChatGPT Profile and never asks for a password', () => {
  assert.equal(CHATGPT_PROFILE_NAME, 'ChatGPT Profile');
  const notSignedIn = chatGptProfileUiModel({ state: CHATGPT_PROFILE_STATES.signInRequired });
  assert.equal(notSignedIn.title, 'ChatGPT Profile');
  assert.equal(notSignedIn.statusText, 'Not signed in');
  assert.equal(notSignedIn.primaryAction, 'Open ChatGPT Profile');
  assert.equal(notSignedIn.passwordRequested, false);
  assert.doesNotMatch(`${notSignedIn.title} ${notSignedIn.statusText} ${notSignedIn.primaryAction}`, /Chromium profile/i);
  assert.match(notSignedIn.technicalImplementation, /Chromium profile/);
});
