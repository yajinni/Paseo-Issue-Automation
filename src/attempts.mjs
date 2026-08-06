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
import {
  AGENT_START_MAX_ATTEMPTS,
  agentRunArgs,
  cleanupWorkspaceIfEmpty,
  expectedWorkspaceAgent,
  inspectWorkspaceAgents,
  launchErrorDetail,
  verifyWorkspaceIdentity,
  workspaceCreateArgs,
  workspaceFromPayload,
} from './launch-retry.mjs';

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
  if (!child.pid) throw new Error('Could not determine the Issue Execution Controller worker PID.');
  child.unref();
  return child.pid;
}

function previousAttemptHistory(previous) {
  return previous ? [...(previous.history || []), {
    attempt: previous.attempt || 1,
    branch: previous.branch || null,
    status: previous.status || null,
    startedAt: previous.startedAt || null,
    completedAt: previous.completedAt || null,
    workspaceId: previous.workspaceId || null,
    activity: previous.activity || [],
    events: previous.events || [],
  }] : [];
}

function saveActivity(root, issueNumber, patch, type, details) {
  const current = loadRun(root, issueNumber) || {};
  const at = now();
  return saveRun(root, issueNumber, {
    ...current,
    ...patch,
    updatedAt: at,
    activity: [...(current.activity || []), { type, at, details }],
  });
}

function terminalLaunchFailure(root, issue, reason) {
  const current = loadRun(root, issue.number) || {};
  if (current.coderAgentId || current.agentId) {
    run('paseo', ['stop', String(current.coderAgentId || current.agentId)], { cwd: root, allowFailure: true });
  }
  const cleanup = cleanupWorkspaceIfEmpty(root, current);
  try {
    editLabels(root, issue.number, [LABELS.failed], [LABELS.running, LABELS.ready, LABELS.blocked, LABELS.humanReview]);
  } catch {}
  const at = now();
  const cleanupDetail = cleanup.status === 'archived-empty'
    ? ' The confirmed empty workspace was archived.'
    : cleanup.status === 'not-applicable'
      ? ''
      : ` Workspace cleanup: ${cleanup.status}${cleanup.reason ? ` (${cleanup.reason})` : ''}.`;
  const message = `${String(reason)}${cleanupDetail}`;
  saveRun(root, issue.number, {
    ...current,
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueUrl: issue.url,
    status: LABELS.failed,
    phase: 'launch-failed',
    reason: message,
    workspaceCleanup: cleanup,
    completedAt: at,
    updatedAt: at,
    activity: [...(current.activity || []), { type: 'launch-failed', at, details: message }],
  });
  return {
    claimed: false,
    failed: true,
    haltDispatch: true,
    issueNumber: issue.number,
    branch: current.branch || null,
    attempt: current.attempt || null,
    reason: message,
  };
}

function finalizeAgentLaunch(root, issue, agent, { recovered = false } = {}) {
  const current = loadRun(root, issue.number) || {};
  const coderAgentId = findFirstKey(agent, ['agentId', 'agent_id', 'id']);
  if (!coderAgentId) return terminalLaunchFailure(root, issue, `Paseo did not return an agent ID for issue #${issue.number}.`);
  const started = current.startedAt || now();
  const state = saveActivity(root, issue.number, {
    status: LABELS.running,
    phase: 'coding',
    coderAgentId,
    agentId: coderAgentId,
    reason: null,
    completedAt: null,
    heartbeatAt: now(),
  }, recovered ? 'agent-start-reconciled' : 'agent-started', recovered
    ? `Recovered agent ${coderAgentId} after the create command reported failure.`
    : `Agent ${coderAgentId} started in workspace ${current.workspaceId}.`);
  const controllerPid = startControllerWorker(root, issue.number);
  saveActivity(root, issue.number, { ...state, controllerPid, startedAt: started }, 'controller-started',
    `Issue Execution Controller PID ${controllerPid}.`);
  unskipIssue(root, issue.number);
  return {
    claimed: true,
    issueNumber: issue.number,
    branch: current.branch,
    attempt: current.attempt,
    controllerPid,
    workspaceId: current.workspaceId,
  };
}

