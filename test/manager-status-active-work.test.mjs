import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { managerRepositoryStatus } from '../src/manager-status.mjs';
import {
  appendIssueLifecycle,
  loadConfig,
  loadRuntime,
  saveConfig,
  saveRuntime,
} from '../src/state.mjs';

function createRepository(parent, name) {
  const root = path.join(parent, name);
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:yajinni/${name}.git`], { cwd: root });
  return root;
}

test('lifecycle-only skipped history is visible without inflating manager active counts', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'paseo-manager-active-work-'));
  const root = createRepository(parent, 'LifecycleOnly');
  const config = loadConfig(root);
  saveConfig(root, { ...config, setupComplete: true, baseBranch: 'main' });
  saveRuntime(root, { ...loadRuntime(root), skippedIssueNumbers: [294] });
  appendIssueLifecycle(root, 294, {
    at: '2026-08-13T02:15:57.309Z',
    type: 'operator-action',
    source: 'operator',
    status: 'success',
    message: 'Skip issue completed.',
    evidence: { action: 'skip-issue' },
  });

  const status = managerRepositoryStatus({
    id: 'lifecycle-only',
    path: root,
    repository: 'yajinni/LifecycleOnly',
  });

  assert.equal(status.automation.activeRunCount, 0);
  assert.equal(status.workQueue.active, 0);
  assert.deepEqual(status.automation.skippedIssueNumbers, [294]);
  assert.equal(status.workQueue.items.length, 1);
  assert.equal(status.workQueue.items[0].stage, 'unknown');
  assert.equal(status.workQueue.items[0].active, false);
  assert.equal(status.workQueue.items[0].timeline[0].type, 'operator-action');
});
