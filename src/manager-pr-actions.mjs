import { managerPrHealthSnapshot } from './pr-review-github.mjs';
import { enqueueManagedReview } from './pr-review-queue.mjs';
import { reconcileManagedPullRequest } from './pr-review-reconcile.mjs';
import { loadPrReviewStore, TERMINAL_PR_STATES } from './pr-review-store.mjs';

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function expectedSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  if (!sha) return null;
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error('expectedHeadSha must be a valid Git commit SHA.');
  return sha;
}

function managedForIssue(store, issueNumber, pullRequestNumber) {
  const matches = (store.managedPullRequests || []).filter((managed) => (
    Number(managed?.issueNumber) === Number(issueNumber)
    && Number(managed?.pullRequestNumber) === Number(pullRequestNumber)
  ));
  if (!matches.length) throw new Error(`Paseo has no managed record for issue #${issueNumber} and PR #${pullRequestNumber}.`);
  if (matches.length > 1) throw new Error(`Paseo found multiple managed records for issue #${issueNumber} and PR #${pullRequestNumber}.`);
  return matches[0];
}

function requireCurrentOpenPr(root, managed, { expectedHeadSha = null, snapshotLoader = managerPrHealthSnapshot } = {}) {
  const snapshot = snapshotLoader(root, managed.pullRequestNumber);
  if (!snapshot) throw new Error(`Could not read current GitHub state for PR #${managed.pullRequestNumber}.`);
  if (Number(snapshot.number) !== Number(managed.pullRequestNumber)) throw new Error('GitHub returned a different pull request than the managed PR.');
  const state = String(snapshot.state || '').toUpperCase();
  if (snapshot.mergedAt || state === 'MERGED') throw new Error(`PR #${managed.pullRequestNumber} is already merged.`);
  if (state !== 'OPEN') throw new Error(`PR #${managed.pullRequestNumber} is not open.`);
  const head = String(snapshot.headRefOid || '').trim().toLowerCase();
  if (!head) throw new Error(`PR #${managed.pullRequestNumber} has no readable head SHA.`);
  const guard = expectedSha(expectedHeadSha);
  if (guard && head !== guard) {
    throw new Error(`PR #${managed.pullRequestNumber} moved from expected head ${guard} to ${head}. Refresh before retrying review.`);
  }
  return { snapshot, head };
}

function exactHeadReviewJob(store, managed, head) {
  return (store.reviewJobs || [])
    .filter((job) => String(job?.managedPullRequestId) === String(managed.id))
    .filter((job) => String(job?.headSha || '').toLowerCase() === head)
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] || null;
}

export function reconcileIssuePullRequest(root, issueNumber, {
  pullRequestNumber,
  loadStore = loadPrReviewStore,
  reconcile = reconcileManagedPullRequest,
} = {}) {
  const issue = positiveNumber(issueNumber, 'issueNumber');
  const pr = positiveNumber(pullRequestNumber, 'pullRequestNumber');
  const store = loadStore(root);
  const managed = managedForIssue(store, issue, pr);
  const result = reconcile(root, managed.id);
  return {
    action: 'reconciled',
    issueNumber: issue,
    pullRequestNumber: pr,
    managedPullRequestId: managed.id,
    result,
  };
}

export function retryIssuePullRequestReview(root, issueNumber, {
  pullRequestNumber,
  expectedHeadSha: expectedHead = null,
  loadStore = loadPrReviewStore,
  snapshotLoader = managerPrHealthSnapshot,
  enqueue = enqueueManagedReview,
} = {}) {
  const issue = positiveNumber(issueNumber, 'issueNumber');
  const pr = positiveNumber(pullRequestNumber, 'pullRequestNumber');
  const store = loadStore(root);
  if (store.config?.enabled !== true || store.config?.browserReview?.enabled !== true) {
    throw new Error('Web ChatGPT PR-review automation is not enabled for this repository.');
  }
  const managed = managedForIssue(store, issue, pr);
  if (TERMINAL_PR_STATES.has(managed.reviewState)) throw new Error(`PR #${pr} is terminal and cannot be requeued for review.`);
  if (managed.reviewState === 'paused') throw new Error(`PR #${pr} is paused. Resume it before retrying review.`);

  const { head } = requireCurrentOpenPr(root, managed, { expectedHeadSha: expectedHead, snapshotLoader });
  const storedHead = String(managed.currentHeadSha || '').trim().toLowerCase();
  if (!storedHead || storedHead !== head) {
    throw new Error(`Paseo's managed head ${storedHead || '(missing)'} does not match GitHub head ${head}. Reconcile the PR first.`);
  }

  const existing = exactHeadReviewJob(store, managed, head);
  if (existing && !['failed', 'cancelled'].includes(existing.state)) {
    throw new Error(`The exact-head review job is ${existing.state}; only failed or cancelled jobs can be manually retried.`);
  }

  const job = enqueue(root, managed.id, {
    headSha: head,
    immediate: true,
    forceRetry: Boolean(existing),
  });
  return {
    action: existing ? 'review-retried' : 'review-queued',
    issueNumber: issue,
    pullRequestNumber: pr,
    managedPullRequestId: managed.id,
    headSha: head,
    reviewJobId: job.id,
    reviewRequestId: job.reviewRequestId,
    state: job.state,
  };
}
