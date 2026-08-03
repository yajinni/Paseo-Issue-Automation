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
  return `A Paseo-managed pull request has blocking review findings that must be fixed.

Repository: ${managed.repository}
Pull request: #${managed.pullRequestNumber}
Pull request URL: ${managed.pullRequestUrl}
Associated issue: #${managed.issueNumber}
Issue URL: ${managed.issueUrl || ''}
Existing branch: ${managed.branchName}
Reviewed head SHA: ${job.reviewedHeadSha}
Review request ID: ${job.reviewRequestId}

Update the existing PR branch.
Do not create a new branch or PR.
Resolve the listed review findings.
Add or update tests.
Run changed-area validation and every validation required by the issue.
Push the fixes to the existing branch.
Report the new head SHA to Paseo.

Review findings:
${job.findings}

Before changing code, confirm that the workspace is on ${managed.branchName} and that PR #${managed.pullRequestNumber} still uses that branch. Stop if the PR was merged, closed, or moved to another branch. Do not broaden the associated issue.`;
}

function issueCodingCount(root) {
  const result = runJson('gh', ['issue', 'list', '--state', 'open', '--label', 'agent-running', '--limit', '100', '--json', 'number'], {
    cwd: root,
    allowFailure: true,
  });
  if (!Array.isArray(result)) throw new Error('Could not confirm the active issue-coding count from GitHub; no new coding job will start.');
  return result.length;
}

export function activeCodingCount(root) {
  return issueCodingCount(root) + activeFixJobs(loadPrReviewStore(root)).length;
}

function launchFixAgent(root, managed, job) {
  const config = loadConfig(root);
  if (!managed.workspaceId) throw new Error('The original Paseo workspace is unavailable; operator action is required before fixes can resume safely.');
  const payload = runJson('paseo', [
    'run', '--background', '--json', '--provider', config.models.coder,
    '--workspace', String(managed.workspaceId),
    '--title', `PR #${managed.pullRequestNumber} fixes (round ${managed.reviewRound})`,
    codingFixPrompt(managed, job),
  ], { cwd: root });
  const coderAgentId = findFirstKey(payload, ['agentId', 'agent_id', 'id']);
  if (!coderAgentId) throw new Error('Paseo did not return an agent ID for the PR fix job.');
  return { coderAgentId };
}

export function dispatchNextFixJob(root, { spawnWorker = true } = {}) {
  const config = loadConfig(root);
  if (activeCodingCount(root) >= config.maxActive) return { claimed: false, reason: 'Maximum coding slot count reached.' };
  const store = loadPrReviewStore(root);
  const selected = queuedFixJobs(store)[0];
  if (!selected) return { claimed: false, reason: 'No queued PR fix job.' };
  const managed = findManaged(store, selected.managedPullRequestId);
  if (!managed) throw new Error(`Managed PR ${selected.managedPullRequestId} was not found.`);
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

export function fixJobStatus(root, fixJobId) {
  return clone(findFixJob(loadPrReviewStore(root), fixJobId));
}
