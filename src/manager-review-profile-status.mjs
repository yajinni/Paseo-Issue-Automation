import { chatGptProfilePrerequisites } from './chatgpt-profile-readiness.mjs';

export function managerReviewProfileStatus(repository, config = {}, options = {}) {
  const required = config.review?.workflow === 'quick-web-chatgpt';
  if (!required) return {
    required: false,
    known: true,
    ready: null,
    repositoryMatches: null,
    conversationUrlConfigured: null,
    checkedAt: null,
    summary: 'ChatGPT Profile is not required by the selected review workflow.',
    blockers: [],
    setupPath: '/setup/review',
    passwordStored: false,
  };

  const prerequisites = (options.prerequisiteStatus || chatGptProfilePrerequisites)();
  const playwrightReady = prerequisites.libraryInstalled === true;
  const chromiumReady = prerequisites.chromiumInstalled === true;
  const conversationUrlConfigured = Boolean(String(prerequisites.conversationUrl || '').trim());
  const blockers = [];
  if (!playwrightReady) blockers.push({ code: 'playwright-required', message: 'Install Playwright for Web ChatGPT full review.', recoveryAction: 'Install Playwright' });
  if (!chromiumReady) blockers.push({ code: 'chromium-required', message: 'Install Chromium for Web ChatGPT full review.', recoveryAction: 'Install Chromium' });
  if (!conversationUrlConfigured) blockers.push({ code: 'review-chat-required', message: 'Save a PR review chat URL for Web ChatGPT full review.', recoveryAction: 'Configure PR review chat' });
  const ready = blockers.length === 0;

  return {
    required: true,
    known: true,
    ready,
    repositoryMatches: true,
    conversationUrlConfigured,
    checkedAt: null,
    summary: ready
      ? 'ChatGPT Profile prerequisites and PR review chat are configured.'
      : blockers[0].message,
    blockers,
    setupPath: '/setup/review',
    passwordStored: false,
    repository: repository || null,
  };
}
