import { recoverOrRestartCodingIssue } from './coding-dispatch.mjs';
import { loadRun, saveRun } from './state.mjs';

const now = () => new Date().toISOString();

function appendActivity(state, type, details, at) {
  return [...(state?.activity || []), { type, at, details }];
}

const [root, issueNumberText, branchAction = 'keep'] = process.argv.slice(2);
const issueNumber = Number(issueNumberText);

if (!root || !Number.isInteger(issueNumber) || issueNumber <= 0 || !['keep', 'delete'].includes(branchAction)) {
  process.exitCode = 2;
} else {
  try {
    const state = loadRun(root, issueNumber);
    if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
    const startedAt = now();
    saveRun(root, issueNumber, {
      ...state,
      phase: 'starting-agent',
      restartPending: true,
      reason: branchAction === 'keep'
        ? 'Checking whether the failed attempt can be recovered before creating a fresh attempt.'
        : 'A fresh coding attempt was explicitly requested with branch deletion.',
      updatedAt: startedAt,
      activity: appendActivity(
        state,
        'restart-started',
        branchAction === 'keep'
          ? 'Background restart worker started in recover-first mode.'
          : 'Background restart worker started in explicit fresh mode.',
        startedAt,
      ),
    });
    recoverOrRestartCodingIssue(root, issueNumber, { branchAction });
  } catch (error) {
    const state = loadRun(root, issueNumber) || { issueNumber };
    const failedAt = now();
    const message = error instanceof Error ? error.message : String(error);
    saveRun(root, issueNumber, {
      ...state,
      phase: 'failed',
      restartPending: false,
      reason: `Restart failed: ${message}`,
      updatedAt: failedAt,
      activity: appendActivity(state, 'restart-failed', message, failedAt),
    });
    process.exitCode = 1;
  }
}
