import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  finalizeApprovedBrowserReview,
  recordApprovedBrowserReview,
} from '../src/pr-review-finalize.mjs';
import { loadRun, saveRun } from '../src/state.mjs';

const HEAD = 'abcdef1234567890';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-finalization-isolation-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function state(root) {
  return saveRun(root, 7, {
    issueNumber: 7,
    status: 'agent-running',
    phase: 'auto-merge-requested',
    branch: 'ai/issue-7-finalize',
    prNumber: 11,
    approvedCommit: HEAD,
    events: [
      { event: 'validation-summary', result: 'PASS', commit: HEAD },
      { event: 'harness-review', stage: 'full', result: 'pass', headSha: HEAD, findings: [] },
    ],
    activity: [],
  });
}

function managed() {
  return {
    id: 'octo/app#11',
    repository: 'octo/app',
    issueNumber: 7,
    pullRequestNumber: 11,
    branchName: 'ai/issue-7-finalize',
    currentHeadSha: HEAD,
  };
}

function importedJob() {
  return {
    id: 'approved-finalization:harness-review:octo/app#11:abcdef1234567890',
    reviewRequestId: 'approved-finalization:harness-review:octo/app#11:abcdef1234567890',
    headSha: HEAD,
    state: 'completed',
    result: 'approved',
  };
}

test('imported finalization evidence never creates browser-review approval side effects', (t) => {
  const root = repository(t);
  const before = state(root);
  const recorded = recordApprovedBrowserReview(root, managed(), importedJob());
  assert.deepEqual(recorded.events, before.events);
  assert.equal(recorded.events.some((event) => event.source === 'browser-review'), false);

  const finalized = finalizeApprovedBrowserReview(root, managed(), importedJob());
  assert.equal(finalized.mode, 'managed-finalization');
  assert.equal(finalized.unchanged, true);
  assert.equal(loadRun(root, 7).events.some((event) => event.source === 'browser-review'), false);
});
