import path from 'node:path';
import { findRepository } from '../repository-registry.mjs';
import { loadConfig, loadRuntime, saveConfig, saveRuntime } from '../state.mjs';
import {
  completeSetupSession,
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';
import {
  confirmedSetupPullRequestReady,
  reconcileConfirmedSetupPullRequest,
} from './setup-pr-service.mjs';

const REQUIRED_PAGES = Object.freeze(['paseo', 'harness', 'repository', 'checkout', 'workspace', 'issues', 'review']);

function activeSession(options = {}) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function checkoutPath(session) {
  const page = session.pages?.checkout?.selections || {};
  const value = page.checkoutPath || session.managedCheckout?.path || session.managedCheckoutChoice;
  return value ? path.resolve(String(value)) : null;
}

function repositoryName(session) {
  const page = session.pages?.repository?.selections || {};
  return String(page.repository || (session.repository ? `${session.repository.owner}/${session.repository.name}` : '')).trim();
}

function pageSummary(session, pageId) {
  const page = session.pages?.[pageId] || {};
  return {
    id: pageId,
    href: `/setup/${pageId}`,
    completed: page.completed === true,
    checkedAt: page.lastCheck?.checkedAt || null,
    summary: page.lastCheck?.summary || null,
    selections: page.selections || {},
  };
}

export function buildFinalReadinessSummary(options = {}) {
  const session = activeSession(options);
  const issues = session.pages?.issues?.selections || {};
  const eligibleIssueCount = Number(options.eligibleIssueCount ?? issues.eligibleIssueCount ?? 0);
  return {
    repository: repositoryName(session),
    baseBranch: session.baseBranch || session.pages?.repository?.selections?.baseBranch || null,
    checkoutPath: checkoutPath(session),
    pages: REQUIRED_PAGES.map((pageId) => pageSummary(session, pageId)),
    eligibleIssueCount: Number.isInteger(eligibleIssueCount) && eligibleIssueCount >= 0 ? eligibleIssueCount : 0,
    startAutomationDefault: Number.isInteger(eligibleIssueCount) && eligibleIssueCount > 0,
  };
}

function blocker(code, message, recoveryAction, details = null) {
  return { code, message, recoveryAction, details };
}

export async function runFinalReadinessChecks(options = {}) {
  let session = activeSession(options);
  const blockers = [];
  const checks = [];

  for (const pageId of REQUIRED_PAGES) {
    const page = session.pages?.[pageId];
    const ok = page?.completed === true && page?.lastCheck?.ok === true;
    checks.push({ id: pageId, ok, checkedAt: page?.lastCheck?.checkedAt || null, summary: page?.lastCheck?.summary || null });
    if (!ok) blockers.push(blocker(
      `readiness-${pageId}-incomplete`,
      `${pageId} setup has not passed its latest requirements check.`,
      `Return to /setup/${pageId}, Recheck, and resolve any blocker.`,
    ));
  }

  const root = checkoutPath(session);
  if (!root) {
    blockers.push(blocker('readiness-checkout-missing', 'The managed checkout path is unavailable.', 'Return to Local checkout and prepare the managed repository.'));
  } else {
    let setupPr = null;
    try {
      setupPr = (options.setupPrReconciler || reconcileConfirmedSetupPullRequest)(root, options);
      const ready = confirmedSetupPullRequestReady(setupPr);
      checks.push({ id: 'setup-pull-request', ok: ready, state: setupPr?.state || 'not-required', syncedAt: setupPr?.syncedAt || null, installationVerifiedAt: setupPr?.installationVerifiedAt || null });
      if (!ready) blockers.push(blocker(
        'readiness-setup-pr-incomplete',
        setupPr?.autoMerge?.reason || setupPr?.syncError || setupPr?.installationVerificationError || 'The setup pull request is not merged, synchronized, and verified yet.',
        setupPr?.autoMerge?.action || 'Open the setup pull request, satisfy repository policy, merge it, synchronize the checkout, then Recheck.',
      ));
    } catch (error) {
      blockers.push(blocker('readiness-setup-pr-check-failed', String(error?.message || error), 'Resolve the setup PR or checkout problem, then Recheck.'));
    }

    const probes = Array.isArray(options.safeProbes) ? options.safeProbes : [];
    for (const probe of probes) {
      try {
        const result = await probe({ root, session });
        const ok = result?.ok === true;
        checks.push({ id: String(result?.id || 'probe'), ok, summary: result?.summary || null, details: result?.details || null });
        if (!ok) blockers.push(blocker(
          `readiness-${String(result?.id || 'probe').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-failed`,
          result?.summary || 'A final readiness probe did not pass.',
          result?.recoveryAction || 'Resolve the reported readiness problem, then Recheck.',
          result?.details || null,
        ));
      } catch (error) {
        blockers.push(blocker('readiness-safe-probe-failed', String(error?.message || error), 'Resolve the reported readiness problem, then Recheck.'));
      }
    }
  }

  session = recordSetupPageCheck('readiness', {
    ok: blockers.length === 0,
    summary: blockers.length === 0
      ? 'All selected setup workflows are ready. Finish setup can now commit configuration safely.'
      : `${blockers.length} final readiness requirement${blockers.length === 1 ? '' : 's'} need attention.`,
    blockers,
  }, options);
  return {
    ...buildFinalReadinessSummary(options),
    checks,
    check: session.pages.readiness.lastCheck,
    safeProbePolicy: {
      fakeIssueCreated: false,
      fakeReviewCreated: false,
      applicationCodeChanged: false,
      paidPromptSent: false,
    },
  };
}

function saveFinishSelection(startAutomation, options = {}) {
  return saveSetupPage('readiness', {
    selections: { startAutomation: startAutomation === true },
    completed: true,
  }, options);
}

export async function finishSetup({ startAutomation = false } = {}, options = {}) {
  let session = activeSession(options);
  if (session.pages?.readiness?.lastCheck?.ok !== true) {
    const readiness = await runFinalReadinessChecks(options);
    if (!readiness.check.ok) throw new Error('Final readiness must pass before setup can finish.');
    session = activeSession(options);
  }

  const root = checkoutPath(session);
  if (!root) throw new Error('Managed checkout is unavailable at Finish setup.');
  const repository = findRepository(root, { rootDir: options.rootDir, platform: options.platform });
  if (!repository) throw new Error('The managed checkout is not registered with the standalone manager.');

  // Commit durable setup state before any worker is started. If worker startup
  // later fails, setup remains complete but automation stays safely paused.
  const config = loadConfig(root);
  saveConfig(root, { ...config, setupComplete: true });
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  saveFinishSelection(startAutomation, options);
  const completed = completeSetupSession(options);

  const workerResults = [];
  let started = false;
  let startError = null;
  if (startAutomation) {
    try {
      // Claims are enabled only after setup session/config commit succeeds.
      saveRuntime(root, { ...loadRuntime(root), claimsEnabled: true });
      if (options.workerManager?.start) workerResults.push({ type: 'coding', result: options.workerManager.start(repository) });
      if (options.reviewWorkerManager?.start) workerResults.push({ type: 'review', result: options.reviewWorkerManager.start(repository) });
      started = true;
    } catch (error) {
      saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
      startError = String(error?.message || error);
    }
  }

  return {
    completed: true,
    sessionId: completed.id,
    repository,
    setupComplete: loadConfig(root).setupComplete === true,
    claimsEnabled: loadRuntime(root).claimsEnabled === true,
    startRequested: startAutomation === true,
    workersStarted: started,
    workerResults,
    startError,
    recoverable: true,
  };
}
