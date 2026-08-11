import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRun, saveRun } from './state.mjs';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manager-restart-worker.mjs');
const now = () => new Date().toISOString();

function withActivity(state, type, details, at) {
  return [...(state?.activity || []), { type, at, details }];
}

export function queueCodingIssueRestart(root, number, {
  branchAction = 'keep',
  refreshExistingPr = false,
  spawnFn = spawn,
  readRun = loadRun,
  writeRun = saveRun,
  executable = process.execPath,
  restartWorkerPath = workerPath,
} = {}) {
  if (!['keep', 'delete'].includes(branchAction)) throw new Error('Restart branch action must be keep or delete.');
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error('A positive issue number is required.');
  const state = readRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);

  if (state.restartPending === true) {
    return {
      queued: true,
      alreadyQueued: true,
      issueNumber,
      branchAction,
      phase: state.phase,
      message: `Issue #${issueNumber} restart is already in progress.`,
    };
  }

  const queuedAt = now();
  const recoverFirst = branchAction === 'keep';
  const restartMode = refreshExistingPr === true ? 'refresh' : 'recover';
  const queuedState = {
    ...state,
    phase: 'queued',
    restartPending: true,
    restartRequestedAt: queuedAt,
    restartPreviousPhase: state.phase || null,
    restartPreviousReason: state.reason || null,
    reason: recoverFirst
      ? (refreshExistingPr === true
        ? 'Existing human-review PR refresh queued. The same branch, workspace, coder, and PR will be refreshed against the current base; no prior approval or fresh attempt will be used.'
        : 'Recover-first restart queued. A verified existing managed PR/controller will be resumed first; otherwise failed work will be reused when safe before any fresh attempt starts.')
      : 'Fresh restart queued with branch deletion.',
    updatedAt: queuedAt,
    activity: withActivity(
      state,
      'restart-queued',
      recoverFirst
        ? (refreshExistingPr === true
          ? 'Existing human-review PR refresh requested from the manager.'
          : 'Recover-first restart requested from the manager.')
        : 'Explicit fresh restart with branch deletion requested from the manager.',
      queuedAt,
    ),
  };
  writeRun(root, issueNumber, queuedState);

  let child;
  try {
    const workerArgs = [restartWorkerPath, path.resolve(root), String(issueNumber), branchAction];
    if (refreshExistingPr === true) workerArgs.push(restartMode);
    child = spawnFn(executable, workerArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!child?.pid) throw new Error('Could not determine the background restart worker PID.');
    child.unref?.();
  } catch (error) {
    const failedAt = now();
    writeRun(root, issueNumber, {
      ...state,
      phase: 'failed',
      restartPending: false,
      reason: `Restart could not be queued: ${error instanceof Error ? error.message : String(error)}`,
      updatedAt: failedAt,
      activity: withActivity(state, 'restart-queue-failed', error instanceof Error ? error.message : String(error), failedAt),
    });
    throw error;
  }

  return {
    queued: true,
    issueNumber,
    branchAction,
    phase: 'queued',
    message: recoverFirst
      ? (refreshExistingPr === true
        ? `Issue #${issueNumber} existing human-review PR refresh queued; Paseo will preserve the current attempt, workspace, coder, branch, and PR.`
        : `Issue #${issueNumber} restart queued. Paseo will first resume a verified existing managed PR/controller, then try failed-attempt recovery, and create a fresh attempt only if neither can be reused safely.`)
      : `Issue #${issueNumber} fresh restart queued with branch deletion.`,
  };
}
