export function managerHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paseo Repository Manager</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b1018;color:#edf3ff}
*{box-sizing:border-box}body{margin:0;background:#0b1018;color:#edf3ff}button,input,select{font:inherit}
.shell{max-width:1180px;margin:0 auto;padding:24px}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}
h1{margin:0 0 6px;font-size:1.65rem}.muted{color:#9dacbf}.toolbar,.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
select,input:not([type="checkbox"]){background:#111a27;color:#edf3ff;border:1px solid #2c3b50;border-radius:8px;padding:9px 11px}select{min-width:220px}
button{border:0;border-radius:8px;padding:9px 13px;background:#2869d8;color:white;cursor:pointer}button.secondary{background:#243247}button.warning{background:#8b621d}button.danger{background:#9c3342}button:disabled{opacity:.55;cursor:not-allowed}
.banner{border:1px solid #365275;background:#132137;border-radius:10px;padding:12px 14px;margin-bottom:16px}.error{border-color:#804451;background:#301820}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:#111924;border:1px solid #253348;border-radius:12px;padding:16px}.card h2{font-size:1rem;margin:0 0 12px}.facts{display:grid;grid-template-columns:minmax(130px,.65fr) minmax(0,1.35fr);gap:8px 14px}.facts dt{color:#9dacbf}.facts dd{margin:0;overflow-wrap:anywhere}.wide{grid-column:1/-1}
.register{display:flex;gap:10px;margin-top:16px}.register input{flex:1}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field-grid label{display:grid;gap:5px;color:#9dacbf}.issue-row{display:grid;grid-template-columns:minmax(120px,.5fr) minmax(140px,.5fr) minmax(0,2fr);gap:10px;align-items:end}.check-row{display:flex;gap:9px;align-items:flex-start;color:#dce8fb;margin-top:12px}.check-row input{margin-top:3px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0a111b;border-radius:8px;padding:12px;max-height:300px;overflow:auto}
@media(max-width:760px){.header{display:block}.toolbar{margin-top:14px}.grid,.field-grid,.issue-row{grid-template-columns:1fr}.facts{grid-template-columns:1fr}.facts dd{margin-bottom:8px}.register{flex-direction:column}select{min-width:0;width:100%}}
</style>
</head>
<body>
<main class="shell">
  <div class="header">
    <div><h1>Paseo Repository Manager</h1><div class="muted">One standalone controller, isolated state and controls for every registered repository.</div></div>
    <div class="toolbar">
      <label for="repository-select" class="muted">Repository</label>
      <select id="repository-select" aria-label="Active repository"><option value="">No repositories registered</option></select>
      <button class="secondary" id="refresh-button">Refresh</button>
    </div>
  </div>
  <div class="banner" id="mode-banner">Actions are scoped to the selected repository. Background workers and installation actions are not enabled in this stage.</div>
  <div class="grid">
    <section class="card wide">
      <h2>Repository</h2>
      <dl class="facts" id="repository-facts"><dt>Status</dt><dd>Select or register a repository.</dd></dl>
    </section>
    <section class="card">
      <h2>Setup</h2>
      <dl class="facts" id="setup-facts"><dt>State</dt><dd>Unknown</dd></dl>
    </section>
    <section class="card">
      <h2>Automation</h2>
      <dl class="facts" id="automation-facts"><dt>State</dt><dd>Unknown</dd></dl>
    </section>
    <section class="card wide">
      <h2>Automation controls</h2>
      <div class="actions">
        <button class="repository-action" data-action="resume">Resume claims</button>
        <button class="repository-action danger" data-action="pause">Pause claims</button>
        <button class="repository-action secondary" data-action="run-now">Run now</button>
        <button class="repository-action secondary" data-action="reconcile">Reconcile dependencies</button>
      </div>
      <p class="muted">These actions use only the selected repository root. They do not start a permanent manager worker.</p>
    </section>
    <section class="card wide">
      <h2>Configuration</h2>
      <form id="config-form">
        <div class="field-grid">
          <label>Base branch<input id="base-branch"></label>
          <label>Poll interval in seconds<input id="poll-interval" type="number" min="60" max="3600"></label>
          <label>Maximum active issues<input id="max-active" type="number" min="1" max="20"></label>
          <label>Provider/Coding Harness<input id="coding-harness" placeholder="harness id"></label>
          <label>Issue processing<select id="issue-selection-mode"><option value="recommended-labels">Recommended labels</option><option value="all-open">All open issues</option></select></label>
          <label>Transient failure retries<input id="temporary-failure-retries" type="number" min="0" max="20"></label>
          <label>Excluded issue labels<input id="excluded-labels" placeholder="label-one, label-two"></label>
          <label>Review workflow<select id="review-workflow"><option value="quick-manual">Quick → Manual</option><option value="quick-web-chatgpt">Quick → Web ChatGPT</option><option value="full-immediate">Full review immediately</option></select></label>
          <label>Quick review rounds<input id="quick-review-rounds" type="number" min="1" max="20"></label>
          <label>Full review rounds<input id="full-review-rounds" type="number" min="1" max="20"></label>
          <label>Coder model<input id="coder-model" placeholder="provider/model"></label>
          <label>Coder thinking level<input id="coder-thinking" placeholder="thinking option id"></label>
          <label>Reviewer model<input id="reviewer-model" placeholder="provider/model"></label>
          <label>Reviewer thinking level<input id="reviewer-thinking" placeholder="thinking option id"></label>
        </div>
        <label class="check-row"><input id="auto-merge-approved" type="checkbox"><span>Automatically merge fully approved coding PRs</span></label>
        <p class="muted" id="auto-merge-help">Automatic merge availability depends on the selected review workflow.</p>
        <div class="actions" style="margin-top:12px"><button class="repository-action" type="submit">Save configuration</button></div>
      </form>
    </section>
    <section class="card">
      <h2>Manual issue action</h2>
      <div class="issue-row">
        <label class="muted">Issue number<input id="issue-number" type="number" min="1"></label>
        <label class="muted">Branch on retry<select id="branch-action"><option value="keep">Keep branch</option><option value="delete">Delete branch</option></select></label>
        <div class="actions">
          <button class="repository-action" data-issue-action="start-issue">Start</button>
          <button class="repository-action secondary" data-issue-action="skip-issue">Skip</button>
          <button class="repository-action secondary" data-issue-action="unskip-issue">Unskip</button>
          <button class="repository-action warning" data-issue-action="restart-issue">Restart</button>
          <button class="repository-action danger" data-issue-action="abandon-issue">Abandon</button>
        </div>
      </div>
    </section>
    <section class="card wide">
      <h2>Latest action result</h2>
      <pre id="dispatch-result">No repository selected.</pre>
      <div class="actions"><button class="danger" id="remove-button" disabled>Remove from manager</button></div>
    </section>
  </div>
  <form class="register" id="register-form">
    <input id="repository-path" required placeholder="C:\\path\\to\\repository or /path/to/repository" aria-label="Repository path">
    <button type="submit">Register repository</button>
  </form>
</main>
<script>
const select = document.getElementById('repository-select');
const banner = document.getElementById('mode-banner');
const removeButton = document.getElementById('remove-button');
const nativeFetch = window.fetch.bind(window);
let repositories = [];
let currentStatus = null;

function facts(target, entries) {
  const element = document.getElementById(target);
  element.textContent = '';
  for (const entry of entries) {
    const dt = document.createElement('dt'); dt.textContent = entry[0];
    const dd = document.createElement('dd'); dd.textContent = entry[1] == null || entry[1] === '' ? 'Not configured' : String(entry[1]);
    element.append(dt, dd);
  }
}

function showError(error) {
  banner.className = 'banner error';
  banner.textContent = error instanceof Error ? error.message : String(error);
}

function selectedPath(action) {
  if (!select.value) throw new Error('Select a repository first.');
  return '/api/repositories/' + encodeURIComponent(select.value) + '/' + action;
}

async function jsonRequest(url, options) {
  const response = await nativeFetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function setActionsEnabled(enabled) {
  for (const button of document.querySelectorAll('.repository-action')) button.disabled = !enabled;
}

function issueSelectionLabel(mode) {
  return mode === 'all-open' ? 'All open issues' : mode === 'recommended-labels' ? 'Recommended labels' : mode;
}

function reviewWorkflowLabel(workflow) {
  if (workflow === 'quick-manual') return 'Quick → Manual';
  if (workflow === 'quick-web-chatgpt') return 'Quick → Web ChatGPT';
  if (workflow === 'full-immediate') return 'Full review immediately';
  return workflow;
}

function syncAutoMergeAvailability() {
  const workflow = document.getElementById('review-workflow').value;
  const checkbox = document.getElementById('auto-merge-approved');
  const help = document.getElementById('auto-merge-help');
  const available = workflow === 'full-immediate' || workflow === 'quick-web-chatgpt';
  checkbox.disabled = !available;
  if (!available) checkbox.checked = false;
  help.textContent = available
    ? 'Off by default. Merge is requested only after exact-head full-review approval, validation, passing checks, a current mergeable base, and repository policy allow it.'
    : 'Automatic merge is unavailable for Quick → Manual. A person must merge the PR after manual review.';
}

function parseExcludedLabels(value) {
  return [...new Set(String(value || '').split(',').map((label) => label.trim()).filter(Boolean))];
}

function renderStatus(data) {
  currentStatus = data;
  const repository = data.repository;
  const configuration = data.configuration || {};
  const issueSelection = configuration.issueSelection || {};
  const review = configuration.review || {};
  facts('repository-facts', [
    ['Name', repository.repository || repository.name],
    ['Path', repository.path],
    ['Remote', repository.remote],
    ['Current branch', repository.branch],
    ['State directory', data.stateDirectory],
  ]);
  facts('setup-facts', [
    ['Setup complete', data.setup.complete ? 'Yes' : 'No'],
    ['Base branch', data.setup.baseBranch],
    ['Provider/Coding Harness', configuration.codingHarness],
    ['Issue processing', issueSelectionLabel(issueSelection.mode)],
    ['Review workflow', reviewWorkflowLabel(review.workflow)],
    ['Workspace', data.setup.workspaceId],
    ['Managed labels', data.setup.managedLabelCount],
    ['Issue template', data.setup.issueTemplateManaged ? 'Managed' : 'Not managed'],
    ['Install controls', data.capabilities.installationActions ? 'Enabled' : 'Not available yet'],
  ]);
  facts('automation-facts', [
    ['Claims', data.automation.claimsEnabled ? 'Enabled' : 'Paused'],
    ['Active runs', data.automation.activeRunCount],
    ['Recorded runs', data.automation.runCount],
    ['Maximum active', data.automation.maxActive],
    ['Poll interval', data.automation.pollIntervalSeconds + ' seconds'],
    ['Quick review limit', review.quickMaxRounds],
    ['Full review limit', review.fullMaxRounds],
    ['Background worker', data.capabilities.backgroundWorkers ? 'Running' : 'Not managed yet'],
    ['Coder', data.models.coder],
    ['Reviewer', data.models.reviewer],
  ]);
  document.getElementById('base-branch').value = data.setup.baseBranch || '';
  document.getElementById('poll-interval').value = data.automation.pollIntervalSeconds || 120;
  document.getElementById('max-active').value = data.automation.maxActive || 1;
  document.getElementById('coding-harness').value = configuration.codingHarness || '';
  document.getElementById('issue-selection-mode').value = issueSelection.mode || 'recommended-labels';
  document.getElementById('temporary-failure-retries').value = issueSelection.temporaryFailureRetries ?? 3;
  document.getElementById('excluded-labels').value = (issueSelection.excludedLabels || []).join(', ');
  document.getElementById('review-workflow').value = review.workflow || 'quick-manual';
  document.getElementById('quick-review-rounds').value = review.quickMaxRounds || 3;
  document.getElementById('full-review-rounds').value = review.fullMaxRounds || data.automation.maxReviewRounds || 3;
  document.getElementById('auto-merge-approved').checked = review.autoMergeApproved === true;
  document.getElementById('coder-model').value = data.models.coder || '';
  document.getElementById('coder-thinking').value = data.models.coderThinking || '';
  document.getElementById('reviewer-model').value = data.models.reviewer || '';
  document.getElementById('reviewer-thinking').value = data.models.reviewerThinking || '';
  syncAutoMergeAvailability();
  document.getElementById('dispatch-result').textContent = data.automation.lastDispatchResult
    ? JSON.stringify(data.automation.lastDispatchResult, null, 2)
    : 'No dispatch has been recorded.';
  setActionsEnabled(true);
}

async function loadRepositories(preferredId) {
  const body = await jsonRequest('/api/repositories');
  repositories = body.repositories || [];
  const prior = preferredId || select.value || localStorage.getItem('paseo-manager-repository');
  select.textContent = '';
  if (!repositories.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'No repositories registered'; select.append(option);
    removeButton.disabled = true;
    setActionsEnabled(false);
    return;
  }
  for (const repository of repositories) {
    const option = document.createElement('option');
    option.value = repository.id;
    option.textContent = repository.repository || repository.name;
    select.append(option);
  }
  select.value = repositories.some((item) => item.id === prior) ? prior : repositories[0].id;
  await loadStatus();
}

async function loadStatus() {
  if (!select.value) return;
  localStorage.setItem('paseo-manager-repository', select.value);
  removeButton.disabled = false;
  banner.className = 'banner';
  banner.textContent = 'All controls on this page are scoped to the selected repository. Background workers and installation actions remain separate follow-up stages.';
  const body = await jsonRequest(selectedPath('status'));
  renderStatus(body.status);
}

async function postRepositoryAction(action, payload) {
  const body = await jsonRequest(selectedPath(action), {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(payload || {}),
  });
  if (body.status) renderStatus(body.status);
  document.getElementById('dispatch-result').textContent = JSON.stringify(body.result, null, 2);
  return body;
}

select.addEventListener('change', () => loadStatus().catch(showError));
document.getElementById('refresh-button').addEventListener('click', () => loadRepositories(select.value).catch(showError));
document.getElementById('review-workflow').addEventListener('change', syncAutoMergeAvailability);
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => postRepositoryAction(button.dataset.action).catch(showError));
}
for (const button of document.querySelectorAll('[data-issue-action]')) {
  button.addEventListener('click', async () => {
    const issueNumber = Number(document.getElementById('issue-number').value);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) { showError(new Error('Enter a positive issue number.')); return; }
    const payload = { issueNumber, branchAction: document.getElementById('branch-action').value };
    if (button.dataset.issueAction === 'abandon-issue') {
      const reason = prompt('Why should this attempt be abandoned?', 'Abandoned by user');
      if (reason === null) return;
      payload.reason = reason;
    }
    if (button.dataset.issueAction === 'restart-issue' && !confirm('Restart issue #' + issueNumber + ' with a fresh attempt?')) return;
    try { await postRepositoryAction(button.dataset.issueAction, payload); }
    catch (error) { showError(error); }
  });
}
document.getElementById('config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const workflow = document.getElementById('review-workflow').value;
    const autoMergeAvailable = workflow === 'full-immediate' || workflow === 'quick-web-chatgpt';
    await postRepositoryAction('config', {
      baseBranch: document.getElementById('base-branch').value.trim(),
      pollIntervalSeconds: Number(document.getElementById('poll-interval').value),
      maxActive: Number(document.getElementById('max-active').value),
      codingHarness: document.getElementById('coding-harness').value.trim(),
      issueSelection: {
        mode: document.getElementById('issue-selection-mode').value,
        excludedLabels: parseExcludedLabels(document.getElementById('excluded-labels').value),
        temporaryFailureRetries: Number(document.getElementById('temporary-failure-retries').value),
      },
      review: {
        workflow,
        quickMaxRounds: Number(document.getElementById('quick-review-rounds').value),
        fullMaxRounds: Number(document.getElementById('full-review-rounds').value),
        autoMergeApproved: autoMergeAvailable && document.getElementById('auto-merge-approved').checked,
      },
      models: {
        coder: document.getElementById('coder-model').value.trim(),
        coderThinking: document.getElementById('coder-thinking').value.trim(),
        reviewer: document.getElementById('reviewer-model').value.trim(),
        reviewerThinking: document.getElementById('reviewer-thinking').value.trim(),
      },
    });
  } catch (error) { showError(error); }
});
document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const repositoryPath = document.getElementById('repository-path').value.trim();
  try {
    const body = await jsonRequest('/api/repositories', {
      method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({path: repositoryPath}),
    });
    document.getElementById('repository-path').value = '';
    await loadRepositories(body.repository.id);
  } catch (error) { showError(error); }
});
removeButton.addEventListener('click', async () => {
  const repository = repositories.find((item) => item.id === select.value);
  if (!repository || !confirm('Remove ' + (repository.repository || repository.name) + ' from this manager? Repository files and state will not be deleted.')) return;
  try {
    await jsonRequest('/api/repositories/' + encodeURIComponent(repository.id), {method:'DELETE'});
    localStorage.removeItem('paseo-manager-repository');
    currentStatus = null;
    await loadRepositories();
  } catch (error) { showError(error); }
});
setActionsEnabled(false);
syncAutoMergeAvailability();
loadRepositories().catch(showError);
</script>
</body>
</html>`;
}
