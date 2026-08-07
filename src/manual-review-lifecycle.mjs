import { run } from './process.mjs';

export const MANUAL_REVIEW_ACTIONS = Object.freeze({
  waiting: 'waiting-manual-review',
  queueFix: 'queue-fix',
  approved: 'manual-review-complete',
  merged: 'merged-complete',
  closedUnmerged: 'closed-unmerged',
  stale: 'stale',
});

const HANDOFF_MARKER = '<!-- paseo-manual-review-handoff:v1 -->';
const ACTION_MARKER = '<!-- paseo-manual-review-action:v1 -->';

function commandError(result, fallback) {
  return result?.stderr || result?.stdout || fallback;
}

function blockingFindings(findings = []) {
  return (Array.isArray(findings) ? findings : []).filter((finding) => finding?.severity === 'blocking');
}

export function renderManualReviewHandoff({
  headSha,
  validationSummary = 'Validation completed for the exact handoff commit.',
  quickFindings = [],
  quickExhausted = false,
} = {}) {
  const sha = String(headSha || '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error('Manual review handoff requires an exact head SHA.');
  const findings = blockingFindings(quickFindings);
  const lines = [
    HANDOFF_MARKER,
    '## Paseo manual review handoff',
    '',
    `Exact head: \`${sha}\``,
    `Quick review: ${quickExhausted ? 'round limit reached with unresolved findings' : 'completed'}`,
    '',
    '### Validation',
    String(validationSummary || 'No validation summary was provided.'),
    '',
    '### Unresolved quick-review findings',
  ];
  if (!findings.length) lines.push('None reported.');
  else findings.forEach((finding, index) => {
    const location = finding.file ? ` (${finding.file}${Number.isInteger(finding.line) ? `:${finding.line}` : ''})` : '';
    lines.push(`${index + 1}. ${finding.message}${location}`);
  });
  lines.push('', 'Quick-review findings are handoff context only; the human reviewer should verify them independently.');
  return lines.join('\n');
}

export function enterManualReview(root, {
  pullRequestNumber,
  headSha,
  validationSummary,
  quickFindings = [],
  quickExhausted = false,
  isDraft = true,
}, {
  runner = run,
} = {}) {
  const prNumber = Number(pullRequestNumber);
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error('Manual review handoff requires a pull request number.');
  const body = renderManualReviewHandoff({ headSha, validationSummary, quickFindings, quickExhausted });
  if (isDraft) {
    const ready = runner('gh', ['pr', 'ready', String(prNumber)], { cwd: root, allowFailure: true });
    if (!ready.ok) throw new Error(commandError(ready, `Could not mark PR #${prNumber} ready for manual review.`));
  }
  const comment = runner('gh', ['pr', 'comment', String(prNumber), '--body', body], { cwd: root, allowFailure: true });
  if (!comment.ok) throw new Error(commandError(comment, `Could not post the manual review handoff on PR #${prNumber}.`));
  return {
    state: MANUAL_REVIEW_ACTIONS.waiting,
    pullRequestNumber: prNumber,
    headSha: String(headSha),
    automaticMergeAllowed: false,
    handoff: body,
  };
}

function latestReviewForHead(reviews = [], expectedHeadSha) {
  const expected = String(expectedHeadSha || '').toLowerCase();
  return [...(Array.isArray(reviews) ? reviews : [])]
    .filter((review) => !review.commitId || String(review.commitId).toLowerCase() === expected)
    .sort((left, right) => Date.parse(right.submittedAt || 0) - Date.parse(left.submittedAt || 0))[0] || null;
}

export function evaluateManualReviewSnapshot({ pr, expectedHeadSha } = {}) {
  const expected = String(expectedHeadSha || '').trim().toLowerCase();
  const current = String(pr?.headRefOid || '').trim().toLowerCase();
  if (!expected || !current || expected !== current) {
    return { action: MANUAL_REVIEW_ACTIONS.stale, complete: false, reason: 'The PR head changed after manual review was requested.' };
  }
  const state = String(pr?.state || '').toUpperCase();
  if (state === 'MERGED' || pr?.mergedAt) {
    return { action: MANUAL_REVIEW_ACTIONS.merged, complete: true, headSha: expected };
  }
  if (state === 'CLOSED') {
    return { action: MANUAL_REVIEW_ACTIONS.closedUnmerged, complete: false, needsAttention: true };
  }
  const review = latestReviewForHead(pr?.reviews, expected);
  const decision = String(review?.state || pr?.reviewDecision || '').toUpperCase();
  if (decision === 'CHANGES_REQUESTED') {
    return {
      action: MANUAL_REVIEW_ACTIONS.queueFix,
      complete: false,
      headSha: expected,
      review,
      samePullRequestRequired: true,
    };
  }
  if (decision === 'APPROVED') {
    return {
      action: MANUAL_REVIEW_ACTIONS.approved,
      complete: true,
      headSha: expected,
      automaticMergeAllowed: false,
      review,
    };
  }
  return { action: MANUAL_REVIEW_ACTIONS.waiting, complete: false, headSha: expected };
}

export function resumeManualReviewAfterRepair({
  previousHeadSha,
  currentHeadSha,
  validationCommit,
  validationPassed,
} = {}) {
  const previous = String(previousHeadSha || '').trim();
  const current = String(currentHeadSha || '').trim();
  if (!previous || !current || previous === current) throw new Error('Manual-review repair must produce a new PR head.');
  if (validationPassed !== true || String(validationCommit || '') !== current) {
    return { ready: false, reason: 'The repaired exact head has not passed validation.' };
  }
  return {
    ready: true,
    state: MANUAL_REVIEW_ACTIONS.waiting,
    headSha: current,
    automaticMergeAllowed: false,
  };
}

export function renderManualFallbackAudit({ action, actor = 'unknown', source = 'dashboard', at = new Date().toISOString(), reason = '' } = {}) {
  if (!['send-back-for-changes', 'mark-manual-review-complete'].includes(action)) {
    throw new Error('Unsupported manual-review fallback action.');
  }
  return [
    ACTION_MARKER,
    `Manual review action: ${action}`,
    `Actor: ${String(actor || 'unknown')}`,
    `Source: ${String(source || 'dashboard')}`,
    `Time: ${String(at)}`,
    reason ? `Reason: ${String(reason)}` : null,
  ].filter(Boolean).join('\n');
}

export function manualReviewCapabilities() {
  return Object.freeze({
    automaticMerge: false,
    fallbackActions: Object.freeze(['send-back-for-changes', 'mark-manual-review-complete']),
  });
}
