import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  appendHistory,
  clone,
  findFixJob,
  findManaged,
  loadPrReviewStore,
  mutatePrReviewStore,
  nowIso,
  TERMINAL_PR_STATES,
  transitionManaged,
} from './pr-review-store.mjs';
import { findFirstKey, runJson } from './process.mjs';
import { loadConfig } from './state.mjs';
import { PR_REVIEW_LABELS, setPrReviewLabels } from './pr-review-github.mjs';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fix-worker.mjs');

export function activeFixJobs(store) {
  return store.fixJobs.filter((job) => job.state === 'fixing');
}

export function queuedFixJobs(store) {
  return store.fixJobs
    .filter((job) => {
      if (!['queued', 'interrupted'].includes(job.state)) return false;
      const managed = findManaged(store, job.managedPullRequestId);
      return Boolean(managed && managed.reviewState !== 'paused' && !TERMINAL_PR_STATES.has(managed.reviewState));
    })
    .sort((a, b) => Number(b.priority) - Number(a.priority) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function codingFixPrompt(managed, job) {
  const findings = String(job.findings || '').trim();
  const sourceReviewRound = Number(job.sourceReviewRound);
  if (!Number.isInteger(sourceReviewRound) || sourceReviewRound < 1) {
    throw new Error('The PR fix job is missing its immutable source review round; refusing to launch an incomplete repair handoff.');
  }
  const sourceComment = job.sourceReviewCommentId !== null && job.sourceReviewCommentId !== undefined
    ? `Matching PR review comment ID: ${job.sourceReviewCommentId}`
    : 'Matching PR review comment ID: not recorded';
  return `A Paseo-managed pull request has an authoritative repair handoff that must be completed.

Repair identity
Repository: ${managed.repository}
Pull request: #${managed.pullRequestNumber}
Pull request URL: ${managed.pullRequestUrl}
Associated issue: #${managed.issueNumber}
Issue URL: ${managed.issueUrl || ''}
Existing branch: ${managed.branchName}
Reviewed head SHA: ${job.reviewedHeadSha}
Review request ID: ${job.reviewRequestId}
Review round: ${sourceReviewRound}
${sourceComment}

Paseo already matched this repair job to the exact managed pull request, review request, and reviewed head. The repair instructions embedded below are authoritative. Do not search repository files, issue prose, PR reviewDecision, or unrelated PR reviews/comments to discover what changes were requested. Inspect surrounding code only as needed to implement and validate these instructions safely.

If source verification is necessary, inspect top-level comments on PR #${managed.pullRequestNumber} and use only a paseo-review:v1 marker whose reviewRequestId is ${job.reviewRequestId} and headSha is ${job.reviewedHeadSha}. Do not treat any other review comment as repair instructions for this job.

Authoritative repair instructions:
---
${findings || '[No repair instructions were recorded. Stop without changing code and report the empty authoritative handoff.]'}
---

Update the existing PR branch.
Do not create a new branch or PR.
Fix only the authoritative instructions above without broadening the associated issue.
Preserve unrelated correct work.
Add or update tests that prove the fixes.
Run changed-area validation and every validation required by the issue.
Commit all intended changes, push the exact current branch head, and leave the worktree clean.
Do not call Paseo hooks, search for a validation-summary command, or invent a validation-summary API. The Paseo fix worker owns internal exact-head validation bookkeeping after it verifies the clean worktree and matching pushed PR head.
Do not report completion until the worktree HEAD and PR head are the same exact SHA and the worktree is clean.

Before changing code, confirm that the workspace is on ${managed.branchName} and that PR #${managed.pullRequestNumber} still uses that branch. Stop if the PR was merged, closed, or moved to another branch.`;
}

function issueCodingCount(root, { jsonRunner = runJson } = {}) {
  const result = jsonRunner('gh', ['issue', 'list', '--state', 'open', '--label', PASEO_LABELS.coding, '--limit', '100', '--json', 'number'], {
    cwd: root,
    allowFailure: true,
  });
  if (!Array.isArray(result)) throw new Error('Could not confirm the active issue-coding count from GitHub; no new coding job will start.');
  return result.length;
}

export function activeCodingCount(root, {
  jsonRunner = runJson,
  storeLoader = loadPrReviewStore,
} = {}) {
  return issueCodingCount(root, { jsonRunner }) + activeFixJobs(storeLoader(root)).length;
}

function launchFixAgent(root, managed, job) {
  const config = loadConfig(root);
  if (!managed.workspaceId) throw new Error('The original Paseo workspace is unavailable; operator action is required before fixes can resume safely.');
  const payload = runJson('paseo', [
    'run', '--background', '--json', '--provider', config.models.coder,
    '--workspace', String(managed.workspaceId),
    '--title', `PR #${managed.pullRequestNumber} fixes (round ${job.sourceReviewRound})`,
    codingFixPrompt(managed, job),
  ], { cwd: root });
  const coderAgentId = findFirstKey(payload, ['agentId', 'agent_id', 'id']);
  if (!coderAgentId) throw new Error('Paseo did not return an agent ID for the PR fix job.');
  return { coderAgentId };
}

function failForReviewLimit(root, selected, managed, maximum) {
  const message = `Maximum review rounds (${maximum}) reached; another automated fix round will not start.`;
  mutatePrReviewStore(root, (store) => {
    const job = findFixJob(store, selected.id);
    const record = findManaged(store, managed.id);
    const at = nowIso();
    if (job) {
      job.state = 'failed';
      job.lastError = message;
      job.updatedAt = at;
    }
    if (record) transitionManaged(store, record, 'failed', {
      reason: message,
      actor: 'coding-scheduler',
      error: message,
      at,
    });
  });
  setPrReviewLabels(root, managed.pullRequestNumber, {
    add: [PR_REVIEW_LABELS.failed],
    remove: [PR_REVIEW_LABELS.fixing, PR_REVIEW_LABELS.queued],
  });
  return { claimed: false, reason: message, jobId: selected.id };
}

export function dispatchNextFixJob(root, { spawnWorker = true } = {}) {
  const config = loadConfig(root);
  if (activeCodingCount(root) >= config.maxActive) return { claimed: false, reason: 'Maximum coding slot count reached.' };
  const store = loadPrReviewStore(root);
  const selected = queuedFixJobs(store)[0];
  if (!selected) return { claimed: false, reason: 'No queued PR fix job.' };
  const managed = findManaged(store, selected.managedPullRequestId);
  if (!managed) throw new Error(`Managed PR ${selected.managedPullRequestId} was not found.`);
  if (managed.reviewRound >= config.maxReviewRounds) {
    return failForReviewLimit(root, selected, managed, config.maxReviewRounds);
  }
  let launch;
  try { launch = launchFixAgent(root, managed, selected); }
  catch (error) {
    mutatePrReviewStore(root, (next) => {
      const job = findFixJob(next, selected.id);
      const record = findManaged(next, selected.managedPullRequestId);
      if (job) { job.state = 'failed'; job.lastError = error.message; job.updatedAt = nowIso(); }
      if (record) transitionManaged(next, record, 'failed', { reason: 'Could not launch PR fix Coder.', actor: 'coding-scheduler', error: error.message });
    });
    setPrReviewLabels(root, managed.pullRequestNumber, { add: [PR_REVIEW_LABELS.failed], remove: [PR_REVIEW_LABELS.fixing] });
    throw error;
  }
  const claimed = mutatePrReviewStore(root, (next) => {
    const job = findFixJob(next, selected.id);
    const record = findManaged(next, selected.managedPullRequestId);
    if (!job || !record || !['queued', 'interrupted'].includes(job.state)) {
      throw new Error('The selected fix job changed before it could be claimed.');
    }
    const at = nowIso();
    job.state = 'fixing';
    job.attempts += 1;
    job.coderAgentId = launch.coderAgentId;
    job.startedAt = at;
    job.updatedAt = at;
    job.lastError = null;
    transitionManaged(next, record, 'fixing', { reason: 'PR fix job claimed a coding slot.', actor: 'coding-scheduler', sha: job.reviewedHeadSha, at });
    appendHistory(next, { entityType: 'fix_job', entityId: job.id, previousState: selected.state, newState: 'fixing', reason: 'Fix Coder launched in the existing workspace.', actor: 'coding-scheduler', sha: job.reviewedHeadSha, timestamp: at });
    return clone(job);
  });
  setPrReviewLabels(root, managed.pullRequestNumber, {
    add: [PR_REVIEW_LABELS.fixing],
    remove: [PR_REVIEW_LABELS.changesRequested, PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.failed],
  });
  if (!spawnWorker) return { claimed: true, job: claimed };
  const child = spawn(process.execPath, [workerPath, root, claimed.id], { detached: true, stdio: 'ignore', windowsHide: true });
  if (!child.pid) throw new Error('Could not determine the PR fix worker PID.');
  child.once('error', (error) => {
    mutatePrReviewStore(root, (next) => {
      const job = findFixJob(next, claimed.id);
      const record = job ? findManaged(next, job.managedPullRequestId) : null;
      if (job) { job.state = 'failed'; job.lastError = error.message; job.updatedAt = nowIso(); }
      if (record) transitionManaged(next, record, 'failed', { reason: 'PR fix worker process failed to start.', actor: 'coding-scheduler', error: error.message });
    });
  });
  child.unref();
  return { claimed: true, jobId: claimed.id, issueNumber: claimed.issueNumber, pullRequestNumber: claimed.pullRequestNumber, pid: child.pid };
}

export function retryFixJob(root, fixJobId) {
  const result = mutatePrReviewStore(root, (store) => {
    const job = findFixJob(store, fixJobId);
    if (!job) throw new Error(`Fix job ${fixJobId} was not found.`);
    if (!['failed', 'interrupted'].includes(job.state)) throw new Error('Only failed or interrupted fix jobs can be retried.');
    const managed = findManaged(store, job.managedPullRequestId);
    if (!managed || managed.reviewState === 'paused' || TERMINAL_PR_STATES.has(managed.reviewState)) {
      throw new Error('The managed pull request is not eligible for another fix attempt.');
    }
    const maximum = loadConfig(root).maxReviewRounds;
    if (managed.reviewRound >= maximum) throw new Error(`Maximum review rounds (${maximum}) reached.`);
    const previous = job.state;
    const at = nowIso();
    job.state = 'queued';
    job.coderAgentId = null;
    job.startedAt = null;
    job.completedAt = null;
    job.lastError = null;
    job.updatedAt = at;
    transitionManaged(store, managed, 'fix_queued', {
      reason: 'Operator retried the failed PR fix job.',
      actor: 'user',
      sha: job.reviewedHeadSha,
      at,
    });
    appendHistory(store, {
      entityType: 'fix_job', entityId: job.id, previousState: previous, newState: 'queued',
      reason: 'Failed PR fix job explicitly retried.', actor: 'user', sha: job.reviewedHeadSha, timestamp: at,
    });
    return { job: clone(job), pullRequestNumber: managed.pullRequestNumber };
  });
  setPrReviewLabels(root, result.pullRequestNumber, {
    add: [PR_REVIEW_LABELS.changesRequested],
    remove: [PR_REVIEW_LABELS.failed, PR_REVIEW_LABELS.fixing],
  });
  return result.job;
}

export function fixJobStatus(root, fixJobId) {
  return clone(findFixJob(loadPrReviewStore(root), fixJobId));
}
