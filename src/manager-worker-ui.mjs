import { managerHtml as baseManagerHtml } from './manager-ui.mjs';

const WORKER_BUTTONS = `      <div class="actions">
        <button class="repository-action" data-action="resume">Resume claims</button>`;

const WORKER_FACTS = `    ['Coding worker', data.worker && data.worker.state === 'active' ? 'Active' : 'Idle'],`;

export function managerHtml() {
  return baseManagerHtml()
    .replace(
      `      <div class="actions">
        <button class="repository-action" data-action="resume">Resume claims</button>`,
      WORKER_BUTTONS,
    )
    .replace(
      `    ['Background worker', data.capabilities.backgroundWorkers ? 'Running' : 'Not managed yet'],`,
      WORKER_FACTS,
    )
    .replace(
      'These actions use only the selected repository root. They do not start a permanent manager worker.',
      'Issue claims control whether new work is selected. The coding worker remains automatically available in the background.',
    )
    .replace(
      'Actions are scoped to the selected repository. Background workers and installation actions are not enabled in this stage.',
      'Actions and coding workers are scoped to the selected repository. PR-review workers, global concurrency, and installation actions are separate stages.',
    )
    .replace(
      'All controls on this page are scoped to the selected repository. Background workers and installation actions remain separate follow-up stages.',
      'All controls and coding-worker timers on this page are scoped to the selected repository. PR-review workers, global concurrency, and installation remain separate.',
    );
}
