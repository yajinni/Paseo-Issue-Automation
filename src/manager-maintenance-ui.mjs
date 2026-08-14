import { managerHtml as installationManagerHtml } from './manager-install-ui.mjs';

const OVERVIEW_PANEL = `  <section class="manager-overview" aria-label="Selected repository overview">
    <div class="overview-heading">
      <div>
        <div class="overview-eyebrow">Selected repository</div>
        <strong id="overview-status-title">Loading operational status…</strong>
        <div class="muted" id="overview-status-message">Checking setup, workers, claims, and recovery state.</div>
      </div>
      <div class="overview-primary-action" id="overview-primary-action"></div>
    </div>
    <div class="overview-metrics">
      <div class="overview-metric" id="overview-issue-processing"><span>Issue processing</span><strong>Unknown</strong></div>
      <div class="overview-metric" id="overview-claims"><span>Claims</span><strong>Unknown</strong></div>
      <div class="overview-metric" id="overview-coding-worker"><span>Coding worker</span><strong>Unknown</strong></div>
      <div class="overview-metric" id="overview-review-worker"><span>PR reviews</span><strong>Unknown</strong></div>
      <div class="overview-metric" id="overview-active-work"><span>Active work</span><strong>0</strong></div>
      <div class="overview-metric" id="overview-attention"><span>Needs attention</span><strong>0</strong></div>
    </div>
  </section>
`;

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

function setOverviewMetric(id, value, state = 'neutral') {
  const metric = document.getElementById(id);
  metric.className = 'overview-metric overview-' + state;
  metric.querySelector('strong').textContent = value;
}

function renderManagerOverview(data) {
  const refresh = data.statusRefresh || {};
  const lastSuccessful = refresh.lastSuccessfulAt ? new Date(refresh.lastSuccessfulAt).toLocaleString() : null;
  const operational = data.operational || {};
  const blockers = Array.isArray(data.blockers) ? data.blockers : [];
  const primary = operational.primaryBlocker || blockers[0] || null;
  const attentionCount = blockers.filter((item) => item.severity === 'error' || item.severity === 'warning').length;
  const issueReady = operational.issueProcessing === 'ready';
  const reviewReady = operational.prReviews === 'ready';
  const claimsEnabled = data.automation?.claimsEnabled === true;
  const codingWorkerActive = data.worker?.state === 'active';
  const reviewWorkerRunning = data.reviewWorker?.running === true;

  const title = document.getElementById('overview-status-title');
  const message = document.getElementById('overview-status-message');
  if (refresh.state === 'refreshing' && !refresh.lastSuccessfulAt) {
    title.textContent = 'Refreshing repository status';
    message.textContent = 'Deep Git and GitHub probes are running in the background.';
    setOverviewMetric('overview-issue-processing', 'Refreshing', 'neutral');
    setOverviewMetric('overview-claims', 'Refreshing', 'neutral');
    setOverviewMetric('overview-coding-worker', 'Refreshing', 'neutral');
    setOverviewMetric('overview-review-worker', 'Refreshing', 'neutral');
    setOverviewMetric('overview-active-work', '--', 'neutral');
    setOverviewMetric('overview-attention', '--', 'neutral');
    return;
  }
  if (refresh.state === 'unavailable' && !refresh.lastSuccessfulAt) {
    title.textContent = 'Repository status unavailable';
    message.textContent = refresh.error || 'The background status probe failed before a successful result was recorded.';
  } else if (refresh.state === 'delayed') {
    title.textContent = 'Repository status refresh delayed';
    message.textContent = (refresh.error || 'The latest status probe failed.') + (lastSuccessful ? ' Showing the last successful status from ' + lastSuccessful + '.' : '');
  } else {
    title.textContent = issueReady
      ? attentionCount ? 'Automation is ready with items to review' : 'Automation is ready'
      : 'Automation needs attention';
    message.textContent = primary?.message || 'No repository-specific blockers are currently reported.';
  }

  setOverviewMetric('overview-issue-processing', issueReady ? 'Ready' : 'Blocked', issueReady ? 'ready' : 'blocked');
  setOverviewMetric('overview-claims', claimsEnabled ? 'Enabled' : 'Paused', claimsEnabled ? 'ready' : 'attention');
  setOverviewMetric('overview-coding-worker', codingWorkerActive ? 'Active' : 'Idle', codingWorkerActive ? 'active' : 'ready');
  setOverviewMetric('overview-review-worker', reviewReady && reviewWorkerRunning ? 'Ready' : reviewWorkerRunning ? 'Attention' : 'Stopped', reviewReady && reviewWorkerRunning ? 'ready' : 'attention');
  setOverviewMetric('overview-active-work', String(data.automation?.activeRunCount || 0), Number(data.automation?.activeRunCount || 0) > 0 ? 'active' : 'neutral');
  setOverviewMetric('overview-attention', String(attentionCount), attentionCount ? 'attention' : 'ready');

  const actionTarget = document.getElementById('overview-primary-action');
  actionTarget.textContent = '';
  const action = blockerActionElement(primary?.action);
  if (action) actionTarget.append(action);
}

