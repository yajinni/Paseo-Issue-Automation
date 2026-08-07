import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEGACY_LABELS, PASEO_LABELS, PR_REVIEW_LABELS } from './label-catalog.mjs';
import { validateIssueBody } from './issue-contract.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { run, runJson } from './process.mjs';
import {
  atomicWrite,
  loadConfig,
  loadIntegration,
  loadRuntime,
  saveConfig,
  saveRun,
  loadRun,
  saveRuntime,
  statePaths,
} from './state.mjs';

export const EXISTING_INSTALL_MIGRATION_VERSION = 1;
const LEGACY_LIFECYCLE_LABELS = Object.freeze(Object.values(LEGACY_LABELS));

function migrationFile(root) {
  return path.join(statePaths(root).root, 'existing-install-migration.json');
}

export function loadExistingInstallationMigration(root) {
  try {
    const file = migrationFile(root);
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value?.version === EXISTING_INSTALL_MIGRATION_VERSION ? value : null;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function issueLabels(issue) {
  return unique((issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name));
}

function issueFields() {
  return 'number,title,body,labels,url,state,blockedBy';
}

function defaultIssueLoader(root, repository, options = {}) {
  const jsonRunner = options.jsonRunner || runJson;
  const rich = jsonRunner('gh', [
    'issue', 'list', '--repo', repository, '--state', 'open', '--limit', '1000', '--json', issueFields(),
  ], { cwd: root, allowFailure: true });
  if (Array.isArray(rich)) return rich;
  const fallback = jsonRunner('gh', [
    'issue', 'list', '--repo', repository, '--state', 'open', '--limit', '1000', '--json', 'number,title,body,labels,url,state',
  ], { cwd: root, allowFailure: true });
  if (!Array.isArray(fallback)) throw new Error('GitHub did not return the open issue catalog for migration preview.');
  return fallback;
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

function blockedByState(issue) {
  if (!Array.isArray(issue?.blockedBy)) return 'unknown';
  const open = issue.blockedBy.some((dependency) => String(dependency?.state || 'OPEN').toUpperCase() === 'OPEN');
  return open ? 'waiting' : 'clear';
}

function classifyIssue(issue, { templateContract = (value) => validateIssueBody(value?.body || '') } = {}) {
  const labels = issueLabels(issue);
  const legacy = labels.filter((name) => LEGACY_LIFECYCLE_LABELS.includes(name));
  if (legacy.length > 1) {
    return {
      issueNumber: Number(issue.number),
      ambiguous: true,
      reason: `Issue #${issue.number} has conflicting legacy lifecycle labels: ${legacy.join(', ')}.`,
      currentLabels: labels,
      addLabels: [],
      removeLabels: [],
      localState: null,
    };
  }

  const addLabels = [];
  const removeLabels = [];
  let localState = null;
  let note = null;
  let ambiguous = false;
  let reason = null;
  if (labels.includes(LEGACY_LABELS.humanReview)) {
    addLabels.push(PASEO_LABELS.reviewQueued);
    removeLabels.push(LEGACY_LABELS.humanReview);
    localState = 'manual-review';
    note = 'Preserve the existing PR/review state and resume at manual review.';
  } else if (labels.includes(LEGACY_LABELS.failed)) {
    addLabels.push(PASEO_LABELS.failed, PASEO_LABELS.needsAttention);
    removeLabels.push(LEGACY_LABELS.failed);
    localState = 'failed';
    note = 'Preserve the existing failure reason and require attention.';
  } else if (labels.includes(LEGACY_LABELS.running)) {
    addLabels.push(PASEO_LABELS.coding);
    removeLabels.push(LEGACY_LABELS.running);
    localState = 'coding';
    note = 'Preserve the active coding attempt; do not start a duplicate attempt.';
  } else if (labels.includes(LEGACY_LABELS.blocked)) {
    const dependency = blockedByState(issue);
    if (dependency === 'waiting') {
      removeLabels.push(LEGACY_LABELS.blocked);
      localState = 'dependency-waiting';
      note = 'Remove the invented blocked lifecycle label while retaining native dependency-wait state locally.';
    } else {
      ambiguous = true;
      reason = dependency === 'unknown'
        ? `Issue #${issue.number} is agent-blocked but native blocked-by data is unavailable.`
        : `Issue #${issue.number} is agent-blocked but has no open native blocked-by dependency.`;
    }
  } else if (labels.includes(LEGACY_LABELS.ready)) {
    const contract = templateContract(issue);
    removeLabels.push(LEGACY_LABELS.ready);
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
    ambiguous,
    reason,
    currentLabels: labels,
    addLabels: unique(addLabels).filter((name) => !labels.includes(name)),
    removeLabels: unique(removeLabels),
    localState,
    note,
  };
}

function loadPendingSetupPullRequest(root) {
  const file = path.join(statePaths(root).root, 'setup-pull-request.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return { state: 'ambiguous' }; }
}

function setupPullRequestBlocksMigration(value) {
  if (!value?.number) return false;
  if (value.state === 'open') return true;
  return value.state === 'merged' && (!value.syncedAt || !value.installationVerifiedAt);
}

export function previewExistingInstallationMigration(root, {
  repository,
  issueLoader = defaultIssueLoader,
  templateContract,
  templateCurrent = false,
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
  const pendingSetupPr = loadPendingSetupPullRequest(root);
  if (pendingSetupPr?.state === 'ambiguous') ambiguities.push('The saved setup pull request state is corrupt or ambiguous.');
  else if (setupPullRequestBlocksMigration(pendingSetupPr)) {
    ambiguities.push(`Setup pull request #${pendingSetupPr.number} must be merged, synchronized, and installation-verified before migration.`);
  }

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
      lastDispatchAt: runtime.lastDispatchAt,
      lastDispatchResult: runtime.lastDispatchResult,
      dependencyWaitingIssueNumbers: dependencyWaiting,
    },
    integration: {
      controllerMode: integration.paseoJson ? 'embedded-or-legacy' : 'external-or-legacy',
      issueTemplate: integration.issueTemplate,
      templateCurrent: templateCurrent === true,
      templateSetupPullRequestRequired: templateCurrent !== true,
      templateOwnershipHashChange: 'setup-pr-only',
    },
    pendingSetupPullRequest: pendingSetupPr,
    reviewState: reviewSnapshot(root),
    issues: issueChanges,
    labels: {
      deleteCatalogLabelsAutomatically: [],
      legacyIssueAssignmentsRemoved: issueChanges.flatMap((item) => item.removeLabels || []),
      userOwnedLabelsDeleted: false,
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
      mutateTrackedRepositoryFilesDirectly: false,
    },
    ambiguities,
    safeToApply: ambiguities.length === 0,
    rollback: {
      machineLocalState: 'Back up the repository Git common-dir paseo-issue-automation state directory before Apply. Restore that backup only while coding/review workers are stopped and claims are paused.',
      githubState: 'Rollback only the issue-label assignments recorded by this migration. Never delete repository label definitions or pre-existing user labels automatically.',
      template: 'Template changes remain behind the reviewed setup-PR lifecycle and can be reverted through Git history.',
      pullRequests: 'Existing pull-request heads and branches are never rewritten by this migration.',
    },
  };
}

function editIssueLabels(root, issueNumber, addLabels, removeLabels, runner = run) {
  for (const label of addLabels) {
    const result = runner('gh', ['issue', 'edit', String(issueNumber), '--add-label', label], { cwd: root, allowFailure: true });
    if (!result.ok) throw new Error(result.stderr || result.stdout || `Could not add ${label} to issue #${issueNumber}.`);
  }
  for (const label of removeLabels) {
    const result = runner('gh', ['issue', 'edit', String(issueNumber), '--remove-label', label], { cwd: root, allowFailure: true });
    if (!result.ok) throw new Error(result.stderr || result.stdout || `Could not remove ${label} from issue #${issueNumber}.`);
  }
}

function retainDependencyWait(root, issueNumber, now = () => new Date()) {
  const previous = loadRun(root, issueNumber) || {};
  saveRun(root, issueNumber, {
    ...previous,
    issueNumber,
    status: 'waiting',
    phase: 'waiting-for-dependencies',
    blockType: 'dependency',
    dependencySource: 'native',
    updatedAt: now().toISOString(),
    activity: [
      ...(previous.activity || []),
      { type: 'existing-install-migration-dependency-wait', at: now().toISOString(), details: 'Retained native dependency-wait state while removing the legacy blocked lifecycle label.' },
    ],
  });
}

export function applyExistingInstallationMigration(root, preview, {
  repositoryId = preview?.repository,
  workerManager,
  reviewWorkerManager,
  runner = run,
  now = () => new Date(),
} = {}) {
  if (!preview || preview.migrationVersion !== EXISTING_INSTALL_MIGRATION_VERSION) throw new Error('A current migration preview is required.');
  if (preview.safeToApply !== true || preview.ambiguities?.length) {
    throw new Error(`Existing-install migration stopped because state is ambiguous: ${(preview.ambiguities || []).join(' ') || 'unknown ambiguity'}`);
  }

  const before = {
    config: loadConfig(root),
    runtime: loadRuntime(root),
    capturedAt: now().toISOString(),
  };
  if (workerManager?.stop) workerManager.stop(repositoryId);
  if (reviewWorkerManager?.stop) reviewWorkerManager.stop(repositoryId);
  saveRuntime(root, { ...before.runtime, claimsEnabled: false });

  const record = {
    version: EXISTING_INSTALL_MIGRATION_VERSION,
    state: 'applying',
    repository: preview.repository,
    repositoryId,
    startedAt: now().toISOString(),
    before,
    preview,
    addedLabels: [],
    removedLegacyAssignments: [],
    dependencyWaitingIssueNumbers: preview.runtime.dependencyWaitingIssueNumbers || [],
  };
  atomicWrite(migrationFile(root), `${JSON.stringify(record, null, 2)}\n`);

  // loadConfig has already normalized supported v2 state; persisting that snapshot upgrades it to v3.
  saveConfig(root, { ...preview.config.normalizedPreview, version: 3, setupComplete: false });
  for (const issue of preview.issues) {
    editIssueLabels(root, issue.issueNumber, issue.addLabels || [], issue.removeLabels || [], runner);
    for (const label of issue.addLabels || []) record.addedLabels.push({ issueNumber: issue.issueNumber, label });
    for (const label of issue.removeLabels || []) record.removedLegacyAssignments.push({ issueNumber: issue.issueNumber, label });
    if (issue.localState === 'dependency-waiting') retainDependencyWait(root, issue.issueNumber, now);
  }

  record.state = 'awaiting-reconciliation';
  record.appliedAt = now().toISOString();
  record.activeWorkRestarted = false;
  record.templateSetupPullRequestRequired = preview.integration.templateSetupPullRequestRequired === true;
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
  if (reconciliationOk !== true) throw new Error('Migration cannot complete until active issues, PRs, review jobs, fix jobs, skipped issues, and local history reconcile without ambiguity.');
  if (record.templateSetupPullRequestRequired && setupPullRequestReady !== true) {
    throw new Error('Migration cannot complete until the reviewed setup PR has updated and synchronized the managed issue template.');
  }
  record.state = 'completed';
  record.completedAt = new Date().toISOString();
  record.activeWorkRestarted = false;
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
