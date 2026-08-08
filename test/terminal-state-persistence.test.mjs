import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { terminalState } from '../src/automation.mjs';
import { LABELS, loadRun, saveConfig, saveRun } from '../src/state.mjs';

function executable(file, content) {
  writeFileSync(file, content, { encoding: 'utf8', mode: 0o755 });
  chmodSync(file, 0o755);
}

test('terminal failure persists locally even when GitHub notifications fail', (t) => {
  if (process.platform === 'win32') return t.skip('fixture uses a Unix executable shim');

  const fixture = mkdtempSync(path.join(os.tmpdir(), 'paseo-terminal-state-'));
  const root = path.join(fixture, 'repo');
  const bin = path.join(fixture, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  executable(path.join(bin, 'gh'), `#!/usr/bin/env node\nprocess.stderr.write('simulated GitHub notification outage');\nprocess.exit(23);\n`);

  saveConfig(root, {
    version: 3,
    setupComplete: true,
    baseBranch: 'main',
    maxActive: 1,
    issueSelection: { mode: 'recommended-labels', excludedLabels: [], temporaryFailureRetries: 0 },
    review: { workflow: 'full-immediate', quickMaxRounds: 2, fullMaxRounds: 2, autoMergeApproved: false },
    models: { orchestrator: 'fixture/coder', coder: 'fixture/coder', reviewer: 'fixture/reviewer' },
  });
  saveRun(root, 404, {
    issueNumber: 404,
    attempt: 2,
    status: LABELS.running,
    phase: 'coding',
    controllerPid: 98765,
    completedAt: null,
    activity: [],
    events: [],
  });

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    assert.doesNotThrow(() => terminalState(root, 404, 'failed', 'validation failed after coder exit'));
  } finally {
    process.env.PATH = previousPath;
  }

  const state = loadRun(root, 404);
  assert.equal(state.status, LABELS.failed);
  assert.equal(state.phase, 'failed');
  assert.equal(state.reason, 'validation failed after coder exit');
  assert.equal(state.controllerPid, null);
  assert.ok(state.completedAt, 'terminal state must record completion even when GitHub is unavailable');
});
