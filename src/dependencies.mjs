import { run, runJson } from './process.mjs';

export function parseBodyDependencies(body) {
  const numbers = new Set();
  const pattern = /^(?:Blocked by|Depends on)\s+#(\d+)\s*$/gim;
  let match;
  while ((match = pattern.exec(String(body || '')))) numbers.add(Number(match[1]));
  return [...numbers];
}

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

export function dependencyNumbers(issue) {
  const native = Array.isArray(issue?.blockedBy)
    ? issue.blockedBy.map(normalizeDependency).filter(Boolean)
    : null;
  if (native !== null) return { source: 'native', numbers: native.map((item) => item.number), dependencies: native };
  const numbers = parseBodyDependencies(issue?.body);
  return { source: 'body-fallback', numbers, dependencies: [] };
}

export function fetchIssue(root, issueNumber, { jsonRunner = runJson } = {}) {
  const rich = jsonRunner('gh', [
    'issue', 'view', String(issueNumber),
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking,closedByPullRequestsReferences',
  ], { cwd: root, allowFailure: true });
  if (rich) return rich;
  return jsonRunner('gh', [
    'issue', 'view', String(issueNumber),
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt,closedByPullRequestsReferences',
  ], { cwd: root, allowFailure: true });
}

export function fetchIssueDependencies(root, issue, options = {}) {
  const declared = dependencyNumbers(issue);
  if (declared.source === 'native') return declared;
  const dependencies = declared.numbers
    .map((number) => normalizeDependency(fetchIssue(root, number, options)))
    .filter(Boolean);
  return { ...declared, dependencies };
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
  const result = runner('git', ['fetch', '--prune', 'origin', `${baseBranch}:${remoteRef}`], {
    cwd: root,
    allowFailure: true,
  });
  return { ok: result.ok, remoteRef, detail: result.stderr || result.stdout || null };
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
  const declared = fetchIssueDependencies(root, issue, options);
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
