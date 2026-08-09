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
  if (state.phase === 'merged'
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
    status: 'merged',
    phase: 'merged',
    reason: null,
    prNumber,
    prUrl: pullRequestUrl || state.prUrl || null,
    approvedCommit: state.approvedCommit || commit,
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
        details: `PR #${prNumber} merged at ${effectiveMergedAt}; associated issue closure was verified.`,
      },
    ],
  });
}
