import assert from 'node:assert/strict';
import test from 'node:test';
import { managerIssueProcessingAction } from '../src/manager-issue-processing.mjs';

const repository = { id: 'repo-1', path: '/repo', repository: 'yajinni/Example' };

test('start issue processing enables claims and ensures the automatic coding worker is available', () => {
  const calls = [];
  const result = managerIssueProcessingAction({
    root: '/repo', repository, pathname: '/api/issue-processing/start',
    workerManager: {
      refresh(value) { calls.push(['worker-refresh', value.id]); return { running: true, state: 'idle' }; },
    },
    actionHandler(root, pathname) { calls.push(['action', root, pathname]); return { claimsEnabled: pathname === '/api/resume' }; },
  });
  assert.equal(result.state, 'running');
  assert.equal(result.claimsEnabled, true);
  assert.equal(result.worker.state, 'idle');
  assert.deepEqual(calls, [
    ['action', '/repo', '/api/resume'],
    ['worker-refresh', 'repo-1'],
  ]);
});

test('pause issue processing pauses claims but leaves the coding worker available', () => {
  const calls = [];
  const result = managerIssueProcessingAction({
    root: '/repo', repository, pathname: '/api/issue-processing/pause',
    workerManager: {
      status(id) { calls.push(['worker-status', id]); return { running: true, state: 'idle' }; },
      stop() { throw new Error('pause must not stop the coding worker'); },
    },
    actionHandler(root, pathname) { calls.push(['action', root, pathname]); return { claimsEnabled: false }; },
  });
  assert.equal(result.state, 'paused');
  assert.equal(result.claimsEnabled, false);
  assert.equal(result.worker.running, true);
  assert.equal(result.worker.state, 'idle');
  assert.deepEqual(calls, [
    ['action', '/repo', '/api/pause'],
    ['worker-status', 'repo-1'],
  ]);
});

test('failed worker availability check rolls claims back to paused', () => {
  const calls = [];
  assert.throws(() => managerIssueProcessingAction({
    root: '/repo', repository, pathname: '/api/issue-processing/start',
    workerManager: { refresh() { throw new Error('worker failed'); } },
    actionHandler(_root, pathname) { calls.push(pathname); return {}; },
  }), /worker failed/);
  assert.deepEqual(calls, ['/api/resume', '/api/pause']);
});

test('unrelated routes are ignored', () => {
  assert.equal(managerIssueProcessingAction({ pathname: '/api/run-now' }), null);
});
