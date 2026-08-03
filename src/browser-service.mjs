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
  saveBrowserConfig,
} from './browser-profile.mjs';
import { isLoginOrHomeUrl, normalizeChatGptConversationUrl, sameConversationUrl } from './chatgpt-url.mjs';

const require = createRequire(import.meta.url);

function playwrightCliPath() {
  try { return require.resolve('playwright-core/cli'); } catch { return null; }
}

export function uninstallPlaywrightBrowsers() {
  const cli = playwrightCliPath();
  if (!cli) return { removed: false, reason: 'playwright-core is not installed' };
  const result = spawnSync(process.execPath, [cli, 'uninstall'], { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || 'Playwright browser uninstall failed.').trim());
  return { removed: true, stdout: String(result.stdout || '').trim() };
}

export function playwrightLibraryStatus() {
  let modulePath = null;
  try { modulePath = require.resolve('playwright-core'); } catch {}
  return { installed: Boolean(modulePath), modulePath, cliPath: playwrightCliPath() };
}

export function installPlaywrightChromium({ withSystemDependencies = false } = {}) {
  const cli = playwrightCliPath();
  if (!cli) throw new Error('playwright-core is not installed. Reinstall this package with optional dependencies enabled.');
  const commands = [];
  if (withSystemDependencies) commands.push(['install-deps', 'chromium']);
  commands.push(['install', 'chromium']);
  const results = [];
  for (const args of commands) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' });
    results.push({ args, status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() });
    if (result.status !== 0) {
      const elevated = args[0] === 'install-deps';
      const hint = elevated ? ' Installing operating-system dependencies may require elevated privileges.' : '';
      throw new Error(`Playwright ${args.join(' ')} failed.${hint} ${results.at(-1).stderr || results.at(-1).stdout}`.trim());
    }
  }
  saveBrowserConfig({ browserInstalledAt: new Date().toISOString() });
  return { installed: true, results };
}

async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch { throw new Error('playwright-core is unavailable. Run the browser install command first.'); }
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

export async function inspectConversation({ conversationUrl, headless = true, sendTestPrompt = false } = {}) {
  const normalized = normalizeChatGptConversationUrl(conversationUrl);
  const lease = acquireBrowserProfileLease({ purpose: 'conversation-test', metadata: { conversation: normalized } });
  if (!lease.acquired) throw new Error('The dedicated ChatGPT browser profile is already in use.');
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
    saveBrowserConfig({ lastConversationUrl: normalized, lastAuthenticatedAt: new Date().toISOString() });
    return { ok: true, authenticated: true, conversationUrl: normalized, composerFound: true, testPromptSent: sendTestPrompt };
  } finally {
    if (context) await context.close().catch(() => {});
    releaseBrowserProfileLease(lease.lease.id);
  }
}

export async function launchBrowserForLogin({ conversationUrl = 'https://chatgpt.com/' } = {}) {
  const lease = acquireBrowserProfileLease({ purpose: 'manual-login' });
  if (!lease.acquired) throw new Error('The dedicated ChatGPT browser profile is already in use.');
  let context;
  try {
    const launched = await launchContext({ headless: false });
    context = launched.context;
    await launched.page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const session = { context, page: launched.page, leaseId: lease.lease.id, closed: false };
    context.on('close', () => {
      session.closed = true;
      releaseBrowserProfileLease(lease.lease.id);
    });
    return session;
  } catch (error) {
    if (context) await context.close().catch(() => {});
    releaseBrowserProfileLease(lease.lease.id);
    throw error;
  }
}

export async function closeManualBrowser(session) {
  if (!session) return;
  await session.context?.close().catch(() => {});
  session.closed = true;
  if (session.leaseId) releaseBrowserProfileLease(session.leaseId);
}

export async function submitReviewPrompt({ conversationUrl, prompt, reviewRequestId }) {
  const normalized = normalizeChatGptConversationUrl(conversationUrl);
  const lease = acquireBrowserProfileLease({ purpose: 'review-submission', metadata: { reviewRequestId } });
  if (!lease.acquired) throw new Error('The dedicated ChatGPT browser profile is already in use.');
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
    const composer = await locateMessageComposer(page, { timeoutMs: 12_000 });
    await composer.fill(prompt).catch(async () => {
      await composer.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.insertText(prompt);
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    saveBrowserConfig({ lastConversationUrl: normalized, lastAuthenticatedAt: new Date().toISOString() });
    return { submitted: true, submittedAt: new Date().toISOString(), conversationUrl: normalized };
  } catch (error) {
    const diagnostics = page ? await diagnosticFailure(page, error, { reviewRequestId }) : { screenshot: null, diagnostic: null };
    error.diagnostics = diagnostics;
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    releaseBrowserProfileLease(lease.lease.id);
  }
}

export function browserDoctor() {
  const library = playwrightLibraryStatus();
  return {
    library: { installed: library.installed },
    profile: browserProfileStatus(),
    config: loadBrowserConfig(),
  };
}
