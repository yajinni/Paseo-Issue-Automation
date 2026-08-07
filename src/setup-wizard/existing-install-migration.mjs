import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEGACY_LABELS, PASEO_LABELS, isManagedLifecycleLabel } from '../label-catalog.mjs';
import { validateIssueBody } from '../issue-contract.mjs';
import { atomicWrite, loadConfig, loadRuntime, saveConfig, saveRuntime, statePaths } from '../state.mjs';

export const EXISTING_INSTALL_MIGRATION_VERSION = 1;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function issueLabels(issue) {
  return unique((issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean));
}

function migrationFile(root) {
  return path.join(statePaths(root).root, 'setup-existing-install-migration.json');
}

export function loadExistingInstallMigration(root) {
  try {
    const file = migrationFile(root);
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value?.version === EXISTING_INSTALL_MIGRATION_VERSION ? value : null;
  } catch {
    return null;
  }
}

export function saveExistingInstallMigration(root, value) {
  const normalized = {
    version: EXISTING_INSTALL_MIGRATION_VERSION,
    ...value,
  };
  atomicWrite(migrationFile(root), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function classifyLegacyIssueForMigration(issue) {
  const labels = issueLabels(issue);
  const add = [];
  const remove = [];
  const notes = [];
  let dependencyWaiting = false;

  const has = (name) => labels.includes(name);
  const removeLegacy = (name) => { if (has(name)) remove.push(name); };

  if (has(LEGACY_LABELS.ready)) {
    removeLegacy(LEGACY_LABELS.ready);
    const validation = validateIssueBody(issue?.body || '');
    if (validation.ok) add.push(PASEO_LABELS.ready);
    else {
      add.push(PASEO_LABELS.needsAttention);
      notes.push(`Legacy ready issue does not pass the current issue contract: ${validation.reason || 'invalid issue body'}`);
    }
  }

  if (has(LEGACY_LABELS.running)) {
    removeLegacy(LEGACY_LABELS.running);
    add.push(PASEO_LABELS.coding);
  }

  if (has(LEGACY_LABELS.blocked)) {
    removeLegacy(LEGACY_LABELS.blocked);
    if (issue?.blockedByOpen === true) {
      dependencyWaiting = true;
      notes.push('Dependency waiting is retained in local state without a blocked lifecycle label.');
    } else {
      add.push(PASEO_LABELS.needsAttention);
      notes.push('Legacy blocked state is ambiguous without an open native dependency and requires attention.');
    }
  }

  if (has(LEGACY_LABELS.failed)) {
    removeLegacy(LEGACY_LABELS.failed);
    add.push(PASEO_LABELS.failed, PASEO_LABELS.needsAttention);
  }

  if (has(LEGACY_LABELS.humanReview)) {
    removeLegacy(LEGACY_LABELS.humanReview);
    add.push(PASEO_LABELS.reviewQueued);
    notes.push('Legacy human-review state is retained as the manual-review handoff stage.');
  }

  return {
    issueNumber: Number(issue?.number),
    addLabels: unique(add).filter((name) => !labels.includes(name)),
    removeLabels: unique(remove),
    dependencyWaiting,
    preserveLabels: labels.filter((name) => !remove.includes(name)),
    notes,
  };
}

function pendingSetupPullRequest(value) {
  if (!value?.number) return false;
  if (value.state === 'open') return true;
  return value.state === 'merged' && (!value.syncedAt || !value.installationVerifiedAt);
}

export function buildExistingInstallMigrationPlan({
  configVersion = null,
  controllerMode = null,
  issues = [],
  templateCurrent = false,
  setupPullRequest = null,
  activeCoding = [],
  openPullRequests = [],
  reviewJobs = [],
  fixJobs = [],
  skippedIssueNumbers = [],
  historyCount = 0,
} = {}) {
  const issueChanges = issues.map(classifyLegacyIssueForMigration)
    .filter((item) => item.addLabels.length || item.removeLabels.length || item.dependencyWaiting || item.notes.length);
  const ambiguous = issueChanges.filter((item) => item.notes.some((note) => note.includes('ambiguous')));
  const blockers = [];
  if (ambiguous.length) blockers.push({
    code: 'ambiguous-legacy-blocked-state',
    message: `${ambiguous.length} legacy blocked issue(s) cannot be migrated automatically.`,
    issueNumbers: ambiguous.map((item) => item.issueNumber),
    recoveryAction: 'Inspect the native dependency state for these issues and resolve the ambiguity before migration.',
  });
  if (pendingSetupPullRequest(setupPullRequest)) blockers.push({
    code: 'pending-setup-pull-request',
    message: `Setup pull request #${setupPullRequest.number} must be reconciled before existing-install migration.`,
    pullRequestNumber: Number(setupPullRequest.number),
    recoveryAction: 'Merge or otherwise resolve the setup pull request, synchronize the configured base branch, and verify installed content before retrying migration.',
  });
  return {
    version: EXISTING_INSTALL_MIGRATION_VERSION,
    controllerMode,
    config: {
      fromVersion: configVersion,
      toVersion: 3,
      migrationRequired: configVersion !== 3,
    },
    issueChanges,
    template: {
      current: templateCurrent === true,
      setupPullRequestRequired: templateCurrent !== true,
      trackedFileMutationAllowedDirectly: false,
      guidance: templateCurrent === true
        ? 'The installed issue template already matches the current managed template.'
        : 'Update managed issue-template content only through the reviewed setup pull-request flow.',
    },
    preserved: {
      activeCodingCount: activeCoding.length,
      openPullRequestCount: openPullRequests.length,
      reviewJobCount: reviewJobs.length,
      fixJobCount: fixJobs.length,
      skippedIssueNumbers: unique(skippedIssueNumbers.map(Number).filter(Number.isInteger)).sort((a, b) => a - b),
      historyCount: Math.max(0, Number(historyCount) || 0),
      activeWorkRestarted: false,
      prHeadsRewritten: false,
      userOwnedLabelsDeleted: false,
      currentReviewLabelsRewritten: false,
    },
    rollback: {
      machineLocalState: 'Back up the repository Git common-dir paseo-issue-automation state directory before Apply. Restore that backup only while coding/review workers are stopped and claims are paused.',
      repositoryFiles: 'No tracked repository file is changed directly by this migration. Template changes remain isolated to the reviewed setup pull-request flow.',
      pullRequests: 'Existing pull-request heads and branches are never rewritten by this migration.',
    },
    blockers,
    canApply: blockers.length === 0,
  };
}

function workerRunning(manager, repositoryId) {
  return manager?.status?.(repositoryId)?.running === true;
}

export function applyExistingInstallMigration(root, {
  plan,
  repositoryId,
  workerManager = null,
  reviewWorkerManager = null,
  applyIssueLabels = null,
  saveDependencyWait = null,
  now = () => new Date(),
} = {}) {
  if (!plan || plan.canApply !== true) throw new Error('Existing-install migration plan is not safe to apply.');
  if (workerRunning(workerManager, repositoryId)) throw new Error('Stop the coding worker before migrating an existing installation.');
  if (workerRunning(reviewWorkerManager, repositoryId)) throw new Error('Stop the PR-review worker before migrating an existing installation.');

  const runtimeBefore = loadRuntime(root);
  saveRuntime(root, { ...runtimeBefore, claimsEnabled: false });

  const config = loadConfig(root);
  if (config.version !== 3) throw new Error('Repository configuration could not be migrated safely to version 3.');
  saveConfig(root, config);

  const appliedIssues = [];
  for (const change of plan.issueChanges) {
    if (!Number.isInteger(change.issueNumber) || change.issueNumber < 1) throw new Error('Migration issue number is invalid.');
    if (typeof applyIssueLabels === 'function' && (change.addLabels.length || change.removeLabels.length)) {
      applyIssueLabels(change.issueNumber, {
        add: change.addLabels,
        remove: change.removeLabels,
      });
    }
    if (change.dependencyWaiting && typeof saveDependencyWait === 'function') {
      saveDependencyWait(change.issueNumber, { reason: 'native-blocked-by', migratedAt: now().toISOString() });
    }
    appliedIssues.push(change.issueNumber);
  }

  const audit = saveExistingInstallMigration(root, {
    status: plan.template.setupPullRequestRequired ? 'awaiting-template-reconciliation' : 'completed',
    appliedAt: now().toISOString(),
    configVersion: 3,
    claimsEnabled: false,
    issueNumbers: appliedIssues,
    templateSetupPullRequestRequired: plan.template.setupPullRequestRequired === true,
    preserved: plan.preserved,
    rollback: plan.rollback,
  });
  saveRuntime(root, { ...loadRuntime(root), claimsEnabled: false });
  return audit;
}

export function migrationPreservesCurrentReviewLabel(name) {
  return isManagedLifecycleLabel(name) && [
    PASEO_LABELS.reviewQueued,
    PASEO_LABELS.reviewing,
    PASEO_LABELS.changesRequested,
    PASEO_LABELS.fixing,
    PASEO_LABELS.reviewFailed,
  ].includes(name);
}
