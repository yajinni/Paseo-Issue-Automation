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
select,input{background:#111a27;color:#edf3ff;border:1px solid #2c3b50;border-radius:8px;padding:9px 11px}
select{min-width:300px}button{border:0;border-radius:8px;padding:9px 13px;background:#2869d8;color:white;cursor:pointer}button.secondary{background:#243247}button.danger{background:#9c3342}button:disabled{opacity:.55;cursor:not-allowed}
.banner{border:1px solid #365275;background:#132137;border-radius:10px;padding:12px 14px;margin-bottom:16px}.error{border-color:#804451;background:#301820}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:#111924;border:1px solid #253348;border-radius:12px;padding:16px}.card h2{font-size:1rem;margin:0 0 12px}.facts{display:grid;grid-template-columns:minmax(130px,.65fr) minmax(0,1.35fr);gap:8px 14px}.facts dt{color:#9dacbf}.facts dd{margin:0;overflow-wrap:anywhere}.wide{grid-column:1/-1}.status{display:inline-flex;border-radius:999px;padding:4px 9px;background:#27364a}.status.good{background:#173d31}.status.warn{background:#503b1d}
.register{display:flex;gap:10px;margin-top:16px}.register input{flex:1}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0a111b;border-radius:8px;padding:12px;max-height:300px;overflow:auto}
@media(max-width:760px){.header{display:block}.toolbar{margin-top:14px}.grid{grid-template-columns:1fr}.facts{grid-template-columns:1fr}.facts dd{margin-bottom:8px}.register{flex-direction:column}select{min-width:0;width:100%}}
</style>
</head>
<body>
<main class="shell">
  <div class="header">
    <div><h1>Paseo Repository Manager</h1><div class="muted">One standalone controller, isolated state for every registered repository.</div></div>
    <div class="toolbar">
      <label for="repository-select" class="muted">Repository</label>
      <select id="repository-select" aria-label="Active repository"><option value="">No repositories registered</option></select>
      <button class="secondary" id="refresh-button">Refresh</button>
    </div>
  </div>
  <div class="banner" id="mode-banner">This manager view is read-only for repository automation. Registration changes are available; issue actions arrive in the next stage.</div>
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
      <h2>Latest dispatch result</h2>
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

function facts(target, entries) {
  const element = document.getElementById(target);
  element.textContent = '';
  for (const [label, value] of entries) {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value == null || value === '' ? 'Not configured' : String(value);
    element.append(dt, dd);
  }
}

function showError(error) {
  banner.className = 'banner error';
  banner.textContent = error instanceof Error ? error.message : String(error);
}

async function jsonRequest(url, options) {
  const response = await nativeFetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

async function loadRepositories(preferredId) {
  const body = await jsonRequest('/api/repositories');
  repositories = body.repositories || [];
  const prior = preferredId || select.value || localStorage.getItem('paseo-manager-repository');
  select.textContent = '';
  if (!repositories.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'No repositories registered'; select.append(option);
    removeButton.disabled = true;
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
  const id = select.value;
  if (!id) return;
  localStorage.setItem('paseo-manager-repository', id);
  removeButton.disabled = false;
  banner.className = 'banner';
  banner.textContent = 'Viewing isolated repository state. Repository automation controls are intentionally read-only in this stage.';
  const body = await jsonRequest('/api/repositories/' + encodeURIComponent(id) + '/status');
  const data = body.status;
  const repository = data.repository;
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
    ['Workspace', data.setup.workspaceId],
    ['Managed labels', data.setup.managedLabelCount],
    ['Issue template', data.setup.issueTemplateManaged ? 'Managed' : 'Not managed'],
  ]);
  facts('automation-facts', [
    ['Claims', data.automation.claimsEnabled ? 'Enabled' : 'Paused'],
    ['Active runs', data.automation.activeRunCount],
    ['Recorded runs', data.automation.runCount],
    ['Maximum active', data.automation.maxActive],
    ['Poll interval', data.automation.pollIntervalSeconds + ' seconds'],
    ['Coder', data.models.coder],
    ['Reviewer', data.models.reviewer],
  ]);
  document.getElementById('dispatch-result').textContent = data.automation.lastDispatchResult
    ? JSON.stringify(data.automation.lastDispatchResult, null, 2)
    : 'No dispatch has been recorded.';
}

select.addEventListener('change', () => loadStatus().catch(showError));
document.getElementById('refresh-button').addEventListener('click', () => loadRepositories(select.value).catch(showError));
document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const path = document.getElementById('repository-path').value.trim();
  try {
    const body = await jsonRequest('/api/repositories', {
      method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({path}),
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
    await loadRepositories();
  } catch (error) { showError(error); }
});
loadRepositories().catch(showError);
</script>
</body>
</html>`;
}
