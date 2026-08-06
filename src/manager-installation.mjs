import { installExternalRepositoryIntegration } from './install.mjs';

export function installExternalRepositoryFromManager(repository, {
  workerManager = null,
  reviewWorkerManager = null,
  installer = installExternalRepositoryIntegration,
} = {}) {
  if (!repository?.id || !repository?.path) {
    throw new Error('A registered repository is required for external installation.');
  }
  const codingWorker = workerManager?.status?.(repository.id);
  if (codingWorker?.running) {
    throw new Error('Stop this repository’s coding worker before installing the external controller integration.');
  }
  const reviewWorker = reviewWorkerManager?.status?.(repository.id);
  if (reviewWorker?.running) {
    throw new Error('Stop this repository’s PR-review worker before installing the external controller integration.');
  }
  return installer(repository.path);
}
