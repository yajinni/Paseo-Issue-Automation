import { inspectRepository } from './repository-registry.mjs';
import {
  listRuns,
  loadConfig,
  loadIntegration,
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

export function managerRepositoryStatus(repository, {
  runner = run,
  platform = process.platform,
  workerManager = null,
} = {}) {
  if (!repository?.path) throw new Error('A registered repository path is required.');
  const inspected = inspectRepository(repository.path, { runner, platform });
  const config = loadConfig(inspected.path);
  const runtime = loadRuntime(inspected.path);
  const integration = loadIntegration(inspected.path);
  const runs = listRuns(inspected.path);
  const activeRuns = runs.filter((item) =>
    !['human-review', 'automation-failed', 'automation-blocked', 'completed', 'closed'].includes(String(item?.status || '')),
  );
  const worker = workerManager?.status?.(repository.id) || { running: false, state: 'stopped' };

  return {
    repository: {
      ...repository,
      name: repository.name || inspected.name,
      path: inspected.path,
      remote: inspected.remote,
      repository: inspected.repository || repository.repository || null,
      branch: safeBranch(inspected.path, runner),
    },
    setup: {
      complete: config.setupComplete === true,
      baseBranch: config.baseBranch || null,
      workspaceId: config.workspace?.id || null,
      issueTemplateManaged: integration.issueTemplate?.createdByPackage === true,
      paseoServiceManaged: integration.paseoJson?.serviceAddedByPackage === true,
      managedLabelCount: Object.values(integration.labels || {})
        .filter((item) => item?.createdByPackage === true).length,
    },
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
    worker,
    models: {
      coder: config.models?.coder || null,
      reviewer: config.models?.reviewer || null,
    },
    capabilities: {
      automationActions: true,
      configuration: true,
      installationActions: false,
      backgroundWorkers: Boolean(workerManager),
    },
    stateDirectory: statePaths(inspected.path).root,
  };
}
