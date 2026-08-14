import { managerHtml as concurrencyManagerHtml } from './manager-concurrency-ui.mjs';

const REVIEW_BUTTONS = '';

const REVIEW_FACTS = `    ['Coding worker', data.worker && data.worker.state === 'active' ? 'Active' : 'Idle'],
    ['PR-review worker', data.reviewWorker && data.reviewWorker.running ? 'Running' : 'Stopped'],
    ['Last review tick', data.reviewWorker && data.reviewWorker.lastReviewTickAt],
    ['Last review result', data.reviewWorker && data.reviewWorker.lastReviewResult ? JSON.stringify(data.reviewWorker.lastReviewResult) : null],
    ['Review worker error', data.reviewWorker && data.reviewWorker.lastReviewError],
    ['Last reconciliation', data.reviewWorker && data.reviewWorker.lastReconciliationAt],
    ['Reconciliation error', data.reviewWorker && data.reviewWorker.lastReconciliationError],`;

const LIGHTWEIGHT_ACTION_STATUS_SCRIPT = `<script>
(function managerLightweightActionStatusSync() {
   const lightweightActions = new Set(['restart-issue', 'review-worker/restart']);
  const configForm = document.getElementById('config-form');
  const repositorySelect = document.getElementById('repository-select');
  let configDraftRepositoryId = null;
  let configDraftValues = null;
  let configDraftVersion = 0;
  let restoringConfigDraft = false;
  let configSaveInFlight = false;
  let configSaveRevision = 0;

  function configFields() {
    return [...(configForm?.querySelectorAll('input,select') || [])]
      .filter((element) => element.id && element.dataset.managerTransient !== 'true');
  }

  function snapshotConfigFields() {
    return configFields().map((element) => ({
      id: element.id,
      checked: element.type === 'checkbox' ? element.checked : undefined,
      value: element.type === 'checkbox' ? undefined : element.value,
    }));
  }

  function captureConfigDraft() {
    if (!configForm || !configDraftRepositoryId || configDraftRepositoryId !== repositorySelect?.value || !configDraftValues) return null;
    return configDraftValues.map((saved) => ({ ...saved }));
  }

  function restoreConfigDraft(draft) {
    if (!draft?.length || configDraftRepositoryId !== repositorySelect?.value) return;
    restoringConfigDraft = true;
    try {
      for (const saved of draft) {
        const element = document.getElementById(saved.id);
        if (!element) continue;
        if (element.type === 'checkbox') element.checked = saved.checked === true;
        else element.value = saved.value == null ? '' : String(saved.value);
      }
      if (typeof window.syncAutoMergeAvailability === 'function') window.syncAutoMergeAvailability();
      const workflow = document.getElementById('review-workflow');
      workflow?.dispatchEvent(new Event('change', { bubbles: true }));
      configForm?.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      restoringConfigDraft = false;
    }
  }

  function noteConfigDraft(event) {
    if (restoringConfigDraft) return;
    const field = event.target;
    if (!field?.matches?.('input,select') || !field.id || field.dataset.managerTransient === 'true') return;
    configDraftRepositoryId = repositorySelect?.value || null;
    configDraftValues = snapshotConfigFields();
    configDraftVersion += 1;
  }

  function clearConfigDraft() {
    configDraftRepositoryId = null;
    configDraftValues = null;
    configDraftVersion = 0;
  }

  configForm?.addEventListener('input', noteConfigDraft);
  configForm?.addEventListener('change', noteConfigDraft);
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#manager-config-discard')) clearConfigDraft();
  }, true);

  const previousLoadStatus = window.loadStatus;
  if (typeof previousLoadStatus === 'function') {
    window.loadStatus = async function managerDraftPreservingLoadStatus(...args) {
      const repositoryId = repositorySelect?.value || null;
      let observedSaveRevision = configSaveRevision;
      let result = await previousLoadStatus(...args);
      let currentRepositoryId = repositorySelect?.value || null;
      while (currentRepositoryId === repositoryId && configSaveRevision !== observedSaveRevision) {
        observedSaveRevision = configSaveRevision;
        result = await previousLoadStatus(...args);
        currentRepositoryId = repositorySelect?.value || null;
      }
      if (currentRepositoryId === repositoryId && configDraftRepositoryId === repositoryId) {
        restoreConfigDraft(captureConfigDraft());
      } else if (configDraftRepositoryId && configDraftRepositoryId !== currentRepositoryId) {
        clearConfigDraft();
      }
      return result;
    };
  }

  const previousPostRepositoryAction = window.postRepositoryAction;
  if (typeof previousPostRepositoryAction !== 'function') return;
  window.postRepositoryAction = async function managerLightweightActionPostRepositoryAction(action, payload) {
    const repositoryId = repositorySelect?.value || null;
    const configDraftVersionAtStart = configDraftVersion;
    const configSave = action === 'config';
    if (configSave && configSaveInFlight) throw new Error('Configuration save is already in progress.');
    if (configSave) configSaveInFlight = true;
    let body;
    try {
      body = await previousPostRepositoryAction(action, payload);
    } finally {
      if (configSave) configSaveInFlight = false;
    }
    if (configSave) {
      configSaveRevision += 1;
      const currentRepositoryId = repositorySelect?.value || null;
      const hasNewerDraft = currentRepositoryId === repositoryId
        && configDraftRepositoryId === repositoryId
        && configDraftVersion > configDraftVersionAtStart;
      if (hasNewerDraft) restoreConfigDraft(captureConfigDraft());
      else if (configDraftRepositoryId === repositoryId) clearConfigDraft();
    } else if (repositorySelect?.value === repositoryId && configDraftRepositoryId === repositoryId) {
      restoreConfigDraft(captureConfigDraft());
    }
    if (lightweightActions.has(action) && !body?.status && typeof window.loadStatus === 'function') {
      queueMicrotask(() => window.loadStatus().catch((error) => {
        if (typeof window.showError === 'function') window.showError(error);
        else console.error(error);
      }));
    }
    return body;
  };
})();
</script>`;

export function managerHtml() {
  return concurrencyManagerHtml()
    .replace(
      `        <button class="repository-action secondary" data-action="reconcile">Reconcile dependencies</button>`,
      `        <button class="repository-action secondary" data-action="reconcile">Reconcile dependencies</button>\n${REVIEW_BUTTONS}`,
    )
    .replace(
      `    ['Coding worker', data.worker && data.worker.state === 'active' ? 'Active' : 'Idle'],`,
      REVIEW_FACTS,
    )
    .replace(
      'Manager-wide fair coding capacity is enforced. PR-review workers and installation actions remain separate stages.',
      'Manager-wide fair coding capacity is enforced. PR-review schedulers are repository-scoped and share the existing machine-global serial browser lease. Installation remains separate.',
    )
    .replace(
      'Manager-wide fair coding capacity is enforced. PR-review workers and installation remain separate.',
      'Manager-wide fair coding capacity and repository PR-review schedulers are available. Installation remains separate.',
    )
    .replace('</body>', `${LIGHTWEIGHT_ACTION_STATUS_SCRIPT}\n</body>`);
}