function pendingLaunch(root, issue, attempts, reason, phase = 'launch-retrying') {
  const current = loadRun(root, issue.number) || {};
  const message = phase === 'launch-reconciliation-needed'
    ? `${reason} The controller could not verify whether Paseo created an agent, so it will not create another one until reconciliation succeeds.`
    : `${reason} Agent start attempt ${attempts}/${AGENT_START_MAX_ATTEMPTS} failed; the next polling cycle will retry in workspace ${current.workspaceId}.`;
  saveActivity(root, issue.number, {
    status: LABELS.running,
    phase,
    reason: message,
    agentStartAttempts: attempts,
    maxAgentStartAttempts: AGENT_START_MAX_ATTEMPTS,
  }, phase === 'launch-reconciliation-needed' ? 'agent-start-reconciliation-needed' : 'agent-start-retry-scheduled', message);
  return {
    claimed: true,
    pending: true,
    issueNumber: issue.number,
    branch: current.branch,
    attempt: current.attempt,
    workspaceId: current.workspaceId,
    reason: message,
  };
}

function reconcileFailedAgentStart(root, issue, title, attemptCount, reason) {
  const current = loadRun(root, issue.number) || {};
  const inspection = inspectWorkspaceAgents(root, current.worktreePath);
  if (!inspection.verified) {
    return pendingLaunch(root, issue, attemptCount,
      `${reason} Paseo agent inventory failed: ${inspection.reason}`, 'launch-reconciliation-needed');
  }
  const reconciliation = expectedWorkspaceAgent(inspection, title);
  if (reconciliation.status === 'found') {
    return finalizeAgentLaunch(root, issue, reconciliation.agent, { recovered: true });
  }
  if (reconciliation.status === 'ambiguous') {
    return terminalLaunchFailure(root, issue,
      `${reason} Multiple matching agents exist in the workspace; operator action is required.`);
  }
  if (reconciliation.status === 'nonempty') {
    return terminalLaunchFailure(root, issue,
      `${reason} The workspace contains an unexpected agent; it was preserved for operator inspection.`);
  }
  if (attemptCount >= AGENT_START_MAX_ATTEMPTS) {
    return terminalLaunchFailure(root, issue,
      `${reason} Agent creation failed ${attemptCount} times in the same workspace.`);
  }
  return pendingLaunch(root, issue, attemptCount, reason);
}

function startRecordedAgent(root, issue, repository) {
  const config = loadConfig(root);
  const current = loadRun(root, issue.number) || {};
  if (!current.workspaceId || !current.worktreePath) {
    return terminalLaunchFailure(root, issue, 'The recorded launch has no usable Paseo workspace.');
  }
  const title = current.agentTitle || `Issue #${issue.number} Coder (attempt ${current.attempt || 1})`;
  const attemptCount = Number(current.agentStartAttempts || 0) + 1;
  saveActivity(root, issue.number, {
    phase: 'starting-agent',
    reason: null,
    agentStartAttempts: attemptCount,
    maxAgentStartAttempts: AGENT_START_MAX_ATTEMPTS,
  }, 'agent-start-attempt', `Starting agent attempt ${attemptCount}/${AGENT_START_MAX_ATTEMPTS} in workspace ${current.workspaceId}.`);
  try {
    const payload = runJson('paseo', agentRunArgs({
      provider: config.models.coder,
      title,
      workspaceId: current.workspaceId,
      prompt: buildAttemptPrompt(repository, issue, current.branch, config),
    }), { cwd: root });
    return finalizeAgentLaunch(root, issue, payload);
  } catch (error) {
    return reconcileFailedAgentStart(root, issue, title, attemptCount, launchErrorDetail(error));
  }
}

