import {
  installPlaywrightChromium,
  launchBrowserForLogin,
} from '../browser-service.mjs';
import { installPlaywrightLibrary } from '../playwright-installer.mjs';
import {
  CHATGPT_PROFILE_STATES,
  chatGptProfilePrerequisites,
  chatGptProfileUiModel,
  configureChatGptReviewChat,
  verifyChatGptProfileReadiness,
} from '../chatgpt-profile-readiness.mjs';
import { REVIEW_WORKFLOWS } from './schema.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';

function activeSession(options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function normalizedRound(value, fallback, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 20) {
    throw new Error(`${label} must be an integer from 1 through 20.`);
  }
  return number;
}

function autoMergeAvailable(workflow) {
  return workflow === 'full-immediate' || workflow === 'quick-web-chatgpt';
}

function selections(session) {
  const value = session.pages?.review?.selections || {};
  const workflow = REVIEW_WORKFLOWS.includes(value.workflow) ? value.workflow : 'quick-manual';
  return {
    workflow,
    quickMaxRounds: normalizedRound(value.quickMaxRounds, 3, 'Maximum light-model review rounds'),
    fullMaxRounds: normalizedRound(value.fullMaxRounds, 3, 'Maximum full-review rounds'),
    conversationUrl: String(value.conversationUrl || '').trim() || null,
    reviewChatMode: value.reviewChatMode === 'existing' ? 'existing' : value.reviewChatMode === 'dedicated' ? 'dedicated' : null,
    autoMergeApproved: autoMergeAvailable(workflow) && value.autoMergeApproved === true,
  };
}

function repositorySelection(session) {
  const value = session.pages?.repository?.selections || {};
  return String(value.repository || session.repository?.nameWithOwner || '').trim();
}

function needsWebChatGpt(selection) {
  return selection.workflow === 'quick-web-chatgpt';
}

function baseValidation(selection, profileStatus) {
  const blockers = [];
  if (!REVIEW_WORKFLOWS.includes(selection.workflow)) blockers.push({ code: 'review-workflow-invalid', message: 'Choose a supported review workflow.' });
  if (!Number.isInteger(selection.quickMaxRounds) || selection.quickMaxRounds < 1 || selection.quickMaxRounds > 20) blockers.push({ code: 'quick-round-limit-invalid', message: 'Light-model review rounds must be from 1 through 20.' });
  if (!Number.isInteger(selection.fullMaxRounds) || selection.fullMaxRounds < 1 || selection.fullMaxRounds > 20) blockers.push({ code: 'full-round-limit-invalid', message: 'Full-review rounds must be from 1 through 20.' });
  if (needsWebChatGpt(selection)) {
    if (!selection.conversationUrl) blockers.push({ code: 'review-chat-required', message: 'Enter the PR review chat URL before continuing with Web ChatGPT review.' });
    if (profileStatus?.ready !== true) blockers.push({
      code: 'chatgpt-profile-not-ready',
      message: profileStatus?.message || 'ChatGPT Profile must be signed in and connected to the selected review chat.',
      recoveryAction: profileStatus?.action || 'Recheck',
    });
  }
  return { ok: blockers.length === 0, blockers };
}

function profileSnapshot(selection, options = {}) {
  if (!needsWebChatGpt(selection)) return null;
  const prerequisites = (options.prerequisiteStatus || chatGptProfilePrerequisites)();
  return {
    ...prerequisites,
    ui: chatGptProfileUiModel(prerequisites),
  };
}

function response(session, profileStatus = null) {
  const selection = selections(session);
  const profile = needsWebChatGpt(selection) ? profileStatus || profileSnapshot(selection) : null;
  const validation = baseValidation(selection, profile);
  return {
    selection,
    profile,
    autoMerge: {
      available: autoMergeAvailable(selection.workflow),
      approved: selection.autoMergeApproved,
      defaultApproved: false,
      explanation: autoMergeAvailable(selection.workflow)
        ? 'Optional automatic merge is off by default and can run only after full exact-head approval, passing required checks, current-base verification, and repository policy all allow it.'
        : 'Automatic merge is unavailable for Light model review → Manual review. A person must merge manually after review.',
    },
    check: session.pages?.review?.lastCheck || {
      ok: validation.ok,
      summary: validation.ok ? 'Review workflow is ready.' : validation.blockers[0]?.message || 'Review setup needs attention.',
      blockers: validation.blockers,
    },
    prompts: {
      quick: { copyable: true, editable: false },
      full: { copyable: true, editable: false },
    },
    explanations: {
      quick: 'Light model review checks issue compliance, acceptance criteria, required validation, obvious mistakes, and unrelated changes before the selected next review stage.',
      full: 'Full review examines the complete change and relevant surrounding code, regressions, security/privacy, compatibility, migrations, and test sufficiency.',
      manual: 'After light model review, a person performs the full review. Automatic merge is not used in manual mode.',
      web: 'After light model review, Web ChatGPT performs the full review using the isolated ChatGPT Profile and selected PR review chat.',
    },
    technicalDetails: {
      workflow: selection.workflow,
      quickMaxRounds: selection.quickMaxRounds,
      fullMaxRounds: selection.fullMaxRounds,
      autoMergeAvailable: autoMergeAvailable(selection.workflow),
      autoMergeApproved: selection.autoMergeApproved,
      conversationUrlConfigured: Boolean(selection.conversationUrl),
      playwrightInstalled: profile?.libraryInstalled === true,
      chromiumInstalled: profile?.chromiumInstalled === true,
      profileState: profile?.state || null,
      passwordStored: false,
    },
  };
}

