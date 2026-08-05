import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  acquireBrowserProfileLease,
  browserPaths,
  browserProfileStatus,
  loadBrowserConfig,
  releaseBrowserProfileLease,
  renewBrowserProfileLease,
  saveBrowserConfig,
} from './browser-profile.mjs';
import { isLoginOrHomeUrl, normalizeChatGptConversationUrl, sameConversationUrl } from './chatgpt-url.mjs';
import { buildWindowsCmdInvocation } from './process.mjs';

const require = createRequire(import.meta.url);
const BROWSER_LEASE_TTL_MS = 180_000;
const BROWSER_COMMAND_TIMEOUT_MS = 15 * 60_000;

export function playwrightCommand(platform = process.platform) {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function playwrightInstallArgs(platform = process.platform) {
  return platform === 'linux'
    ? ['playwright', 'install', '--with-deps', 'chromium']
    : ['playwright', 'install', 'chromium'];
}

export function playwrightSpawnInvocation(args, {
  platform = process.platform,
  env = process.env,
} = {}) {
  const command = playwrightCommand(platform);
  if (platform === 'win32') return buildWindowsCmdInvocation(command, args, env);
  return { executable: command, args: [...args], windowsVerbatimArguments: false };
}

function runPlaywrightCommand(args, {
  platform = process.platform,
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const invocation = playwrightSpawnInvocation(args, { platform, env });
  return spawn(invocation.executable, invocation.args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: BROWSER_COMMAND_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
  });
}

export function uninstallPlaywrightBrowsers(options = {}) {
  if (!playwrightLibraryStatus().installed) {
    return { removed: false, reason: 'playwright is not installed' };
  }
  const result = runPlaywrightCommand(['playwright', 'uninstall'], options);
  if (result.error?.code === 'ETIMEDOUT') throw new Error('Playwright browser uninstall timed out.');
  if (result.error) throw new Error(`Unable to run Playwright: ${result.error.message}`);
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || 'Playwright browser uninstall failed.').trim());
  return { removed: true, stdout: String(result.stdout || '').trim() };
}

export function playwrightLibraryStatus() {
  let modulePath = null;
  try { modulePath = require.resolve('playwright'); } catch {}
  return { installed: Boolean(modulePath), modulePath };
}

export function installPlaywrightChromium(options = {}) {
  if (!playwrightLibraryStatus().installed) {
    throw new Error('Playwright is unavailable. Reinstall Paseo Issue Automation so its required dependencies are installed.');
  }
  const platform = options.platform || process.platform;
  const args = playwrightInstallArgs(platform);
  const result = runPlaywrightCommand(args, { ...options, platform });
  if (result.error?.code === 'ETIMEDOUT') throw new Error('Chromium installation timed out.');
  if (result.error) throw new Error(`Unable to run Playwright: ${result.error.message}`);
  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || 'Playwright could not install Chromium.').trim();
    const hint = platform === 'linux'
      ? ' Installing Linux browser dependencies may require administrator privileges.'
      : '';
    throw new Error(`Chromium installation failed.${hint} ${output}`.trim());
  }
  saveBrowserConfig({ browserInstalledAt: new Date().toISOString() });
  return {
    installed: true,
    command: [playwrightCommand(platform), ...args],
    stdout: String(result.stdout || '').trim(),
  };
}

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch { throw new Error('Playwright is unavailable. Reinstall Paseo Issue Automation, then run Install Chromium.'); }
}

function composerCandidates(page) {
  return [
    page.getByRole('textbox', { name: /message|prompt|chat/i }).last(),
    page.locator('textarea[placeholder*="Message" i]').last(),
    page.locator('[contenteditable="true"][data-lexical-editor="true"]').last(),
    page.locator('[contenteditable="true"]').last(),
  ];
}

export async function locateMessageComposer(page, { timeoutMs = 10_000 } = {}) {
  for (const locator of composerCandidates(page)) {
    try {
      await locator.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 3_000) });
      if (await locator.isEnabled().catch(() => true)) return locator;
    } catch {}
  }
  throw new Error('A usable ChatGPT message composer could not be located.');
}

