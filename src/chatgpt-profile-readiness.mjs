import {
  browserProfileStatus,
  loadBrowserConfig,
  saveBrowserConfig,
} from './browser-profile.mjs';
import {
  inspectConversation,
  playwrightChromiumStatus,
  playwrightLibraryStatus,
} from './browser-service.mjs';
import { normalizeChatGptConversationUrl } from './chatgpt-url.mjs';

export const CHATGPT_PROFILE_NAME = 'ChatGPT Profile';

export const CHATGPT_PROFILE_STATES = Object.freeze({
  missingBrowser: 'browser-install-required',
  profileBusy: 'profile-in-use',
  chatRequired: 'review-chat-required',
  signInRequired: 'sign-in-required',
  repositoryAccessRequired: 'github-access-required',
  ready: 'ready',
});

function safeMessage(error) {
  return String(error?.message || error || '').replace(/dedicated (?:ChatGPT )?(?:browser )?profile/gi, CHATGPT_PROFILE_NAME);
}

export function chatGptProfilePrerequisites({
  library = playwrightLibraryStatus(),
  chromium = playwrightChromiumStatus(),
  profile = browserProfileStatus(),
  config = loadBrowserConfig(),
} = {}) {
  const conversationUrl = config.globalConversationUrl || config.lastConversationUrl || null;
  if (!library.installed || !chromium.installed) {
    return {
      state: CHATGPT_PROFILE_STATES.missingBrowser,
      ready: false,
      action: 'install-chromium',
      libraryInstalled: library.installed === true,
      chromiumInstalled: chromium.installed === true,
      profileExists: profile.profileExists === true,
      conversationUrl,
    };
  }
  if (profile.locked) {
    return {
      state: CHATGPT_PROFILE_STATES.profileBusy,
      ready: false,
      action: 'close-chatgpt-profile',
      libraryInstalled: true,
      chromiumInstalled: true,
      profileExists: profile.profileExists === true,
      conversationUrl,
    };
  }
  if (!conversationUrl) {
    return {
      state: CHATGPT_PROFILE_STATES.chatRequired,
      ready: false,
      action: 'choose-review-chat',
      libraryInstalled: true,
      chromiumInstalled: true,
      profileExists: profile.profileExists === true,
      conversationUrl: null,
    };
  }
  return {
    state: 'verification-required',
    ready: false,
    action: 'recheck',
    libraryInstalled: true,
    chromiumInstalled: true,
    profileExists: profile.profileExists === true,
    conversationUrl,
  };
}

export async function configureChatGptReviewChat({
  mode,
  conversationUrl,
  createDedicatedChat,
  save = saveBrowserConfig,
} = {}) {
  let selectedUrl = null;
  if (mode === 'existing') {
    selectedUrl = normalizeChatGptConversationUrl(conversationUrl);
  } else if (mode === 'dedicated') {
    if (typeof createDedicatedChat !== 'function') {
      throw new Error('Creating a dedicated PR review chat requires the ChatGPT Profile chat-creation adapter.');
    }
    const created = await createDedicatedChat();
    selectedUrl = normalizeChatGptConversationUrl(created?.conversationUrl || created);
  } else {
    throw new Error('Review chat mode must be dedicated or existing.');
  }
  const stored = save({ globalConversationUrl: selectedUrl, lastConversationUrl: selectedUrl });
  return {
    mode,
    conversationUrl: stored.globalConversationUrl || selectedUrl,
    stableIdentifierStored: true,
  };
}

function authenticationFailure(error) {
  const text = safeMessage(error).toLowerCase();
  return text.includes('login')
    || text.includes('sign in')
    || text.includes('authenticate')
    || text.includes('home');
}

export function expiredProfileSession(error) {
  if (!authenticationFailure(error)) return null;
  return {
    state: CHATGPT_PROFILE_STATES.signInRequired,
    ready: false,
    action: 'open-chatgpt-profile',
    pauseNewWebReviews: true,
    failActivePullRequests: false,
    message: `${CHATGPT_PROFILE_NAME} needs you to sign in again. Existing pull requests remain active; new Web ChatGPT submissions are paused.`,
  };
}

