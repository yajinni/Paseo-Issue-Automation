import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { queueCodingIssueRestart } from '../src/manager-restart.mjs';

test('manager restart records a recover-first queued state and detaches slow restart work', () => {
  const writes = [];
  const spawns = [];
  let unrefCalled = false;
  const state = {
    issueNumber: 274,
    issueTitle: 'Reconcile accepted OpenSpec and rewrite status',
    status: 'paseo:failed',
    phase: 'failed',
    reason: 'Completion evidence was missing.',
    workspaceId: 'ws-old',
    attempt: 2,
    activity: [],
  };
  const result = queueCodingIssueRestart('/repo', 274, {
    branchAction: 'keep',
    readRun: () => state,
    writeRun: (_root, _number, next) => { writes.push(next); return next; },
    executable: '/node',
    restartWorkerPath: '/restart-worker.mjs',
    spawnFn: (command, args, options) => {
      spawns.push({ command, args, options });
      return { pid: 1234, unref() { unrefCalled = true; } };
    },
  });

  assert.equal(result.queued, true);
  assert.equal(result.phase, 'queued');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].phase, 'queued');
  assert.equal(writes[0].restartPending, true);
  assert.equal(writes[0].restartPreviousPhase, 'failed');
  assert.equal(writes[0].restartPreviousReason, 'Completion evidence was missing.');
  assert.match(writes[0].reason, /verified existing managed PR\/controller/i);
  assert.match(result.message, /first resume a verified existing managed PR\/controller/i);
  assert.match(result.message, /failed-attempt recovery/i);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, '/node');
  assert.deepEqual(spawns[0].args, ['/restart-worker.mjs', path.resolve('/repo'), '274', 'keep']);
  assert.equal(spawns[0].options.detached, true);
  assert.equal(spawns[0].options.stdio, 'ignore');
  assert.equal(unrefCalled, true);
});

test('duplicate restart clicks are idempotent while a background restart is pending', () => {
  let spawned = false;
  const result = queueCodingIssueRestart('/repo', 274, {
    readRun: () => ({ issueNumber: 274, phase: 'starting-agent', restartPending: true }),
    writeRun: () => { throw new Error('should not rewrite an already queued restart'); },
    spawnFn: () => { spawned = true; return { pid: 1 }; },
  });
  assert.equal(result.queued, true);
  assert.equal(result.alreadyQueued, true);
  assert.equal(spawned, false);
});

test('manager restart can explicitly queue a same-PR human-review refresh', () => {
  const writes = [];
  const spawns = [];
  const state = {
    issueNumber: 239,
    status: 'human-review',
    phase: 'human-review',
    reason: 'Automatic merge is disabled.',
    activity: [],
  };
  const result = queueCodingIssueRestart('/repo', 239, {
    branchAction: 'keep',
    refreshExistingPr: true,
    readRun: () => state,
    writeRun: (_root, _number, next) => { writes.push(next); return next; },
    executable: '/node',
    restartWorkerPath: '/restart-worker.mjs',
    spawnFn: (command, args, options) => {
      spawns.push({ command, args, options });
      return { pid: 1234, unref() {} };
    },
  });

  assert.equal(result.queued, true);
  assert.equal(writes[0].restartPreviousPhase, 'human-review');
  assert.match(writes[0].reason, /existing human-review PR refresh/i);
  assert.deepEqual(spawns[0].args, ['/restart-worker.mjs', path.resolve('/repo'), '239', 'keep', 'refresh']);
});

test('restart queue failure restores a visible failed state', () => {
  const writes = [];
  const state = { issueNumber: 274, status: 'paseo:failed', phase: 'failed', activity: [] };
  assert.throws(() => queueCodingIssueRestart('/repo', 274, {
    readRun: () => state,
    writeRun: (_root, _number, next) => { writes.push(next); return next; },
    spawnFn: () => { throw new Error('spawn unavailable'); },
  }), /spawn unavailable/);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].phase, 'failed');
  assert.equal(writes[1].restartPending, false);
  assert.match(writes[1].reason, /Restart could not be queued/);
});
