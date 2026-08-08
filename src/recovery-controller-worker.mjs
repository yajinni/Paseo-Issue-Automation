import { setTimeout as sleep } from 'node:timers/promises';
import { loadRun } from './state.mjs';

const [root, rawIssue] = process.argv.slice(2);
const issueNumber = Number(rawIssue);

if (!root || !Number.isInteger(issueNumber)) {
  throw new Error('Usage: recovery-controller-worker.mjs <repository-root> <issue-number>');
}

let owned = false;
for (let attempt = 0; attempt < 200; attempt += 1) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  if (Number(state.controllerPid) === process.pid) {
    owned = true;
    break;
  }
  if (state.phase === 'failed' || state.status !== 'agent-running') {
    throw new Error(`Recovery controller ownership was cancelled for issue #${issueNumber}.`);
  }
  await sleep(25);
}

if (!owned) {
  throw new Error(`Timed out waiting for recovery controller ownership for issue #${issueNumber}.`);
}

await import('./controller-worker.mjs');
