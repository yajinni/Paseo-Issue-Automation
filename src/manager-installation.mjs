import {
  createExternalMigrationPullRequest,
  reconcileExternalMigration,
} from './external-migration.mjs';
import { installExternalRepositoryIntegration } from './install.mjs';

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

export function installExternalRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  installer = installExternalRepositoryIntegration,
} = {}) {
  requireRegisteredRepository(repository, 'install the external controller integration');
  requireStoppedWorkers(repository, { workerManager, reviewWorkerManager });
  return installer(repository.path);
}

export function migrateEmbeddedRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  migrator = createExternalMigrationPullRequest,
} = {}) {
  requireRegisteredRepository(repository, 'migrate the embedded controller installation');
  requireStoppedWorkers(repository, { workerManager, reviewWorkerManager });
  return migrator(repository.path);
}

export function reconcileEmbeddedMigrationFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  reconciler = reconcileExternalMigration,
} = {}) {
  requireRegisteredRepository(repository, 'reconcile the external-controller migration');
  requireStoppedWorkers(repository, { workerManager, reviewWorkerManager });
  return reconciler(repository.path);
}
