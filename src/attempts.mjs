import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCoderPrompt } from './controller-prompts.mjs';
import {
  dependencyNumbers,
  detectDependencyCycles,
  evaluateIssueDependencies,
  fetchIssue,
  refreshBase,
} from './dependencies.mjs';
import { validateIssueBody, slugify } from './automation.mjs';
import { LABELS, listRuns, loadConfig, loadRun, loadRuntime, saveRun, saveRuntime } from './state.mjs';
import { findFirstKey, run, runJson } from './process.mjs';

const now = () => new Date().toISOString();
const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'controller-worker.mjs');

const branchName = (issue, attempt = 1) => {
  const base = `ai/issue-${issue.number}-${slugify(issue.title)}`;
  return attempt > 1 ? `${base}-attempt-${attempt}` : base;
};

export function branchForAttempt(issueNumber, title, attempt = 1) {
  return branchName({ number: Number(issueNumber), title }, Number(attempt));
}

function labelNames(issue) {
  return new Set((issue.labels || []).map((label) => typeof label === 'string' ? label : label.name));
}

function editLabels(root, number, add = [], remove = []) {
  const args = ['issue', 'edit', String(number)];
  add.forEach((label) => args.push('--add-label', label));
  remove.forEach((label) => args.push('--remove-label', label));
  if (add.length || remove.length) run('gh', args, { cwd: root });
}

function listByLabel(root, label) {
  const rich = runJson('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100', '--label', label,
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt,blockedBy,blocking',
  ], { cwd: root, allowFailure: true });
  if (rich) return rich;
  return runJson('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100', '--label', label,
    '--json', 'number,title,body,labels,state,stateReason,url,createdAt',
  ], { cwd: root }) || [];
}

function viewIssue(root, number) {
  const issue = fetchIssue(root, number);
  if (!issue) throw new Error(`Issue #${number} could not be retrieved.`);
  return issue;
}

function branchExists(root, branch) {
  if (run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, allowFailure: true }).ok) return true;
  return run('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  }).ok;
}

function openPrs(root, branch) {
  return runJson('gh', ['pr', 'list', '--state', 'open', '--head', branch, '--json', 'number,url'], {
    cwd: root,
    allowFailure: true,
  }) || [];
}

function deleteRecordedBranch(root, state) {
  if (!state?.branch) throw new Error('No package-recorded branch is available to delete.');
  if (openPrs(root, state.branch).length) throw new Error(`Branch ${state.branch} has an open pull request and will not be deleted.`);
  run('git', ['branch', '-D', state.branch], { cwd: root, allowFailure: true });
  run('git', ['push', 'origin', '--delete', state.branch], { cwd: root, allowFailure: true });
  if (branchExists(root, state.branch)) throw new Error(`Branch ${state.branch} could not be deleted. It may be checked out or protected.`);
}

function nextBranch(root, issue, start) {
  let attempt = Math.max(1, Number(start) || 1);
  while (branchExists(root, branchName(issue, attempt))) attempt += 1;
  return { attempt, branch: branchName(issue, attempt) };
}

function updateDependencyRun(root, issue, dependency, status) {
  const previous = loadRun(root, issue.number) || {};
  const at = now();
  return saveRun(root, issue.number, {
    ...previous,
    issueNumber: Number(issue.number),
    issueTitle: issue.title,
    issueUrl: issue.url,
    status,
    phase: dependency.ok ? 'ready' : 'waiting-for-dependencies',
    blockType: dependency.ok ? null : 'dependency',
    dependencies: dependency.dependencies,
    dependencySource: dependency.source,
    reason: dependency.ok ? null : dependency.unresolved.join(' '),
    updatedAt: at,
    activity: [
      ...(previous.activity || []),
      {
        type: dependency.ok ? 'dependencies-satisfied' : 'dependency-wait',
        at,
        details: dependency.ok
          ? `Dependencies satisfied: ${dependency.dependencies.join(', ') || 'none'}.`
          : dependency.unresolved.join(' '),
      },
    ],
  });
}

function graphForIssues(issues) {
  return Object.fromEntries(issues.map((issue) => [issue.number, dependencyNumbers(issue).numbers]));
}

