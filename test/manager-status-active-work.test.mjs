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
  saveRun,
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

test('removed-run lifecycle phase evidence remains historical and inactive', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'paseo-manager-historical-phase-'));
  const root = createRepository(parent, 'HistoricalPhase');
  const config = loadConfig(root);
  saveConfig(root, { ...config, setupComplete: true, baseBranch: 'main' });
  appendIssueLifecycle(root, 303, {
    at: '2026-08-13T02:16:57.309Z',
    type: 'state-transition',
    source: 'state',
    status: 'success',
    message: 'Historical coding phase recorded.',
    evidence: { phase: 'coding' },
  });

  const status = managerRepositoryStatus({
    id: 'historical-phase',
    path: root,
    repository: 'yajinni/HistoricalPhase',
  });

  assert.equal(status.automation.activeRunCount, 0);
  assert.equal(status.workQueue.active, 0);
  assert.equal(status.workQueue.items.length, 1);
  assert.equal(status.workQueue.items[0].phase, null);
  assert.equal(status.workQueue.items[0].active, false);
  assert.equal(status.workQueue.items[0].timeline[0].evidence.phase, 'coding');
});

test('stale historical controller PIDs remain visible without inflating active counts', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'paseo-manager-stale-pids-'));
  const root = createRepository(parent, 'StalePids');
  const config = loadConfig(root);
  saveConfig(root, { ...config, setupComplete: true, baseBranch: 'main' });
  saveRuntime(root, { ...loadRuntime(root), skippedIssueNumbers: [294] });
  for (const [issueNumber, controllerPid] of [[239, 54748], [275, 52884], [276, 81552]]) {
    saveRun(root, issueNumber, {
      issueNumber,
      issueTitle: `Historical issue #${issueNumber}`,
      status: 'completed',
      phase: 'completed',
      attempt: 1,
      controllerPid,
      completedAt: '2026-08-13T03:00:00.000Z',
    });
  }
  appendIssueLifecycle(root, 294, {
    at: '2026-08-13T02:15:57.309Z',
    type: 'operator-action',
    source: 'operator',
    status: 'success',
    message: 'Skip issue completed.',
    evidence: { action: 'skip-issue' },
  });

  const status = managerRepositoryStatus({ id: 'stale-pids', path: root, repository: 'yajinni/StalePids' }, {
    controllerLiveness: () => false,
  });

  assert.equal(status.automation.activeRunCount, 0);
  assert.equal(status.workQueue.active, 0);
  assert.deepEqual(status.workQueue.items.filter((item) => [239, 275, 276].includes(item.issueNumber))
    .map((item) => item.diagnostics.controllerPid).sort((a, b) => a - b), [52884, 54748, 81552]);
  assert.equal(status.workQueue.items.find((item) => item.issueNumber === 294)?.active, false);
});

test('verified controller ownership drives both active count projections', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'paseo-manager-live-controller-'));
  const root = createRepository(parent, 'LiveController');
  const config = loadConfig(root);
  saveConfig(root, { ...config, setupComplete: true, baseBranch: 'main' });
  saveRun(root, 239, {
    issueNumber: 239,
    issueTitle: 'Live controller',
    status: 'completed',
    phase: 'completed',
    attempt: 2,
    controllerPid: 54748,
    completedAt: '2026-08-13T03:00:00.000Z',
  });

  const status = managerRepositoryStatus({ id: 'live-controller', path: root, repository: 'yajinni/LiveController' }, {
    controllerLiveness: (_root, run) => run.issueNumber === 239 && run.attempt === 2,
  });

  assert.equal(status.automation.activeRunCount, 1);
  assert.equal(status.workQueue.active, 1);
  assert.equal(status.workQueue.items[0].controllerLive, true);
});
