import { randomUUID } from 'node:crypto';
import {
  appendHistory,
  clone,
  findManaged,
  findReviewJob,
  loadPrReviewStore,
  managedPullRequestId,
  mutatePrReviewStore,
  nextQueuePosition,
  nowIso,
  TERMINAL_PR_STATES,
  transitionManaged,
} from './pr-review-store.mjs';
import { managedPrSnapshot } from './pr-review-github.mjs';
import { evaluateApprovedReviewGate, finalizeApprovedBrowserReview } from './pr-review-finalize.mjs';
import { createReviewRequestId, reviewJobId } from './review-prompt.mjs';

function validSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error('A valid pull-request head SHA is required.');
  return sha;
}

function queuedReviewJobs(store, managedId) {
  return store.reviewJobs.filter((job) => job.managedPullRequestId === managedId && ['queued', 'submitting', 'awaiting_result'].includes(job.state));
}

function supersedeOlderJobs(store, managed, headSha, at) {
  for (const job of queuedReviewJobs(store, managed.id)) {
    if (job.headSha === headSha) continue;
    const previous = job.state;
    job.state = 'superseded';
    job.completedAt = at;
    job.updatedAt = at;
    appendHistory(store, {
      entityType: 'review_job', entityId: job.id, previousState: previous, newState: 'superseded',
      reason: `Superseded by newer PR head ${headSha}.`, actor: 'queue', sha: headSha, timestamp: at,
    });
    if (store.runtime.activeReviewJobId === job.id) store.runtime.activeReviewJobId = null;
  }
}

export function enqueueReviewInStore(store, managed, {
  headSha = managed.currentHeadSha,
  immediate = false,
  forceRetry = false,
  conversationUrlOverride = null,
  now = Date.now(),
} = {}) {
  if (TERMINAL_PR_STATES.has(managed.reviewState)) throw new Error(`Managed PR ${managed.id} is terminal and cannot be queued.`);
  const sha = validSha(headSha);
  const at = nowIso(now);
  const promptVersion = Number(managed.reviewPromptVersion || store.config.browserReview.reviewPromptVersion);
  const id = reviewJobId({ repository: managed.repository, pullRequestNumber: managed.pullRequestNumber, headSha: sha, reviewPromptVersion: promptVersion });
  const existing = findReviewJob(store, id);
  if (existing) {
    if (existing.state === 'queued' && conversationUrlOverride) {
      existing.conversationUrlOverride = conversationUrlOverride;
      if (immediate) existing.dueAt = at;
      existing.updatedAt = at;
      appendHistory(store, {
        entityType: 'review_job', entityId: existing.id, previousState: 'queued', newState: 'queued',
        reason: 'One-time review destination updated on the existing deduplicated job.', actor: 'user', sha, timestamp: at,
      });
      return existing;
    }
    if (!forceRetry || !['failed', 'paused', 'cancelled'].includes(existing.state)) return existing;
    const previousState = existing.state;
    existing.state = 'queued';
    existing.lastError = null;
    existing.diagnosticScreenshot = null;
    existing.completedAt = null;
    if (conversationUrlOverride) existing.conversationUrlOverride = conversationUrlOverride;
    existing.dueAt = immediate ? at : nowIso(now + store.config.browserReview.reviewDebounceMs);
    existing.queuePosition = nextQueuePosition(store);
    existing.updatedAt = at;
    appendHistory(store, {
      entityType: 'review_job', entityId: existing.id, previousState, newState: 'queued',
      reason: 'Explicit review retry requested.', actor: 'user', sha, timestamp: at,
    });
    transitionManaged(store, managed, 'queued', { reason: 'Review retry queued.', actor: 'user', sha, at });
    return existing;
  }
  supersedeOlderJobs(store, managed, sha, at);
  const job = {
    id,
    managedPullRequestId: managed.id,
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    headSha: sha,
    promptVersion,
    reviewRound: managed.reviewRound,
    reviewRequestId: createReviewRequestId(),
    state: 'queued',
    queuePosition: nextQueuePosition(store),
    priority: managed.priority || 0,
    dueAt: immediate ? at : nowIso(now + store.config.browserReview.reviewDebounceMs),
    attempts: 0,
    conversationUrlOverride,
    conversationUrlUsed: null,
    submittedAt: null,
    completedAt: null,
    lastError: null,
    diagnosticScreenshot: null,
    createdAt: at,
    updatedAt: at,
  };
  store.reviewJobs.push(job);
  managed.currentHeadSha = sha;
  managed.queuePosition = job.queuePosition;
  managed.activeReviewRequestId = job.reviewRequestId;
  transitionManaged(store, managed, 'queued', { reason: `Review queued for ${sha}.`, actor: 'queue', sha, at });
  appendHistory(store, {
    entityType: 'review_job', entityId: job.id, previousState: null, newState: 'queued',
    reason: 'Persistent review job created.', actor: 'queue', sha, timestamp: at,
  });
  return job;
}

