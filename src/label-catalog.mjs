export const PASEO_LABELS = Object.freeze({
  ready: 'paseo:ready',
  queued: 'paseo:queued',
  coding: 'paseo:coding',
  reviewQueued: 'paseo:review-queued',
  reviewing: 'paseo:reviewing',
  changesRequested: 'paseo:changes-requested',
  fixing: 'paseo:fixing',
  reviewFailed: 'paseo:review-failed',
  failed: 'paseo:failed',
  needsAttention: 'paseo:needs-attention',
});

export const PR_REVIEW_LABELS = Object.freeze({
  queued: PASEO_LABELS.reviewQueued,
  reviewing: PASEO_LABELS.reviewing,
  changesRequested: PASEO_LABELS.changesRequested,
  fixing: PASEO_LABELS.fixing,
  failed: PASEO_LABELS.reviewFailed,
});

export const LEGACY_LABELS = Object.freeze({
  ready: 'agent-ready',
  running: 'agent-running',
  blocked: 'agent-blocked',
  failed: 'agent-failed',
  humanReview: 'human-review',
});

export const LEGACY_LABEL_COMPATIBILITY = Object.freeze({
  [LEGACY_LABELS.ready]: PASEO_LABELS.ready,
  [LEGACY_LABELS.running]: PASEO_LABELS.coding,
  [LEGACY_LABELS.blocked]: PASEO_LABELS.needsAttention,
  [LEGACY_LABELS.failed]: PASEO_LABELS.failed,
  [LEGACY_LABELS.humanReview]: PASEO_LABELS.reviewQueued,
});

const catalog = [
  [PASEO_LABELS.ready, '0e8a16', 'Ready for Paseo issue automation.'],
  [PASEO_LABELS.queued, '1d76db', 'Eligible and queued for coding capacity.'],
  [PASEO_LABELS.coding, '5319e7', 'Currently being implemented by Paseo.'],
  [PASEO_LABELS.reviewQueued, 'fbca04', 'Implementation is queued for automated review.'],
  [PASEO_LABELS.reviewing, 'd4c5f9', 'Implementation is undergoing automated review.'],
  [PASEO_LABELS.changesRequested, 'f9d0c4', 'Automated review requested changes.'],
  [PASEO_LABELS.fixing, 'c5def5', 'Requested review changes are being fixed.'],
  [PASEO_LABELS.reviewFailed, 'b60205', 'Automated review could not complete successfully.'],
  [PASEO_LABELS.failed, 'd73a4a', 'Coding automation failed and requires recovery.'],
  [PASEO_LABELS.needsAttention, 'e99695', 'Human attention is required before automation can continue.'],
];

export const LIFECYCLE_LABEL_CATALOG = Object.freeze(Object.fromEntries(
  catalog.map(([name, color, description]) => [name, Object.freeze({
    name,
    color,
    description,
    managedBy: 'paseo-issue-automation',
  })]),
));

export function lifecycleLabel(name) {
  return LIFECYCLE_LABEL_CATALOG[String(name || '').trim()] || null;
}

export function currentLabelForLegacy(name) {
  return LEGACY_LABEL_COMPATIBILITY[String(name || '').trim()] || null;
}

export function isManagedLifecycleLabel(name) {
  return lifecycleLabel(name) !== null;
}
