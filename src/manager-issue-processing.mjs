import { managerRepositoryAction } from './manager-actions.mjs';

export const ISSUE_PROCESSING_ROUTES = Object.freeze([
  '/api/issue-processing/start',
  '/api/issue-processing/pause',
]);

export function managerIssueProcessingAction({
  root,
  repository,
  pathname,
  workerManager,
  actionHandler = managerRepositoryAction,
  actions,
} = {}) {
  if (!ISSUE_PROCESSING_ROUTES.includes(pathname)) return null;
  if (!root || !repository?.id) throw new Error('A registered repository is required for issue processing.');
  if (!workerManager) throw new Error('The standalone manager issue-processing worker pool is unavailable.');

  if (pathname === '/api/issue-processing/start') {
    const claims = actionHandler(root, '/api/resume', {}, actions);
    try {
      const worker = workerManager.refresh?.(repository) || workerManager.start(repository);
      return {
        state: 'running',
        claimsEnabled: true,
        worker,
        claims,
      };
    } catch (error) {
      try { actionHandler(root, '/api/pause', {}, actions); } catch {}
      throw error;
    }
  }

  const claims = actionHandler(root, '/api/pause', {}, actions);
  return {
    state: 'paused',
    claimsEnabled: false,
    worker: workerManager.status?.(repository.id) || { running: true, state: 'idle' },
    claims,
  };
}
