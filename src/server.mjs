import http from 'node:http';
import { spawn } from 'node:child_process';
import { dashboardHtml } from './ui.mjs';
import { prReviewDashboardHtml } from './pr-review-dashboard.mjs';
import { dispatchAvailableIssues } from './dispatch-batch.mjs';
import { dashboardStatus } from './dashboard-status.mjs';
import { automationStatus, setClaimsEnabled } from './automation.mjs';
import {
  abandonAttempt,
  openAttemptWorkspace,
  operationalStatus,
  reconcileDependencies,
  skipIssue,
  unskipIssue,
  updateManagedDispatch,
} from './attempts.mjs';
import {
  clearLocalAutomationState,
  createAutomationWorkspace,
  finishSetup,
  guidedUninstall,
  installIssueTemplate,
  installLabels,
  installPaseoService,
  installRepositoryIntegration,
  installationPreview,
  removeAllManagedLabels,
  removeAutomationWorkspace,
  removeIssueTemplate,
  removeLabel,
  removePaseoIntegration,
  repairLabel,
  runSetupSelfTest,
  setupSnapshot,
} from './install.mjs';
import { loadConfig, repositoryRoot, saveConfig } from './state.mjs';
import { dispatchSpecificCodingIssue, restartCodingIssue } from './coding-dispatch.mjs';
import {
  applyManualReviewResult,
  cancelQueuedReview,
  enqueueManagedReview,
  moveReviewJob,
  pauseManagedPr,
  retryReviewJob,
} from './pr-review-queue.mjs';
import { loadPrReviewStore, setReviewQueuePaused } from './pr-review-store.mjs';
import { saveValidatedPrAutomationConfig } from './pr-review-config.mjs';
import { prReviewStatus } from './pr-review-status.mjs';
import { reconcileManagedPullRequests, recoverPrReviewState } from './pr-review-reconcile.mjs';
import { tickReviewScheduler } from './pr-review-scheduler.mjs';
import {
  browserDoctor,
  closeManualBrowser,
  inspectConversation,
  installPlaywrightChromium,
  launchBrowserForLogin,
  locateMessageComposer,
  uninstallPlaywrightBrowsers,
} from './browser-service.mjs';
import { loadBrowserConfig, resetBrowserProfile, saveBrowserConfig, uninstallBrowserState } from './browser-profile.mjs';
import { normalizeChatGptConversationUrl } from './chatgpt-url.mjs';
import {
  cancelAssociatedIssue,
  markManagedPrManuallyResolved,
  reopenClosedPullRequest,
  returnIssueToBacklog,
  returnIssueToCodingQueue,
} from './closed-unmerged-actions.mjs';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function combinedSnapshot(root) {
  const snapshot = setupSnapshot(root);
  let automation = null;
  if (snapshot.requirements.githubAuthenticated) {
    try {
      const basic = { ...automationStatus(root), ...operationalStatus(root) };
      automation = dashboardStatus(root, basic);
    } catch {
      automation = null;
    }
  }
  let prReviews = null;
  try { prReviews = prReviewStatus(root); } catch {}
  return { ...snapshot, automation, prReviews };
}

