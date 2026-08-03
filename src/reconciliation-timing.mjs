import { TERMINAL_PR_STATES } from './pr-review-store.mjs';

export function reconciliationDelay(store) {
  const active = (store.managedPullRequests || []).some((record) =>
    record.reviewState !== 'paused' && !TERMINAL_PR_STATES.has(record.reviewState));
  return active
    ? store.config.reconciliation.activeIntervalMs
    : store.config.reconciliation.idleIntervalMs;
}