export async function verifyChatGptProfileReadiness({
  repository,
  conversationUrl,
  inspect = inspectConversation,
  repositoryAccessProbe,
  prerequisiteStatus = chatGptProfilePrerequisites,
} = {}) {
  const prerequisites = prerequisiteStatus();
  if (prerequisites.state !== 'verification-required') return prerequisites;
  const selectedUrl = normalizeChatGptConversationUrl(conversationUrl || prerequisites.conversationUrl);

  let first;
  try {
    first = await inspect({ conversationUrl: selectedUrl, headless: true, sendTestPrompt: false });
  } catch (error) {
    const expired = expiredProfileSession(error);
    if (expired) return expired;
    return {
      state: 'verification-failed',
      ready: false,
      action: 'recheck',
      message: safeMessage(error),
    };
  }
  if (!first?.authenticated || !first?.composerFound || first?.testPromptSent === true) {
    return {
      state: CHATGPT_PROFILE_STATES.signInRequired,
      ready: false,
      action: 'open-chatgpt-profile',
      pauseNewWebReviews: true,
      failActivePullRequests: false,
      message: `${CHATGPT_PROFILE_NAME} is not signed in with a usable review chat.`,
    };
  }

  if (typeof repositoryAccessProbe !== 'function') {
    return {
      state: CHATGPT_PROFILE_STATES.repositoryAccessRequired,
      ready: false,
      action: 'verify-github-access',
      message: 'GitHub access has not been safely verified for the selected repository.',
    };
  }
  const access = await repositoryAccessProbe({ repository, conversationUrl: selectedUrl, sendPrompt: false });
  if (!access?.ok || access?.repository !== repository || access?.mutated === true || access?.promptSent === true) {
    return {
      state: CHATGPT_PROFILE_STATES.repositoryAccessRequired,
      ready: false,
      action: 'verify-github-access',
      message: access?.message || `The selected ChatGPT review workflow cannot yet inspect ${repository}.`,
    };
  }

  // inspectConversation closes the persistent context before it returns. Opening it
  // again proves that the authenticated session and selected chat survive a close.
  let reopened;
  try {
    reopened = await inspect({ conversationUrl: selectedUrl, headless: true, sendTestPrompt: false });
  } catch (error) {
    const expired = expiredProfileSession(error);
    if (expired) return expired;
    return {
      state: 'session-persistence-failed',
      ready: false,
      action: 'open-chatgpt-profile',
      message: `The ${CHATGPT_PROFILE_NAME} did not remain usable after reopening: ${safeMessage(error)}`,
    };
  }
  if (!reopened?.authenticated || !reopened?.composerFound || reopened?.testPromptSent === true) {
    return {
      state: 'session-persistence-failed',
      ready: false,
      action: 'open-chatgpt-profile',
      message: `The ${CHATGPT_PROFILE_NAME} did not preserve its authenticated review session after reopening.`,
    };
  }

  return {
    state: CHATGPT_PROFILE_STATES.ready,
    ready: true,
    action: null,
    conversationUrl: selectedUrl,
    repository,
    authenticated: true,
    composerFound: true,
    githubAccessVerified: true,
    sessionPersistenceVerified: true,
    promptSent: false,
  };
}

export function chatGptProfileUiModel(status = {}) {
  const state = String(status.state || 'verification-required');
  return Object.freeze({
    title: CHATGPT_PROFILE_NAME,
    statusText: state === CHATGPT_PROFILE_STATES.ready
      ? 'Signed in and ready'
      : state === CHATGPT_PROFILE_STATES.signInRequired
        ? 'Not signed in'
        : state === CHATGPT_PROFILE_STATES.profileBusy
          ? 'In use'
          : 'Not ready',
    primaryAction: state === CHATGPT_PROFILE_STATES.signInRequired ? 'Open ChatGPT Profile' : status.action || 'Recheck',
    recheckAction: 'Recheck',
    passwordRequested: false,
    technicalImplementation: 'The ChatGPT Profile uses an isolated Chromium profile managed by Playwright.',
  });
}