export async function startServer({ cwd = process.cwd(), open = false } = {}) {
  const root = repositoryRoot(cwd);
  let codingTimer = null;
  let reviewTimer = null;
  let reconciliationTimer = null;
  let manualBrowserSession = null;

  const dispatch = () => {
    try {
      const result = dispatchAvailableIssues(root);
      updateManagedDispatch(root, result);
      return result;
    } catch (error) {
      const result = { claimed: false, error: error.message };
      updateManagedDispatch(root, result);
      throw error;
    }
  };

  const resetCodingTimer = () => {
    if (codingTimer) clearInterval(codingTimer);
    const config = loadConfig(root);
    codingTimer = setInterval(() => {
      try { dispatch(); } catch (error) { console.error(JSON.stringify({ subsystem: 'coding-scheduler', error: error.message })); }
    }, config.pollIntervalSeconds * 1000);
    codingTimer.unref();
  };

  const resetPrReviewTimers = () => {
    if (reviewTimer) clearInterval(reviewTimer);
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    reviewTimer = setInterval(() => {
      try { tickReviewScheduler(root); } catch (error) { console.error(JSON.stringify({ subsystem: 'serial-review-scheduler', error: error.message })); }
    }, 5_000);
    reviewTimer.unref();
    const store = loadPrReviewStore(root);
    const interval = store.managedPullRequests.some((record) => !['merged', 'closed_unmerged'].includes(record.reviewState))
      ? store.config.reconciliation.activeIntervalMs
      : store.config.reconciliation.idleIntervalMs;
    reconciliationTimer = setInterval(() => {
      try {
        if (loadPrReviewStore(root).config.reconciliation.enabled) reconcileManagedPullRequests(root);
      } catch (error) { console.error(JSON.stringify({ subsystem: 'github-reconciliation', error: error.message })); }
    }, interval);
    reconciliationTimer.unref();
  };

  try { recoverPrReviewState(root); } catch (error) {
    console.error(JSON.stringify({ subsystem: 'startup-recovery', error: error.message }));
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(dashboardHtml());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/pr-reviews') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(prReviewDashboardHtml());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        json(response, 200, combinedSnapshot(root));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/pr-reviews/status') {
        json(response, 200, prReviewStatus(root));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/preview') {
        json(response, 200, installationPreview(root));
        return;
      }
      if (request.method !== 'POST') {
        json(response, 404, { error: 'Not found' });
        return;
      }

      const body = await readBody(request);
      let result = null;
      if (url.pathname === '/api/install') result = installRepositoryIntegration(root);
      else if (url.pathname === '/api/install/issue-template') result = installIssueTemplate(root);
      else if (url.pathname === '/api/repair/issue-template') result = installIssueTemplate(root, { overwriteManaged: true });
      else if (url.pathname === '/api/install/paseo-service') result = installPaseoService(root);
      else if (url.pathname === '/api/repair/paseo-service') result = installPaseoService(root, { overwriteManaged: true });
      else if (url.pathname === '/api/install/labels') result = installLabels(root);
      else if (url.pathname === '/api/repair/label') result = repairLabel(root, body.label);
      else if (url.pathname === '/api/remove/issue-template') result = removeIssueTemplate(root);
      else if (url.pathname === '/api/remove/paseo-integration') result = removePaseoIntegration(root);
      else if (url.pathname === '/api/remove/label') result = removeLabel(root, body.label, { force: body.force === true });
      else if (url.pathname === '/api/remove/labels') result = removeAllManagedLabels(root, { force: body.force === true });
      else if (url.pathname === '/api/workspace') result = createAutomationWorkspace(root);
      else if (url.pathname === '/api/remove/workspace') result = removeAutomationWorkspace(root);
      else if (url.pathname === '/api/self-test') result = runSetupSelfTest(root);
      else if (url.pathname === '/api/clear-state') result = clearLocalAutomationState(root, { force: body.force === true });
      else if (url.pathname === '/api/uninstall') result = guidedUninstall(root, body);
      else if (url.pathname === '/api/start-issue') result = dispatchSpecificCodingIssue(root, Number(body.issueNumber), { branchAction: body.branchAction || 'keep' });
      else if (url.pathname === '/api/skip-issue') result = skipIssue(root, Number(body.issueNumber));
      else if (url.pathname === '/api/unskip-issue') result = unskipIssue(root, Number(body.issueNumber));
      else if (url.pathname === '/api/abandon-issue') result = abandonAttempt(root, Number(body.issueNumber), body.reason || 'Abandoned by user');
      else if (url.pathname === '/api/restart-issue') result = restartCodingIssue(root, Number(body.issueNumber), { branchAction: body.branchAction || 'keep' });
      else if (url.pathname === '/api/open-attempt-workspace') result = openAttemptWorkspace(root, Number(body.issueNumber));
      else if (url.pathname === '/api/reconcile') result = reconcileDependencies(root);
      else if (url.pathname === '/api/config') {
        const current = loadConfig(root);
        result = saveConfig(root, { ...current, ...body, models: { ...current.models, ...(body.models || {}) } });
        resetCodingTimer();
      } else if (url.pathname === '/api/finish') {
        result = finishSetup(root);
        setClaimsEnabled(root, false);
      } else if (url.pathname === '/api/resume') result = setClaimsEnabled(root, true);
      else if (url.pathname === '/api/pause') result = setClaimsEnabled(root, false);
      else if (url.pathname === '/api/run-now') result = dispatch();
      else if (url.pathname === '/api/pr-reviews/config') {
        result = saveValidatedPrAutomationConfig(root, body);
        resetPrReviewTimers();
      } else if (url.pathname === '/api/pr-reviews/pause') result = setReviewQueuePaused(root, true);
      else if (url.pathname === '/api/pr-reviews/resume') result = setReviewQueuePaused(root, false);
      else if (url.pathname === '/api/pr-reviews/review-now') result = enqueueManagedReview(root, String(body.managedPullRequestId), {
        immediate: true,
        conversationUrlOverride: body.conversationUrlOverride ? normalizeChatGptConversationUrl(body.conversationUrlOverride) : null,
      });
      else if (url.pathname === '/api/pr-reviews/retry') result = retryReviewJob(root, String(body.reviewJobId));
      else if (url.pathname === '/api/pr-reviews/move') result = moveReviewJob(root, String(body.reviewJobId), body.direction === 'up' ? 'up' : 'down');
      else if (url.pathname === '/api/pr-reviews/pause-pr') result = pauseManagedPr(root, String(body.managedPullRequestId), true);
      else if (url.pathname === '/api/pr-reviews/resume-pr') result = pauseManagedPr(root, String(body.managedPullRequestId), false);
      else if (url.pathname === '/api/pr-reviews/cancel') result = cancelQueuedReview(root, String(body.reviewJobId));
      else if (url.pathname === '/api/pr-reviews/manual-result') result = applyManualReviewResult(root, String(body.managedPullRequestId), { result: body.result, findings: body.findings || '' });
      else if (url.pathname === '/api/pr-reviews/send-to-coding') result = dispatch();
      else if (url.pathname === '/api/pr-reviews/reconcile') result = reconcileManagedPullRequests(root);
      else if (url.pathname === '/api/pr-reviews/browser/install') result = installPlaywrightChromium({ withSystemDependencies: body.withSystemDependencies === true });
      else if (url.pathname === '/api/pr-reviews/browser/open') {
        if (manualBrowserSession?.closed) manualBrowserSession = null;
        if (manualBrowserSession) throw new Error('The dedicated browser is already open.');
        const destination = body.url || loadBrowserConfig().globalConversationUrl || 'https://chatgpt.com/';
        manualBrowserSession = await launchBrowserForLogin({ conversationUrl: destination });
        result = { opened: true, url: manualBrowserSession.page.url() };
      } else if (url.pathname === '/api/pr-reviews/browser/use-current') {
        if (!manualBrowserSession) throw new Error('The dedicated browser is not open.');
        const conversationUrl = normalizeChatGptConversationUrl(manualBrowserSession.page.url());
        await locateMessageComposer(manualBrowserSession.page);
        if (body.scope === 'global') saveBrowserConfig({ globalConversationUrl: conversationUrl, lastConversationUrl: conversationUrl, lastAuthenticatedAt: new Date().toISOString() });
        else saveValidatedPrAutomationConfig(root, { browserReview: { projectConversationUrl: conversationUrl } });
        result = { conversationUrl, scope: body.scope === 'global' ? 'global' : 'project' };
      } else if (url.pathname === '/api/pr-reviews/browser/close') {
        await closeManualBrowser(manualBrowserSession);
        manualBrowserSession = null;
        result = { closed: true };
      } else if (url.pathname === '/api/pr-reviews/browser/test') {
        const destination = body.url || loadPrReviewStore(root).config.browserReview.projectConversationUrl || loadBrowserConfig().globalConversationUrl;
        result = await inspectConversation({ conversationUrl: destination, headless: body.visible !== true, sendTestPrompt: body.sendTestPrompt === true });
      } else if (url.pathname === '/api/pr-reviews/browser/doctor') result = browserDoctor();
      else if (url.pathname === '/api/pr-reviews/browser/reset') result = resetBrowserProfile();
      else if (url.pathname === '/api/pr-reviews/browser/uninstall') result = { browsers: uninstallPlaywrightBrowsers(), state: uninstallBrowserState() };
      else if (url.pathname === '/api/pr-reviews/closed/reopen') result = reopenClosedPullRequest(root, String(body.managedPullRequestId));
      else if (url.pathname === '/api/pr-reviews/closed/return-coding') result = returnIssueToCodingQueue(root, String(body.managedPullRequestId));
      else if (url.pathname === '/api/pr-reviews/closed/backlog') result = returnIssueToBacklog(root, String(body.managedPullRequestId));
      else if (url.pathname === '/api/pr-reviews/closed/cancel-issue') result = cancelAssociatedIssue(root, String(body.managedPullRequestId));
      else if (url.pathname === '/api/pr-reviews/closed/manual-resolved') result = markManagedPrManuallyResolved(root, String(body.managedPullRequestId), body.note || 'Marked manually resolved by operator.');
      else {
        json(response, 404, { error: 'Not found' });
        return;
      }
      json(response, 200, { result, snapshot: combinedSnapshot(root) });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });

  const requestedPort = Number(process.env.PASEO_PORT || 4317);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Issue Execution Controller dashboard: ${url}`);
  resetCodingTimer();
  resetPrReviewTimers();
  server.on('close', async () => {
    if (codingTimer) clearInterval(codingTimer);
    if (reviewTimer) clearInterval(reviewTimer);
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    await closeManualBrowser(manualBrowserSession).catch(() => {});
  });
  if (open) openBrowser(url);
  return { server, root, url };
}
