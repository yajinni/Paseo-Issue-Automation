import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCompletionRecoveryPrompt } from './controller-prompts.mjs';
import { PASEO_LABELS } from './label-catalog.mjs';
import { expectedWorkspaceAgent, inspectWorkspaceAgents, verifyWorkspaceIdentity } from './launch-retry.mjs';
import { run } from './process.mjs';
import { LABELS, loadConfig, loadRun, saveRun } from './state.mjs';

export const FAILED_ATTEMPT_RECOVERY_MAX = 1;

const controllerWorkerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recovery-controller-worker.mjs');
const now = () => new Date().toISOString();

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

export function failedAttemptRecoveryEligibility(state, { branchAction = 'keep' } = {}) {
  if (branchAction !== 'keep') return { eligible: false, reason: 'Deleting the branch explicitly requests a fresh attempt.' };
  if (!state) return { eligible: false, reason: 'No recorded attempt exists.' };
  if (!terminalFailureState(state)) return { eligible: false, reason: 'Only failed attempts are eligible for recover-first restart.' };
  if (Number(state.failedAttemptRecoveryCount || 0) >= FAILED_ATTEMPT_RECOVERY_MAX) {
    return { eligible: false, reason: 'This failed attempt already used its recover-first restart.' };
  }
  if (!state.branch) return { eligible: false, reason: 'The failed attempt has no recorded branch.' };
  if (!state.workspaceId || !state.worktreePath) return { eligible: false, reason: 'The failed attempt has no reusable Paseo workspace.' };
  if (!(state.coderAgentId || state.agentId)) return { eligible: false, reason: 'The failed attempt has no reusable coder agent.' };
  return { eligible: true, reason: null };
}

function editRecoveryLabels(root, issueNumber, running, runner) {
  const args = ['issue', 'edit', String(issueNumber)];
  const add = running ? [LABELS.running] : [LABELS.failed];
  const remove = running
    ? [LABELS.ready, PASEO_LABELS.ready, LABELS.blocked, LABELS.failed, PASEO_LABELS.failed, PASEO_LABELS.needsAttention, LABELS.humanReview]
    : [LABELS.running];
  add.forEach((label) => args.push('--add-label', label));
  remove.forEach((label) => args.push('--remove-label', label));
  const result = runner('gh', args, { cwd: root, allowFailure: true });
  if (!result?.ok) throw new Error(result?.stderr || result?.stdout || 'Could not update issue labels for recovery.');
}

function recoveryPrompt(state, issueNumber, baseBranch) {
  const priorReason = state.restartPreviousReason || state.reason || 'The previous controller attempt failed.';
  return `Recover the existing implementation for issue #${issueNumber}; do NOT start the task over.\n\nRe-read the complete issue and review the work already present in this worktree against its acceptance criteria. Preserve correct completed work. Only change code when your review finds something missing or wrong. Then rerun the issue-required validation and finish the existing branch/PR handoff.\n\n${buildCompletionRecoveryPrompt({
    issueNumber,
    branch: state.branch,
    baseBranch,
    reason: priorReason,
  })}`;
}

export function recoverFailedAttempt(root, number, {
  branchAction = 'keep',
  readRun = loadRun,
  writeRun = saveRun,
  configLoader = loadConfig,
  runner = run,
  inspectAgents = inspectWorkspaceAgents,
  verifyWorkspace = verifyWorkspaceIdentity,
  spawnFn = spawn,
  executable = process.execPath,
  workerPath = controllerWorkerPath,
} = {}) {
  const issueNumber = Number(number);
  const state = readRun(root, issueNumber);
  const eligibility = failedAttemptRecoveryEligibility(state, { branchAction });
  if (!eligibility.eligible) return { recovered: false, issueNumber, reason: eligibility.reason };

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
      recovered: false,
      issueNumber,
      reason: `Recorded workspace cannot be safely reused: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const inspection = inspectAgents(root, state.worktreePath, { runner });
  if (!inspection?.verified) {
    return { recovered: false, issueNumber, reason: `Paseo could not verify the old workspace agent: ${inspection?.reason || 'unknown inventory failure'}` };
  }
  const coderId = String(state.coderAgentId || state.agentId);
  let coder = inspection.agents.find((agent) => agentId(agent) === coderId);
  if (!coder && state.agentTitle) {
    const byTitle = expectedWorkspaceAgent(inspection, state.agentTitle);
    if (byTitle.status === 'found' && agentId(byTitle.agent) === coderId) coder = byTitle.agent;
  }
  if (!coder) {
    return { recovered: false, issueNumber, reason: `The recorded coder ${coderId} is no longer present in the failed attempt workspace.` };
  }

  const prompt = recoveryPrompt(state, issueNumber, configLoader(root).baseBranch);
  const sent = runner('paseo', ['send', coderId, '--no-wait', prompt], { cwd: root, allowFailure: true });
  if (!sent?.ok) {
    return {
      recovered: false,
      issueNumber,
      reason: `The existing coder could not be resumed: ${sent?.stderr || sent?.stdout || 'Paseo send failed.'}`,
    };
  }

  editRecoveryLabels(root, issueNumber, true, runner);
  const startedAt = now();
  const recoveryCount = Number(state.failedAttemptRecoveryCount || 0) + 1;
  let recoveredState = writeRun(root, issueNumber, {
    ...state,
    status: LABELS.running,
    phase: 'recovering-failed-attempt',
    reason: 'Recovering the existing failed attempt before creating any fresh attempt.',
    completedAt: null,
    controllerPid: null,
    heartbeatAt: startedAt,
    updatedAt: startedAt,
    restartPending: false,
    restartRequestedAt: null,
    failedAttemptRecoveryCount: recoveryCount,
    failedAttemptRecoveryStartedAt: startedAt,
    activity: appendActivity(
      state,
      'failed-attempt-recovery-started',
      `Reusing attempt ${state.attempt || 1}, workspace ${state.workspaceId}, branch ${state.branch}, and coder ${coderId}.`,
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
    if (!child?.pid) throw new Error('Could not determine the recovery controller worker PID.');
    child.unref?.();
  } catch (error) {
    const failedAt = now();
    try { editRecoveryLabels(root, issueNumber, false, runner); } catch {}
    recoveredState = writeRun(root, issueNumber, {
      ...recoveredState,
      status: LABELS.failed,
      phase: 'failed',
      reason: `Failed-attempt recovery controller could not start: ${error instanceof Error ? error.message : String(error)}`,
      completedAt: failedAt,
      controllerPid: null,
      updatedAt: failedAt,
      activity: appendActivity(recoveredState, 'failed-attempt-recovery-controller-failed', error instanceof Error ? error.message : String(error), failedAt),
    });
    throw error;
  }

  return {
    recovered: true,
    claimed: true,
    issueNumber,
    branch: state.branch,
    attempt: state.attempt || 1,
    workspaceId: state.workspaceId,
    coderAgentId: coderId,
    controllerPid: child.pid,
    state: { ...recoveredState, controllerPid: child.pid },
  };
}
