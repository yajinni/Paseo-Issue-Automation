import { managerHtml as installationManagerHtml } from './manager-install-ui.mjs';

const HEALTH_PANEL = `  <section class="card wide" id="repository-health-panel" style="margin-top:14px">
    <h2>Repository health</h2>
    <dl class="facts" id="operational-facts"><dt>Issue processing</dt><dd>Loading…</dd></dl>
    <div id="repository-blockers" class="blocker-list"></div>
  </section>
  <section class="card wide" id="repository-maintenance-panel" style="margin-top:14px">
    <h2>External integration maintenance</h2>
    <dl class="facts" id="maintenance-facts"><dt>State</dt><dd>Loading…</dd></dl>
    <div class="actions" style="margin-top:12px">
      <button id="repair-external-controller" disabled>Repair managed components</button>
      <button id="remove-external-controller" class="danger" disabled>Create removal PR</button>
      <button id="reconcile-external-removal" class="secondary" disabled>Reconcile removal PR</button>
    </div>
    <p class="muted">Repair changes only components recorded as manager-owned. Removal deletes the managed issue template through a reviewed PR, then removes manager-owned labels and the Paseo workspace only after merge and local synchronization.</p>
    <div id="removal-pr-link" class="muted"></div>
  </section>
`;

const HEALTH_SCRIPT = `<script>
function blockerDetails(details) {
  if (!details) return '';
  const values = [];
  if (Array.isArray(details.files) && details.files.length) values.push('Files: ' + details.files.join(', '));
  if (details.syncError) values.push('Sync error: ' + details.syncError);
  if (details.error) values.push('Error: ' + details.error);
  if (details.reason) values.push('Reason: ' + details.reason);
  return values.join(' · ');
}

function blockerActionElement(action) {
  if (!action) return null;
  if (action.kind === 'link') {
    const anchor = document.createElement('a');
    anchor.href = action.url;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = action.label;
    return anchor;
  }
  const button = document.createElement('button');
  button.className = 'secondary';
  button.textContent = action.label;
  button.addEventListener('click', async () => {
    try {
      if (action.kind === 'post') await postRepositoryAction(action.endpoint);
      if (action.kind === 'button') document.getElementById(action.targetId)?.click();
    } catch (error) { showError(error); }
  });
  return button;
}

function renderRepositoryHealth(data) {
  const operational = data.operational || {};
  facts('operational-facts', [
    ['Issue processing', operational.issueProcessing || 'Unknown'],
    ['PR reviews', operational.prReviews || 'Unknown'],
    ['Blocking conditions', operational.blockingCount || 0],
    ['All notices', operational.blockerCount || 0],
    ['Primary reason', operational.issueProcessingReason],
  ]);
  const target = document.getElementById('repository-blockers');
  target.textContent = '';
  const blockers = Array.isArray(data.blockers) ? data.blockers : [];
  if (!blockers.length) {
    const ready = document.createElement('div');
    ready.className = 'blocker blocker-ready';
    ready.textContent = 'No repository-specific blockers are currently reported.';
    target.append(ready);
  }
  for (const item of blockers) {
    const card = document.createElement('article');
    card.className = 'blocker blocker-' + (item.severity || 'info');
    const title = document.createElement('strong'); title.textContent = item.title || item.code;
    const message = document.createElement('div'); message.textContent = item.message || '';
    card.append(title, message);
    const details = blockerDetails(item.details);
    if (details) {
      const detail = document.createElement('div'); detail.className = 'muted'; detail.textContent = details; card.append(detail);
    }
    const action = blockerActionElement(item.action);
    if (action) {
      const actions = document.createElement('div'); actions.className = 'actions'; actions.style.marginTop = '8px'; actions.append(action); card.append(actions);
    }
    target.append(card);
  }
}

function renderExternalMaintenance(data) {
  const maintenance = data.maintenance || {};
  const removal = maintenance.removal || null;
  facts('maintenance-facts', [
    ['Last repair', maintenance.lastRepair && maintenance.lastRepair.repairedAt],
    ['Removal state', removal ? removal.state : 'Not started'],
    ['Removal sync error', removal && removal.syncError],
    ['Removal completed', removal && removal.completedAt],
  ]);
  const workersRunning = Boolean(data.worker && data.worker.running) || Boolean(data.reviewWorker && data.reviewWorker.running);
  const capabilities = data.capabilities || {};
  const repair = document.getElementById('repair-external-controller');
  repair.disabled = !capabilities.externalRepair || workersRunning;
  repair.textContent = workersRunning ? 'Stop repository workers before repair' : 'Repair managed components';
  const remove = document.getElementById('remove-external-controller');
  remove.disabled = !capabilities.externalRemoval || workersRunning;
  remove.textContent = maintenance.removalPending ? 'Removal PR is pending' : workersRunning ? 'Stop repository workers before removal' : 'Create removal PR';
  const reconcile = document.getElementById('reconcile-external-removal');
  reconcile.disabled = !capabilities.externalRemovalReconciliation || workersRunning;
  const link = document.getElementById('removal-pr-link');
  link.textContent = '';
  if (removal && removal.url) {
    const anchor = document.createElement('a');
    anchor.href = removal.url;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = 'Removal PR #' + removal.number + ': ' + removal.state;
    link.append(anchor);
  }
}

function renderMaintenanceAndHealth(data) {
  renderRepositoryHealth(data);
  renderExternalMaintenance(data);
}

document.getElementById('repair-external-controller').addEventListener('click', async () => {
  if (!confirm('Repair only the selected repository components recorded as manager-owned? Repository file changes will use the normal setup PR workflow.')) return;
  try { await postRepositoryAction('maintenance/repair'); }
  catch (error) { showError(error); }
});

document.getElementById('remove-external-controller').addEventListener('click', async () => {
  if (!confirm('Create a reviewed PR to remove the selected repository’s manager-owned issue template? Claims will remain paused until merge and cleanup complete.')) return;
  try { await postRepositoryAction('maintenance/remove'); }
  catch (error) { showError(error); }
});

document.getElementById('reconcile-external-removal').addEventListener('click', async () => {
  try { await postRepositoryAction('maintenance/reconcile'); }
  catch (error) { showError(error); }
});
</script>`;

export function managerHtml() {
  return installationManagerHtml()
    .replace(
      '</style>',
      `.blocker-list{display:grid;gap:10px;margin-top:12px}.blocker{border:1px solid #30445f;border-radius:9px;padding:11px;background:#0d1724}.blocker-error{border-color:#894351;background:#301820}.blocker-warning{border-color:#80672c;background:#2b2515}.blocker-ready{border-color:#356b4a;background:#12261a}.blocker a{color:#8ab8ff}\n</style>`,
    )
    .replace(
      `  <form class="register" id="register-form">`,
      `${HEALTH_PANEL}  <form class="register" id="register-form">`,
    )
    .replace(
      `  currentStatus = data;`,
      `  currentStatus = data;\n  renderMaintenanceAndHealth(data);`,
    )
    .replace('</body>', `${HEALTH_SCRIPT}\n</body>`);
}
