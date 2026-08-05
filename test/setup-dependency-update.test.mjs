import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setupPullRequestAllowsRecovery,
  setupRepositoryFilesCheck,
} from '../src/install.mjs';

test('setup PR recovery waits only for open or unsynchronized merged PRs', () => {
  assert.equal(setupPullRequestAllowsRecovery(null), true);
  assert.equal(setupPullRequestAllowsRecovery({ state: 'closed' }), true);
  assert.equal(setupPullRequestAllowsRecovery({ state: 'open' }), false);
  assert.equal(setupPullRequestAllowsRecovery({ state: 'merged', syncedAt: null }), false);
  assert.equal(setupPullRequestAllowsRecovery({ state: 'merged', syncedAt: '2026-08-05T20:00:00.000Z' }), true);
});

test('setup-file self-test names and reports dirty managed files', () => {
  assert.deepEqual(setupRepositoryFilesCheck({ expectedFiles: [] }), {
    name: 'No uncommitted setup-file changes',
    pass: true,
    details: { changedFiles: [] },
  });

  assert.deepEqual(setupRepositoryFilesCheck({ expectedFiles: ['package-lock.json'] }), {
    name: 'No uncommitted setup-file changes',
    pass: false,
    details: { changedFiles: ['package-lock.json'] },
  });
});
