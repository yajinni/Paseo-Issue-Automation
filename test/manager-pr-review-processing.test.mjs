import assert from 'node:assert/strict';
import test from 'node:test';
import { managerPrReviewProcessingAction } from '../src/manager-pr-review-processing.mjs';

const repository = { id: 'repo-1', path: '/repo', repository: 'yajinni/Example' };

test('PR Review Start persists the desired state before starting the worker', () => {
  const calls = [];
  const result = managerPrReviewProcessingAction({
    root: '/repo', repository, pathname: '/api/pr-review/resume',
    reviewWorkerManager: { start(value) { calls.push(['start', value.id]); return { running: true }; } },
    actionHandler(root, pathname) { calls.push(['action', root, pathname]); return { reviewQueue: { paused: false } }; },
  });
  assert.equal(result.state, 'running');
  assert.deepEqual(calls, [['action', '/repo', '/api/pr-review/resume'], ['start', 'repo-1']]);
});

test('PR Review Stop persists stopped and stops only the review worker', () => {
  const calls = [];
  const result = managerPrReviewProcessingAction({
    root: '/repo', repository, pathname: '/api/pr-review/pause',
    reviewWorkerManager: { stop(id) { calls.push(['stop', id]); return { running: false }; } },
    actionHandler(root, pathname) { calls.push(['action', root, pathname]); return { reviewQueue: { paused: true } }; },
  });
  assert.equal(result.state, 'stopped');
  assert.deepEqual(calls, [['action', '/repo', '/api/pr-review/pause'], ['stop', 'repo-1']]);
});

test('PR Review Start rolls desired state back when worker startup fails', () => {
  const calls = [];
  assert.throws(() => managerPrReviewProcessingAction({
    root: '/repo', repository, pathname: '/api/pr-review/resume',
    reviewWorkerManager: { start() { throw new Error('worker failed'); } },
    actionHandler(_root, pathname) { calls.push(pathname); return {}; },
  }), /worker failed/);
  assert.deepEqual(calls, ['/api/pr-review/resume', '/api/pr-review/pause']);
});
