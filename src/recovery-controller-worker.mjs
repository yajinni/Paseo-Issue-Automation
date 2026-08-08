import { loadRun, saveRun } from './state.mjs';

const [root, rawIssue] = process.argv.slice(2);
const issueNumber = Number(rawIssue);

if (!root || !Number.isInteger(issueNumber)) {
  throw new Error('Usage: recovery-controller-worker.mjs <repository-root> <issue-number>');
}

const state = loadRun(root, issueNumber);
if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);

const at = new Date().toISOString();
saveRun(root, issueNumber, {
  ...state,
  controllerPid: process.pid,
  updatedAt: at,
  heartbeatAt: at,
  activity: [
    ...(state.activity || []),
    {
      type: 'controller-restarted-for-recovery',
      at,
      details: `Issue Execution Controller PID ${process.pid} resumed attempt ${state.attempt || 1}.`,
    },
  ],
});

await import('./controller-worker.mjs');