async function diagnosticFailure(page, error, { reviewRequestId = 'browser', stage = 'submission' } = {}) {
  const paths = browserPaths();
  const safeId = String(reviewRequestId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${safeId}-${stage}-${stamp}`;
  const screenshot = path.join(paths.diagnostics, `${base}.png`);
  const diagnostic = path.join(paths.diagnostics, `${base}.json`);
  try { await page.screenshot({ path: screenshot, fullPage: true }); } catch {}
  let safeUrl = null;
  try { const current = new URL(page.url()); safeUrl = current.origin + current.pathname; } catch {}
  const payload = {
    stage,
    at: new Date().toISOString(),
    url: safeUrl,
    error: String(error?.message || error),
  };
  writeFileSync(diagnostic, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { screenshot: existsSync(screenshot) ? path.basename(screenshot) : null, diagnostic: path.basename(diagnostic) };
}

async function launchContext({ headless = false } = {}) {
  const { chromium } = await loadPlaywright();
  const paths = browserPaths();
  const context = await chromium.launchPersistentContext(paths.profile, {
    headless,
    viewport: { width: 1440, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const pages = context.pages();
  return { context, page: pages[0] || await context.newPage() };
}

async function composerText(composer) {
  return String(await composer.inputValue().catch(async () => await composer.textContent().catch(() => '')) || '').trim();
}

async function requestAlreadyVisible(page, reviewRequestId) {
  if (!reviewRequestId) return false;
  return (await page.getByText(reviewRequestId, { exact: false }).count().catch(() => 0)) > 0;
}

async function waitForSubmissionAcknowledgement(page, composer, reviewRequestId) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const cleared = !(await composerText(composer));
    const visible = await requestAlreadyVisible(page, reviewRequestId);
    if (cleared && visible) return true;
    await page.waitForTimeout(300);
  }
  throw new Error('ChatGPT did not visibly acknowledge the submitted review prompt.');
}

export async function inspectConversation({ conversationUrl, headless = true, sendTestPrompt = false } = {}) {
  const normalized = normalizeChatGptConversationUrl(conversationUrl);
  const lease = acquireBrowserProfileLease({ purpose: 'conversation-test', metadata: { conversation: normalized } });
  if (!lease.acquired) throw new Error('The dedicated ChatGPT browser profile is already in use.');
  const heartbeat = startProfileHeartbeat(lease.lease.id, { conversation: normalized, purpose: 'conversation-test' });
  let context;
  try {
    const launched = await launchContext({ headless });
    context = launched.context;
    const page = launched.page;
    await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1_500);
    if (isLoginOrHomeUrl(page.url())) throw new Error('ChatGPT redirected to login or home; authenticate the dedicated profile first.');
    if (!sameConversationUrl(page.url(), normalized)) throw new Error('ChatGPT opened an unexpected conversation.');
    const composer = await locateMessageComposer(page);
    if (sendTestPrompt) {
      const harmless = `Paseo browser test ${new Date().toISOString()}. Reply with OK only.`;
      await composer.fill(harmless).catch(async () => {
        await composer.click();
        await page.keyboard.insertText(harmless);
      });
      await page.keyboard.press('Enter');
    }
    if (heartbeat.error()) throw heartbeat.error();
    saveBrowserConfig({ lastConversationUrl: normalized, lastAuthenticatedAt: new Date().toISOString() });
    return { ok: true, authenticated: true, conversationUrl: normalized, composerFound: true, testPromptSent: sendTestPrompt };
  } finally {
    heartbeat.stop();
    if (context) await context.close().catch(() => {});
    releaseBrowserProfileLease(lease.lease.id);
  }
}

export async function launchBrowserForLogin({ conversationUrl = 'https://chatgpt.com/' } = {}) {
  const lease = acquireBrowserProfileLease({ purpose: 'manual-login' });
  if (!lease.acquired) throw new Error('The dedicated ChatGPT browser profile is already in use.');
  const heartbeat = startProfileHeartbeat(lease.lease.id, { purpose: 'manual-login' });
  let context;
  try {
    const launched = await launchContext({ headless: false });
    context = launched.context;
    await launched.page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const session = { context, page: launched.page, leaseId: lease.lease.id, heartbeat, closed: false };
    context.on('close', () => {
      session.closed = true;
      heartbeat.stop();
      releaseBrowserProfileLease(lease.lease.id);
    });
    return session;
  } catch (error) {
    heartbeat.stop();
    if (context) await context.close().catch(() => {});
    releaseBrowserProfileLease(lease.lease.id);
    throw error;
  }
}

export async function closeManualBrowser(session) {
  if (!session) return;
  session.heartbeat?.stop();
  await session.context?.close().catch(() => {});
  session.closed = true;
  if (session.leaseId) releaseBrowserProfileLease(session.leaseId);
}

export async function submitReviewPrompt({ conversationUrl, prompt, reviewRequestId }) {
  const normalized = normalizeChatGptConversationUrl(conversationUrl);
  const lease = acquireBrowserProfileLease({ purpose: 'review-submission', metadata: { reviewRequestId } });
  if (!lease.acquired) throw new Error('The dedicated ChatGPT browser profile is already in use.');
  const heartbeat = startProfileHeartbeat(lease.lease.id, { purpose: 'review-submission', reviewRequestId });
  let context;
  let page;
  try {
    const launched = await launchContext({ headless: false });
    context = launched.context;
    page = launched.page;
    await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1_500);
    if (isLoginOrHomeUrl(page.url())) throw new Error('ChatGPT redirected to login or home.');
    if (!sameConversationUrl(page.url(), normalized)) throw new Error('ChatGPT redirected to a different conversation.');
    if (await requestAlreadyVisible(page, reviewRequestId)) {
      return { submitted: true, recoveredExistingSubmission: true, submittedAt: new Date().toISOString(), conversationUrl: normalized };
    }
    const composer = await locateMessageComposer(page, { timeoutMs: 12_000 });
    await composer.fill(prompt).catch(async () => {
      await composer.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.insertText(prompt);
    });
    await page.keyboard.press('Enter');
    await waitForSubmissionAcknowledgement(page, composer, reviewRequestId);
    if (heartbeat.error()) throw heartbeat.error();
    saveBrowserConfig({ lastConversationUrl: normalized, lastAuthenticatedAt: new Date().toISOString() });
    return { submitted: true, submittedAt: new Date().toISOString(), conversationUrl: normalized };
  } catch (error) {
    const diagnostics = page ? await diagnosticFailure(page, error, { reviewRequestId }) : { screenshot: null, diagnostic: null };
    error.diagnostics = diagnostics;
    throw error;
  } finally {
    heartbeat.stop();
    if (context) await context.close().catch(() => {});
    releaseBrowserProfileLease(lease.lease.id);
  }
}

export function browserDoctor() {
  const library = playwrightLibraryStatus();
  return {
    library: { installed: library.installed, modulePath: library.modulePath },
    profile: browserProfileStatus(),
    config: loadBrowserConfig(),
  };
}

function startProfileHeartbeat(leaseId, metadata) {
  let error = null;
  const timer = setInterval(() => {
    try { renewBrowserProfileLease(leaseId, { ttlMs: BROWSER_LEASE_TTL_MS, metadata }); }
    catch (caught) { error = caught; clearInterval(timer); }
  }, 45_000);
  timer.unref?.();
  return {
    stop() { clearInterval(timer); },
    error() { return error; },
  };
}
