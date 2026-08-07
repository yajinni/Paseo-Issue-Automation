import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentLabelForLegacy,
  LEGACY_LABELS,
  LIFECYCLE_LABEL_CATALOG,
  PASEO_LABELS,
  PR_REVIEW_LABELS,
} from '../src/label-catalog.mjs';
import { LABELS } from '../src/state.mjs';

test('lifecycle catalog defines the approved Paseo labels with no blocked or completion label', () => {
  assert.deepEqual(Object.values(PASEO_LABELS), [
    'paseo:ready',
    'paseo:queued',
    'paseo:coding',
    'paseo:review-queued',
    'paseo:reviewing',
    'paseo:changes-requested',
    'paseo:fixing',
    'paseo:review-failed',
    'paseo:failed',
    'paseo:needs-attention',
  ]);
  assert.equal(Object.values(PASEO_LABELS).includes('paseo:blocked'), false);
  assert.equal(Object.values(PASEO_LABELS).some((name) => name.includes('complete')), false);
  for (const name of Object.values(PASEO_LABELS)) {
    assert.equal(LIFECYCLE_LABEL_CATALOG[name].name, name);
    assert.match(LIFECYCLE_LABEL_CATALOG[name].color, /^[0-9a-f]{6}$/);
    assert.ok(LIFECYCLE_LABEL_CATALOG[name].description.length > 0);
    assert.equal(LIFECYCLE_LABEL_CATALOG[name].managedBy, 'paseo-issue-automation');
  }
});

test('review labels remain stable and are sourced from the lifecycle catalog', () => {
  assert.deepEqual(PR_REVIEW_LABELS, {
    queued: 'paseo:review-queued',
    reviewing: 'paseo:reviewing',
    changesRequested: 'paseo:changes-requested',
    fixing: 'paseo:fixing',
    failed: 'paseo:review-failed',
  });
});

test('legacy label compatibility distinguishes old runtime states without inventing blocked lifecycle state', () => {
  assert.equal(currentLabelForLegacy('agent-ready'), 'paseo:ready');
  assert.equal(currentLabelForLegacy('agent-running'), 'paseo:coding');
  assert.equal(currentLabelForLegacy('agent-blocked'), 'paseo:needs-attention');
  assert.equal(currentLabelForLegacy('agent-failed'), 'paseo:failed');
  assert.equal(currentLabelForLegacy('human-review'), 'paseo:review-queued');
  assert.equal(currentLabelForLegacy('custom-label'), null);
  assert.equal(LABELS, LEGACY_LABELS);
});