function renderRepositoryHealth(data) {
  const refresh = data.statusRefresh || {};
  if (refresh.state === 'refreshing' && !refresh.lastSuccessfulAt) {
    facts('operational-facts', [
      ['Status', 'Refreshing'],
      ['Last successful status', refresh.lastSuccessfulAt],
    ]);
    const target = document.getElementById('repository-blockers');
    target.textContent = 'Deep repository probes are running in the background.';
    return;
  }
  if (refresh.state === 'unavailable' && !refresh.lastSuccessfulAt) {
    facts('operational-facts', [
      ['Status', 'Unavailable'],
      ['Error', refresh.error],
    ]);
    const target = document.getElementById('repository-blockers');
    target.textContent = refresh.error || 'The repository status probe failed.';
    return;
  }
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
  const codingActive = data.worker?.state === 'active' || Number(data.worker?.activeCount || 0) > 0 || data.worker?.ticking === true;
  const reviewRunning = Boolean(data.reviewWorker && data.reviewWorker.running);
  const workersBusy = codingActive || reviewRunning;
  const waitText = codingActive ? 'Wait for coding work to finish' : 'Stop PR-review worker first';
  const capabilities = data.capabilities || {};
  const repair = document.getElementById('repair-external-controller');
  repair.disabled = !capabilities.externalRepair || workersBusy;
  repair.textContent = workersBusy ? waitText : 'Repair managed components';
  const remove = document.getElementById('remove-external-controller');
  remove.disabled = !capabilities.externalRemoval || workersBusy;
  remove.textContent = maintenance.removalPending ? 'Removal PR is pending' : workersBusy ? waitText : 'Create removal PR';
  const reconcile = document.getElementById('reconcile-external-removal');
  reconcile.disabled = !capabilities.externalRemovalReconciliation || workersBusy;
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
  renderManagerOverview(data);
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
      `.manager-overview{background:#111924;border:1px solid #30445f;border-radius:12px;padding:16px;margin-bottom:14px}.overview-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.overview-eyebrow{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#8da3be;margin-bottom:4px}.overview-heading strong{font-size:1.08rem}.overview-primary-action a{display:inline-flex;border-radius:8px;padding:9px 13px;background:#243247;color:#fff;text-decoration:none}.overview-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px;margin-top:14px}.overview-metric{border:1px solid #2b3b50;border-radius:9px;padding:10px;background:#0d1724}.overview-metric span{display:block;color:#9dacbf;font-size:.78rem;margin-bottom:4px}.overview-metric strong{display:block;font-size:.95rem}.overview-ready{border-color:#356b4a;background:#12261a}.overview-blocked{border-color:#894351;background:#301820}.overview-attention{border-color:#80672c;background:#2b2515}.overview-active{border-color:#365f8b;background:#122238}.blocker-list{display:grid;gap:10px;margin-top:12px}.blocker{border:1px solid #30445f;border-radius:9px;padding:11px;background:#0d1724}.blocker-error{border-color:#894351;background:#301820}.blocker-warning{border-color:#80672c;background:#2b2515}.blocker-ready{border-color:#356b4a;background:#12261a}.blocker a{color:#8ab8ff}@media(max-width:900px){.overview-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:560px){.overview-heading{display:block}.overview-primary-action{margin-top:10px}.overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}\n</style>`,
    )
    .replace(
      `  <div class="grid">`,
      `${OVERVIEW_PANEL}  <div class="grid">`,
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
