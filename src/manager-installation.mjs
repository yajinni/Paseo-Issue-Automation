import { adoptAlreadyMigratedRepository } from './external-adoption.mjs';
import {
  createExternalRemovalPullRequest,
  reconcileExternalRemoval,
  repairExternalRepositoryIntegration,
} from './external-maintenance.mjs';
import {
  createExternalMigrationPullRequest,
  reconcileExternalMigration,
} from './external-migration.mjs';
import { installExternalRepositoryIntegration, setupSnapshot } from './install.mjs';

function requireRegisteredRepository(repository, action) {
  if (!repository?.id || !repository?.path) {
    throw new Error(`A registered repository is required to ${action}.`);
  }
}

function requireStoppedWorkers(repository, { workerManager = null, reviewWorkerManager = null } = {}) {
  const codingWorker = workerManager?.status?.(repository.id);
  if (codingWorker?.running) {
    throw new Error('Stop this repository’s coding worker before changing its controller installation.');
  }
  const reviewWorker = reviewWorkerManager?.status?.(repository.id);
  if (reviewWorker?.running) {
    throw new Error('Stop this repository’s PR-review worker before changing its controller installation.');
  }
}

function guarded(repository, options, action, handler) {
  requireRegisteredRepository(repository, action);
  requireStoppedWorkers(repository, options);
  return handler(repository.path);
}

export function installExternalRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  installer = installExternalRepositoryIntegration,
} = {}) {
  return guarded(
    repository,
    { workerManager, reviewWorkerManager },
    'install the external controller integration',
    installer,
  );
}

export function migrateEmbeddedRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  migrator = createExternalMigrationPullRequest,
} = {}) {
  return guarded(
    repository,
    { workerManager, reviewWorkerManager },
    'migrate the embedded controller installation',
    migrator,
  );
}

export function reconcileEmbeddedMigrationFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  reconciler = reconcileExternalMigration,
} = {}) {
  return guarded(
    repository,
    { workerManager, reviewWorkerManager },
    'reconcile the external-controller migration',
    reconciler,
  );
}

export function finalizeExistingMigrationFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  adopter = adoptAlreadyMigratedRepository,
  refresher = setupSnapshot,
} = {}) {
  requireRegisteredRepository(repository, 'finalize the existing external-controller migration');
  requireStoppedWorkers(repository, { workerManager, reviewWorkerManager });
  const adoption = adopter(repository.path);
  const setup = refresher(repository.path, {
    forceDiscovery: true,
    forceRequirements: true,
    forceIntegration: true,
  });
  return {
    ...adoption,
    setupReady: setup.checks?.ready === true,
    setupComplete: setup.config?.setupComplete === true,
    setupChecks: setup.checks || null,
  };
}

export function repairExternalRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  repairer = repairExternalRepositoryIntegration,
} = {}) {
  return guarded(
    repository,
    { workerManager, reviewWorkerManager },
    'repair the external controller integration',
    repairer,
  );
}

export function removeExternalRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  remover = createExternalRemovalPullRequest,
} = {}) {
  return guarded(
    repository,
    { workerManager, reviewWorkerManager },
    'remove the external controller integration',
    remover,
  );
}

export function reconcileExternalRemovalFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  reconciler = reconcileExternalRemoval,
} = {}) {
  return guarded(
    repository,
    { workerManager, reviewWorkerManager },
    'reconcile external integration removal',
    reconciler,
  );
}
