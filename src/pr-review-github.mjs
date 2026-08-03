import { PR_REVIEW_LABELS } from './pr-review-store.mjs';
import { run, runJson } from './process.mjs';

export const PR_REVIEW_LABEL_DETAILS = Object.freeze({
  [PR_REVIEW_LABELS.queued]: ['0969da', 'Paseo PR review is queued'],
  [PR_REVIEW_LABELS.reviewing]: ['8250df', 'Paseo submitted this PR for review'],
  [PR_REVIEW_LABELS.changesRequested]: ['d93f0b', 'Paseo review requested code changes'],
  [PR_REVIEW_LABELS.fixing]: ['1d76db', 'A Paseo coding agent is fixing this PR'],
  [PR_REVIEW_LABELS.failed]: ['b60205', 'Paseo PR review automation needs attention'],
});

export function ensurePrReviewLabels(root) {
  const existing = new Map((runJson('gh', ['label', 'list', '--limit', '200', '--json', 'name,color,description'], {
    cwd: root, allowFailure: true,
  }) || []).map((label) => [label.name, label]));
  const results = [];
  for (const [name, [color, description]] of Object.entries(PR_REVIEW_LABEL_DETAILS)) {
    if (existing.has(name)) { results.push({ name, created: false }); continue; }
    const result = run('gh', ['label', 'create', name, '--color', color, '--description', description], { cwd: root, allowFailure: true });
    if (!result.ok) throw new Error(result.stderr || result.stdout || `Could not create ${name}.`);
    results.push({ name, created: true });
  }
  return results;
}

export function setPrReviewLabels(root, prNumber, { add = [], remove = [] } = {}) {
  const args = ['pr', 'edit', String(prNumber)];
  for (const label of [...new Set(add)]) args.push('--add-label', label);
  for (const label of [...new Set(remove)]) args.push('--remove-label', label);
  if (args.length === 3) return { changed: false };
  const result = run('gh', args, { cwd: root, allowFailure: true });
  if (!result.ok) throw new Error(result.stderr || result.stdout || `Could not update labels on PR #${prNumber}.`);
  return { changed: true };
}

export function managedPrSnapshot(root, prNumber) {
  return runJson('gh', [
    'pr', 'view', String(prNumber), '--json',
    'number,url,state,isDraft,headRefOid,headRefName,baseRefName,mergedAt,closedAt,labels,reviewDecision,comments,reviews,statusCheckRollup,body,closingIssuesReferences',
  ], { cwd: root, allowFailure: true });
}

export function issueSnapshot(root, issueNumber) {
  return runJson('gh', ['issue', 'view', String(issueNumber), '--json', 'number,url,state,stateReason,title,body,comments'], {
    cwd: root, allowFailure: true,
  });
}

export function closeAssociatedIssue(root, issueNumber, prNumber) {
  const comment = `Completed by merged PR #${prNumber}. Paseo verified the explicitly associated pull request was merged.`;
  const commented = run('gh', ['issue', 'comment', String(issueNumber), '--body', comment], { cwd: root, allowFailure: true });
  if (!commented.ok) throw new Error(commented.stderr || commented.stdout || 'Could not add the completion issue comment.');
  const closed = run('gh', ['issue', 'close', String(issueNumber), '--reason', 'completed'], { cwd: root, allowFailure: true });
  if (!closed.ok) throw new Error(closed.stderr || closed.stdout || 'Could not close the associated issue.');
  return { closed: true };
}

export function prHasExplicitIssueAssociation(pr, issueNumber) {
  const references = Array.isArray(pr?.closingIssuesReferences) ? pr.closingIssuesReferences : [];
  if (references.some((issue) => Number(issue.number) === Number(issueNumber))) return true;
  const pattern = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${Number(issueNumber)}\\b`, 'i');
  return pattern.test(String(pr?.body || ''));
}
