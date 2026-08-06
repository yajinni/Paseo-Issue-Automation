import { managerHtml as workerManagerHtml } from './manager-worker-ui.mjs';

const CAPACITY_PANEL = `  <section class="card wide" style="margin-top:14px">
    <h2>Manager-wide coding capacity</h2>
    <div class="field-grid">
      <label>Global maximum active coding jobs<input id="global-max-active" type="number" min="1" max="50"></label>
      <dl class="facts" id="manager-capacity-facts"><dt>Capacity</dt><dd>Loading…</dd></dl>
    </div>
    <div class="actions" style="margin-top:12px">
      <button id="save-manager-config">Save manager capacity</button>
      <button class="secondary" id="refresh-manager-status">Refresh manager status</button>
    </div>
    <p class="muted">Each fair scheduling turn can start at most one job for a repository. Running repositories rotate while capacity is available.</p>
  </section>
`;

const CAPACITY_SCRIPT = `<script>
function renderManagerCapacity(body) {
  const config = body.config || {};
  const manager = body.manager || {};
  document.getElementById('global-max-active').value = config.globalMaxActive || manager.globalMaxActive || 2;
  facts('manager-capacity-facts', [
    ['Active coding jobs', manager.active == null ? 'Unknown' : manager.active],
    ['Available slots', manager.available == null ? 'Unknown' : manager.available],
    ['Running repository workers', manager.runningWorkerCount == null ? 0 : manager.runningWorkerCount],
    ['Waiting repositories', (manager.pendingRepositoryIds || []).length],
    ['Last served repository', manager.lastServedRepositoryId],
    ['Capacity errors', (manager.errors || []).length ? manager.errors.map((item) => item.repositoryId + ': ' + item.error).join('; ') : 'None'],
  ]);
}

async function loadManagerCapacity() {
  const body = await jsonRequest('/api/manager/status');
  renderManagerCapacity(body);
}

document.getElementById('save-manager-config').addEventListener('click', async () => {
  try {
    const body = await jsonRequest('/api/manager/config', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({globalMaxActive: Number(document.getElementById('global-max-active').value)}),
    });
    renderManagerCapacity(body);
  } catch (error) { showError(error); }
});
document.getElementById('refresh-manager-status').addEventListener('click', () => loadManagerCapacity().catch(showError));
loadManagerCapacity().catch(showError);
setInterval(() => loadManagerCapacity().catch(() => {}), 15000);
</script>`;

export function managerHtml() {
  return workerManagerHtml()
    .replace(
      `  <form class="register" id="register-form">`,
      `${CAPACITY_PANEL}  <form class="register" id="register-form">`,
    )
    .replace(
      `    ['Worker error', data.worker && data.worker.lastError],`,
      `    ['Worker error', data.worker && data.worker.lastError],
    ['Capacity wait', data.worker && data.worker.lastScheduleReason],
    ['Capacity check error', data.worker && data.worker.capacityError],`,
    )
    .replace(
      'PR-review workers, global concurrency, and installation actions are separate stages.',
      'Manager-wide fair coding capacity is enforced. PR-review workers and installation actions remain separate stages.',
    )
    .replace(
      'PR-review workers, global concurrency, and installation remain separate.',
      'Manager-wide fair coding capacity is enforced. PR-review workers and installation remain separate.',
    )
    .replace('</body>', `${CAPACITY_SCRIPT}\n</body>`);
}
