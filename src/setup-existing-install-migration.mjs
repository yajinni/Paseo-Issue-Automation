import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEGACY_LABELS, PASEO_LABELS, PR_REVIEW_LABELS } from './label-catalog.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { run, runJson } from './process.mjs';
import {
  atomicWrite,
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveRuntime,
  statePaths,
} from './state.mjs';

export const EXISTING_INSTALL_MIGRATION_VERSION = 1;
const ACTIVE_LEGACY = new Set([
  LEGACY_LABELS.running,
  LEGACY_LABELS.failed,
  LEGACY_LABELS.humanReview,
]);

function migrationFile(root) {
  return path.join(statePaths(root).root, 'existing-install-migration.json');
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function issueLabels(issue) {
  return unique((issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name));
}

function defaultIssueLoader(root, repository, options = {}) {
  const jsonRunner = options.jsonRunner || runJson;
  const issues = jsonRunner('gh', [
    'issue', 'list', '--repo', repository, '--state', 'open', '--limit', '1000', '--json', 'number,title,labels,url',
  ], { cwd: root, allowFailure: false });
  if (!Array.isArray(issues)) throw new Error('GitHub did not return the open issue catalog for migration preview.');
  return issues;
}

function configVersion(root) {
  const file = statePaths(root).config;
  if (!existsSync(file)) return null;
  try { return Number(JSON.parse(readFileSync(file, 'utf8'))?.version) || null; }
  catch { return 'invalid'; }
}

function reviewSnapshot(root) {
  try {
    const store = loadPrReviewStore(root);
    return {
      managedPullRequests: store.managedPullRequests.length,
      activeManagedPullRequests: store.managedPullRequests.filter((item) => !['completed', 'failed'].includes(item.reviewState)).length,
      reviewJobs: store.reviewJobs.length,
      activeReviewJobs: store.reviewJobs.filter((item) => ['queued', 'submitting', 'awaiting_result'].includes(item.state)).length,
      fixJobs: store.fixJobs.length,
      activeFixJobs: store.fixJobs.filter((item) => ['queued', 'running', 'interrupted'].includes(item.state)).length,
      historyEntries: store.history.length,
      browserReviewLabelsPreserved: Object.values(PR_REVIEW_LABELS),
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

function classifyIssue(issue, { templateContract = () => ({ ok: true }) } = {}) {
  const labels = issueLabels(issue);
  const legacy = labels.filter((name) => Object.values(LEGACY_LABELS).includes(name));
  const active = legacy.filter((name) => ACTIVE_LEGACY.has(name));
  if (active.length > 1) {
    return {
      issueNumber: Number(issue.number),
      ambiguous: true,
      reason: `Issue #${issue.number} has conflicting legacy lifecycle labels: ${active.join(', ')}.`,
      currentLabels: labels,
      addLabels: [],
      localState: null,
    };
  }

  const addLabels = [];
  let localState = null;
  let note = null;
  if (labels.includes(LEGACY_LABELS.humanReview)) {
    addLabels.push(PASEO_LABELS.reviewQueued);
    localState = 'manual-review';
    note = 'Preserve the existing PR/review state and resume at manual review.';
  } else if (labels.includes(LEGACY_LABELS.failed)) {
    addLabels.push(PASEO_LABELS.failed, PASEO_LABELS.needsAttention);
    localState = 'failed';
    note = 'Preserve the failure reason and require attention.';
  } else if (labels.includes(LEGACY_LABELS.running)) {
    addLabels.push(PASEO_LABELS.coding);
    localState = 'coding';
    note = 'Preserve the active coding attempt; do not start a duplicate attempt.';
  } else if (labels.includes(LEGACY_LABELS.blocked)) {
    localState = 'dependency-waiting';
    note = 'Stop interpreting agent-blocked as a lifecycle gate; retain local dependency-wait state.';
  } else if (labels.includes(LEGACY_LABELS.ready)) {
    const contract = templateContract(issue);
    if (contract?.ok === true) {
      addLabels.push(PASEO_LABELS.ready);
      localState = 'ready';
      note = 'Migrate agent-ready only because the existing issue passes the current template contract.';
    } else {
      addLabels.push(PASEO_LABELS.needsAttention);
      localState = 'invalid';
      note = contract?.reason || 'Legacy ready issue does not pass the current template contract.';
    }
  }

  return {
    issueNumber: Number(issue.number),
    ambiguous: false,
    currentLabels: labels,
    addLabels: unique(addLabels).filter((name) => !labels.includes(name)),
    removeLabels: [],
    localState,
    note,
  };
}

export function previewExistingInstallationMigration(root, {
  repository,
  issueLoader = defaultIssueLoader,
  templateContract,
  ...options
} = {}) {
  if (!repository) throw new Error('Existing-install migration requires the selected GitHub repository.');
  const storedVersion = configVersion(root);
  if (storedVersion === 'invalid') {
    return {
      migrationVersion: EXISTING_INSTALL_MIGRATION_VERSION,
      safeToApply: false,
      ambiguities: ['The existing local config file is not valid JSON. Restore or repair it before migration.'],
      stopWorkers: true,
      claimsPausedDuringMigration: true,
    };
  }
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const integration = loadIntegration(root);
  const issues = issueLoader(root, repository, options);
  const issueChanges = issues.map((issue) => classifyIssue(issue, { templateContract }));
  const ambiguities = issueChanges.filter((item) => item.ambiguous).map((item) => item.reason);
  const pendingSetupPr = (() => {
    const file = path.join(statePaths(root).root, 'setup-pull-request.json');
    if (!existsSync(file)) return null;
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { state: 'ambiguous' }; }
  })();
  if (pendingSetupPr?.state === 'ambiguous') ambiguities.push('The saved setup pull request state is corrupt or ambiguous.');

  const dependencyWaiting = issueChanges.filter((item) => item.localState === 'dependency-waiting').map((item) => item.issueNumber);
  return {
    migrationVersion: EXISTING_INSTALL_MIGRATION_VERSION,
    repository,
    config: {
      storedVersion,
      targetVersion: 3,
      normalizedPreview: config,
    },
    runtime: {
      claimsWereEnabled: runtime.claimsEnabled === true,
      skippedIssueNumbers: runtime.skippedIssueNumbers,
      dependencyWaitingIssueNumbers: dependencyWaiting,
    },
    integration: {
      controllerMode: integration.paseoJson ? 'embedded-or-legacy' : 'external-or-legacy',
      issueTemplate: integration.issueTemplate,
      templateOwnershipHashChange: 'setup-pr-only',
    },
    pendingSetupPullRequest: pendingSetupPr,
    reviewState: reviewSnapshot(root),
    issues: issueChanges,
    labels: {
      deleteAutomatically: [],
      legacyLabelsPreserved: Object.values(LEGACY_LABELS),
      webReviewLabelsPreserved: Object.values(PR_REVIEW_LABELS),
    },
    safety: {
      stopCodingWorkers: true,
      stopReviewWorkers: true,
      pauseClaims: true,
      rewriteActivePullRequestHeads: false,
      rewriteBranches: false,
      deleteUserOwnedLabels: false,
      restartActiveWorkAutomatically: false,
    },
    ambiguities,
    safeToApply: ambiguities.length === 0,
    rollback: {
      machineLocalState: 'Restore the pre-migration config/runtime snapshot written to existing-install-migration.json, then restart the manager with claims paused.',
      githubState: 'Migration only adds current lifecycle labels; remove only labels explicitly listed as added by the migration if rollback is required. Never delete pre-existing labels automatically.',
      template: 'Template changes remain behind the reviewed setup-PR lifecycle and can be reverted through Git history.',
    },
  };
}

function addIssueLabels(root, issueNumber, labels, runner = run) {
  for (const label of labels) {
    const result = runner('gh', ['issue', 'edit', String(issueNumber), '--add-label', label], { cwd: root, allowFailure: true });
    if (!result.ok) throw new Error(result.stderr || result.stdout || `Could not add ${label} to issue #${issueNumber}.`);
  }
}

export function applyExistingInstallationMigration(root, preview, {
  workerManager,
  reviewWorkerManager,
  runner = run,
} = {}) {
  if (!preview || preview.migrationVersion !== EXISTING_INSTALL_MIGRATION_VERSION) throw new Error('A current migration preview is required.');
  if (preview.safeToApply !== true || preview.ambiguities?.length) {
    throw new Error(`Existing-install migration stopped because state is ambiguous: ${(preview.ambiguities || []).join(' ') || 'unknown ambiguity'}`);
  }

  const before = {
    config: loadConfig(root),
    runtime: loadRuntime(root),
    capturedAt: new Date().toISOString(),
  };
  if (workerManager?.stop) workerManager.stop(preview.repository);
  if (reviewWorkerManager?.stop) reviewWorkerManager.stop(preview.repository);
  saveRuntime(root, { ...before.runtime, claimsEnabled: false });

  const record = {
    version: EXISTING_INSTALL_MIGRATION_VERSION,
    state: 'applying',
    repository: preview.repository,
    startedAt: new Date().toISOString(),
    before,
    preview,
    addedLabels: [],
    dependencyWaitingIssueNumbers: preview.runtime.dependencyWaitingIssueNumbers || [],
  };
  atomicWrite(migrationFile(root), `${JSON.stringify(record, null, 2)}\n`);

  // saveConfig validates and upgrades legacy v2-compatible values to the v3 schema.
  saveConfig(root, { ...preview.config.normalizedPreview, version: 3, setupComplete: false });
  for (const issue of preview.issues) {
    addIssueLabels(root, issue.issueNumber, issue.addLabels || [], runner);
    for (const label of issue.addLabels || []) record.addedLabels.push({ issueNumber: issue.issueNumber, label });
  }

  record.state = 'awaiting-reconciliation';
  record.appliedAt = new Date().toISOString();
  record.activeWorkRestarted = false;
  record.templateSetupPullRequestRequired = true;
  atomicWrite(migrationFile(root), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function completeExistingInstallationMigration(root, {
  reconciliationOk,
  setupPullRequestReady,
} = {}) {
  const file = migrationFile(root);
  if (!existsSync(file)) throw new Error('No existing-install migration is in progress.');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (record.state !== 'awaiting-reconciliation') throw new Error(`Migration state ${record.state} cannot complete.`);
  if (reconciliationOk !== true) throw new Error('Migration cannot complete until active issues, PRs, review jobs, fix jobs, and local history reconcile without ambiguity.');
  if (record.templateSetupPullRequestRequired && setupPullRequestReady !== true) {
    throw new Error('Migration cannot complete until the reviewed setup PR has updated and synchronized the managed issue template.');
  }
  record.state = 'completed';
  record.completedAt = new Date().toISOString();
  record.activeWorkRestarted = false;
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