export function reconcileDependencies(root) {
  const config = loadConfig(root);
  const ready = listByLabel(root, LABELS.ready);
  const blocked = listByLabel(root, LABELS.blocked)
    .filter((issue) => loadRun(root, issue.number)?.blockType === 'dependency');
  const candidates = [...new Map([...ready, ...blocked].map((issue) => [Number(issue.number), issue])).values()];
  if (!candidates.length) return { checked: 0, blocked: [], unblocked: [], cycles: [] };

  const graph = graphForIssues(candidates);
  const cycles = detectDependencyCycles(graph);
  const cyclic = new Set(cycles.flat());
  const refreshed = refreshBase(root, config.baseBranch);
  const remoteRef = refreshed.ok ? refreshed.remoteRef : null;
  const result = { checked: candidates.length, blocked: [], unblocked: [], cycles };

  for (const issue of candidates) {
    let dependency;
    if (cyclic.has(Number(issue.number))) {
      const cycle = cycles.find((item) => item.includes(Number(issue.number)));
      dependency = {
        ok: false,
        source: dependencyNumbers(issue).source,
        dependencies: dependencyNumbers(issue).numbers,
        unresolved: [`Dependency cycle detected: ${cycle.join(' -> ')}.`],
      };
    } else if (!refreshed.ok && dependencyNumbers(issue).numbers.length) {
      dependency = {
        ok: false,
        source: dependencyNumbers(issue).source,
        dependencies: dependencyNumbers(issue).numbers,
        unresolved: [`Could not refresh ${config.baseBranch}: ${refreshed.detail || 'unknown error'}`],
      };
    } else {
      dependency = evaluateIssueDependencies(root, issue, config, remoteRef ? { remoteRef } : {});
    }

    const labels = labelNames(issue);
    if (!dependency.ok && labels.has(LABELS.ready)) {
      editLabels(root, issue.number, [LABELS.blocked], [LABELS.ready]);
      updateDependencyRun(root, issue, dependency, LABELS.blocked);
      result.blocked.push({ issueNumber: issue.number, reasons: dependency.unresolved });
    } else if (dependency.ok && labels.has(LABELS.blocked)) {
      editLabels(root, issue.number, [LABELS.ready], [LABELS.blocked]);
      updateDependencyRun(root, issue, dependency, LABELS.ready);
      result.unblocked.push({ issueNumber: issue.number });
    }
  }
  return result;
}

function validateLaunch(root, issue, config) {
  if (String(issue.state).toUpperCase() !== 'OPEN') throw new Error(`Issue #${issue.number} is not open.`);
  if (!labelNames(issue).has(LABELS.ready)) throw new Error(`Issue #${issue.number} is not labeled ${LABELS.ready}.`);
  const body = validateIssueBody(issue.body);
  if (!body.ok) throw new Error(body.reason);
  const dependency = evaluateIssueDependencies(root, issue, config);
  if (!dependency.ok) throw new Error(dependency.unresolved.join(' '));
  if (listByLabel(root, LABELS.running).length >= config.maxActive) throw new Error('Maximum active issue count reached.');
  return dependency;
}

export function buildAttemptPrompt(repository, issue, branch, config) {
  return `${buildCoderPrompt({ repository, issue, branch, config })}\n\nThis attempt cannot be resumed or recovered. If interrupted, it will be abandoned and restarted fresh.`;
}

