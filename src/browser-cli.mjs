import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  browserDoctor,
  closeManualBrowser,
  inspectConversation,
  installPlaywrightChromium,
  launchBrowserForLogin,
  locateMessageComposer,
  playwrightLibraryStatus,
  uninstallPlaywrightBrowsers,
} from './browser-service.mjs';
import {
  browserPaths,
  loadBrowserConfig,
  resetBrowserProfile,
  saveBrowserConfig,
  uninstallBrowserState,
} from './browser-profile.mjs';
import { normalizeChatGptConversationUrl } from './chatgpt-url.mjs';
import { saveValidatedPrAutomationConfig } from './pr-review-config.mjs';

async function waitForEnter(message) {
  const rl = createInterface({ input, output });
  try { await rl.question(`${message}\nPress Enter when finished… `); }
  finally { rl.close(); }
}

async function manualLogin() {
  const session = await launchBrowserForLogin({ conversationUrl: 'https://chatgpt.com/' });
  try {
    await waitForEnter('Log in to ChatGPT manually in the dedicated Paseo browser. Do not enter credentials into Paseo.');
    saveBrowserConfig({ lastAuthenticatedAt: new Date().toISOString() });
    return { authenticated: true };
  } finally { await closeManualBrowser(session); }
}

async function configureConversation(root, { scope = 'project', url = null } = {}) {
  if (url) {
    const normalized = normalizeChatGptConversationUrl(url);
    await inspectConversation({ conversationUrl: normalized, headless: true });
    if (scope === 'global') saveBrowserConfig({ globalConversationUrl: normalized, lastConversationUrl: normalized });
    else saveValidatedPrAutomationConfig(root, { browserReview: { projectConversationUrl: normalized } });
    return { scope, conversationUrl: normalized };
  }
  const current = loadBrowserConfig().globalConversationUrl || 'https://chatgpt.com/';
  const session = await launchBrowserForLogin({ conversationUrl: current });
  try {
    await waitForEnter('Navigate to the exact ChatGPT conversation Paseo should use.');
    const normalized = normalizeChatGptConversationUrl(session.page.url());
    await locateMessageComposer(session.page);
    if (scope === 'global') saveBrowserConfig({ globalConversationUrl: normalized, lastConversationUrl: normalized, lastAuthenticatedAt: new Date().toISOString() });
    else saveValidatedPrAutomationConfig(root, { browserReview: { projectConversationUrl: normalized } });
    return { scope, conversationUrl: normalized };
  } finally { await closeManualBrowser(session); }
}

export async function runBrowserCommand(root, command, options = {}) {
  if (command === 'install') return installPlaywrightChromium({ withSystemDependencies: options.deps === true });
  if (command === 'login') return manualLogin();
  if (command === 'configure') return configureConversation(root, { scope: options.scope || 'project', url: options.url || null });
  if (command === 'doctor') return browserDoctor();
  if (command === 'test') {
    const url = options.url || loadBrowserConfig().globalConversationUrl;
    if (!url) throw new Error('No conversation URL is configured.');
    return inspectConversation({ conversationUrl: url, headless: options.visible !== true, sendTestPrompt: options.send === true });
  }
  if (command === 'debug') {
    const url = options.url || loadBrowserConfig().globalConversationUrl || 'https://chatgpt.com/';
    const session = await launchBrowserForLogin({ conversationUrl: url });
    try {
      await waitForEnter(`Debug browser opened. Dedicated profile is active.`);
      return { opened: true, url: session.page.url() };
    } finally { await closeManualBrowser(session); }
  }
  if (command === 'reset') return resetBrowserProfile();
  if (command === 'uninstall') return { browsers: uninstallPlaywrightBrowsers(), state: uninstallBrowserState() };
  if (command === 'setup') {
    const library = playwrightLibraryStatus();
    if (!library.installed) throw new Error('playwright-core is unavailable. Reinstall with optional dependencies enabled.');
    installPlaywrightChromium({ withSystemDependencies: options.deps === true });
    await manualLogin();
    const destination = await configureConversation(root, { scope: options.scope || 'project', url: options.url || null });
    const test = await inspectConversation({ conversationUrl: destination.conversationUrl, headless: true, sendTestPrompt: options.send === true });
    return { installed: true, destination, test };
  }
  throw new Error(`Unknown browser command: ${command}`);
}