export function registerManagedPullRequest(root, input, options = {}) {
  return mutatePrReviewStore(root, (store) => {
    const id = managedPullRequestId(input.repository, input.pullRequestNumber);
    const at = nowIso(options.now || Date.now());
    let managed = findManaged(store, id);
    if (!managed) {
      managed = {
        id,
        repository: String(input.repository),
        issueNumber: Number(input.issueNumber),
        issueUrl: input.issueUrl || null,
        pullRequestNumber: Number(input.pullRequestNumber),
        pullRequestUrl: String(input.pullRequestUrl),
        branchName: String(input.branchName),
        worktreePath: input.worktreePath || null,
        workspaceId: input.workspaceId || null,
        coderAgentId: input.coderAgentId || null,
        currentHeadSha: validSha(input.currentHeadSha),
        lastSubmittedReviewSha: null,
        lastCompletedReviewSha: null,
        reviewRound: Math.max(1, Number(input.reviewRound) || 1),
        reviewPromptVersion: store.config.browserReview.reviewPromptVersion,
        reviewState: store.config.enabled && store.config.browserReview.enabled ? 'queued' : 'paused',
        queuePosition: null,
        priority: Number(input.priority) || 0,
        activeReviewRequestId: null,
        lastReviewCommentId: null,
        lastProcessedReviewRequestId: null,
        conversationUrlOverride: input.conversationUrlOverride || null,
        createdAt: at,
        updatedAt: at,
        lastReconciledAt: null,
        lastActivityAt: at,
        lastError: null,
        issueClosurePending: false,
        diagnosticScreenshot: null,
      };
      store.managedPullRequests.push(managed);
      appendHistory(store, {
        entityType: 'managed_pull_request', entityId: managed.id, previousState: null,
        newState: managed.reviewState, reason: 'Coder created or updated a managed PR.', actor: 'coding-scheduler',
        sha: managed.currentHeadSha, timestamp: at,
      });
    } else {
      Object.assign(managed, {
        issueNumber: Number(input.issueNumber), issueUrl: input.issueUrl || managed.issueUrl,
        pullRequestUrl: String(input.pullRequestUrl || managed.pullRequestUrl), branchName: String(input.branchName || managed.branchName),
        worktreePath: input.worktreePath || managed.worktreePath, workspaceId: input.workspaceId || managed.workspaceId,
        coderAgentId: input.coderAgentId || managed.coderAgentId, currentHeadSha: validSha(input.currentHeadSha), updatedAt: at, lastActivityAt: at,
      });
    }
    let reviewJob = null;
    if (store.config.enabled && store.config.browserReview.enabled) reviewJob = enqueueReviewInStore(store, managed, { headSha: managed.currentHeadSha, now: options.now });
    return { managed: clone(managed), reviewJob: reviewJob ? clone(reviewJob) : null };
  });
}

export function enqueueManagedReview(root, managedId, options = {}) {
  return mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
    return clone(enqueueReviewInStore(store, managed, options));
  });
}

