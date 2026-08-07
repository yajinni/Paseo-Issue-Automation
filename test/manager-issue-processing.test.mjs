import assert from 'node:assert/strict';
import test from 'node:test';
import { managerIssueProcessingAction } from '../src/manager-issue-processing.mjs';

const repository = { id: 'repo-1', path: '/repo', repository: 'yajinni/Example' };

test('start issue processing enables claims and starts the repository worker as one action', () => {
  const calls = [];
  const result = managerIssueProcessingAction({
    root: '/repo', repository, pathname: '/api/issue-processing/start',
    workerManager: {
      start(value) { calls.push(['worker-start', value.id]); return { running: true }; },
    },
    actionHandler(root, pathname) { calls.push(['action', root, pathname]); return { claimsEnabled: pathname === '/api/resume' }; },
  });
  assert.equal(result.state, 'running');
  assert.equal(result.claimsEnabled, true);
  assert.deepEqual(calls, [
    ['action', '/repo', '/api/resume'],
    ['worker-start', 'repo-1'],
  ]);
});

test('pause issue processing pauses claims and stops the repository worker as one action', () => {
  const calls = [];
  const result = managerIssueProcessingAction({
    root: '/repo', repository, pathname: '/api/issue-processing/pause',
    workerManager: {
      stop(id) { calls.push(['worker-stop', id]); return { running: false }; },
    },
    actionHandler(root, pathname) { calls.push(['action', root, pathname]); return { claimsEnabled: false }; },
  });
  assert.equal(result.state, 'paused');
  assert.equal(result.claimsEnabled, false);
  assert.deepEqual(calls, [
    ['action', '/repo', '/api/pause'],
    ['worker-stop', 'repo-1'],
  ]);
});

test('failed worker start rolls claims back to paused', () => {
  const calls = [];
  assert.throws(() => managerIssueProcessingAction({
    root: '/repo', repository, pathname: '/api/issue-processing/start',
    workerManager: { start() { throw new Error('worker failed'); } },
    actionHandler(_root, pathname) { calls.push(pathname); return {}; },
  }), /worker failed/);
  assert.deepEqual(calls, ['/api/resume', '/api/pause']);
});

test('unrelated routes are ignored', () => {
  assert.equal(managerIssueProcessingAction({ pathname: '/api/run-now' }), null);
});
