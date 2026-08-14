function repositoryName(status) {
  return status?.repository?.repository || status?.repository?.name || 'this repository';
}

function linkAction(label, url) {
  return url ? { kind: 'link', label, url } : null;
}

function postAction(label, endpoint) {
  return { kind: 'post', label, endpoint };
}

function buttonAction(label, targetId) {
  return { kind: 'button', label, targetId };
}

function blocker({
  code,
  severity = 'warning',
  scope,
  title,
  message,
  blocksIssueProcessing = false,
  action = null,
  details = null,
}) {
  return {
    code,
    severity,
    scope,
    title,
    message,
    blocksIssueProcessing,
    action,
    details,
  };
}

function migrationBlockers(status, result) {
  const name = repositoryName(status);
  const migration = status.setup?.migration;
  if (!migration?.number) return;
  const label = `Migration PR #${migration.number}`;

  if (migration.state === 'open') {
    result.push(blocker({
      code: 'migration-pr-open',
      severity: 'error',
      scope: 'migration',
      title: `${label} is awaiting merge`,
      message: `Issue processing for ${name} is paused until migration PR #${migration.number} is merged and the local base branch synchronizes.`,
      blocksIssueProcessing: true,
      action: linkAction(`Open migration PR #${migration.number}`, migration.url),
    }));
    return;
  }

  if (migration.state === 'merged' && !migration.syncedAt) {
    result.push(blocker({
      code: 'migration-pr-sync-pending',
      severity: 'error',
      scope: 'migration',
      title: `${label} merged; local synchronization is pending`,
      message: migration.syncError
        ? `Migration PR #${migration.number} merged, but ${name} could not finish local synchronization: ${migration.syncError}`
        : `Migration PR #${migration.number} merged, but ${name} has not yet synchronized its local base branch and finalized external controller mode.`,
      blocksIssueProcessing: true,
      action: postAction('Retry migration synchronization', 'migrate/reconcile'),
      details: migration.syncError ? { syncError: migration.syncError } : null,
    }));
    return;
  }

  if (migration.state === 'closed' && !migration.syncedAt) {
    result.push(blocker({
      code: 'migration-pr-closed',
      severity: 'error',
      scope: 'migration',
      title: `${label} closed without completing migration`,
      message: `${name} remains on the embedded controller installation because migration PR #${migration.number} did not complete.`,
      blocksIssueProcessing: status.automation?.claimsEnabled !== true,
      action: buttonAction('Create a new migration PR', 'migrate-embedded-controller'),
    }));
  }
}

function setupPullRequestBlockers(status, result) {
  const name = repositoryName(status);
  const pullRequest = status.setup?.pullRequest;
  if (!pullRequest?.number) return;
  const label = `Setup PR #${pullRequest.number}`;

  if (pullRequest.state === 'open') {
    result.push(blocker({
      code: 'setup-pr-open',
      severity: 'error',
      scope: 'setup',
      title: `${label} is awaiting merge`,
      message: `Issue processing for ${name} is paused because setup PR #${pullRequest.number} is open. Merge it, then allow the local base branch to synchronize.`,
      blocksIssueProcessing: true,
      action: linkAction(`Open setup PR #${pullRequest.number}`, pullRequest.url),
      details: Array.isArray(pullRequest.files) ? { files: pullRequest.files } : null,
    }));
    return;
  }

  if (pullRequest.state === 'merged' && !pullRequest.syncedAt) {
    result.push(blocker({
      code: 'setup-pr-sync-pending',
      severity: 'error',
      scope: 'setup',
      title: `${label} merged; local synchronization is pending`,
      message: pullRequest.syncError
        ? `Setup PR #${pullRequest.number} merged, but ${name} could not synchronize locally: ${pullRequest.syncError}`
        : `Setup PR #${pullRequest.number} merged, but ${name} has not yet synchronized its local base branch.`,
      blocksIssueProcessing: true,
      action: linkAction(`Open setup PR #${pullRequest.number}`, pullRequest.url),
      details: pullRequest.syncError ? { syncError: pullRequest.syncError } : null,
    }));
    return;
  }

  if (pullRequest.state === 'failed') {
    result.push(blocker({
      code: 'setup-pr-failed',
      severity: 'error',
      scope: 'setup',
      title: 'Automatic setup PR creation failed',
      message: pullRequest.error
        ? `${name} could not create or reconcile its setup PR: ${pullRequest.error}`
        : `${name} could not create or reconcile its setup PR.`,
      blocksIssueProcessing: true,
      details: pullRequest.error ? { error: pullRequest.error } : null,
    }));
  }
}