export function nextDueReview(store, now = Date.now()) {
  if (!store.config.enabled || !store.config.browserReview.enabled || store.config.reviewQueue.paused || store.runtime.activeReviewJobId) return null;
  return store.reviewJobs
    .filter((job) => {
      if (job.state !== 'queued' || Date.parse(job.dueAt) > now) return false;
      const managed = findManaged(store, job.managedPullRequestId);
      return Boolean(managed && managed.reviewState !== 'paused' && !TERMINAL_PR_STATES.has(managed.reviewState));
    })
    .sort((a, b) => Number(b.priority) - Number(a.priority) || Number(a.queuePosition) - Number(b.queuePosition))[0] || null;
}

export function claimNextReview(root, { now = Date.now() } = {}) {
  return mutatePrReviewStore(root, (store) => {
    const job = nextDueReview(store, now);
    if (!job) return null;
    const managed = findManaged(store, job.managedPullRequestId);
    const at = nowIso(now);
    const previous = job.state;
    job.state = 'submitting';
    job.attempts += 1;
    job.updatedAt = at;
    store.runtime.activeReviewJobId = job.id;
    transitionManaged(store, managed, 'submitting', { reason: 'Serial review worker claimed the job.', actor: 'review-scheduler', sha: job.headSha, at });
    appendHistory(store, { entityType: 'review_job', entityId: job.id, previousState: previous, newState: 'submitting', reason: 'Serial review worker claimed the job.', actor: 'review-scheduler', sha: job.headSha, timestamp: at });
    return clone(job);
  });
}

export function markReviewSubmitted(root, jobId, result) {
  return mutatePrReviewStore(root, (store) => {
    const job = findReviewJob(store, jobId);
    if (!job) throw new Error(`Review job ${jobId} was not found.`);
    const managed = findManaged(store, job.managedPullRequestId);
    const at = result.submittedAt || nowIso();
    job.state = 'awaiting_result';
    job.submittedAt = at;
    job.conversationUrlUsed = result.conversationUrl;
    job.updatedAt = at;
    job.lastError = null;
    if (managed) {
      managed.lastSubmittedReviewSha = job.headSha;
      managed.activeReviewRequestId = job.reviewRequestId;
      transitionManaged(store, managed, 'awaiting_result', { reason: 'Review prompt submitted exactly once.', actor: 'browser-worker', sha: job.headSha, at });
    }
    store.runtime.activeReviewJobId = null;
    appendHistory(store, { entityType: 'review_job', entityId: job.id, previousState: 'submitting', newState: 'awaiting_result', reason: 'Review prompt submitted.', actor: 'browser-worker', sha: job.headSha, timestamp: at });
    return clone(job);
  });
}

export function markReviewSubmissionFailed(root, jobId, error, diagnostics = {}) {
  return mutatePrReviewStore(root, (store) => {
    const job = findReviewJob(store, jobId);
    if (!job) throw new Error(`Review job ${jobId} was not found.`);
    const managed = findManaged(store, job.managedPullRequestId);
    const at = nowIso();
    const retryable = job.attempts < store.config.browserReview.maxSubmissionAttempts;
    job.state = retryable ? 'queued' : 'failed';
    job.lastError = String(error?.message || error);
    job.diagnosticScreenshot = diagnostics.screenshot || null;
    job.dueAt = nowIso(Date.now() + Math.min(300_000, 15_000 * (2 ** Math.max(0, job.attempts - 1))));
    job.updatedAt = at;
    if (managed) {
      managed.diagnosticScreenshot = job.diagnosticScreenshot;
      transitionManaged(store, managed, retryable ? 'queued' : 'failed', { reason: retryable ? 'Bounded browser retry scheduled.' : 'Maximum browser submission attempts reached.', actor: 'browser-worker', sha: job.headSha, error: job.lastError, at });
    }
    store.runtime.activeReviewJobId = null;
    appendHistory(store, { entityType: 'review_job', entityId: job.id, previousState: 'submitting', newState: job.state, reason: retryable ? 'Submission failed; retry queued.' : 'Submission failed permanently.', actor: 'browser-worker', sha: job.headSha, error: job.lastError, timestamp: at });
    return clone(job);
  });
}

