import { LEGACY_LABELS, PASEO_LABELS, isManagedLifecycleLabel } from '../label-catalog.mjs';
import { validateIssueBody } from '../issue-contract.mjs';
import { loadConfig, loadRuntime, saveConfig, saveRuntime } from '../state.mjs';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function issueLabels(issue) {
  return unique((issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean));
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

export function buildExistingInstallMigrationPlan({
  configVersion = null,
  issues = [],
  templateCurrent = false,
  activeCoding = [],
  openPullRequests = [],
  reviewJobs = [],
  fixJobs = [],
} = {}) {
  const issueChanges = issues.map(classifyLegacyIssueForMigration)
    .filter((item) => item.addLabels.length || item.removeLabels.length || item.dependencyWaiting || item.notes.length);
  const ambiguous = issueChanges.filter((item) => item.notes.some((note) => note.includes('ambiguous')));
  const blockers = [];
  if (ambiguous.length) blockers.push({
    code: 'ambiguous-legacy-blocked-state',
    message: `${ambiguous.length} legacy blocked issue(s) cannot be migrated automatically.`,
    issueNumbers: ambiguous.map((item) => item.issueNumber),
  });
  return {
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
    },
    preserved: {
      activeCodingCount: activeCoding.length,
      openPullRequestCount: openPullRequests.length,
      reviewJobCount: reviewJobs.length,
      fixJobCount: fixJobs.length,
      activeWorkRestarted: false,
      prHeadsRewritten: false,
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

  const audit = {
    completedAt: now().toISOString(),
    configVersion: 3,
    claimsEnabled: false,
    issueNumbers: appliedIssues,
    templateSetupPullRequestRequired: plan.template.setupPullRequestRequired === true,
    preserved: plan.preserved,
  };
  saveRuntime(root, {
    ...loadRuntime(root),
    claimsEnabled: false,
    existingInstallMigration: audit,
  });
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