function reconcileBeforeRetry(root, issue, repository) {
  const current = loadRun(root, issue.number) || {};
  const inspection = inspectWorkspaceAgents(root, current.worktreePath);
  if (!inspection.verified) {
    return pendingLaunch(root, issue, Number(current.agentStartAttempts || 0),
      `Paseo agent inventory failed: ${inspection.reason}`, 'launch-reconciliation-needed');
  }
  const title = current.agentTitle || `Issue #${issue.number} Coder (attempt ${current.attempt || 1})`;
  const reconciliation = expectedWorkspaceAgent(inspection, title);
  if (reconciliation.status === 'found') return finalizeAgentLaunch(root, issue, reconciliation.agent, { recovered: true });
  if (reconciliation.status === 'ambiguous') {
    return terminalLaunchFailure(root, issue, 'Multiple matching agents exist in the recorded workspace; operator action is required.');
  }
  if (reconciliation.status === 'nonempty') {
    return terminalLaunchFailure(root, issue, 'The recorded workspace contains an unexpected agent and was preserved for operator inspection.');
  }
  if (Number(current.agentStartAttempts || 0) >= AGENT_START_MAX_ATTEMPTS) {
    return terminalLaunchFailure(root, issue,
      `Agent creation failed ${current.agentStartAttempts} times in the same workspace.`);
  }
  return startRecordedAgent(root, issue, repository);
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

  const started = now();
  const agentTitle = `Issue #${issue.number} Coder (attempt ${selection.attempt})`;
  const workspaceTitle = selection.branch;
  editLabels(root, issue.number, [LABELS.running], [LABELS.ready, LABELS.blocked, LABELS.failed, LABELS.humanReview]);
  saveRun(root, issue.number, {
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueUrl: issue.url,
    branch: selection.branch,
    attempt: selection.attempt,
    status: LABELS.running,
    phase: 'creating-workspace',
    workspaceTitle,
    agentTitle,
    dependencies: dependency.dependencies,
    dependencySource: dependency.source,
    startedAt: started,
    heartbeatAt: started,
    updatedAt: started,
    completedAt: null,
    prNumber: null,
    events: [],
    agentStartAttempts: 0,
    maxAgentStartAttempts: AGENT_START_MAX_ATTEMPTS,
    activity: [{ type: 'attempt-launching', at: started, details: `Attempt ${selection.attempt} reserved on ${selection.branch}.` }],
    history: previousAttemptHistory(previous),
  });
  unskipIssue(root, issue.number);

  try {
    const payload = runJson('paseo', workspaceCreateArgs({
      root,
      title: workspaceTitle,
      branch: selection.branch,
      baseBranch: config.baseBranch,
    }), { cwd: root });
    const workspace = workspaceFromPayload(payload);
    saveActivity(root, issue.number, {
      workspaceId: workspace.workspaceId || null,
      worktreePath: workspace.worktreePath || null,
      workspaceName: workspace.workspaceName || null,
      phase: 'verifying-workspace',
    }, 'workspace-created', `Workspace ${workspace.workspaceId || '(unknown)'} created once for attempt ${selection.attempt}.`);
    verifyWorkspaceIdentity(root, workspace, {
      title: workspaceTitle,
      branch: selection.branch,
    });
    saveActivity(root, issue.number, { phase: 'starting-agent' }, 'workspace-verified',
      `Workspace ${workspace.workspaceId} matches ${selection.branch}.`);
    return startRecordedAgent(root, issue, repository);
  } catch (error) {
    return terminalLaunchFailure(root, issue, launchErrorDetail(error));
  }
}

export function resumePendingAgentLaunches(root) {
  if (!loadRuntime(root).claimsEnabled) {
    return { claimed: false, attempts: [], results: [], haltDispatch: false, reason: 'Claims are paused.' };
  }
  const pending = listRuns(root).filter((state) =>
    state?.status === LABELS.running
    && ['launch-retrying', 'launch-reconciliation-needed'].includes(state.phase)
    && state.workspaceId
    && !state.agentId
    && !state.coderAgentId);
  if (!pending.length) return { claimed: false, attempts: [], results: [], haltDispatch: false };
  const results = [];
  const attempts = [];
  for (const state of pending) {
    let result;
    try {
      const issue = viewIssue(root, state.issueNumber);
      const repository = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
      if (!repository) throw new Error('Could not determine the GitHub repository.');
      result = state.phase === 'launch-reconciliation-needed'
        ? reconcileBeforeRetry(root, issue, repository)
        : startRecordedAgent(root, issue, repository);
    } catch (error) {
      const issue = { number: state.issueNumber, title: state.issueTitle, url: state.issueUrl };
      result = terminalLaunchFailure(root, issue, launchErrorDetail(error));
    }
    results.push(result);
    if (result?.claimed) attempts.push({
      claimed: true,
      type: 'launch-retry',
      issueNumber: result.issueNumber,
      branch: result.branch,
      attempt: result.attempt,
      controllerPid: result.controllerPid,
      pending: result.pending === true,
    });
  }
  return {
    claimed: attempts.length > 0,
    attempts,
    results,
    haltDispatch: results.some((result) => result?.failed || result?.pending),
    reason: results.map((result) => result?.reason).filter(Boolean).join(' '),
  };
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