export function createFixJobInStore(store, managed, reviewJob, findings, { sourceCommentId = null, now = Date.now() } = {}) {
  const existing = store.fixJobs.find((job) => job.reviewRequestId === reviewJob.reviewRequestId);
  if (existing) return existing;
  const at = nowIso(now);
  const job = {
    id: `fix-${randomUUID()}`,
    managedPullRequestId: managed.id,
    reviewJobId: reviewJob.id,
    reviewRequestId: reviewJob.reviewRequestId,
    sourceReviewRound: reviewJob.reviewRound,
    sourceReviewCommentId: sourceCommentId,
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    issueNumber: managed.issueNumber,
    branchName: managed.branchName,
    reviewedHeadSha: reviewJob.headSha,
    findings: String(findings || ''),
    state: 'queued',
    priority: managed.priority || 0,
    attempts: 0,
    workerLease: null,
    coderAgentId: null,
    startedAt: null,
    completedAt: null,
    newHeadSha: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
  };
  store.fixJobs.push(job);
  reviewJob.state = 'completed';
  reviewJob.completedAt = at;
  reviewJob.updatedAt = at;
  managed.lastCompletedReviewSha = reviewJob.headSha;
  managed.lastReviewCommentId = sourceCommentId;
  managed.lastProcessedReviewRequestId = reviewJob.reviewRequestId;
  transitionManaged(store, managed, 'fix_queued', { reason: 'Validated review findings created a coding fix job.', actor: 'reconciliation', sha: reviewJob.headSha, at });
  appendHistory(store, { entityType: 'fix_job', entityId: job.id, previousState: null, newState: 'queued', reason: 'Fix job created from matching review result.', actor: 'reconciliation', sha: reviewJob.headSha, timestamp: at });
  return job;
}

export function moveReviewJob(root, jobId, direction) {
  return mutatePrReviewStore(root, (store) => {
    const queued = store.reviewJobs.filter((job) => job.state === 'queued').sort((a, b) => a.queuePosition - b.queuePosition);
    const index = queued.findIndex((job) => job.id === jobId);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= queued.length) return clone(findReviewJob(store, jobId));
    [queued[index].queuePosition, queued[swapIndex].queuePosition] = [queued[swapIndex].queuePosition, queued[index].queuePosition];
    queued[index].updatedAt = nowIso(); queued[swapIndex].updatedAt = nowIso();
    return clone(queued[index]);
  });
}

export function pauseManagedPr(root, managedId, paused = true) {
  return mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
    const active = store.reviewJobs.find((job) => job.managedPullRequestId === managedId && job.state === 'submitting');
    if (paused && active) throw new Error('An actively submitting review cannot be paused. Wait for submission to finish or fail.');
    const at = nowIso();
    for (const job of store.reviewJobs.filter((candidate) => candidate.managedPullRequestId === managedId)) {
      if (paused && job.state === 'queued') {
        job.state = 'paused';
        job.updatedAt = at;
      } else if (!paused && job.state === 'paused') {
        job.state = 'queued';
        job.dueAt = at;
        job.queuePosition = nextQueuePosition(store);
        job.updatedAt = at;
      }
    }
    transitionManaged(store, managed, paused ? 'paused' : 'queued', { reason: paused ? 'PR review paused by user.' : 'PR review resumed by user.', actor: 'user', at });
    return clone(managed);
  });
}

