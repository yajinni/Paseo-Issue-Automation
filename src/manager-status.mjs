import { CONTROLLER_MODES, loadControllerMode } from './controller-mode.mjs';
import { inspectExternalMigrationAdoption } from './external-adoption.mjs';
import { externalMaintenanceStatus } from './external-maintenance.mjs';
import { loadExternalMigration } from './external-migration.mjs';
import { managerPrHealthSummary } from './manager-pr-health.mjs';
import { managerReviewEvidenceSummary } from './manager-review-evidence.mjs';
import { managerPrHealthSnapshot } from './pr-review-github.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { inspectRepository } from './repository-registry.mjs';
import { managedRepositoryOperationalSummary } from './repository-health.mjs';
import { managerReviewProfileStatus } from './manager-review-profile-status.mjs';
import { managerWorkQueue } from './manager-work-queue.mjs';
import { loadSetupPullRequest, setupChangeStatus } from './setup-pr.mjs';
import {
  listRuns,
  loadConfig,
  loadIntegration,
  loadIssueLifecycle,
  loadRuntime,
  statePaths,
} from './state.mjs';
import { run } from './process.mjs';

function statusCounts(runs) {
  const counts = {};
  for (const item of runs) {
    const key = String(item?.status || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function safeBranch(root, runner = run) {
  const result = runner('git', ['branch', '--show-current'], {
    cwd: root,
    allowFailure: true,
  });
  return result.ok && result.stdout ? result.stdout : null;
}

export function managerPrReviewSummary(root, { loadStore = loadPrReviewStore } = {}) {
  try {
    const store = loadStore(root);
    return {
      available: true,
      enabled: store.config?.enabled === true,
      browserReviewEnabled: store.config?.browserReview?.enabled === true,
      queuePaused: store.config?.reviewQueue?.paused !== false,
      waitingReviewCount: (store.reviewJobs || []).filter((job) => job?.state === 'queued').length,
      activeReviewJobId: store.runtime?.activeReviewJobId || null,
    };
  } catch (error) {
    return {
      available: false,
      enabled: false,
      browserReviewEnabled: false,
      queuePaused: true,
      waitingReviewCount: 0,
      activeReviewJobId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function managerRepositoryStatus(repository, {
  runner = run,
  platform = process.platform,
  workerManager = null,
  reviewWorkerManager = null,
  rootDir = undefined,
  prSnapshotLoader = managerPrHealthSnapshot,
} = {}) {
  if (!repository?.path) throw new Error('A registered repository path is required.');
  const inspected = inspectRepository(repository.path, { runner, platform });
  const config = loadConfig(inspected.path);
  const runtime = loadRuntime(inspected.path);
  const integration = loadIntegration(inspected.path);
  const controllerMode = loadControllerMode(inspected.path);
  const migration = loadExternalMigration(inspected.path);
  const maintenance = externalMaintenanceStatus(inspected.path);
  const setupPullRequest = loadSetupPullRequest(inspected.path);
  const setupChanges = setupChangeStatus(inspected.path, { runner, mode: controllerMode });
  const migrationAdoption = controllerMode === CONTROLLER_MODES.embedded
    ? inspectExternalMigrationAdoption(inspected.path, { runner })
    : null;
  const runs = listRuns(inspected.path).map((item) => ({
    ...item,
    lifecycle: loadIssueLifecycle(inspected.path, item.issueNumber, { limit: 250 }),
  }));
  let prReviewStore = null;
  try { prReviewStore = loadPrReviewStore(inspected.path); } catch {}
  const prHealth = managerPrHealthSummary(runs, prReviewStore, {
    loadSnapshot: (prNumber) => prSnapshotLoader(inspected.path, prNumber),
  });
  const reviewEvidence = managerReviewEvidenceSummary(runs, prReviewStore, config);
  const workQueue = {
    ...managerWorkQueue(runs, config, prReviewStore),
    prHealth,
    reviewEvidence,
  };
  const activeRuns = runs.filter((item) =>
    !['human-review', 'automation-failed', 'automation-blocked', 'completed', 'merged', 'closed'].includes(String(item?.status || '')),
  );
  const worker = workerManager?.status?.(repository.id) || { running: false, state: 'stopped' };
  const reviewWorker = reviewWorkerManager?.status?.(repository.id) || { running: false, state: 'stopped' };
  const prReviews = prReviewStore
    ? managerPrReviewSummary(inspected.path, { loadStore: () => prReviewStore })
    : managerPrReviewSummary(inspected.path);
  const externalController = controllerMode === CONTROLLER_MODES.external;
  const embeddedController = controllerMode === CONTROLLER_MODES.embedded;
  const migrationPending = migration?.state === 'open' || (migration?.state === 'merged' && !migration.syncedAt);
  const adoptionReady = migrationAdoption?.ready === true && !migrationPending;
  const repositoryIdentity = inspected.repository || repository.repository || null;
  const chatGptProfile = managerReviewProfileStatus(repositoryIdentity, config, { rootDir });

  const status = {
    repository: {
      ...repository,
      name: repository.name || inspected.name,
      path: inspected.path,
      remote: inspected.remote,
      repository: repositoryIdentity,
      branch: safeBranch(inspected.path, runner),
    },
    setup: {
      complete: config.setupComplete === true,
      baseBranch: config.baseBranch || null,
      controllerMode,
      externalController,
      embeddedController,
      workspaceId: config.workspace?.id || null,
      issueTemplateManaged: integration.issueTemplate?.createdByPackage === true,
      paseoServiceManaged: integration.paseoJson?.serviceAddedByPackage === true,
      managedLabelCount: Object.values(integration.labels || {})
        .filter((item) => item?.createdByPackage === true).length,
      pullRequest: setupPullRequest,
      migration,
      migrationPending,
      migrationAdoption,
      repositoryChanges: {
        available: setupChanges.available,
        expectedFiles: setupChanges.expectedFiles,
        unexpectedFiles: setupChanges.unexpectedFiles,
        managedFiles: setupChanges.managedFiles,
        reason: setupChanges.reason,
      },
    },
    maintenance,
    workQueue,
    chatGptProfile,
    prReviews,
    automation: {
      claimsEnabled: runtime.claimsEnabled === true,
      maxActive: config.maxActive,
      maxReviewRounds: config.maxReviewRounds,
      pollIntervalSeconds: config.pollIntervalSeconds,
      lastDispatchAt: runtime.lastDispatchAt || null,
      lastDispatchResult: runtime.lastDispatchResult || null,
      skippedIssueNumbers: runtime.skippedIssueNumbers || [],
      activeRunCount: activeRuns.length,
      runCount: runs.length,
      statusCounts: statusCounts(runs),
    },
    configuration: {
      codingHarness: config.codingHarness || null,
      issueSelection: {
        mode: config.issueSelection?.mode || null,
        excludedLabels: config.issueSelection?.excludedLabels || [],
        temporaryFailureRetries: config.issueSelection?.temporaryFailureRetries,
      },
      review: {
        workflow: config.review?.workflow || null,
        quickMaxRounds: config.review?.quickMaxRounds,
        fullMaxRounds: config.review?.fullMaxRounds,
        autoMergeApproved: config.review?.autoMergeApproved === true,
      },
    },
    worker,
    reviewWorker,
    models: {
      coder: config.models?.coder || null,
      coderThinking: config.models?.coderThinking || null,
      reviewer: config.models?.reviewer || null,
      reviewerThinking: config.models?.reviewerThinking || null,
    },
    capabilities: {
      automationActions: true,
      configuration: true,
      installationActions: true,
      externalInstallation: !controllerMode,
      embeddedMigration: embeddedController && !migrationPending && !adoptionReady,
      migrationReconciliation: Boolean(migration?.number) && migration?.state !== 'completed',
      migrationAdoption: adoptionReady,
      migrationRequired: embeddedController,
      externalRepair: maintenance.repairAvailable,
      externalRemoval: maintenance.removalAvailable,
      externalRemovalReconciliation: maintenance.removalReconciliation,
      backgroundWorkers: Boolean(workerManager),
      prReviewWorkers: Boolean(reviewWorkerManager),
    },
    stateDirectory: statePaths(inspected.path).root,
  };
  return { ...status, ...managedRepositoryOperationalSummary(status) };
}
