import { bringBrowserToForeground } from './browser-foreground.mjs';
import {
  installPlaywrightChromium,
  launchBrowserForLogin,
} from './browser-service.mjs';
import {
  chatGptProfilePrerequisites,
  configureChatGptReviewChat,
} from './chatgpt-profile-readiness.mjs';
import {
  connectManagerPaseo,
  managerHarnessCatalog,
  managerPaseoConnectionStatus,
} from './manager-paseo-configuration.mjs';
import { installPlaywrightLibrary } from './playwright-installer.mjs';
import { loadPrReviewStore, savePrAutomationConfig } from './pr-review-store.mjs';
import { parseRepositoryApiPath, resolveRepositoryApiContext } from './repository-api-context.mjs';
import { listAllGitHubBranches } from './setup-wizard/github-repositories.mjs';

function projectConversationUrl(root, options = {}) {
  try {
    const loadStore = options.loadPrReviewStore || loadPrReviewStore;
    return loadStore(root)?.config?.browserReview?.projectConversationUrl || null;
  } catch {
    return null;
  }
}

function chatGptStatus(root, options = {}) {
  const status = (options.chatGptPrerequisites || chatGptProfilePrerequisites)();
  return {
    libraryInstalled: status.libraryInstalled === true,
    chromiumInstalled: status.chromiumInstalled === true,
    profileExists: status.profileExists === true,
    conversationUrl: projectConversationUrl(root, options) || status.conversationUrl || null,
    state: status.state || null,
  };
}

async function openChatGptProfile(root, options = {}) {
  const status = chatGptStatus(root, options);
  if (!status.libraryInstalled || !status.chromiumInstalled) {
    throw new Error('Install Playwright and Chromium before opening the ChatGPT Profile.');
  }
  const open = options.openProfile || launchBrowserForLogin;
  const session = await open({ conversationUrl: status.conversationUrl || 'https://chatgpt.com/' });
  const focus = options.focusProfile || bringBrowserToForeground;
  const foreground = await focus(session?.page, options.foregroundOptions || {});
  return {
    opened: true,
    sessionId: session?.leaseId || null,
    foreground,
    status: chatGptStatus(root, options),
  };
}

async function saveChatGptConversation(root, body = {}, options = {}) {
  const configured = await configureChatGptReviewChat({
    mode: 'existing',
    conversationUrl: body.conversationUrl,
    save: options.saveBrowserConfig,
  });
  const saveReviewConfig = options.savePrAutomationConfig || savePrAutomationConfig;
  saveReviewConfig(root, {
    browserReview: { projectConversationUrl: configured.conversationUrl },
  });
  return {
    configured: true,
    conversationUrl: configured.conversationUrl,
    status: chatGptStatus(root, options),
  };
}

function githubHostFromRemote(remote) {
  const value = String(remote || '').trim();
  const urlMatch = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/@]+@)?([^/:]+)(?::\d+)?\//i);
  if (urlMatch?.[2]) return urlMatch[2];
  const scpMatch = value.match(/^[^@\s]+@([^:]+):/);
  return scpMatch?.[1] || 'github.com';
}

function githubRepositoryFromRemote(remote) {
  const value = String(remote || '').trim();
  if (!value) return null;

  const scpMatch = value.match(/^[^@\s]+@[^:\s]+:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (scpMatch) return `${scpMatch[1]}/${scpMatch[2]}`;

  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, rawRepository] = parts;
    const repository = rawRepository.replace(/\.git$/i, '');
    return owner && repository ? `${owner}/${repository}` : null;
  } catch {
    return null;
  }
}

function managerBranchCatalog(context, options = {}) {
  const repository = String(
    context.repository?.repository || githubRepositoryFromRemote(context.repository?.remote) || '',
  ).trim();
  if (!repository) throw new Error('The registered repository does not have a GitHub owner/name identity.');
  const loadBranches = options.branchLoader || listAllGitHubBranches;
  const result = loadBranches(repository, {
    host: options.githubHost || githubHostFromRemote(context.repository?.remote),
    runner: options.runner,
    env: options.env,
  });
  return {
    repository,
    branches: result.branches || [],
    recommendedBranch: result.recommended || null,
    blocker: result.ok ? null : result.blocker || {
      code: 'github-branch-catalog-unavailable',
      message: 'GitHub branches could not be loaded.',
      recoveryAction: 'Check GitHub CLI access, then refresh branches.',
    },
  };
}

function response(body, status = 200) {
  return { handled: true, status, body };
}

export async function managerConfigurationApiRequest({ method, pathname, body = {} }, options = {}) {
  const route = parseRepositoryApiPath(pathname);
  if (!route.matched || !route.selector || !route.repositoryPath?.startsWith('/configuration/')) return { handled: false };
  const context = resolveRepositoryApiContext(pathname, options);
  if (!context) return { handled: false };

  if (context.pathname === '/api/configuration/paseo-connection' && method === 'GET') {
    return response({ status: await managerPaseoConnectionStatus(context, options) });
  }
  if (context.pathname === '/api/configuration/paseo-connection/connect' && method === 'POST') {
    return response({ status: await connectManagerPaseo(context, body, options) });
  }
  if (context.pathname === '/api/configuration/harnesses' && method === 'GET') {
    return response(await managerHarnessCatalog(context, options));
  }
  if (context.pathname === '/api/configuration/branches' && method === 'GET') {
    return response(managerBranchCatalog(context, options));
  }
  if (context.pathname === '/api/configuration/chatgpt-profile' && method === 'GET') {
    return response({ status: chatGptStatus(context.root, options) });
  }
  if (context.pathname === '/api/configuration/chatgpt-profile/playwright/install' && method === 'POST') {
    const install = options.installPlaywright || installPlaywrightLibrary;
    const result = await install(options.playwrightOptions || {});
    return response({ result, status: chatGptStatus(context.root, options) });
  }
  if (context.pathname === '/api/configuration/chatgpt-profile/chromium/install' && method === 'POST') {
    const install = options.installChromium || installPlaywrightChromium;
    const result = await install(options.browserOptions || {});
    return response({ result, status: chatGptStatus(context.root, options) });
  }
  if (context.pathname === '/api/configuration/chatgpt-profile/open' && method === 'POST') {
    return response(await openChatGptProfile(context.root, options));
  }
  if (context.pathname === '/api/configuration/chatgpt-profile/chat' && method === 'POST') {
    return response(await saveChatGptConversation(context.root, body, options));
  }

  return response({ error: `Configuration route ${context.pathname} is not available for ${method}.` }, method === 'GET' ? 404 : 405);
}
