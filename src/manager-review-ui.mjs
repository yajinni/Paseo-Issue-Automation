import { managerHtml as concurrencyManagerHtml } from './manager-concurrency-ui.mjs';

const REVIEW_BUTTONS = `        <button class="repository-action secondary" data-action="worker/restart">Restart worker</button>
        <button class="repository-action" data-action="review-worker/start">Start PR-review worker</button>
        <button class="repository-action danger" data-action="review-worker/stop">Stop PR-review worker</button>
        <button class="repository-action secondary" data-action="review-worker/restart">Restart PR-review worker</button>`;

const REVIEW_FACTS = `    ['Capacity check error', data.worker && data.worker.capacityError],
    ['PR-review worker', data.reviewWorker && data.reviewWorker.running ? 'Running' : 'Stopped'],
    ['Last review tick', data.reviewWorker && data.reviewWorker.lastReviewTickAt],
    ['Last review result', data.reviewWorker && data.reviewWorker.lastReviewResult ? JSON.stringify(data.reviewWorker.lastReviewResult) : null],
    ['Review worker error', data.reviewWorker && data.reviewWorker.lastReviewError],
    ['Last reconciliation', data.reviewWorker && data.reviewWorker.lastReconciliationAt],
    ['Reconciliation error', data.reviewWorker && data.reviewWorker.lastReconciliationError],`;

export function managerHtml() {
  return concurrencyManagerHtml()
    .replace(
      `        <button class="repository-action secondary" data-action="worker/restart">Restart worker</button>`,
      REVIEW_BUTTONS,
    )
    .replace(
      `    ['Capacity check error', data.worker && data.worker.capacityError],`,
      REVIEW_FACTS,
    )
    .replace(
      'Manager-wide fair coding capacity is enforced. PR-review workers and installation actions remain separate stages.',
      'Manager-wide fair coding capacity is enforced. PR-review schedulers are repository-scoped and share the existing machine-global serial browser lease. Installation remains separate.',
    )
    .replace(
      'Manager-wide fair coding capacity is enforced. PR-review workers and installation remain separate.',
      'Manager-wide fair coding capacity and repository PR-review schedulers are available. Installation remains separate.',
    );
}
