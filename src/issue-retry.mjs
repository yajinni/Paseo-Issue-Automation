import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listRuns, loadRun, saveRun } from './state.mjs';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'controller-worker.mjs');

function nowIso() { return new Date().toISOString(); }

function startControllerWorker(root, issueNumber, attempt) {
  const args = [workerPath, path.resolve(root), String(issueNumber)];
  if (Number.isInteger(Number(attempt)) && Number(attempt) > 0) args.push(String(attempt));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) throw new Error('Could not determine the temporary-failure retry controller PID.');
  child.unref();
  return child.pid;
}

export function resumeTemporaryFailureRetries(root, {
  runLister = listRuns,
  runLoader = loadRun,
  runSaver = saveRun,
  startWorker = startControllerWorker,
} = {}) {
  const pending = (runLister(root) || [])
    .filter((state) => state?.phase === 'retry-pending' && Number.isInteger(Number(state.issueNumber)))
    .sort((left, right) => Number(left.issueNumber) - Number(right.issueNumber));
  if (!pending.length) return { claimed: false, attempts: [], results: [] };

  const attempts = [];
  const results = [];
  for (const pendingState of pending) {
    const issueNumber = Number(pendingState.issueNumber);
    const current = runLoader(root, issueNumber) || pendingState;
    if (current.phase !== 'retry-pending') continue;
    const controllerPid = startWorker(root, issueNumber, current.attempt);
    const at = nowIso();
    const saved = runSaver(root, issueNumber, {
      ...current,
      phase: 'retrying-temporary-failure',
      controllerPid,
      heartbeatAt: at,
      updatedAt: at,
      activity: [
        ...(current.activity || []),
        {
          type: 'temporary-failure-retry-started',
          at,
          details: `Retry ${Number(current.temporaryFailureCount || 0)} started on a later scheduler turn.`,
        },
      ],
    });
    const result = {
      claimed: true,
      type: 'temporary-failure-retry',
      issueNumber,
      branch: saved.branch || null,
      attempt: saved.attempt || null,
      controllerPid,
    };
    attempts.push(result);
    results.push(result);
  }
  return { claimed: attempts.length > 0, attempts, results };
}
