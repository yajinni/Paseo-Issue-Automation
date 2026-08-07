import assert from 'node:assert/strict';
import test from 'node:test';
import { managerWorkQueueItem } from '../src/manager-work-queue.mjs';

test('work queue prefers durable lifecycle records and exposes structured evidence', () => {
  const item = managerWorkQueueItem({
    issueNumber: 274,
    issueTitle: 'Reconcile accepted OpenSpec and rewrite status',
    phase: 'updating-from-base',
    activity: [{ type: 'legacy-activity', at: '2026-08-07T23:00:00.000Z', details: 'legacy' }],
    lifecycle: [{
      id: 'evt-1',
      at: '2026-08-07T23:30:00.000Z',
      issueNumber: 274,
      attempt: 4,
      type: 'base-update-required',
      status: 'success',
      source: 'activity',
      message: 'The issue branch does not contain the latest rewrite/openspec-baseline.',
      evidence: {
        baseSha: '5074d15',
        headSha: 'ad06351',
        mergeBase: '5074d15',
        baseIsAncestor: true,
        behind: 0,
        ahead: 1,
      },
    }],
  });

  assert.equal(item.timeline.length, 1);
  assert.equal(item.timeline[0].type, 'base-update-required');
  assert.equal(item.timeline[0].attempt, 4);
  assert.equal(item.timeline[0].evidence.baseIsAncestor, true);
  assert.match(item.timeline[0].detail, /baseSha=5074d15/);
  assert.match(item.timeline[0].detail, /behind=0/);
  assert.deepEqual(item.lifecycle, item.lifecycle);
});
