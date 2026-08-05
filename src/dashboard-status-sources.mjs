import { LABELS } from './state.mjs';
import { run, runJson } from './process.mjs';

const LIVE_ATTEMPT_STATUSES = new Set([
  LABELS.running,
  LABELS.humanReview,
  'agent-running',
  'human-review',
]);

export function repositoryIssueSnapshot(root, { jsonRunner = runJson } = {}) {
  const result = jsonRunner('gh', [
    'issue', 'list', '--state', 'open', '--limit', '1000',
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking',
  ], { cwd: root, allowFailure: true });
  return {
    available: Array.isArray(result),
    issues: Array.isArray(result) ? result : [],
  };
}

export function summarizePrChecks(checks = []) {
  const normalized = (Array.isArray(checks) ? checks : []).map((check) => ({
    name: check.name || check.context || check.workflowName || 'check',
    state: String(check.conclusion || check.state || check.status || 'UNKNOWN').toUpperCase(),
    url: check.detailsUrl || check.targetUrl || null,
  }));
  const failed = normalized.filter((check) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(check.state));
  const pending = normalized.filter((check) => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING', 'UNKNOWN'].includes(check.state));
  return {
    state: failed.length ? 'failed' : pending.length ? 'pending' : normalized.length ? 'passed' : 'none',
    total: normalized.length,
    failed: failed.length,
    pending: pending.length,
    checks: normalized,
  };
}

export function inspectPullRequest(root, state, { jsonRunner = runJson } = {}) {
  if (!state?.prNumber && !state?.branch) return null;
  const args = state.prNumber
    ? ['pr', 'view', String(state.prNumber)]
    : ['pr', 'list', '--state', 'open', '--head', String(state.branch), '--limit', '1'];
  args.push('--json', 'number,url,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup');
  const result = jsonRunner('gh', args, { cwd: root, allowFailure: true });
  const pr = Array.isArray(result) ? result[0] : result;
  if (!pr) return null;
  return {
    number: Number(pr.number),
    url: pr.url || null,
    isDraft: pr.isDraft === true,
    head: pr.headRefOid || null,
    base: pr.baseRefName || null,
    mergeable: pr.mergeable || null,
    mergeStateStatus: pr.mergeStateStatus || null,
    checks: summarizePrChecks(pr.statusCheckRollup),
  };
}

export function inspectBaseFreshness(root, state, baseBranch, { runner = run } = {}) {
  if (!state?.branch && !state?.worktreePath) return { state: 'unknown', baseBranch };
  const cwd = state.worktreePath || root;
  const result = runner('git', ['merge-base', '--is-ancestor', `refs/remotes/origin/${baseBranch}`, 'HEAD'], {
    cwd,
    allowFailure: true,
  });
  return {
    state: result?.ok ? 'current' : 'behind-or-unknown',
    baseBranch,
  };
}

export function collectRemoteDashboardState(root, {
  attempts = [],
  baseBranch = '',
  jsonRunner = runJson,
  runner = run,
} = {}) {
  const startedAt = Date.now();
  let repository;
  let repositoryError = null;
  try {
    repository = repositoryIssueSnapshot(root, { jsonRunner });
  } catch (error) {
    repository = { available: false, issues: [] };
    repositoryError = String(error?.message || error);
  }

  const attemptHealth = {};
  const errors = [];
  for (const state of attempts) {
    if (!LIVE_ATTEMPT_STATUSES.has(state?.status)) continue;
    try {
      attemptHealth[String(Number(state.issueNumber))] = {
        pr: inspectPullRequest(root, state, { jsonRunner }),
        baseFreshness: inspectBaseFreshness(root, state, baseBranch, { runner }),
      };
    } catch (error) {
      const message = String(error?.message || error);
      attemptHealth[String(Number(state.issueNumber))] = {
        pr: null,
        baseFreshness: { state: 'behind-or-unknown', baseBranch },
        error: message,
      };
      errors.push({ issueNumber: Number(state.issueNumber), error: message });
    }
  }

  return {
    repository,
    attemptHealth,
    collectedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    errors: repositoryError ? [{ source: 'issues', error: repositoryError }, ...errors] : errors,
  };
}
