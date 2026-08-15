import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCoderPrompt } from './controller-prompts.mjs';
import {
  dependencyNumbers,
  evaluateIssueDependencies,
  fetchIssue,
} from './dependencies.mjs';
import { evaluateIssueQueue, listIssueCandidates } from './issue-eligibility.mjs';
import { LEGACY_LABELS, PASEO_LABELS } from './label-catalog.mjs';
import { validateIssueBody, slugify } from './automation.mjs';
import { LABELS, listRuns, loadConfig, loadRun, loadRuntime, saveRun, saveRuntime } from './state.mjs';
import { findFirstKey, run, runJson } from './process.mjs';
import {
  AGENT_START_MAX_ATTEMPTS,
  LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
  agentRunArgs,
  cleanupWorkspaceIfEmpty,
  expectedWorkspaceAgent,
  inspectWorkspaceAgents,
  launchErrorDetail,
  nextReconciliationAttempt,
  normalizeAttemptPrompt,
  refreshConfiguredBase,
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

function queueSnapshot(root, config, options = {}) {
  return evaluateIssueQueue(root, config, {
    ...options,
    listCandidates: options.listCandidates || listIssueCandidates,
  });
}

export function reconcileDependencies(root) {
  const config = loadConfig(root);
  const queue = queueSnapshot(root, config);
  return {
    checked: queue.eligible.length + queue.waiting.length + queue.rejected.length,
    blocked: queue.waiting.map((item) => ({ issueNumber: item.issueNumber, reasons: item.reasons })),
    unblocked: queue.eligible
      .filter(({ issue }) => loadRun(root, issue.number)?.phase === 'ready')
      .map(({ issue }) => ({ issueNumber: issue.number })),
    cycles: [],
    rejected: queue.rejected,
  };
}

function validateLaunch(root, issue, config) {
  if (String(issue.state).toUpperCase() !== 'OPEN') throw new Error(`Issue #${issue.number} is not open.`);
  const labels = labelNames(issue);
  const excluded = new Set(config.issueSelection?.excludedLabels || []);
  const excludedLabel = [...labels].find((label) => excluded.has(label));
  if (excludedLabel) throw new Error(`Issue #${issue.number} has excluded label ${excludedLabel}.`);
  if ((config.issueSelection?.mode || 'recommended-labels') === 'recommended-labels'
    && !labels.has(PASEO_LABELS.ready)
    && !labels.has(LEGACY_LABELS.ready)) {
    throw new Error(`Issue #${issue.number} is not labeled ${PASEO_LABELS.ready}.`);
  }
  const body = validateIssueBody(issue.body);
  if (!body.ok) throw new Error(body.reason);
  const dependency = evaluateIssueDependencies(root, issue, config);
  if (!dependency.ok) throw new Error(dependency.unresolved.join(' '));
  const previous = loadRun(root, issue.number);
  if (previous && !previous.completedAt && !['waiting-for-dependencies', 'invalid-issue', 'ready'].includes(String(previous.phase || ''))
      && (previous.branch || previous.workspaceId || previous.agentId || previous.coderAgentId || previous.controllerPid || previous.startedAt)) {
    throw new Error(`Issue #${issue.number} already has an active automation attempt.`);
  }
  if (listByLabel(root, PASEO_LABELS.coding).length >= config.maxActive) throw new Error('Maximum active issue count reached.');
  return dependency;
}

export function buildAttemptPrompt(repository, issue, branch, config) {
  return `${buildCoderPrompt({ repository, issue, branch, config })}\n\nThis attempt cannot be resumed or recovered. If interrupted, it will be abandoned and restarted fresh.`;
}

function startControllerWorker(root, issueNumber, attempt) {
  const args = [workerPath, path.resolve(root), String(issueNumber)];
  if (Number.isInteger(Number(attempt)) && Number(attempt) > 0) args.push(String(attempt));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) throw new Error('Could not determine the Issue Execution Controller worker PID.');
  child.unref();
  return child.pid;
}

