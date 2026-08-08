import { run, runJson } from './process.mjs';

function resultText(result) {
  return String(result?.stderr || result?.stdout || result?.error?.message || '').trim() || null;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function gitValue(runner, cwd, args) {
  const result = runner('git', args, { cwd, allowFailure: true });
  return {
    value: result.ok ? String(result.stdout || '').trim() || null : null,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    error: result.ok ? null : resultText(result),
  };
}

function divergence(runner, cwd, baseRef) {
  const result = runner('git', ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`], {
    cwd,
    allowFailure: true,
  });
  if (!result.ok) {
    return {
      behind: null,
      ahead: null,
      exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      error: resultText(result),
    };
  }
  const [behind, ahead] = String(result.stdout || '').trim().split(/\s+/).map(Number);
  return {
    behind: Number.isFinite(behind) ? behind : null,
    ahead: Number.isFinite(ahead) ? ahead : null,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : 0,
    error: null,
  };
}

function githubCompare(root, baseSha, headSha, jsonRunner) {
  if (!baseSha || !headSha) return { available: false, reason: 'Base or head SHA was unavailable.' };
  const repository = jsonRunner('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
    cwd: root,
    allowFailure: true,
  })?.nameWithOwner;
  if (!repository) return { available: false, reason: 'GitHub repository identity was unavailable.' };
  const comparison = jsonRunner('gh', ['api', `repos/${repository}/compare/${baseSha}...${headSha}`], {
    cwd: root,
    allowFailure: true,
  });
  if (!comparison) return { available: false, repository, reason: 'GitHub compare was unavailable.' };
  return {
    available: true,
    repository,
    status: comparison.status || null,
    behind: numeric(comparison.behind_by),
    ahead: numeric(comparison.ahead_by),
  };
}

export function inspectBaseFreshness(root, state, baseBranch, {
  runner = run,
  jsonRunner = runJson,
} = {}) {
  const cwd = state?.worktreePath || root;
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const fetch = runner('git', ['fetch', '--prune', 'origin', `+refs/heads/${baseBranch}:${remoteRef}`], {
    cwd,
    allowFailure: true,
  });
  const evidence = {
    cwd,
    baseBranch,
    remoteRef,
    fetchExitCode: Number.isInteger(fetch.exitCode) ? fetch.exitCode : null,
    fetchError: fetch.ok ? null : resultText(fetch),
  };
  if (!fetch.ok) {
    return {
      ok: false,
      status: 'indeterminate',
      reason: `Controller could not fetch the latest ${baseBranch}; the coder was not asked to rewrite its branch.`,
      evidence,
    };
  }

  const base = gitValue(runner, cwd, ['rev-parse', remoteRef]);
  const head = gitValue(runner, cwd, ['rev-parse', 'HEAD']);
  const mergeBase = gitValue(runner, cwd, ['merge-base', remoteRef, 'HEAD']);
  const counts = divergence(runner, cwd, remoteRef);
  const ancestor = runner('git', ['merge-base', '--is-ancestor', remoteRef, 'HEAD'], {
    cwd,
    allowFailure: true,
  });
  Object.assign(evidence, {
    baseSha: base.value,
    baseResolveExitCode: base.exitCode,
    baseResolveError: base.error,
    headSha: head.value,
    headResolveExitCode: head.exitCode,
    headResolveError: head.error,
    mergeBase: mergeBase.value,
    mergeBaseExitCode: mergeBase.exitCode,
    mergeBaseError: mergeBase.error,
    baseIsAncestor: ancestor.exitCode === 0,
    ancestorExitCode: Number.isInteger(ancestor.exitCode) ? ancestor.exitCode : null,
    ancestorError: ancestor.exitCode === 0 || ancestor.exitCode === 1 ? null : resultText(ancestor),
    behind: counts.behind,
    ahead: counts.ahead,
    divergenceExitCode: counts.exitCode,
    divergenceError: counts.error,
  });

  if (ancestor.exitCode === 0) {
    return {
      ok: true,
      status: 'current',
      reason: `The issue branch contains the latest ${baseBranch}.`,
      evidence,
    };
  }

  if (ancestor.exitCode !== 1) {
    return {
      ok: false,
      status: 'indeterminate',
      reason: `Controller could not determine whether the issue branch contains the latest ${baseBranch}; the coder was not asked to rewrite its branch.`,
      evidence,
    };
  }

  const remote = githubCompare(root, base.value, head.value, jsonRunner);
  Object.assign(evidence, {
    githubCompareAvailable: remote.available === true,
    githubRepository: remote.repository || null,
    githubStatus: remote.status || null,
    githubBehind: remote.behind ?? null,
    githubAhead: remote.ahead ?? null,
    githubCompareReason: remote.available ? null : remote.reason || null,
  });

  const localContradiction = counts.behind === 0
    || Boolean(base.value && mergeBase.value && base.value === mergeBase.value);
  if (localContradiction || (remote.available && remote.behind === 0)) {
    const corroboration = remote.available && remote.behind === 0
      ? ' GitHub also reports the branch is 0 commits behind.'
      : '';
    return {
      ok: false,
      status: 'inconsistent',
      reason: `Git ancestry checks disagreed about whether the issue branch contains the latest ${baseBranch}.${corroboration} The coder was not asked to rewrite its branch.`,
      evidence,
    };
  }

  return {
    ok: false,
    status: 'stale',
    reason: `The issue branch does not contain the latest ${baseBranch}.`,
    evidence,
  };
}
