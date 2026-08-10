import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recordEvent } from '../src/automation.mjs';
import { loadRun, saveConfig, saveRun } from '../src/state.mjs';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-staged-rounds-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function configure(root) {
  return saveConfig(root, {
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    pollIntervalSeconds: 60,
    maxActive: 1,
    codingHarness: 'fixture',
    issueSelection: {
      mode: 'recommended-labels',
      excludedLabels: [],
      temporaryFailureRetries: 0,
    },
    review: {
      workflow: 'quick-manual',
      quickMaxRounds: 3,
      fullMaxRounds: 1,
      autoMergeApproved: false,
    },
    models: {
      orchestrator: 'fixture/coder',
      coder: 'fixture/coder',
      coderThinking: 'medium',
      reviewer: 'fixture/reviewer',
      reviewerThinking: 'high',
    },
  });
}

function initialRun(root, issueNumber) {
  return saveRun(root, issueNumber, {
    issueNumber,
    status: 'agent-running',
    phase: 'reviewing-light',
    attempt: 1,
    events: [],
    activity: [],
  });
}

test('staged and manual review evidence do not consume the legacy full-review cap', (t) => {
  const root = repository(t);
  configure(root);
  initialRun(root, 7);

  for (let round = 1; round <= 3; round += 1) {
    assert.doesNotThrow(() => recordEvent(root, 7, {
      event: 'review',
      result: round === 3 ? 'APPROVED' : 'CHANGES_REQUIRED',
      commit: `abcdef${round}234567890`,
      details: `Light review round ${round}.`,
      source: 'harness-review-compat',
    }));
  }
  assert.doesNotThrow(() => recordEvent(root, 7, {
    event: 'review',
    result: 'APPROVED',
    commit: 'fedcba1234567890',
    details: 'Manual review approved the exact head.',
    source: 'manual-review',
  }));
  assert.equal(loadRun(root, 7).events.filter((event) => event.event === 'review').length, 4);
});

test('legacy review events retain the configured full-review cap', (t) => {
  const root = repository(t);
  configure(root);
  initialRun(root, 8);

  recordEvent(root, 8, {
    event: 'review',
    result: 'CHANGES_REQUIRED',
    commit: 'abcdef1234567890',
    details: 'Legacy review round one.',
  });
  assert.throws(() => recordEvent(root, 8, {
    event: 'review',
    result: 'APPROVED',
    commit: 'fedcba1234567890',
    details: 'Legacy review round two.',
  }), /Maximum review rounds \(1\) reached/);
});