export function cancelQueuedReview(root, jobId) {
  return mutatePrReviewStore(root, (store) => {
    const job = findReviewJob(store, jobId);
    if (!job) throw new Error(`Review job ${jobId} was not found.`);
    if (job.state !== 'queued') throw new Error('Only queued review jobs can be cancelled.');
    const at = nowIso();
    job.state = 'cancelled';
    job.completedAt = at;
    job.updatedAt = at;
    const managed = findManaged(store, job.managedPullRequestId);
    if (managed && managed.activeReviewRequestId === job.reviewRequestId) {
      managed.activeReviewRequestId = null;
      managed.queuePosition = null;
      const remaining = store.reviewJobs.some((candidate) => candidate.managedPullRequestId === managed.id && ['queued', 'submitting', 'awaiting_result'].includes(candidate.state));
      if (!remaining) transitionManaged(store, managed, 'paused', { reason: 'The last queued review was cancelled by the user.', actor: 'user', at });
    }
    appendHistory(store, { entityType: 'review_job', entityId: job.id, previousState: 'queued', newState: 'cancelled', reason: 'Queued review cancelled by user.', actor: 'user', sha: job.headSha, timestamp: at });
    return clone(job);
  });
}

export function reviewManagedNow(root, managedId) {
  return enqueueManagedReview(root, managedId, { immediate: true });
}

export function retryReviewJob(root, jobId) {
  return mutatePrReviewStore(root, (store) => {
    const job = findReviewJob(store, jobId);
    if (!job) throw new Error(`Review job ${jobId} was not found.`);
    const managed = findManaged(store, job.managedPullRequestId);
    if (!managed) throw new Error(`Managed PR ${job.managedPullRequestId} was not found.`);
    return clone(enqueueReviewInStore(store, managed, {
      headSha: job.headSha,
      immediate: true,
      forceRetry: true,
      conversationUrlOverride: job.conversationUrlOverride,
    }));
  });
}

function manualReviewSelection(root, managedId) {
  const store = loadPrReviewStore(root);
  const managed = findManaged(store, managedId);
  if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
  const job = store.reviewJobs
    .filter((candidate) => candidate.managedPullRequestId === managed.id && ['awaiting_result', 'failed', 'paused'].includes(candidate.state))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (!job) throw new Error('No review job is available for a manual result.');
  const pr = managedPrSnapshot(root, managed.pullRequestNumber);
  const currentHead = String(pr?.headRefOid || '').toLowerCase();
  if (!pr || String(pr.state).toUpperCase() !== 'OPEN' || currentHead !== job.headSha || currentHead !== managed.currentHeadSha) {
    throw new Error('Manual review results require an open PR whose current head exactly matches the selected review job.');
  }
  return { managed, job, pr };
}

export function applyManualReviewResult(root, managedId, { result, findings = '', actor = 'user' } = {}) {
  const selected = manualReviewSelection(root, managedId);
  if (result === 'changes_requested') {
    return mutatePrReviewStore(root, (store) => {
      const managed = findManaged(store, managedId);
      const job = findReviewJob(store, selected.job.id);
      return clone(createFixJobInStore(store, managed, job, findings, { now: Date.now() }));
    });
  }
  if (result !== 'approved') throw new Error('Manual result must be approved or changes_requested.');
  const gate = evaluateApprovedReviewGate(root, selected.managed, selected.job, selected.pr);
  if (!gate.ok) throw new Error(gate.reason || 'The approved-review completion gate did not pass.');
  finalizeApprovedBrowserReview(root, selected.managed, selected.job, {
    findings: findings || 'Operator approved this exact validated commit.',
    pr: selected.pr,
    gate,
  });
  return mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    const job = findReviewJob(store, selected.job.id);
    const at = nowIso();
    const previous = job.state;
    job.state = 'completed';
    job.completedAt = at;
    job.updatedAt = at;
    managed.lastCompletedReviewSha = job.headSha;
    managed.lastProcessedReviewRequestId = job.reviewRequestId;
    managed.lastError = null;
    transitionManaged(store, managed, 'ready_to_merge', { reason: 'Operator approval passed the deterministic final gate.', actor, sha: job.headSha, at });
    appendHistory(store, { entityType: 'review_job', entityId: job.id, previousState: previous, newState: 'completed', reason: 'Operator supplied an approved review result after all gates passed.', actor, sha: job.headSha, timestamp: at });
    return clone(managed);
  });
}
