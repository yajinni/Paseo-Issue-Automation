import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { claimNextReview, markReviewSubmissionFailed } from './pr-review-queue.mjs';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pr-review-worker.mjs');

export function tickReviewScheduler(root, { spawnWorker = true, now = Date.now() } = {}) {
  const job = claimNextReview(root, { now });
  if (!job) return { started: false, reason: 'No due serial PR review job.' };
  if (!spawnWorker) return { started: true, job };
  try {
    const child = spawn(process.execPath, [workerPath, root, job.id], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { started: true, jobId: job.id, pid: child.pid || null };
  } catch (error) {
    markReviewSubmissionFailed(root, job.id, error);
    throw error;
  }
}
