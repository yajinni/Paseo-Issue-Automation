import { restartCodingIssue } from './coding-dispatch.mjs';
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
      phase: 'restarting',
      reason: 'Restarting as a fresh coding attempt.',
      updatedAt: startedAt,
      activity: appendActivity(state, 'restart-started', 'Background restart worker started.', startedAt),
    });
    restartCodingIssue(root, issueNumber, { branchAction });
  } catch (error) {
    const state = loadRun(root, issueNumber) || { issueNumber };
    const failedAt = now();
    const message = error instanceof Error ? error.message : String(error);
    saveRun(root, issueNumber, {
      ...state,
      phase: 'restart-failed',
      reason: `Restart failed: ${message}`,
      updatedAt: failedAt,
      activity: appendActivity(state, 'restart-failed', message, failedAt),
    });
    process.exitCode = 1;
  }
}
