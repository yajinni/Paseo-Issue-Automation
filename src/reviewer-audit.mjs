import { run } from './process.mjs';

export function formatReviewerAuditComment({
  issueNumber,
  prNumber,
  commit,
  round,
  approved,
  findings,
}) {
  const verdict = approved ? 'APPROVED' : 'CHANGES_REQUIRED';
  const details = String(findings || '').trim() || (approved
    ? 'Reviewer approved this exact validated commit.'
    : 'Reviewer requested changes but returned no detailed findings.');

  return [
    '## Automated Reviewer audit',
    '',
    `- Issue: #${Number(issueNumber)}`,
    `- PR: #${Number(prNumber)}`,
    `- Commit: \`${String(commit)}\``,
    `- Review round: ${Number(round)}`,
    `- Verdict: **${verdict}**`,
    '',
    '### Findings',
    '',
    details,
  ].join('\n');
}

export function postReviewerAuditComment(root, review, { runner = run } = {}) {
  const body = formatReviewerAuditComment(review);
  const result = runner('gh', [
    'pr', 'comment', String(review.prNumber), '--body', body,
  ], {
    cwd: root,
    allowFailure: true,
  });

  if (!result?.ok) {
    const detail = result?.stderr || result?.stdout || result?.error?.message || 'unknown error';
    throw new Error(`Could not write Reviewer audit comment to PR #${review.prNumber}: ${detail}`);
  }

  return {
    prNumber: Number(review.prNumber),
    commit: String(review.commit),
    round: Number(review.round),
    verdict: review.approved ? 'APPROVED' : 'CHANGES_REQUIRED',
    body,
  };
}
