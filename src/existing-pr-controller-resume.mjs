import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectBaseFreshness } from './base-freshness.mjs';
import { currentPr, remoteBranchHead } from './controller-draft-pr.mjs';
import { PASEO_LABELS } from './label-catalog.mjs';
import { expectedWorkspaceAgent, inspectWorkspaceAgents, verifyWorkspaceIdentity } from './launch-retry.mjs';
import { pauseManagedPr } from './pr-review-queue.mjs';
import { loadPrReviewStore } from './pr-review-store.mjs';
import { run, runJson } from './process.mjs';
import { LABELS, loadConfig, loadRun, saveRun } from './state.mjs';

const controllerWorkerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recovery-controller-worker.mjs');
const now = () => new Date().toISOString();

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function controllerProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function appendActivity(state, type, details, at = now()) {
  return [...(state?.activity || []), { type, at, details }];
}

function agentId(agent) {
  return String(agent?.id ?? agent?.agentId ?? agent?.agent_id ?? '').trim();
}

function terminalFailureState(state) {
  return state?.status === LABELS.failed
    || state?.status === PASEO_LABELS.failed
    || state?.phase === 'failed'
    || state?.phase === 'launch-failed'
    || state?.restartPreviousPhase === 'failed'
    || state?.restartPreviousPhase === 'launch-failed';
}

export function existingPrControllerResumeEligibility(state, {
  branchAction = 'keep',
  controllerAlive = controllerProcessAlive,
} = {}) {
  if (branchAction !== 'keep') return { eligible: false, reason: 'Deleting the branch explicitly requests a fresh attempt.' };
  if (!state) return { eligible: false, reason: 'No recorded attempt exists.' };
  const orphanedController = state.status === LABELS.running
    && Number.isInteger(Number(state.controllerPid))
    && !controllerAlive(state.controllerPid);
  if (!terminalFailureState(state) && !orphanedController) {
    return { eligible: false, reason: 'Only failed attempts or orphaned running controllers are eligible for existing-PR controller resume.' };
  }
  if (!state.branch) return { eligible: false, reason: 'The failed attempt has no recorded branch.' };
  if (!state.workspaceId || !state.worktreePath) return { eligible: false, reason: 'The failed attempt has no reusable Paseo workspace.' };
  if (!(state.coderAgentId || state.agentId)) return { eligible: false, reason: 'The failed attempt has no reusable coder agent.' };
  return { eligible: true, reason: null, orphanedController };
}

function editResumeLabels(root, issueNumber, running, runner) {
  const args = ['issue', 'edit', String(issueNumber)];
  const add = running ? [PASEO_LABELS.coding] : [PASEO_LABELS.failed];
  const remove = running
    ? [PASEO_LABELS.ready, PASEO_LABELS.queued, PASEO_LABELS.reviewQueued, PASEO_LABELS.failed, PASEO_LABELS.needsAttention]
    : [PASEO_LABELS.coding];
  add.forEach((label) => args.push('--add-label', label));
  remove.forEach((label) => args.push('--remove-label', label));
  const result = runner('gh', args, { cwd: root, allowFailure: true });
  if (!result?.ok) throw new Error(result?.stderr || result?.stdout || 'Could not update issue labels for controller resume.');
}

function humanReviewRefreshEligibility(state) {
  const humanReview = state?.status === LABELS.humanReview
    && (state.phase === 'human-review' || state.restartPreviousPhase === 'human-review');
  if (!humanReview) return { eligible: false, reason: 'Only a recorded human-review attempt can use the explicit existing-PR refresh.' };
  if (!state.approvedCommit) return { eligible: false, reason: 'The human-review attempt has no exact approved head to invalidate.' };
  if (!state.prNumber) return { eligible: false, reason: 'The human-review attempt has no recorded pull request.' };
  if (!state.branch || !state.workspaceId || !state.worktreePath || !(state.coderAgentId || state.agentId)) {
    return { eligible: false, reason: 'The human-review attempt is missing reusable branch, workspace, worktree, or coder identity.' };
  }
  return { eligible: true, refresh: true, reason: null };
}

function pauseExistingReviewForRefresh(root, issueNumber, pullRequestNumber) {
  const store = loadPrReviewStore(root);
  const matches = (store.managedPullRequests || []).filter((managed) => (
    Number(managed.issueNumber) === Number(issueNumber)
      && Number(managed.pullRequestNumber) === Number(pullRequestNumber)
  ));
  if (matches.length > 1) throw new Error(`Paseo found multiple managed records for issue #${issueNumber} and PR #${pullRequestNumber}.`);
  if (matches[0]) pauseManagedPr(root, matches[0].id, true);
}