function startControllerWorker(root, issueNumber) {
  const child = spawn(process.execPath, [workerPath, root, String(issueNumber)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid || null;
}

function launch(root, issue, branchAction) {
  const config = loadConfig(root);
  if (!config.setupComplete) throw new Error('Setup is not complete.');
  const dependency = validateLaunch(root, issue, config);
  const previous = loadRun(root, issue.number);
  if (previous?.status === LABELS.running) throw new Error(`Issue #${issue.number} already has a running attempt.`);

  const base = branchName(issue, 1);
  const nextAttempt = previous ? Number(previous.attempt || 1) + 1 : 1;
  let selection;
  if (!previous && !branchExists(root, base)) selection = { branch: base, attempt: 1 };
  else if (branchAction === 'keep') selection = nextBranch(root, issue, nextAttempt);
  else if (branchAction === 'delete') {
    deleteRecordedBranch(root, previous);
    selection = nextBranch(root, issue, nextAttempt);
  } else throw new Error(`Branch ${base} already exists. Choose keep or delete.`);

  const repository = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
  if (!repository) throw new Error('Could not determine the GitHub repository.');
  editLabels(root, issue.number, [LABELS.running], [LABELS.ready, LABELS.blocked, LABELS.failed, LABELS.humanReview]);

  const payload = runJson('paseo', [
    'run', '--background', '--json', '--provider', config.models.coder,
    '--title', `Issue #${issue.number} Coder (attempt ${selection.attempt})`,
    '--new-workspace', 'worktree', '--worktree-mode', 'branch-off',
    '--new-branch', selection.branch, '--base', config.baseBranch,
    buildAttemptPrompt(repository, issue, selection.branch, config),
  ], { cwd: root });
  const ids = {
    coderAgentId: findFirstKey(payload, ['agentId', 'agent_id', 'id']),
    workspaceId: findFirstKey(payload, ['workspaceId', 'workspace_id']),
    worktreePath: findFirstKey(payload, ['worktreePath', 'worktree_path', 'cwd', 'path']),
  };
  if (!ids.coderAgentId) {
    editLabels(root, issue.number, [LABELS.failed], [LABELS.running]);
    throw new Error(`Paseo did not return an agent ID for issue #${issue.number}.`);
  }

  const history = previous ? [...(previous.history || []), {
    attempt: previous.attempt || 1,
    branch: previous.branch || null,
    status: previous.status || null,
    startedAt: previous.startedAt || null,
    completedAt: previous.completedAt || null,
    workspaceId: previous.workspaceId || null,
    activity: previous.activity || [],
    events: previous.events || [],
  }] : [];
  const started = now();
  const state = saveRun(root, issue.number, {
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueUrl: issue.url,
    branch: selection.branch,
    attempt: selection.attempt,
    status: LABELS.running,
    phase: 'coding',
    ...ids,
    agentId: ids.coderAgentId,
    dependencies: dependency.dependencies,
    dependencySource: dependency.source,
    startedAt: started,
    heartbeatAt: started,
    updatedAt: started,
    completedAt: null,
    prNumber: null,
    events: [],
    activity: [{ type: 'attempt-started', at: started, details: `Attempt ${selection.attempt} started on ${selection.branch}.` }],
    history,
  });
  const controllerPid = startControllerWorker(root, issue.number);
  saveRun(root, issue.number, {
    ...state,
    controllerPid,
    activity: [...state.activity, { type: 'controller-started', at: now(), details: `Issue Execution Controller PID ${controllerPid || 'unknown'}.` }],
  });
  unskipIssue(root, issue.number);
  return { claimed: true, issueNumber: issue.number, branch: selection.branch, attempt: selection.attempt, controllerPid };
}

export function dispatchSpecificIssue(root, number, { branchAction = 'keep' } = {}) {
  reconcileDependencies(root);
  return launch(root, viewIssue(root, number), branchAction);
}

export function dispatchNextIssue(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  if (!config.setupComplete) return { claimed: false, reason: 'Setup is not complete.' };
  if (!runtime.claimsEnabled) return { claimed: false, reason: 'Claims are paused.' };
  const reconciliation = reconcileDependencies(root);
  if (listByLabel(root, LABELS.running).length >= config.maxActive) {
    return { claimed: false, reason: 'Maximum active issue count reached.', reconciliation };
  }
  const skipped = new Set(runtime.skippedIssueNumbers || []);
  const issues = listByLabel(root, LABELS.ready)
    .filter((issue) => !skipped.has(Number(issue.number)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.number - b.number);
  for (const issue of issues) {
    if (branchExists(root, branchName(issue, 1))) continue;
    try { return { ...launch(root, issue, 'keep'), reconciliation }; }
    catch (error) {
      if (/Missing meaningful|Blocked by open|could not be retrieved|Dependency #|cycle detected|not present in|no merged pull request/i.test(error.message)) {
        editLabels(root, issue.number, [LABELS.blocked], [LABELS.ready]);
        updateDependencyRun(root, issue, {
          ok: false,
          source: dependencyNumbers(issue).source,
          dependencies: dependencyNumbers(issue).numbers,
          unresolved: [error.message],
        }, LABELS.blocked);
        continue;
      }
      throw error;
    }
  }
  return { claimed: false, reason: 'No eligible ready issue found.', reconciliation };
}

export function updateManagedDispatch(root, result) {
  return saveRuntime(root, { ...loadRuntime(root), lastDispatchAt: now(), lastDispatchResult: result });
}

export function skipIssue(root, number) {
  const runtime = loadRuntime(root);
  return saveRuntime(root, { ...runtime, skippedIssueNumbers: [...runtime.skippedIssueNumbers, Number(number)] });
}

export function unskipIssue(root, number) {
  const runtime = loadRuntime(root);
  return saveRuntime(root, {
    ...runtime,
    skippedIssueNumbers: runtime.skippedIssueNumbers.filter((value) => value !== Number(number)),
  });
}

export function abandonAttempt(root, number, reason = 'Abandoned by user') {
  const state = loadRun(root, number);
  if (!state) throw new Error(`No automation state exists for issue #${number}.`);
  if (state.status === LABELS.humanReview) throw new Error('A human-review attempt cannot be abandoned.');
  if (state.coderAgentId || state.agentId) run('paseo', ['stop', String(state.coderAgentId || state.agentId)], { cwd: root, allowFailure: true });
  if (state.workspaceId) run('paseo', ['workspace', 'archive', String(state.workspaceId)], { cwd: root, allowFailure: true });
  editLabels(root, number, [LABELS.failed], [LABELS.running, LABELS.ready, LABELS.blocked, LABELS.humanReview]);
  run('gh', ['issue', 'comment', String(number), '--body', `Automation attempt ${state.attempt || 1} abandoned: ${reason}`], {
    cwd: root,
  });
  const ended = now();
  return saveRun(root, number, {
    ...state,
    status: 'abandoned',
    phase: 'abandoned',
    reason,
    completedAt: ended,
    updatedAt: ended,
    activity: [...(state.activity || []), { type: 'attempt-abandoned', at: ended, details: reason }],
  });
}

export function restartIssue(root, number, { branchAction = 'keep' } = {}) {
  if (!['keep', 'delete'].includes(branchAction)) throw new Error('Restart branch action must be keep or delete.');
  const state = loadRun(root, number);
  if (state?.status === LABELS.running) abandonAttempt(root, number, 'Restarted as a fresh attempt');
  else if (state?.workspaceId) run('paseo', ['workspace', 'archive', String(state.workspaceId)], { cwd: root, allowFailure: true });
  editLabels(root, number, [LABELS.ready], [LABELS.running, LABELS.blocked, LABELS.failed, LABELS.humanReview]);
  return dispatchSpecificIssue(root, number, { branchAction });
}

export function openAttemptWorkspace(root, number) {
  const state = loadRun(root, number);
  if (!state?.workspaceId) throw new Error(`Issue #${number} has no recorded Paseo workspace.`);
  const result = run('paseo', ['workspace', 'open', String(state.workspaceId)], { cwd: root, allowFailure: true });
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Paseo could not open the workspace.');
  return { opened: true, workspaceId: state.workspaceId };
}

function timeline(state) {
  const items = [...(state.activity || [])];
  for (const event of state.events || []) {
    items.push({ type: event.event, at: event.at, result: event.result, commit: event.commit, details: event.details });
  }
  if (state.completedAt && !items.some((item) => item.at === state.completedAt && item.type === state.phase)) {
    items.push({ type: state.phase || state.status || 'completed', at: state.completedAt, details: state.reason || '' });
  }
  return items.filter((item) => item.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function summarize(state) {
  return {
    issueNumber: Number(state.issueNumber),
    issueTitle: state.issueTitle || `Issue #${state.issueNumber}`,
    issueUrl: state.issueUrl || null,
    status: state.status || null,
    phase: state.phase || null,
    branch: state.branch || null,
    attempt: state.attempt || 1,
    dependencies: state.dependencies || [],
    dependencySource: state.dependencySource || null,
    reason: state.reason || null,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    heartbeatAt: state.heartbeatAt || null,
    workspaceId: state.workspaceId || null,
    prNumber: state.prNumber || null,
    prUrl: state.prUrl || null,
    reviewRound: (state.events || []).filter((event) => event.event === 'review').length,
    activity: timeline(state),
    history: state.history || [],
  };
}

export function operationalStatus(root) {
  const runtime = loadRuntime(root);
  const skipped = new Set(runtime.skippedIssueNumbers || []);
  const byLabel = Object.fromEntries(Object.entries(LABELS).map(([name, label]) => [name, listByLabel(root, label)]));
  return {
    counts: Object.fromEntries(Object.entries(byLabel).map(([name, issues]) => [name, issues.length])),
    readyIssues: byLabel.ready.map((issue) => ({
      number: Number(issue.number),
      title: issue.title,
      url: issue.url,
      createdAt: issue.createdAt,
      dependencies: dependencyNumbers(issue).numbers,
      dependencySource: dependencyNumbers(issue).source,
      skipped: skipped.has(Number(issue.number)),
      branchExists: branchExists(root, branchName(issue, 1)),
    })),
    attempts: listRuns(root).map(summarize),
  };
}
