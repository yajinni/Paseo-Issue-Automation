import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeTemporaryFailureRetries } from '../src/issue-retry.mjs';

test('temporary failures resume on a later scheduler turn in issue-number order', () => {
  const runs = new Map([
    [12, {
      issueNumber: 12,
      phase: 'retry-pending',
      branch: 'ai/issue-12',
      attempt: 1,
      temporaryFailureCount: 2,
      activity: [],
    }],
    [7, {
      issueNumber: 7,
      phase: 'retry-pending',
      branch: 'ai/issue-7',
      attempt: 1,
      temporaryFailureCount: 1,
      activity: [],
    }],
    [3, { issueNumber: 3, phase: 'coding', activity: [] }],
  ]);
  const started = [];
  let pid = 500;
  const result = resumeTemporaryFailureRetries('/repo', {
    runLister: () => [...runs.values()],
    runLoader: (_root, number) => runs.get(Number(number)),
    runSaver: (_root, number, state) => {
      runs.set(Number(number), state);
      return state;
    },
    startWorker: (_root, number) => {
      started.push(Number(number));
      pid += 1;
      return pid;
    },
  });

  assert.equal(result.claimed, true);
  assert.deepEqual(started, [7, 12]);
  assert.equal(runs.get(7).phase, 'retrying-temporary-failure');
  assert.equal(runs.get(12).phase, 'retrying-temporary-failure');
  assert.equal(runs.get(7).controllerPid, 501);
  assert.equal(runs.get(12).controllerPid, 502);
  assert.match(runs.get(7).activity.at(-1).details, /Retry 1 started on a later scheduler turn/);
  assert.equal(runs.get(3).phase, 'coding');
});

test('temporary retry resume is a no-op when no retry is pending', () => {
  const result = resumeTemporaryFailureRetries('/repo', {
    runLister: () => [{ issueNumber: 9, phase: 'failed' }],
    startWorker: () => { throw new Error('should not start'); },
  });
  assert.deepEqual(result, { claimed: false, attempts: [], results: [] });
});