function verifyRecordedCoder(root, state, {
  runner,
  inspectAgents,
  verifyWorkspace,
} = {}) {
  const expectedTitle = state.workspaceTitle || state.branch;
  try {
    verifyWorkspace(root, {
      workspaceId: state.workspaceId,
      worktreePath: state.worktreePath,
      workspaceName: state.workspaceName || expectedTitle,
    }, {
      title: expectedTitle,
      branch: state.branch,
    }, { runner });
  } catch (error) {
    return {
      ok: false,
      reason: `Recorded workspace cannot be safely reused: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const inspection = inspectAgents(root, state.worktreePath, { runner });
  if (!inspection?.verified) {
    return { ok: false, reason: `Paseo could not verify the old workspace agent: ${inspection?.reason || 'unknown inventory failure'}` };
  }

  const coderId = String(state.coderAgentId || state.agentId);
  let coder = inspection.agents.find((agent) => agentId(agent) === coderId);
  if (!coder && state.agentTitle) {
    const byTitle = expectedWorkspaceAgent(inspection, state.agentTitle);
    if (byTitle.status === 'found' && agentId(byTitle.agent) === coderId) coder = byTitle.agent;
  }
  if (!coder) return { ok: false, reason: `The recorded coder ${coderId} is no longer present in the failed attempt workspace.` };
  return { ok: true, coderId };
}

function exactHeadEvidence(root, state, pr, {
  runner,
  remoteHeadReader,
} = {}) {
  const cwd = state.worktreePath || root;
  const headResult = runner('git', ['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  const head = headResult?.ok ? text(headResult.stdout) : '';
  if (!head) return { ok: false, reason: 'The existing PR worktree has no readable local HEAD.' };

  const status = runner('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, allowFailure: true });
  if (!status?.ok) return { ok: false, reason: status?.stderr || status?.stdout || 'Could not inspect the existing PR worktree.' };
  if (text(status.stdout)) return { ok: false, reason: 'The existing PR worktree is not clean.' };

  const remoteHead = remoteHeadReader(root, state.branch, { runner });
  if (remoteHead !== head) {
    return { ok: false, reason: `The pushed branch head ${remoteHead || '(missing)'} does not match local HEAD ${head}.` };
  }
  if (text(pr?.headRefOid) !== head) {
    return { ok: false, reason: `PR #${pr?.number || '(unknown)'} head ${text(pr?.headRefOid) || '(missing)'} does not match local HEAD ${head}.` };
  }
  return { ok: true, head };
}

export function resumeExistingPrController(root, number, {
  branchAction = 'keep',
  readRun = loadRun,
  writeRun = saveRun,
  configLoader = loadConfig,
  runner = run,
  inspectAgents = inspectWorkspaceAgents,
  verifyWorkspace = verifyWorkspaceIdentity,
  prReader = currentPr,
  remoteHeadReader = remoteBranchHead,
  controllerAlive = controllerProcessAlive,
  refreshHumanReview = false,
  jsonRunner = runJson,
  pauseReview = pauseExistingReviewForRefresh,
  spawnFn = spawn,
  executable = process.execPath,
  workerPath = controllerWorkerPath,
} = {}) {
  const issueNumber = Number(number);
  const state = readRun(root, issueNumber);
  const eligibility = existingPrControllerResumeEligibility(state, { branchAction, controllerAlive });
  const selectedEligibility = refreshHumanReview
    ? humanReviewRefreshEligibility(state)
    : eligibility;
  if (!selectedEligibility.eligible) return { resumed: false, recovered: false, issueNumber, reason: selectedEligibility.reason };

  const coder = verifyRecordedCoder(root, state, { runner, inspectAgents, verifyWorkspace });
  if (!coder.ok) return { resumed: false, recovered: false, issueNumber, reason: coder.reason };

  const config = configLoader(root);
  const pr = prReader(root, state, { configLoader: () => config });
  if (!pr) return { resumed: false, recovered: false, issueNumber, reason: 'The existing attempt has no open PR on its recorded branch.' };
  if (state.prNumber && Number(pr.number) !== Number(state.prNumber)) {
    return { resumed: false, recovered: false, issueNumber, reason: `The open PR #${pr.number} does not match recorded PR #${state.prNumber}.` };
  }
  if (pr.baseRefName !== config.baseBranch) {
    return { resumed: false, recovered: false, issueNumber, reason: `PR #${pr.number} targets ${pr.baseRefName || '(missing)'} instead of ${config.baseBranch}.` };
  }

  const exact = exactHeadEvidence(root, state, pr, { runner, remoteHeadReader });
  if (!exact.ok) return { resumed: false, recovered: false, issueNumber, reason: exact.reason };

  if (selectedEligibility.refresh) {
    if (text(state.approvedCommit).toLowerCase() !== exact.head.toLowerCase()) {
      return { resumed: false, recovered: false, issueNumber, reason: `The recorded approved head ${text(state.approvedCommit) || '(missing)'} does not match the current PR head ${exact.head}.` };
    }
    const freshness = inspectBaseFreshness(root, state, config.baseBranch, { runner, jsonRunner });
    if (freshness.status === 'indeterminate' || freshness.status === 'inconsistent') {
      return { resumed: false, recovered: false, issueNumber, reason: freshness.reason };
    }
    if (freshness.ok) {
      return { resumed: false, recovered: false, issueNumber, reason: 'The human-review PR already contains the latest base; no refresh was needed.' };
    }
    pauseReview(root, issueNumber, pr.number);
  }

  editResumeLabels(root, issueNumber, true, runner);
  const startedAt = now();
  const resumeDescription = selectedEligibility.refresh
    ? `Refreshing human-review PR #${pr.number} at exact head ${exact.head}; the prior approval will not be reused.`
    : selectedEligibility.orphanedController
    ? `Resuming orphaned controller PID ${state.controllerPid} for existing managed PR #${pr.number} at exact head ${exact.head} without starting a fresh attempt.`
    : `Resuming the existing managed PR #${pr.number} at exact head ${exact.head} without starting a fresh attempt.`;
  let resumedState = writeRun(root, issueNumber, {
    ...state,
    status: LABELS.running,
    phase: 'resuming-existing-pr-controller',
    reason: resumeDescription,
    completedAt: null,
    controllerPid: null,
    heartbeatAt: startedAt,
    updatedAt: startedAt,
    restartPending: false,
    restartRequestedAt: null,
    prNumber: pr.number,
    prUrl: pr.url || state.prUrl || null,
    ...(selectedEligibility.refresh ? {
      approvedCommit: null,
      reviewRequestId: null,
      reviewExpectedHeadSha: null,
      reviewSchemaRetryCount: 0,
    } : {}),
    activity: appendActivity(
      state,
      selectedEligibility.refresh ? 'existing-pr-controller-refresh-started' : 'existing-pr-controller-resume-started',
      `Reusing attempt ${state.attempt || 1}, workspace ${state.workspaceId}, branch ${state.branch}, coder ${coder.coderId}, and PR #${pr.number} at exact head ${exact.head}.`,
      startedAt,
    ),
  });

  let child;
  try {
    child = spawnFn(executable, [workerPath, path.resolve(root), String(issueNumber)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!child?.pid) throw new Error('Could not determine the controller resume worker PID.');
    child.unref?.();
  } catch (error) {
    const failedAt = now();
    try { editResumeLabels(root, issueNumber, false, runner); } catch {}
    resumedState = writeRun(root, issueNumber, {
      ...resumedState,
      status: LABELS.failed,
      phase: 'failed',
      reason: `Existing-PR controller resume could not start: ${error instanceof Error ? error.message : String(error)}`,
      completedAt: failedAt,
      controllerPid: null,
      updatedAt: failedAt,
      activity: appendActivity(resumedState, 'existing-pr-controller-resume-failed', error instanceof Error ? error.message : String(error), failedAt),
    });
    throw error;
  }

  const controllerStartedAt = now();
  resumedState = writeRun(root, issueNumber, {
    ...resumedState,
    controllerPid: child.pid,
    updatedAt: controllerStartedAt,
    activity: appendActivity(
      resumedState,
      selectedEligibility.refresh ? 'controller-started-for-existing-pr-refresh' : 'controller-restarted-for-existing-pr',
      `Issue Execution Controller PID ${child.pid} ${selectedEligibility.refresh ? 'started refresh for' : 'resumed'} existing PR #${pr.number} for attempt ${state.attempt || 1}.`,
      controllerStartedAt,
    ),
  });

  return {
    resumed: true,
    recovered: true,
    refreshed: selectedEligibility.refresh === true,
    claimed: true,
    issueNumber,
    branch: state.branch,
    attempt: state.attempt || 1,
    workspaceId: state.workspaceId,
    coderAgentId: coder.coderId,
    prNumber: pr.number,
    prUrl: pr.url || state.prUrl || null,
    head: exact.head,
    controllerPid: child.pid,
    state: resumedState,
  };
}