function setupStateBlockers(status, result) {
  const name = repositoryName(status);
  const setup = status.setup || {};
  const changes = setup.repositoryChanges || {};

  if (!setup.controllerMode) {
    result.push(blocker({
      code: 'controller-not-installed',
      severity: 'error',
      scope: 'setup',
      title: 'Standalone controller integration is not installed',
      message: `${name} is registered, but it has not been installed for the standalone Paseo manager.`,
      blocksIssueProcessing: true,
      action: buttonAction('Install for standalone manager', 'install-external-controller'),
    }));
  }

  if (changes.available === false) {
    result.push(blocker({
      code: 'repository-status-unavailable',
      severity: 'error',
      scope: 'repository',
      title: 'Repository working-tree status is unavailable',
      message: changes.reason
        ? `${name} could not read Git status: ${changes.reason}`
        : `${name} could not read Git status.`,
      blocksIssueProcessing: true,
      details: changes.reason ? { reason: changes.reason } : null,
    }));
  }

  if (Array.isArray(changes.unexpectedFiles) && changes.unexpectedFiles.length) {
    result.push(blocker({
      code: 'unrelated-working-tree-changes',
      severity: 'warning',
      scope: 'repository',
      title: 'Unrelated working-tree changes need attention',
      message: `${name} has unrelated local changes that can prevent setup, migration, or base-branch synchronization.`,
      details: { files: changes.unexpectedFiles },
    }));
  }

  if (Array.isArray(changes.expectedFiles) && changes.expectedFiles.length) {
    result.push(blocker({
      code: 'managed-setup-files-changed',
      severity: 'warning',
      scope: 'setup',
      title: 'Controller-managed repository files have local changes',
      message: `${name} has uncommitted changes in controller-managed setup files.`,
      details: { files: changes.expectedFiles },
    }));
  }

  const hasSpecificSetupBlocker = result.some((item) =>
    item.scope === 'setup' && item.blocksIssueProcessing,
  ) || result.some((item) => item.scope === 'migration' && item.blocksIssueProcessing);
  if (setup.complete !== true && !hasSpecificSetupBlocker) {
    result.push(blocker({
      code: 'setup-incomplete',
      severity: 'error',
      scope: 'setup',
      title: 'Repository setup is incomplete',
      message: `${name} has not passed every required setup check, so autonomous issue processing cannot start.`,
      blocksIssueProcessing: true,
    }));
  }
}

function automationBlockers(status, result) {
  const name = repositoryName(status);
  const automation = status.automation || {};
  const worker = status.worker || {};
  const reviewWorker = status.reviewWorker || {};

  if (automation.claimsEnabled !== true) {
    result.push(blocker({
      code: 'claims-paused',
      severity: 'warning',
      scope: 'automation',
      title: 'Issue claims are paused',
      message: `${name} will not claim new coding issues until claims are resumed.`,
      blocksIssueProcessing: true,
      action: postAction('Resume issue claims', 'resume'),
    }));
  }

  if (worker.lastError) {
    result.push(blocker({
      code: 'coding-worker-error',
      severity: 'error',
      scope: 'worker',
      title: 'Coding worker reported an error',
      message: `${name} coding worker failed its latest scheduling attempt: ${worker.lastError}`,
      blocksIssueProcessing: false,
      details: { error: worker.lastError },
    }));
  } else if (worker.capacityError) {
    result.push(blocker({
      code: 'coding-capacity-unknown',
      severity: 'warning',
      scope: 'capacity',
      title: 'Coding capacity cannot be confirmed',
      message: `${name} is being handled conservatively because its active coding count could not be confirmed: ${worker.capacityError}`,
      details: { error: worker.capacityError },
    }));
  } else if (worker.lastScheduleReason) {
    result.push(blocker({
      code: 'coding-capacity-wait',
      severity: 'info',
      scope: 'capacity',
      title: 'Coding worker is waiting for capacity',
      message: worker.lastScheduleReason,
    }));
  }

  if (status.capabilities?.prReviewWorkers && status.prReviews?.queuePaused === false && reviewWorker.running !== true) {
    result.push(blocker({
      code: 'review-worker-stopped',
      severity: 'info',
      scope: 'review-worker',
      title: 'PR-review worker is stopped',
      message: `${name} will not automatically schedule or reconcile PR reviews until PR-review processing resumes.`,
      action: postAction('Resume PR-review processing', 'pr-review/resume'),
    }));
  }

  const reviewError = reviewWorker.lastReviewError || reviewWorker.lastReconciliationError;
  if (reviewError) {
    result.push(blocker({
      code: 'review-worker-error',
      severity: 'warning',
      scope: 'review-worker',
      title: 'PR-review worker reported an error',
      message: `${name} PR-review automation failed: ${reviewError}`,
      action: postAction('Restart PR-review worker', 'review-worker/restart'),
      details: { error: reviewError },
    }));
  }
}

export function deriveRepositoryBlockers(status = {}) {
  const result = [];
  migrationBlockers(status, result);
  setupPullRequestBlockers(status, result);
  setupStateBlockers(status, result);
  automationBlockers(status, result);
  return result;
}

export function repositoryOperationalSummary(status = {}, blockers = deriveRepositoryBlockers(status)) {
  const issueBlocker = blockers.find((item) => item.blocksIssueProcessing);
  const reviewBlocker = blockers.find((item) => item.scope === 'review-worker');
  return {
    issueProcessing: issueBlocker ? 'blocked' : 'ready',
    issueProcessingReason: issueBlocker?.message || null,
    primaryBlocker: issueBlocker || blockers[0] || null,
    prReviews: reviewBlocker ? 'attention' : 'ready',
    blockerCount: blockers.length,
    blockingCount: blockers.filter((item) => item.blocksIssueProcessing).length,
  };
}
