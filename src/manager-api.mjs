import { listControllerLogs } from './controller-log.mjs';
import { managerRepositoryAction } from './manager-actions.mjs';
import { loadManagerConfig, saveManagerConfig } from './manager-config.mjs';
import {
  finalizeExistingMigrationFromManager,
  installExternalRepositoryFromManager,
  migrateEmbeddedRepositoryFromManager,
  reconcileEmbeddedMigrationFromManager,
  reconcileExternalRemovalFromManager,
  removeExternalRepositoryFromManager,
  repairExternalRepositoryFromManager,
} from './manager-installation.mjs';
import { managerIssueProcessingAction } from './manager-issue-processing.mjs';
import { managerIssuePlan } from './manager-issues.mjs';
import {
  parseRepositoryApiPath,
  repositoryRegistryRequest,
  resolveRepositoryApiContext,
} from './repository-api-context.mjs';
import { findRepository } from './repository-registry.mjs';
import { managerRepositoryStatus } from './manager-status.mjs';
import { setupWizardApiRequest } from './setup-wizard/api.mjs';
import { loadConfig } from './state.mjs';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function workerAction(workerManager, context, pathname) {
  const workerRoute = ['/api/worker/start', '/api/worker/stop', '/api/worker/restart'].includes(pathname);
  if (!workerRoute) return null;
  if (!workerManager) throw new Error('The standalone manager coding-worker pool is unavailable.');
  if (pathname === '/api/worker/start') return workerManager.start(context.repository);
  if (pathname === '/api/worker/stop') return workerManager.stop(context.repository.id);
  return workerManager.restart(context.repository);
}

function reviewWorkerAction(reviewWorkerManager, context, pathname) {
  const workerRoute = [
    '/api/review-worker/start',
    '/api/review-worker/stop',
    '/api/review-worker/restart',
  ].includes(pathname);
  if (!workerRoute) return null;
  if (!reviewWorkerManager) throw new Error('The standalone manager PR-review worker pool is unavailable.');
  if (pathname === '/api/review-worker/start') return reviewWorkerManager.start(context.repository);
  if (pathname === '/api/review-worker/stop') return reviewWorkerManager.stop(context.repository.id);
  return reviewWorkerManager.restart(context.repository);
}

function cachedManagerStatus(workerManager) {
  return workerManager?.managerStatus?.({ refreshCapacity: false }) || null;
}

function managerRequest(method, pathname, body, options) {
  if (pathname === '/api/manager/config' && method === 'GET') {
    return { handled: true, status: 200, body: { config: loadManagerConfig(options) } };
  }
  if (pathname === '/api/manager/config' && method === 'POST') {
    const config = saveManagerConfig(body, options);
    options.workerManager?.drain?.();
    return {
      handled: true,
      status: 200,
      body: { config, manager: cachedManagerStatus(options.workerManager) },
    };
  }
  if (pathname === '/api/manager/status' && method === 'GET') {
    return {
      handled: true,
      status: 200,
      body: {
        config: loadManagerConfig(options),
        manager: cachedManagerStatus(options.workerManager),
        workers: options.workerManager?.list?.() || [],
        reviewWorkers: options.reviewWorkerManager?.list?.() || [],
      },
    };
  }
  return null;
}

function refreshedResult(context, options, result) {
  const statusReader = options.statusReader || managerRepositoryStatus;
  return {
    handled: true,
    status: 200,
    body: {
      result,
      status: statusReader(context.repository, options),
    },
  };
}

function lightweightAcceptedResult(result) {
  return {
    handled: true,
    status: 202,
    body: { result },
  };
}

function issuePlanResult(context, options) {
  const planner = options.issuePlanner || managerIssuePlan;
  const configLoader = options.repositoryConfigLoader || loadConfig;
  try {
    return {
      handled: true,
      status: 200,
      body: { issuePlan: { available: true, error: null, ...planner(context.root, configLoader(context.root)) } },
    };
  } catch (error) {
    return {
      handled: true,
      status: 200,
      body: {
        issuePlan: {
          available: false,
          error: error instanceof Error ? error.message : String(error),
          items: [],
          total: 0,
          eligible: 0,
          blocked: 0,
          skipped: 0,
          active: 0,
          nextIssueNumber: null,
        },
      },
    };
  }
}

function weeklyLogsResult(context) {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  return {
    handled: true,
    status: 200,
    body: listControllerLogs(context.root, { since, limit: 10_000 }),
  };
}