function previousAttemptHistory(previous) {
  return previous?.attempt ? [...(previous.history || []), {
    attempt: previous.attempt,
    branch: previous.branch || null,
    status: previous.status || null,
    startedAt: previous.startedAt || null,
    completedAt: previous.completedAt || null,
    workspaceId: previous.workspaceId || null,
    baseBranch: previous.baseBranch || null,
    baseSha: previous.baseSha || null,
    coderPrompts: previous.coderPrompts || [],
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
    editLabels(root, issue.number, [PASEO_LABELS.failed], [PASEO_LABELS.coding, PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.needsAttention]);
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
    launchReconciliationAttempts: 0,
    maxLaunchReconciliationAttempts: LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
  }, recovered ? 'agent-start-reconciled' : 'agent-started', recovered
    ? `Recovered agent ${coderAgentId} after the create command reported failure.`
    : `Agent ${coderAgentId} started in workspace ${current.workspaceId}.`);
  const controllerPid = startControllerWorker(root, issue.number, current.attempt);
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

function pendingLaunch(root, issue, attempts, reason) {
  const current = loadRun(root, issue.number) || {};
  const message = `${reason} Agent start attempt ${attempts}/${AGENT_START_MAX_ATTEMPTS} failed; the next polling cycle will retry in workspace ${current.workspaceId}.`;
  saveActivity(root, issue.number, {
    status: LABELS.running,
    phase: 'launch-retrying',
    reason: message,
    agentStartAttempts: attempts,
    maxAgentStartAttempts: AGENT_START_MAX_ATTEMPTS,
    launchReconciliationAttempts: 0,
    maxLaunchReconciliationAttempts: LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
  }, 'agent-start-retry-scheduled', message);
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

function pendingReconciliation(root, issue, reason) {
  const current = loadRun(root, issue.number) || {};
  const retry = nextReconciliationAttempt(current.launchReconciliationAttempts);
  const summary = `${reason} Workspace reconciliation attempt ${retry.attempt}/${retry.maximum} failed.`;
  if (retry.exhausted) {
    return terminalLaunchFailure(root, issue,
      `${summary} The controller stopped retrying; cleanup will archive the workspace only if Paseo can prove it is empty.`);
  }
  const message = `${summary} The controller will not create another agent until reconciliation succeeds.`;
  saveActivity(root, issue.number, {
    status: LABELS.running,
    phase: 'launch-reconciliation-needed',
    reason: message,
    launchReconciliationAttempts: retry.attempt,
    maxLaunchReconciliationAttempts: retry.maximum,
  }, 'agent-start-reconciliation-needed', message);
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
    return pendingReconciliation(root, issue,
      `${reason} Paseo agent inventory failed: ${inspection.reason}`);
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
  const prompt = normalizeAttemptPrompt(buildAttemptPrompt(repository, issue, current.branch, config));
  saveActivity(root, issue.number, {
    coderPrompt: prompt,
    coderPromptRecordedAt: now(),
    coderPromptKind: 'initial-attempt',
    coderPrompts: [
      ...(current.coderPrompts || []),
      { attempt: current.attempt || 1, kind: 'initial-attempt', at: now(), prompt },
    ],
  }, 'coder-prompt-recorded', `Recorded the exact coder prompt sent for attempt ${current.attempt || 1}.`);
  saveActivity(root, issue.number, {
    phase: 'starting-agent',
    reason: null,
    agentStartAttempts: attemptCount,
    maxAgentStartAttempts: AGENT_START_MAX_ATTEMPTS,
    launchReconciliationAttempts: 0,
    maxLaunchReconciliationAttempts: LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
  }, 'agent-start-attempt', `Starting agent attempt ${attemptCount}/${AGENT_START_MAX_ATTEMPTS} in workspace ${current.workspaceId}.`);
  try {
    const payload = runJson('paseo', agentRunArgs({
      provider: config.models.coder,
      thinking: config.models.coderThinking,
      title,
      workspaceId: current.workspaceId,
      prompt,
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
    return pendingReconciliation(root, issue,
      `Paseo agent inventory failed: ${inspection.reason}`);
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

  const priorAttempt = previous?.attempt ? previous : null;
  const base = branchName(issue, 1);
  const nextAttempt = priorAttempt ? Number(priorAttempt.attempt || 1) + 1 : 1;
  let selection;
  if (!priorAttempt && !branchExists(root, base)) selection = { branch: base, attempt: 1 };
  else if (branchAction === 'keep') selection = nextBranch(root, issue, nextAttempt);
  else if (branchAction === 'delete') {
    deleteRecordedBranch(root, priorAttempt);
    selection = nextBranch(root, issue, nextAttempt);
  } else throw new Error(`Branch ${base} already exists. Choose keep or delete.`);

  const repository = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
  if (!repository) throw new Error('Could not determine the GitHub repository.');

  const started = now();
  const agentTitle = `Issue #${issue.number} Coder (attempt ${selection.attempt})`;
  const workspaceTitle = selection.branch;
  editLabels(root, issue.number, [PASEO_LABELS.coding], [PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.failed, PASEO_LABELS.needsAttention]);
  saveRun(root, issue.number, {
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueUrl: issue.url,
    branch: selection.branch,
    baseBranch: config.baseBranch,
    baseSha: null,
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
    launchReconciliationAttempts: 0,
    maxLaunchReconciliationAttempts: LAUNCH_RECONCILIATION_MAX_ATTEMPTS,
    activity: [
      ...(previous?.activity || []),
      { type: 'attempt-launching', at: started, details: `Attempt ${selection.attempt} reserved on ${selection.branch}.` },
    ],
    history: previousAttemptHistory(priorAttempt),
  });
  unskipIssue(root, issue.number);

  try {
    const base = refreshConfiguredBase(root, config.baseBranch);
    saveActivity(root, issue.number, {
      baseBranch: base.baseBranch,
      baseSha: base.baseSha,
      baseRef: base.baseRef,
      baseVerifiedAt: base.verifiedAt,
      phase: 'creating-workspace',
    }, 'workspace-base-verified', `Verified origin/${base.baseBranch} at ${base.baseSha} before workspace creation.`);
    const payload = runJson('paseo', workspaceCreateArgs({
      root,
      title: workspaceTitle,
      branch: selection.branch,
      baseBranch: base.baseBranch,
      baseSha: base.baseSha,
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
      baseSha: base.baseSha,
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
  return launch(root, viewIssue(root, number), branchAction);
}

export function dispatchNextIssue(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  if (!config.setupComplete) return { claimed: false, reason: 'Setup is not complete.' };
  if (!runtime.claimsEnabled) return { claimed: false, reason: 'Claims are paused.' };
  if (listByLabel(root, PASEO_LABELS.coding).length >= config.maxActive) {
    return { claimed: false, reason: 'Maximum active issue count reached.' };
  }

  const skipped = new Set(runtime.skippedIssueNumbers || []);
  const queue = queueSnapshot(root, config);
  for (const { issue } of queue.eligible) {
    if (skipped.has(Number(issue.number))) continue;
    if (branchExists(root, branchName(issue, 1)) && !loadRun(root, issue.number)?.attempt) continue;
    try {
      return {
        ...launch(root, issue, 'keep'),
        reconciliation: {
          checked: queue.eligible.length + queue.waiting.length + queue.rejected.length,
          blocked: queue.waiting,
          rejected: queue.rejected,
        },
      };
    } catch (error) {
      if (/already has an active automation attempt/i.test(error.message)) continue;
      if (/Blocked by open|could not be retrieved|Dependency #|cycle detected|not present in|no merged pull request|Native GitHub blocked-by/i.test(error.message)) continue;
      throw error;
    }
  }
  return {
    claimed: false,
    reason: 'No eligible issue found.',
    reconciliation: {
      checked: queue.eligible.length + queue.waiting.length + queue.rejected.length,
      blocked: queue.waiting,
      rejected: queue.rejected,
    },
  };
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
  editLabels(root, number, [PASEO_LABELS.failed], [PASEO_LABELS.coding, PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.needsAttention]);
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
  editLabels(root, number, [PASEO_LABELS.ready], [PASEO_LABELS.coding, PASEO_LABELS.queued, PASEO_LABELS.failed, PASEO_LABELS.needsAttention]);
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
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const skipped = new Set(runtime.skippedIssueNumbers || []);
  const byLabel = Object.fromEntries(Object.entries(LABELS).map(([name, label]) => [name, listByLabel(root, label)]));
  let queue;
  try { queue = queueSnapshot(root, config); }
  catch { queue = { eligible: [], waiting: [], rejected: [] }; }
  return {
    counts: Object.fromEntries(Object.entries(byLabel).map(([name, issues]) => [name, issues.length])),
    readyIssues: queue.eligible.map(({ issue }) => ({
      number: Number(issue.number),
      title: issue.title,
      url: issue.url,
      createdAt: issue.createdAt,
      dependencies: dependencyNumbers(issue).numbers,
      dependencySource: dependencyNumbers(issue).source,
      skipped: skipped.has(Number(issue.number)),
      branchExists: branchExists(root, branchName(issue, 1)),
    })),
    waitingIssues: queue.waiting,
    rejectedIssues: queue.rejected,
    attempts: listRuns(root).map(summarize),
  };
}
