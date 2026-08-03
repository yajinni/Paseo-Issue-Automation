import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { browserPaths } from './browser-profile.mjs';
import { acquireLease, releaseLease, transferLease } from './durable-lease.mjs';
import { claimNextReview, markReviewSubmissionFailed } from './pr-review-queue.mjs';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pr-review-worker.mjs');
const GLOBAL_REVIEW_TTL_MS = 180_000;

export function tickReviewScheduler(root, { spawnWorker = true, now = Date.now() } = {}) {
  const globalLock = browserPaths().reviewSchedulerLock;
  const globalLease = acquireLease(globalLock, {
    owner: `serial-review-scheduler-${process.pid}`,
    purpose: 'serial-chatgpt-review',
    resource: 'global-chatgpt-review-session',
    ttlMs: GLOBAL_REVIEW_TTL_MS,
    now,
    requireLiveProcess: false,
  });
  if (!globalLease.acquired) return { started: false, reason: 'Another Paseo project owns the global serial review lease.' };
  const job = claimNextReview(root, { now });
  if (!job) {
    releaseLease(globalLock, globalLease.lease.id);
    return { started: false, reason: 'No due serial PR review job.' };
  }
  if (!spawnWorker) return { started: true, job, globalLease };
  try {
    const child = spawn(process.execPath, [workerPath, root, job.id, globalLease.lease.id], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!child.pid) throw new Error('Could not determine the serial review worker PID.');
    transferLease(globalLock, globalLease.lease.id, {
      owner: `serial-review-worker-${child.pid}`,
      pid: child.pid,
      ttlMs: GLOBAL_REVIEW_TTL_MS,
      metadata: { repositoryRoot: root, reviewJobId: job.id },
    });
    child.once('error', (error) => {
      releaseLease(globalLock, globalLease.lease.id);
      try { markReviewSubmissionFailed(root, job.id, error); } catch {}
    });
    child.unref();
    return { started: true, jobId: job.id, pid: child.pid };
  } catch (error) {
    releaseLease(globalLock, globalLease.lease.id);
    markReviewSubmissionFailed(root, job.id, error);
    throw error;
  }
}
