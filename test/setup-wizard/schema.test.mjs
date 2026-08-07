import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeRepositoryConfig,
  validateRepositoryConfig,
} from '../../src/setup-wizard/schema.mjs';

test('repository config v2 migrates to v3 without dropping existing selections', () => {
  const config = validateRepositoryConfig({
    version: 2,
    setupComplete: true,
    baseBranch: 'release/current',
    pollIntervalSeconds: 300,
    maxActive: 10,
    maxReviewRounds: 7,
    models: {
      orchestrator: 'legacy/orchestrator',
      coder: 'provider/coder',
      coderThinking: 'high',
      reviewer: 'provider/reviewer',
      reviewerThinking: 'medium',
    },
    workspace: { id: 'workspace-1' },
  });

  assert.equal(config.version, 3);
  assert.equal(config.setupComplete, true);
  assert.equal(config.baseBranch, 'release/current');
  assert.equal(config.pollIntervalSeconds, 300);
  assert.equal(config.maxActive, 10);
  assert.equal(config.review.workflow, 'full-immediate');
  assert.equal(config.review.quickMaxRounds, 3);
  assert.equal(config.review.fullMaxRounds, 7);
  assert.equal(config.review.autoMergeApproved, false);
  assert.equal(config.maxReviewRounds, 7);
  assert.equal(config.models.coder, 'provider/coder');
  assert.equal(config.models.reviewer, 'provider/reviewer');
  assert.equal(config.models.orchestrator, 'legacy/orchestrator');
  assert.equal(config.workspace.id, 'workspace-1');
  assert.deepEqual(config.issueSelection, {
    mode: 'recommended-labels',
    excludedLabels: [],
    temporaryFailureRetries: 3,
  });
});

test('repository config v3 accepts new limits and rejects values above them', () => {
  const config = validateRepositoryConfig({
    version: 3,
    maxActive: 20,
    codingHarness: 'provider-id',
    issueSelection: {
      mode: 'all-open',
      excludedLabels: ['do-not-run', 'needs-design', 'do-not-run'],
      temporaryFailureRetries: 3,
    },
    review: {
      workflow: 'quick-web-chatgpt',
      quickMaxRounds: 20,
      fullMaxRounds: 20,
      autoMergeApproved: true,
    },
  });

  assert.equal(config.maxActive, 20);
  assert.equal(config.codingHarness, 'provider-id');
  assert.equal(config.issueSelection.mode, 'all-open');
  assert.deepEqual(config.issueSelection.excludedLabels, ['do-not-run', 'needs-design']);
  assert.equal(config.review.quickMaxRounds, 20);
  assert.equal(config.review.fullMaxRounds, 20);
  assert.equal(config.review.autoMergeApproved, true);

  assert.throws(() => validateRepositoryConfig({ version: 3, maxActive: 21 }), /1 through 20/);
  assert.throws(
    () => validateRepositoryConfig({ version: 3, review: { quickMaxRounds: 21 } }),
    /1 through 20/,
  );
  assert.throws(
    () => validateRepositoryConfig({ version: 3, review: { fullMaxRounds: 21 } }),
    /1 through 20/,
  );
});

test('partial repository config updates preserve unrelated nested fields', () => {
  const current = validateRepositoryConfig({
    version: 3,
    codingHarness: 'provider-a',
    issueSelection: {
      mode: 'all-open',
      excludedLabels: ['manual'],
      temporaryFailureRetries: 5,
    },
    review: {
      workflow: 'quick-manual',
      quickMaxRounds: 4,
      fullMaxRounds: 6,
      autoMergeApproved: false,
    },
    models: {
      coder: 'provider/coder',
      reviewer: 'provider/reviewer',
    },
  });

  const merged = mergeRepositoryConfig(current, {
    maxActive: 2,
    review: { autoMergeApproved: true },
    models: { coder: 'provider/new-coder' },
  });
  const config = validateRepositoryConfig(merged);

  assert.equal(config.maxActive, 2);
  assert.equal(config.issueSelection.mode, 'all-open');
  assert.deepEqual(config.issueSelection.excludedLabels, ['manual']);
  assert.equal(config.issueSelection.temporaryFailureRetries, 5);
  assert.equal(config.review.workflow, 'quick-manual');
  assert.equal(config.review.quickMaxRounds, 4);
  assert.equal(config.review.fullMaxRounds, 6);
  assert.equal(config.review.autoMergeApproved, true);
  assert.equal(config.models.coder, 'provider/new-coder');
  assert.equal(config.models.reviewer, 'provider/reviewer');
});
