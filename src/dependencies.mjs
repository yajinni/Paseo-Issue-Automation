import { run, runJson } from './process.mjs';

function normalizeDependency(value) {
  if (!value || typeof value !== 'object') return null;
  const number = Number(value.number);
  if (!Number.isInteger(number)) return null;
  return {
    number,
    title: value.title || `Issue #${number}`,
    state: String(value.state || '').toUpperCase(),
    stateReason: String(value.stateReason || '').toUpperCase(),
    url: value.url || null,
    closedByPullRequestsReferences: Array.isArray(value.closedByPullRequestsReferences)
      ? value.closedByPullRequestsReferences
      : [],
  };
}

export function relationshipNodes(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.nodes)) return value.nodes;
  return null;
}

export function dependencyNumbers(issue) {
  const nodes = relationshipNodes(issue?.blockedBy);
  if (!nodes) {
    return {
      source: 'native',
      numbers: [],
      dependencies: [],
      unavailable: true,
      reason: 'Native GitHub blocked-by relationship data is unavailable. The controller will not infer dependencies from issue-body text.',
    };
  }
  const dependencies = nodes.map(normalizeDependency).filter(Boolean);
  return {
    source: 'native',
    numbers: dependencies.map((item) => item.number),
    dependencies,
    unavailable: false,
    reason: null,
  };
}

export function fetchIssue(root, issueNumber, { jsonRunner = runJson } = {}) {
  return jsonRunner('gh', [
    'issue', 'view', String(issueNumber),
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking,closedByPullRequestsReferences',
  ], { cwd: root, allowFailure: true });
}

export function fetchIssueDependencies(root, issue) {
  return dependencyNumbers(issue);
}

function mergeCommitOid(pr) {
  return pr?.mergeCommit?.oid || pr?.mergeCommit?.sha || null;
}

export function fetchDependencyPr(root, reference, { jsonRunner = runJson } = {}) {
  const target = reference?.number || reference?.url;
  if (!target) return null;
  return jsonRunner('gh', [
    'pr', 'view', String(target),
    '--json', 'number,url,state,mergedAt,baseRefName,mergeCommit',
  ], { cwd: root, allowFailure: true });
}

export function refreshBase(root, baseBranch, { runner = run } = {}) {
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const fetchRef = `+refs/heads/${baseBranch}:${remoteRef}`;
  const result = runner('git', ['fetch', 'origin', fetchRef], {
    cwd: root,
    allowFailure: true,
  });
  if (!result.ok) return { ok: false, remoteRef, detail: result.stderr || result.stdout || null };

  const verified = runner('git', ['show-ref', '--verify', '--quiet', remoteRef], {
    cwd: root,
    allowFailure: true,
  });
  return {
    ok: verified.ok,
    remoteRef,
    detail: verified.ok ? (result.stderr || result.stdout || null) : (verified.stderr || verified.stdout || null),
  };
}

export function commitIsInBase(root, commit, remoteRef, { runner = run } = {}) {
  if (!commit) return false;
  return runner('git', ['merge-base', '--is-ancestor', commit, remoteRef], {
    cwd: root,
    allowFailure: true,
  }).ok;
}

export function evaluateDependency(root, dependency, config, options = {}) {
  const fetched = fetchIssue(root, dependency.number, options);
  const issue = normalizeDependency(fetched) || dependency;
  if (!issue) return { ok: false, number: dependency.number, reason: `Dependency #${dependency.number} could not be retrieved.` };
  if (issue.state !== 'CLOSED') return { ok: false, number: issue.number, reason: `Blocked by open issue #${issue.number}.` };
  if (issue.stateReason && issue.stateReason !== 'COMPLETED') {
    return { ok: false, number: issue.number, reason: `Dependency #${issue.number} closed as ${issue.stateReason.toLowerCase()}, not completed.` };
  }

  const prs = issue.closedByPullRequestsReferences
    .map((reference) => fetchDependencyPr(root, reference, options))
    .filter(Boolean)
    .filter((pr) => pr.mergedAt && pr.baseRefName === config.baseBranch);
  if (!prs.length) {
    return {
      ok: false,
      number: issue.number,
      reason: `Dependency #${issue.number} has no merged pull request targeting ${config.baseBranch}.`,
    };
  }

  const remoteRef = options.remoteRef || `refs/remotes/origin/${config.baseBranch}`;
  const merged = prs.find((pr) => commitIsInBase(root, mergeCommitOid(pr), remoteRef, options));
  if (!merged) {
    return {
      ok: false,
      number: issue.number,
      reason: `Dependency #${issue.number} is not present in ${config.baseBranch}.`,
    };
  }
  return { ok: true, number: issue.number, prNumber: merged.number, mergeCommit: mergeCommitOid(merged) };
}

export function evaluateIssueDependencies(root, issue, config, options = {}) {
  const declared = fetchIssueDependencies(root, issue);
  if (declared.unavailable) {
    return {
      ok: false,
      source: declared.source,
      dependencies: [],
      unresolved: [declared.reason],
    };
  }
  if (!declared.numbers.length) return { ok: true, source: declared.source, dependencies: [], unresolved: [] };
  const refreshed = options.remoteRef
    ? { ok: true, remoteRef: options.remoteRef }
    : refreshBase(root, config.baseBranch, options);
  if (!refreshed.ok) {
    return {
      ok: false,
      source: declared.source,
      dependencies: declared.numbers,
      unresolved: [`Could not refresh ${config.baseBranch}: ${refreshed.detail || 'unknown error'}`],
    };
  }
  const results = declared.dependencies.map((dependency) => evaluateDependency(root, dependency, config, {
    ...options,
    remoteRef: refreshed.remoteRef,
  }));
  const unresolved = results.filter((result) => !result.ok).map((result) => result.reason);
  return {
    ok: unresolved.length === 0,
    source: declared.source,
    dependencies: declared.numbers,
    results,
    unresolved,
  };
}

export function detectDependencyCycles(graph) {
  const normalized = new Map(Object.entries(graph || {}).map(([key, values]) => [
    Number(key),
    [...new Set((values || []).map(Number).filter(Number.isInteger))],
  ]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dependency of normalized.get(node) || []) visit(dependency);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of normalized.keys()) visit(node);
  const unique = new Map(cycles.map((cycle) => [cycle.join('>'), cycle]));
  return [...unique.values()];
}

export function executionWaves(graph, completed = []) {
  const remaining = new Map(Object.entries(graph || {}).map(([key, values]) => [
    Number(key),
    new Set((values || []).map(Number).filter(Number.isInteger)),
  ]));
  const done = new Set((completed || []).map(Number));
  const waves = [];

  while (remaining.size) {
    const wave = [...remaining.entries()]
      .filter(([, dependencies]) => [...dependencies].every((dependency) => done.has(dependency) || !remaining.has(dependency)))
      .map(([number]) => number)
      .sort((a, b) => a - b);
    if (!wave.length) break;
    waves.push(wave);
    for (const number of wave) {
      remaining.delete(number);
      done.add(number);
    }
  }
  return { waves, unresolved: [...remaining.keys()].sort((a, b) => a - b) };
}
