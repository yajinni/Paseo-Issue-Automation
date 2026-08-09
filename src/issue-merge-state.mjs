import { loadRun, saveRun } from './state.mjs';

export function markIssueMerged(root, {
  issueNumber,
  pullRequestNumber,
  pullRequestUrl = null,
  headSha,
  mergedAt = null,
  issueClosureVerifiedAt = new Date().toISOString(),
} = {}) {
  const number = Number(issueNumber);
  const prNumber = Number(pullRequestNumber);
  const commit = String(headSha || '').trim().toLowerCase();
  if (!Number.isInteger(number) || number < 1) throw new Error('A positive issue number is required to record merge completion.');
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error('A positive pull request number is required to record merge completion.');
  if (!/^[0-9a-f]{7,64}$/.test(commit)) throw new Error('The merged pull request head SHA is required to record merge completion.');

  const state = loadRun(root, number);
  if (!state) throw new Error(`No automation state exists for issue #${number}.`);
  const exactValidation = (state.events || []).some((event) => event.event === 'validation-summary'
    && event.result === 'PASS'
    && String(event.commit || '').toLowerCase() === commit);
  const exactApproval = (state.events || []).some((event) => event.event === 'review'
    && event.result === 'APPROVED'
    && String(event.commit || '').toLowerCase() === commit);
  if (!exactValidation || !exactApproval) {
    throw new Error(`Issue #${number} cannot be marked merged without exact PASS validation and APPROVED review evidence for ${commit}.`);
  }
  if (state.approvedCommit && String(state.approvedCommit).toLowerCase() !== commit) {
    throw new Error(`Issue #${number} approval is bound to ${state.approvedCommit}, not merged head ${commit}.`);
  }
  if (['merged', 'completed'].includes(state.phase)
      && Number(state.prNumber) === prNumber
      && String(state.mergedHeadSha || '').toLowerCase() === commit
      && state.issueClosureVerifiedAt) {
    return state;
  }

  const verifiedAt = issueClosureVerifiedAt || new Date().toISOString();
  const effectiveMergedAt = mergedAt || verifiedAt;
  const alreadyRecorded = (state.activity || []).some((entry) => entry.type === 'pr-merged'
    && Number(entry.pullRequestNumber) === prNumber
    && String(entry.headSha || '').toLowerCase() === commit);
  return saveRun(root, number, {
    ...state,
    status: 'completed',
    phase: 'completed',
    reason: null,
    prNumber,
    prUrl: pullRequestUrl || state.prUrl || null,
    approvedCommit: commit,
    mergedHeadSha: commit,
    mergedAt: effectiveMergedAt,
    issueClosureVerifiedAt: verifiedAt,
    completedAt: effectiveMergedAt,
    updatedAt: verifiedAt,
    heartbeatAt: verifiedAt,
    activity: alreadyRecorded ? (state.activity || []) : [
      ...(state.activity || []),
      {
        type: 'pr-merged',
        at: verifiedAt,
        pullRequestNumber: prNumber,
        headSha: commit,
        details: `PR #${prNumber} merged at ${effectiveMergedAt}; associated issue closure was verified and the issue run completed.`,
      },
    ],
  });
}
