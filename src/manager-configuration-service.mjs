import { bringBrowserToForeground } from './browser-foreground.mjs';
import {
  installPlaywrightChromium,
  launchBrowserForLogin,
} from './browser-service.mjs';
import {
  chatGptProfilePrerequisites,
  configureChatGptReviewChat,
} from './chatgpt-profile-readiness.mjs';
import { installPlaywrightLibrary } from './playwright-installer.mjs';
import { loadPrReviewStore, savePrAutomationConfig } from './pr-review-store.mjs';
import { run as defaultRun } from './process.mjs';
import { parseRepositoryApiPath, resolveRepositoryApiContext } from './repository-api-context.mjs';
import { discoverPaseoCatalog } from './setup-discovery.mjs';
import { createPaseoConnectionContext, redactSensitive } from './setup-wizard/paseo-connection.mjs';
import { loadSetupSessionStore } from './setup-wizard/store.mjs';

function repositoryName(session = {}) {
  const selected = String(session.pages?.repository?.selections?.repository || '').trim();
  if (selected) return selected;
  const owner = String(session.repository?.owner || '').trim();
  const name = String(session.repository?.name || '').trim();
  return owner && name ? `${owner}/${name}` : null;
}

function matchingSetupSession(repository, options = {}) {
  const name = String(repository || '').trim();
  if (!name || !options.rootDir) return null;
  const store = loadSetupSessionStore(options);
  const sessions = [store.activeSession, ...(store.completedSessions || []).slice().reverse()].filter(Boolean);
  return sessions.find((session) => repositoryName(session) === name) || null;
}

function publicCatalog(catalog) {
  const safe = redactSensitive(catalog || {});
  return {
    providers: (safe.providers || []).map((provider) => ({
      id: String(provider.id),
      label: String(provider.label || provider.id),
      status: String(provider.status || 'available'),
      defaultMode: provider.defaultMode || null,
      modes: Array.isArray(provider.modes) ? provider.modes : [],
      models: (provider.models || []).map((model) => ({
        id: String(model.id),
        label: String(model.label || model.id),
        description: String(model.description || ''),
        value: String(model.value || `${provider.id}/${model.id}`),
        thinkingOptionIds: Array.isArray(model.thinkingOptionIds) ? model.thinkingOptionIds.map(String) : [],
        defaultThinkingOptionId: model.defaultThinkingOptionId == null ? null : String(model.defaultThinkingOptionId),
      })),
      noModels: !(provider.models || []).length && !provider.error?.includes('Could not list models'),
      warning: provider.error || null,
    })),
    errors: Array.isArray(safe.errors) ? safe.errors.map(String) : [],
    complete: safe.complete === true,
    elapsedMs: Number(safe.elapsedMs || 0),
  };
}

async function harnessCatalog(context, options = {}) {
  const session = matchingSetupSession(context.repository.repository, options);
  if (!session) throw new Error('No saved Paseo setup connection was found for this repository. Open Connect Paseo and verify it first.');
  const host = String(session.pages?.paseo?.selections?.host || '').trim();
  if (!host) throw new Error('No saved Paseo host was found for this repository. Open Connect Paseo and verify it first.');
  const stored = options.credentialStore ? await options.credentialStore.read(host).catch(() => null) : null;
  const contextFactory = options.paseoContextFactory || createPaseoConnectionContext;
  const paseo = contextFactory({
    host,
    password: stored?.password || null,
    cwd: context.root,
    env: options.env,
    run: options.run,
    runJson: options.runJson,
  });
  const loader = options.catalogLoader || ((root, discoveryOptions) => discoverPaseoCatalog(root, discoveryOptions));
  const runner = (command, args, runnerOptions = {}) => {
    if (command === 'paseo') return paseo.command(args, runnerOptions);
    return (options.run || defaultRun)(command, args, runnerOptions);
  };
  const catalog = await loader(context.root, {
    runner,
    commandTimeoutMs: options.commandTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
  });
  return {
    host,
    catalog: publicCatalog(catalog),
  };
}

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

function response(body, status = 200) {
  return { handled: true, status, body };
}

export async function managerConfigurationApiRequest({ method, pathname, body = {} }, options = {}) {
  const route = parseRepositoryApiPath(pathname);
  if (!route.matched || !route.selector || !route.repositoryPath?.startsWith('/configuration/')) return { handled: false };
  const context = resolveRepositoryApiContext(pathname, options);
  if (!context) return { handled: false };

  if (context.pathname === '/api/configuration/harnesses' && method === 'GET') {
    return response(await harnessCatalog(context, options));
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
