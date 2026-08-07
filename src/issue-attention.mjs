import { LEGACY_LABELS, PASEO_LABELS } from './label-catalog.mjs';
import { run, runJson } from './process.mjs';
import { loadRun, saveRun } from './state.mjs';

export const INVALID_ISSUE_COMMENT_MARKER = '<!-- paseo:invalid-issue-feedback -->';

function nowIso() { return new Date().toISOString(); }
function labelNames(issue) { return new Set((issue?.labels || []).map((label) => typeof label === 'string' ? label : String(label?.name || '')).filter(Boolean)); }

export function invalidIssueFeedbackBody(contract = {}) {
  const problems = [...(contract.missingFields || []), ...(contract.invalidFields || [])];
  const rows = problems.length
    ? problems.map((problem) => `- **${problem.field}** — ${problem.message}`).join('\n')
    : `- ${contract.reason || 'The issue does not satisfy the automation issue contract.'}`;
  return `${INVALID_ISSUE_COMMENT_MARKER}\n### Paseo setup needs attention\n\nThis issue is not eligible for automated coding yet. Fix the issue body and Paseo will recheck it automatically.\n\n${rows}\n\nThis comment is maintained by Paseo and will be updated instead of duplicated.`;
}

function repositoryName(root, options = {}) {
  const jsonRunner = options.runJson || runJson;
  const repository = jsonRunner('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root, allowFailure: true });
  return repository?.nameWithOwner || null;
}

function upsertFeedbackComment(root, issueNumber, body, options = {}) {
  const jsonRunner = options.runJson || runJson;
  const repository = options.repository || repositoryName(root, options);
  if (!repository) return { id: null, changed: false, warning: 'Could not determine repository for invalid-issue feedback.' };
  const comments = jsonRunner('gh', ['api', `repos/${repository}/issues/${issueNumber}/comments`, '--paginate'], { cwd: root, allowFailure: true }) || [];
  const existing = comments.find((comment) => String(comment?.body || '').includes(INVALID_ISSUE_COMMENT_MARKER));
  if (existing && String(existing.body || '') === body) return { id: existing.id || null, changed: false };
  if (existing?.id) {
    const updated = jsonRunner('gh', ['api', '--method', 'PATCH', `repos/${repository}/issues/comments/${existing.id}`, '-f', `body=${body}`], { cwd: root, allowFailure: true });
    return { id: updated?.id || existing.id, changed: true };
  }
  const created = jsonRunner('gh', ['api', '--method', 'POST', `repos/${repository}/issues/${issueNumber}/comments`, '-f', `body=${body}`], { cwd: root, allowFailure: true });
  return { id: created?.id || null, changed: true };
}

function editAttentionLabels(root, issue, config, { corrected = false, runCommand = run } = {}) {
  const labels = labelNames(issue);
  const recommended = (config?.issueSelection?.mode || 'recommended-labels') === 'recommended-labels';
  const rememberedReady = labels.has(PASEO_LABELS.ready) ? PASEO_LABELS.ready : labels.has(LEGACY_LABELS.ready) ? LEGACY_LABELS.ready : null;
  const args = ['issue', 'edit', String(issue.number)];
  if (corrected) {
    args.push('--remove-label', PASEO_LABELS.needsAttention);
    if (recommended) args.push('--add-label', rememberedReady || PASEO_LABELS.ready);
  } else {
    args.push('--add-label', PASEO_LABELS.needsAttention);
    if (recommended && rememberedReady) args.push('--remove-label', rememberedReady);
  }
  const result = runCommand('gh', args, { cwd: root, allowFailure: true });
  return { ok: result?.ok !== false, readyLabel: rememberedReady, detail: result?.stderr || result?.stdout || null };
}

export function recordInvalidIssueAttention(root, issue, contract, config, options = {}) {
  const previous = (options.loadRun || loadRun)(root, issue.number) || {};
  const body = invalidIssueFeedbackBody(contract);
  const comment = (options.upsertComment || upsertFeedbackComment)(root, issue.number, body, options);
  const labels = (options.editLabels || editAttentionLabels)(root, issue, config, options);
  const at = nowIso();
  const state = (options.saveRun || saveRun)(root, issue.number, {
    ...previous,
    issueNumber: Number(issue.number),
    issueTitle: issue.title,
    issueUrl: issue.url,
    status: PASEO_LABELS.needsAttention,
    phase: 'invalid-issue',
    blockType: 'invalid-issue',
    reason: contract.reason || 'Issue content is invalid.',
    invalidIssueContract: {
      missingFields: contract.missingFields || [],
      invalidFields: contract.invalidFields || [],
    },
    invalidIssueCommentId: comment.id || previous.invalidIssueCommentId || null,
    readyLabelBeforeAttention: labels.readyLabel || previous.readyLabelBeforeAttention || null,
    updatedAt: at,
    activity: [
      ...(previous.activity || []),
      { type: 'invalid-issue-attention', at, details: contract.reason || 'Issue content is invalid.' },
    ],
  });
  return { state, comment, labels };
}

export function restoreCorrectedIssue(root, issue, config, options = {}) {
  const previous = (options.loadRun || loadRun)(root, issue.number);
  if (!previous || previous.phase !== 'invalid-issue') return previous;
  const labels = (options.editLabels || editAttentionLabels)(root, {
    ...issue,
    labels: [...(issue.labels || []), previous.readyLabelBeforeAttention ? { name: previous.readyLabelBeforeAttention } : null].filter(Boolean),
  }, config, { ...options, corrected: true });
  const at = nowIso();
  return (options.saveRun || saveRun)(root, issue.number, {
    ...previous,
    status: 'ready',
    phase: 'ready',
    blockType: null,
    reason: null,
    updatedAt: at,
    activity: [
      ...(previous.activity || []),
      { type: 'invalid-issue-corrected', at, details: 'Issue contract is valid again and eligibility was restored.' },
    ],
    attentionLabelRecovery: labels,
  });
}
