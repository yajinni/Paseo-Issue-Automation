import { LEGACY_LABELS, PASEO_LABELS } from './label-catalog.mjs';
import { validateIssueBody } from './issue-contract.mjs';
import { evaluateIssueDependencies } from './dependencies.mjs';
import { runJson } from './process.mjs';
import { loadRun, saveRun } from './state.mjs';

function nowIso() { return new Date().toISOString(); }

export function issueLabelNames(issue) {
  return new Set((issue?.labels || []).map((label) => typeof label === 'string' ? label : String(label?.name || '')).filter(Boolean));
}

function candidateFields() {
  return 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking';
}

function listWithArgs(root, args, jsonRunner) {
  const rich = jsonRunner('gh', [...args, '--json', candidateFields()], { cwd: root, allowFailure: true });
  if (Array.isArray(rich)) return rich;
  const fallback = jsonRunner('gh', [...args, '--json', 'number,title,body,labels,state,stateReason,url,createdAt'], { cwd: root, allowFailure: true });
  if (!Array.isArray(fallback)) throw new Error('Could not list open GitHub issues for deterministic eligibility evaluation.');
  return fallback;
}

export function listIssueCandidates(root, config, { jsonRunner = runJson } = {}) {
  const mode = config?.issueSelection?.mode || 'recommended-labels';
  const base = ['issue', 'list', '--state', 'open', '--limit', '1000'];
  if (mode === 'all-open') return listWithArgs(root, base, jsonRunner);
  if (mode !== 'recommended-labels') throw new Error(`Unsupported issue selection mode: ${mode}.`);

  // New installations use paseo:ready. Until the dedicated migration PR removes
  // legacy compatibility, also consume agent-ready without requiring repositories
  // to be migrated mid-rollout.
  const current = listWithArgs(root, [...base, '--label', PASEO_LABELS.ready], jsonRunner);
  const legacy = listWithArgs(root, [...base, '--label', LEGACY_LABELS.ready], jsonRunner);
  return [...new Map([...current, ...legacy].map((issue) => [Number(issue.number), issue])).values()];
}

export function issueAlreadyClaimed(root, issue, { runLoader = loadRun } = {}) {
  const state = runLoader(root, issue.number);
  if (!state) return false;
  if (state.completedAt) return false;
  if (['waiting-for-dependencies', 'invalid-issue', 'ready'].includes(String(state.phase || ''))) return false;
  return Boolean(state.branch || state.workspaceId || state.agentId || state.coderAgentId || state.controllerPid || state.startedAt);
}

export function baseIssueEligibility(root, issue, config, options = {}) {
  const number = Number(issue?.number);
  if (!Number.isInteger(number) || number < 1) return { ok: false, kind: 'invalid', reason: 'Issue number is invalid.' };
  if (String(issue?.state || 'OPEN').toUpperCase() !== 'OPEN') return { ok: false, kind: 'closed', reason: `Issue #${number} is not open.` };
  if (issue?.isPullRequest === true || issue?.pullRequest || issue?.pull_request) return { ok: false, kind: 'pull-request', reason: `#${number} is a pull request, not an issue.` };
  const labels = issueLabelNames(issue);
  const excluded = new Set((config?.issueSelection?.excludedLabels || []).map(String));
  const matchedExcluded = [...labels].filter((label) => excluded.has(label));
  if (matchedExcluded.length) return { ok: false, kind: 'excluded-label', reason: `Issue #${number} has excluded label ${matchedExcluded[0]}.` };
  if ((config?.issueSelection?.mode || 'recommended-labels') === 'recommended-labels'
    && !labels.has(PASEO_LABELS.ready)
    && !labels.has(LEGACY_LABELS.ready)) {
    return { ok: false, kind: 'not-ready', reason: `Issue #${number} is not labeled ${PASEO_LABELS.ready}.` };
  }
  const contract = (options.validateBody || validateIssueBody)(issue?.body || '');
  if (!contract.ok) return { ok: false, kind: 'invalid-contract', reason: contract.reason, contract };
  if ((options.claimed || issueAlreadyClaimed)(root, issue, options)) return { ok: false, kind: 'duplicate-claim', reason: `Issue #${number} already has an active automation attempt.` };
  return { ok: true, kind: 'candidate', contract };
}

function recordDependencyWait(root, issue, dependency, { runLoader = loadRun, runSaver = saveRun } = {}) {
  const previous = runLoader(root, issue.number) || {};
  const at = nowIso();
  const message = (dependency.unresolved || []).join(' ') || 'Native dependencies are not yet satisfied.';
  return runSaver(root, issue.number, {
    ...previous,
    issueNumber: Number(issue.number),
    issueTitle: issue.title,
    issueUrl: issue.url,
    status: 'waiting',
    phase: 'waiting-for-dependencies',
    blockType: 'dependency',
    dependencies: dependency.dependencies || [],
    dependencySource: dependency.source || 'native',
    reason: message,
    updatedAt: at,
    activity: [
      ...(previous.activity || []),
      { type: 'dependency-wait', at, details: message },
    ],
  });
}

function recordDependenciesSatisfied(root, issue, dependency, { runLoader = loadRun, runSaver = saveRun } = {}) {
  const previous = runLoader(root, issue.number);
  if (!previous || previous.phase !== 'waiting-for-dependencies') return previous;
  const at = nowIso();
  return runSaver(root, issue.number, {
    ...previous,
    status: 'ready',
    phase: 'ready',
    blockType: null,
    dependencies: dependency.dependencies || [],
    dependencySource: dependency.source || 'native',
    reason: null,
    updatedAt: at,
    activity: [
      ...(previous.activity || []),
      { type: 'dependencies-satisfied', at, details: `Dependencies satisfied: ${(dependency.dependencies || []).join(', ') || 'none'}.` },
    ],
  });
}

export function evaluateIssueQueue(root, config, options = {}) {
  const source = options.issues || (options.listCandidates || listIssueCandidates)(root, config, options);
  const sorted = [...source].sort((left, right) => Number(left.number) - Number(right.number));
  const eligible = [];
  const waiting = [];
  const rejected = [];

  for (const issue of sorted) {
    const base = baseIssueEligibility(root, issue, config, options);
    if (!base.ok) {
      rejected.push({ issueNumber: Number(issue.number), kind: base.kind, reason: base.reason });
      continue;
    }
    const dependency = (options.evaluateDependencies || evaluateIssueDependencies)(root, issue, config, options.dependencyOptions || {});
    if (!dependency.ok) {
      (options.recordWait || recordDependencyWait)(root, issue, dependency, options);
      waiting.push({ issueNumber: Number(issue.number), dependencies: dependency.dependencies || [], reasons: dependency.unresolved || [] });
      continue;
    }
    (options.recordReady || recordDependenciesSatisfied)(root, issue, dependency, options);
    eligible.push({ issue, dependency });
  }

  return {
    mode: config?.issueSelection?.mode || 'recommended-labels',
    eligible,
    waiting,
    rejected,
    next: eligible[0] || null,
  };
}