export function getReviewSetupPageStatus(options = {}) {
  const session = activeSession(options);
  return response(session, profileSnapshot(selections(session), options));
}

export function saveReviewSetupPage(input = {}, options = {}) {
  const prior = selections(activeSession(options));
  const nextWorkflow = String(input.workflow ?? prior.workflow).trim();
  const next = {
    workflow: nextWorkflow,
    quickMaxRounds: normalizedRound(input.quickMaxRounds, prior.quickMaxRounds, 'Maximum light-model review rounds'),
    fullMaxRounds: normalizedRound(input.fullMaxRounds, prior.fullMaxRounds, 'Maximum full-review rounds'),
    conversationUrl: prior.conversationUrl,
    reviewChatMode: prior.reviewChatMode,
    autoMergeApproved: autoMergeAvailable(nextWorkflow) && input.autoMergeApproved === true,
  };
  if (!REVIEW_WORKFLOWS.includes(next.workflow)) throw new Error('Choose a supported review workflow.');
  let session = saveSetupPage('review', { selections: next }, options);
  const profile = profileSnapshot(next, options);
  const validation = baseValidation(next, profile);
  session = recordSetupPageCheck('review', {
    ok: validation.ok,
    summary: validation.ok ? 'Review workflow is ready.' : validation.blockers[0]?.message || 'Review setup needs attention.',
    blockers: validation.blockers,
  }, options);
  return response(session, profile);
}

export async function saveReviewChat(input = {}, options = {}) {
  const prior = selections(activeSession(options));
  const mode = input.mode === 'dedicated' ? 'dedicated' : 'existing';
  const manuallyCreatedDedicated = mode === 'dedicated' && String(input.conversationUrl || '').trim();
  const configured = await configureChatGptReviewChat({
    mode: manuallyCreatedDedicated ? 'existing' : mode,
    conversationUrl: input.conversationUrl,
    createDedicatedChat: options.createDedicatedChat,
    save: options.saveBrowserConfig,
  });
  let session = saveSetupPage('review', {
    selections: {
      ...prior,
      conversationUrl: configured.conversationUrl,
      reviewChatMode: mode,
    },
  }, options);
  session = recordSetupPageCheck('review', {
    ok: false,
    summary: 'Review chat saved. Recheck ChatGPT Profile readiness before continuing.',
    blockers: [{ code: 'chatgpt-profile-recheck-required', message: 'Recheck ChatGPT Profile after choosing the review chat.' }],
  }, options);
  return response(session, profileSnapshot(selections(session), options));
}

export async function openChatGptProfile(options = {}) {
  const selection = selections(activeSession(options));
  const open = options.openProfile || launchBrowserForLogin;
  const session = await open({ conversationUrl: selection.conversationUrl || 'https://chatgpt.com/' });
  return {
    opened: true,
    profileName: 'ChatGPT Profile',
    closeRequiredBeforeRecheck: true,
    sessionId: session?.leaseId || null,
  };
}

export function installChatGptPlaywright(options = {}) {
  const install = options.installPlaywright || installPlaywrightLibrary;
  return install(options.playwrightOptions || {});
}

export function installChatGptChromium(options = {}) {
  const install = options.installChromium || installPlaywrightChromium;
  return install(options.browserOptions || {});
}

export async function recheckReviewSetupPage(options = {}) {
  let session = activeSession(options);
  const selection = selections(session);
  let profile = profileSnapshot(selection, options);
  if (needsWebChatGpt(selection) && selection.conversationUrl && profile?.state === 'verification-required') {
    const prerequisites = profile;
    const verified = await (options.verifyProfile || verifyChatGptProfileReadiness)({
      repository: repositorySelection(session),
      conversationUrl: selection.conversationUrl,
      repositoryAccessProbe: options.repositoryAccessProbe,
      prerequisiteStatus: options.prerequisiteStatus,
    });
    profile = {
      ...verified,
      libraryInstalled: prerequisites.libraryInstalled === true,
      chromiumInstalled: prerequisites.chromiumInstalled === true,
    };
    profile = { ...profile, ui: chatGptProfileUiModel(profile) };
  }
  const validation = baseValidation(selection, profile);
  session = recordSetupPageCheck('review', {
    ok: validation.ok,
    summary: validation.ok ? 'Review workflow and selected full-review method are ready.' : validation.blockers[0]?.message || 'Review setup needs attention.',
    blockers: validation.blockers,
  }, options);
  return response(session, profile);
}

export { CHATGPT_PROFILE_STATES };
