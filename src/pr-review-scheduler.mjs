import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { browserPaths } from './browser-profile.mjs';
import { appendControllerLog } from './controller-log.mjs';
import { acquireLease, releaseLease, transferLease } from './durable-lease.mjs';
import { claimNextReview, markReviewSubmissionFailed } from './pr-review-queue.mjs';
import { findManaged, findReviewJob, loadPrReviewStore } from './pr-review-store.mjs';
import { webChatGptFullReviewMetadata } from './web-chatgpt-full-review.mjs';
import { loadConfig } from './state.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const legacyWorkerPath = path.join(sourceDirectory, 'pr-review-worker.mjs');
const fullReviewWorkerPath = path.join(sourceDirectory, 'web-chatgpt-full-review-worker.mjs');
const GLOBAL_REVIEW_TTL_MS = 180_000;

function safeSchedulerLog(root, input) {
  try { return appendControllerLog(root, { category: 'pr-reviews', source: 'automation', ...input }); }
  catch { return null; }
}

export function reviewWorkerPath(root, jobId) {
  const metadata = webChatGptFullReviewMetadata(root, jobId);
  const store = loadPrReviewStore(root);
  const job = findReviewJob(store, jobId);
  const managed = job ? findManaged(store, job.managedPullRequestId) : null;
  let quickWebWorkflow = false;
  try { quickWebWorkflow = loadConfig(root).review?.workflow === 'quick-web-chatgpt'; } catch {}
  if (quickWebWorkflow && managed?.provenance?.type === 'manual-import'
      && (!metadata || metadata.stage !== 'full'
        || String(metadata.headSha || '').toLowerCase() !== String(job.headSha || '').toLowerCase())) {
    throw new Error(`Imported quick-web review job ${jobId} lacks matching exact-head Full metadata.`);
  }
  return metadata ? fullReviewWorkerPath : legacyWorkerPath;
}

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
    const workerPath = reviewWorkerPath(root, job.id);
    const workerName = workerPath === fullReviewWorkerPath ? 'web-chatgpt-full-review' : 'legacy-browser-review';
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
      metadata: {
        repositoryRoot: root,
        reviewJobId: job.id,
        worker: workerName,
      },
    });
    safeSchedulerLog(root, {
      action: 'start-pr-review-worker',
      status: 'started',
      message: `Claimed PR review job ${job.id} and started the serial review worker.`,
      details: {
        reviewJobId: job.id,
        managedPullRequestId: job.managedPullRequestId || null,
        headSha: job.headSha || null,
        reviewRound: job.reviewRound || null,
        worker: workerName,
        pid: child.pid,
      },
    });
    child.once('error', (error) => {
      releaseLease(globalLock, globalLease.lease.id);
      try { markReviewSubmissionFailed(root, job.id, error); } catch {}
      safeSchedulerLog(root, {
        level: 'error',
        action: 'start-pr-review-worker',
        status: 'failed',
        message: `PR review worker failed to start for job ${job.id}: ${error.message}`,
        details: { reviewJobId: job.id, worker: workerName, error },
      });
    });
    child.unref();
    return {
      started: true,
      jobId: job.id,
      pid: child.pid,
      worker: workerName,
    };
  } catch (error) {
    releaseLease(globalLock, globalLease.lease.id);
    markReviewSubmissionFailed(root, job.id, error);
    safeSchedulerLog(root, {
      level: 'error',
      action: 'start-pr-review-worker',
      status: 'failed',
      message: `Could not start the serial PR review worker for job ${job.id}: ${error.message}`,
      details: { reviewJobId: job.id, error },
    });
    throw error;
  }
}
