import { managerRepositoryAction } from './manager-actions.mjs';

export const PR_REVIEW_PROCESSING_ROUTES = Object.freeze([
  '/api/pr-review/resume',
  '/api/pr-review/pause',
]);

export function managerPrReviewProcessingAction({
  root,
  repository,
  pathname,
  reviewWorkerManager,
  actionHandler = managerRepositoryAction,
  actions,
} = {}) {
  if (!PR_REVIEW_PROCESSING_ROUTES.includes(pathname)) return null;
  if (!root || !repository?.id) throw new Error('A registered repository is required for PR-review processing.');
  if (!reviewWorkerManager) throw new Error('The standalone manager PR-review worker pool is unavailable.');

  if (pathname === '/api/pr-review/resume') {
    const desired = actionHandler(root, '/api/pr-review/resume', {}, actions);
    try {
      const worker = reviewWorkerManager.start(repository);
      return { state: 'running', desiredRunning: true, worker, desired };
    } catch (error) {
      try { actionHandler(root, '/api/pr-review/pause', {}, actions); } catch {}
      throw error;
    }
  }

  const desired = actionHandler(root, '/api/pr-review/pause', {}, actions);
  const worker = reviewWorkerManager.stop(repository.id);
  return { state: 'stopped', desiredRunning: false, worker, desired };
}