function installationResult(context, options, handler, dependencyKey) {
  const result = handler(context.repository, {
    workerManager: options.workerManager,
    reviewWorkerManager: options.reviewWorkerManager,
    [dependencyKey]: options[dependencyKey],
  });
  return refreshedResult(context, options, result);
}

export function managerApiRequest({ method, pathname, body = {} }, options = {}) {
  const setup = setupWizardApiRequest({ method, pathname, body }, options);
  if (setup.handled) return setup;

  const manager = managerRequest(method, pathname, body, options);
  if (manager) return manager;
  if (method === 'GET' && pathname === '/api/workers') {
    return {
      handled: true,
      status: 200,
      body: {
        workers: options.workerManager?.list?.() || [],
        reviewWorkers: options.reviewWorkerManager?.list?.() || [],
      },
    };
  }

  const route = parseRepositoryApiPath(pathname);
  if (method === 'DELETE' && route.selector && !route.repositoryPath) {
    const repository = findRepository(route.selector, options);
    if (repository) {
      options.workerManager?.stop?.(repository.id);
      options.reviewWorkerManager?.stop?.(repository.id);
    }
  }
  const registry = repositoryRegistryRequest({ method, pathname, body }, options);
  if (registry.handled) return registry;

  const context = resolveRepositoryApiContext(pathname, options);
  if (!context) return { handled: false };
  const statusReader = options.statusReader || managerRepositoryStatus;
  if (method === 'GET' && context.pathname === '/api/status') {
    return {
      handled: true,
      status: 200,
      body: { status: statusReader(context.repository, options) },
    };
  }
  if (method === 'GET' && context.pathname === '/api/issues-plan') return issuePlanResult(context, options);
  if (method === 'GET' && context.pathname === '/api/logs') return weeklyLogsResult(context);
  if (method === 'POST') {
    if (context.pathname === '/api/migrate/adopt') {
      const result = finalizeExistingMigrationFromManager(context.repository, {
        workerManager: options.workerManager,
        reviewWorkerManager: options.reviewWorkerManager,
        adopter: options.adoptionHandler,
        refresher: options.setupRefresher,
      });
      return refreshedResult(context, options, result);
    }

    const installationRoutes = new Map([
      ['/api/install/external', [options.installHandler || installExternalRepositoryFromManager, 'installer']],
      ['/api/migrate/external', [options.migrationHandler || migrateEmbeddedRepositoryFromManager, 'migrator']],
      ['/api/migrate/reconcile', [options.migrationReconcileHandler || reconcileEmbeddedMigrationFromManager, 'reconciler']],
      ['/api/maintenance/repair', [options.repairHandler || repairExternalRepositoryFromManager, 'repairer']],
      ['/api/maintenance/remove', [options.removalHandler || removeExternalRepositoryFromManager, 'remover']],
      ['/api/maintenance/reconcile', [options.removalReconcileHandler || reconcileExternalRemovalFromManager, 'reconciler']],
    ]);
    const installationRoute = installationRoutes.get(context.pathname);
    if (installationRoute) {
      return installationResult(context, options, installationRoute[0], installationRoute[1]);
    }

    const actionHandler = options.actionHandler || managerRepositoryAction;
    const issueProcessingResult = (options.issueProcessingHandler || managerIssueProcessingAction)({
      root: context.root,
      repository: context.repository,
      pathname: context.pathname,
      workerManager: options.workerManager,
      actionHandler,
      actions: options.actions,
    });
    if (issueProcessingResult !== null) return refreshedResult(context, options, issueProcessingResult);

    const codingWorkerResult = workerAction(options.workerManager, context, context.pathname);
    if (codingWorkerResult !== null) {
      return refreshedResult(context, options, codingWorkerResult);
    }
    const reviewResult = reviewWorkerAction(options.reviewWorkerManager, context, context.pathname);
    if (reviewResult !== null) {
      if (context.pathname === '/api/review-worker/start' || context.pathname === '/api/review-worker/restart') {
        return lightweightAcceptedResult(reviewResult);
      }
      return refreshedResult(context, options, reviewResult);
    }

    const result = actionHandler(context.root, context.pathname, body, options.actions);
    if (result !== null) {
      if (context.pathname === '/api/config') options.workerManager?.refresh?.(context.repository);
      if (context.pathname === '/api/restart-issue') return lightweightAcceptedResult(result);
      return refreshedResult(context, options, result);
    }
  }
  return {
    handled: true,
    status: method === 'GET' ? 404 : 405,
    body: {
      error: method === 'GET'
        ? `Manager route ${context.pathname} is not available.`
        : `Manager action ${context.pathname} is not available.`,
    },
  };
}
