export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paseo Issue Automation</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: #0d1117; color: #e6edf3; }
main { max-width: 1060px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { margin-bottom: 6px; }
h2, h3 { margin-top: 0; }
p { color: #9da7b3; line-height: 1.5; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 18px; }
.card.done { border-color: #238636; }
button { background: #238636; color: white; border: 0; border-radius: 7px; padding: 10px 14px; cursor: pointer; font-weight: 700; }
button.secondary { background: #30363d; }
button.warning { background: #9e6a03; }
button.danger { background: #da3633; }
button:disabled { cursor: not-allowed; opacity: .45; }
input { width: 100%; box-sizing: border-box; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 7px; padding: 10px; margin: 5px 0 12px; }
input[type=checkbox] { width: auto; margin: 0 8px 0 0; }
label { display: block; font-size: 13px; color: #b1bac4; }
.ok { color: #3fb950; }
.bad { color: #f85149; }
.muted { color: #8b949e; }
pre { white-space: pre-wrap; background: #0d1117; padding: 12px; border-radius: 7px; overflow: auto; }
code { overflow-wrap: anywhere; }
.hidden { display: none !important; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.component-list { display: grid; gap: 10px; margin-top: 14px; }
.component { padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
.component-head { display: flex; gap: 14px; align-items: start; justify-content: space-between; }
.component p { margin: 6px 0 10px; font-size: 13px; }
.checkline { display: flex; align-items: center; margin: 8px 0; font-size: 14px; }
hr { border: 0; border-top: 1px solid #30363d; margin: 18px 0; }
</style>
</head>
<body><main>
<h1>Issue Coding Automation</h1>
<p id="subtitle">Loading setup status…</p>
<div id="message"></div>
<section id="setup" class="hidden">
  <div class="actions" style="margin-bottom:16px">
    <button id="return-dashboard" class="secondary hidden" onclick="showDashboardAgain()">Return to dashboard</button>
  </div>

  <div class="grid">
    <article class="card" id="requirements-card">
      <h2>1. Check requirements</h2>
      <p>Checks Git, GitHub authentication, the repository remote, and Paseo. This changes nothing.</p>
      <button onclick="refresh()">Check requirements</button>
      <pre id="requirements"></pre>
    </article>

    <article class="card" id="preview-card">
      <h2>2. Preview and install</h2>
      <p>Shows every file, GitHub label, workspace, and local-state location before anything is installed.</p>
      <pre id="install-preview">Loading preview…</pre>
      <div class="actions">
        <button class="secondary" onclick="loadPreview()">Refresh preview</button>
        <button onclick="installAll()">Install shown components</button>
      </div>
    </article>
  </div>

  <article class="card" id="integration-card" style="margin-top:16px">
    <h2>3. Installed components and repairs</h2>
    <p>Every package-created file has its own removal button. For modified files, cleanup removes only the package-owned addition.</p>
    <div class="component-list">
      <div class="component">
        <div class="component-head"><code>.github/ISSUE_TEMPLATE/automated-coding-task.md</code><span id="issue-template-badge"></span></div>
        <p id="issue-template-status">Checking…</p>
        <div class="actions">
          <button id="install-issue-template" class="secondary" onclick="post('/api/install/issue-template')">Install</button>
          <button id="repair-issue-template" class="warning hidden" onclick="confirmedPost('/api/repair/issue-template', 'Replace this package-managed template with the package version?')">Restore package version</button>
          <button id="remove-issue-template" class="danger hidden" onclick="confirmedPost('/api/remove/issue-template', 'Remove the unchanged issue template file created by this package?')">Remove installed file</button>
        </div>
      </div>
      <div class="component">
        <div class="component-head"><code>paseo.json → scripts.issue-coding-automation</code><span id="paseo-json-badge"></span></div>
        <p id="paseo-json-status">Checking…</p>
        <div class="actions">
          <button id="install-paseo-service" class="secondary" onclick="post('/api/install/paseo-service')">Install service</button>
          <button id="repair-paseo-service" class="warning hidden" onclick="confirmedPost('/api/repair/paseo-service', 'Restore only the package-owned service entry while preserving other paseo.json content?')">Repair added service</button>
          <button id="remove-paseo-integration" class="danger hidden" onclick="confirmedPost('/api/remove/paseo-integration', 'Remove the package-owned Paseo integration? Unrelated paseo.json content is preserved.')">Remove package addition</button>
        </div>
      </div>
      <div class="component">
        <div class="component-head"><strong>GitHub lifecycle labels</strong><span id="labels-badge"></span></div>
        <p>Labels that already existed are reused and are never considered package-owned. Each label created by the package can be removed separately.</p>
        <div id="label-list" class="component-list"></div>
        <div class="actions" style="margin-top:10px">
          <button class="secondary" onclick="post('/api/install/labels')">Install or repair missing labels</button>
          <button class="danger" onclick="removeAllLabels(false)">Remove all package-created labels</button>
          <button class="danger" onclick="removeAllLabels(true)">Force remove all</button>
        </div>
      </div>
      <div class="component">
        <div class="component-head"><strong>Permanent Paseo workspace</strong><span id="workspace-badge"></span></div>
        <p>Creates or reconnects to <strong>Issue Coding Automation</strong>. Removal archives only a workspace recorded as package-created.</p>
        <pre id="workspace"></pre>
        <div class="actions">
          <button class="secondary" onclick="post('/api/workspace')">Create or reconnect</button>
          <button id="remove-workspace" class="danger hidden" onclick="confirmedPost('/api/remove/workspace', 'Archive the package-created Issue Coding Automation workspace? This is blocked while issues are running.')">Archive workspace</button>
        </div>
      </div>
    </div>
  </article>

  <div class="grid" style="margin-top:16px">
    <article class="card" id="config-card">
      <h2>4. Configure automation</h2>
      <p>The base branch creates issue branches and is also their PR target. Task-specific checks come from each issue.</p>
      <label>Base branch<input id="baseBranch"></label>
      <label>Orchestrator model<input id="orchestrator" placeholder="provider/model"></label>
      <label>Coder model<input id="coder" placeholder="provider/model"></label>
      <label>Independent Reviewer model<input id="reviewer" placeholder="provider/model"></label>
      <label>Polling interval in seconds<input id="pollIntervalSeconds" type="number" min="60" max="3600"></label>
      <label>Maximum active issues<input id="maxActive" type="number" min="1" max="10"></label>
      <label>Maximum review rounds<input id="maxReviewRounds" type="number" min="1" max="10"></label>
      <button onclick="saveConfig()">Save configuration</button>
    </article>

    <article class="card" id="finish-card">
      <h2>5. Self-test and finish</h2>
      <p>The self-test is non-destructive. It reads configuration and connectivity but does not create an issue, branch, agent, or PR.</p>
      <div class="actions">
        <button class="secondary" onclick="runSelfTest()">Run setup self-test</button>
        <button onclick="post('/api/finish')">Finish setup</button>
      </div>
      <pre id="self-test">Not run.</pre>
      <pre id="verification"></pre>
    </article>
  </div>

  <article class="card" style="margin-top:16px">
    <h2>Maintenance and uninstall</h2>
    <p>Destructive actions pause new claims and refuse to continue while automation issues are running.</p>
    <div class="component">
      <strong>Local automation state</strong>
      <p id="state-path"></p>
      <div class="actions">
        <button class="danger" onclick="clearState(false)">Clear local state</button>
        <button class="danger" onclick="clearState(true)">Force clear ownership records</button>
      </div>
    </div>
    <hr>
    <h3>Guided uninstall</h3>
    <label class="checkline"><input id="uninstall-template" type="checkbox" checked>Remove package-created issue template</label>
    <label class="checkline"><input id="uninstall-paseo" type="checkbox" checked>Remove package-owned paseo.json service</label>
    <label class="checkline"><input id="uninstall-labels" type="checkbox" checked>Remove package-created GitHub labels</label>
    <label class="checkline"><input id="uninstall-workspace" type="checkbox" checked>Archive package-created Paseo workspace</label>
    <label class="checkline"><input id="uninstall-state" type="checkbox" checked>Clear local automation state last</label>
    <label class="checkline"><input id="uninstall-force-labels" type="checkbox">Force label removal even when open issues use them</label>
    <div class="actions"><button class="danger" onclick="guidedUninstall()">Run selected uninstall steps</button></div>
    <p>After the dashboard cleanup finishes, close this dashboard and run:</p>
    <pre id="npm-uninstall-command"></pre>
  </article>
</section>

<section id="dashboard" class="hidden">
  <article class="card">
    <h2>Controller</h2>
    <p>Issue claiming is <strong id="claim-state"></strong>. Pausing prevents new claims but does not stop agents already running.</p>
    <div class="actions">
      <button onclick="post('/api/resume')">Resume claims</button>
      <button class="secondary" onclick="post('/api/run-now')">Run now</button>
      <button class="danger" onclick="post('/api/pause')">Pause claims</button>
    </div>
  </article>
  <div class="grid" style="margin-top:16px">
    <article class="card"><h2>Ready</h2><strong id="count-ready">0</strong></article>
    <article class="card"><h2>Running</h2><strong id="count-running">0</strong></article>
    <article class="card"><h2>Blocked</h2><strong id="count-blocked">0</strong></article>
    <article class="card"><h2>Failed</h2><strong id="count-failed">0</strong></article>
    <article class="card"><h2>Human review</h2><strong id="count-humanReview">0</strong></article>
  </div>
  <article class="card" style="margin-top:16px">
    <h2>Configuration</h2>
    <pre id="final-config"></pre>
    <button class="secondary" onclick="showSetupAgain()">Setup, repair, and uninstall</button>
  </article>
</section>
<script>
let forceSetup = false;
function showMessage(text, bad=false) {
  document.getElementById('message').innerHTML = text ? '<p class="'+(bad?'bad':'ok')+'">'+escapeHtml(text)+'</p>' : '';
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function api(path, options={}) {
  const response = await fetch(path, {headers:{'content-type':'application/json'}, ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function post(path, body={}) {
  try {
    showMessage('Working…');
    const data = await api(path, {method:'POST', body:JSON.stringify(body)});
    showMessage('Completed.');
    if (data.result) document.getElementById('self-test').textContent = JSON.stringify(data.result, null, 2);
    await refresh();
    return data;
  } catch (error) { showMessage(error.message, true); return null; }
}
async function confirmedPost(path, question, body={}) {
  if (!window.confirm(question)) return;
  await post(path, body);
}
async function loadPreview() {
  try { document.getElementById('install-preview').textContent = JSON.stringify(await api('/api/preview'), null, 2); }
  catch (error) { showMessage(error.message, true); }
}
async function installAll() {
  const preview = document.getElementById('install-preview').textContent;
  if (!window.confirm('Install the components shown in the preview?\n\n'+preview)) return;
  await post('/api/install');
}
async function saveConfig() {
  await post('/api/config', {
    baseBranch: document.getElementById('baseBranch').value,
    models: {
      orchestrator: document.getElementById('orchestrator').value,
      coder: document.getElementById('coder').value,
      reviewer: document.getElementById('reviewer').value
    },
    pollIntervalSeconds: Number(document.getElementById('pollIntervalSeconds').value),
    maxActive: Number(document.getElementById('maxActive').value),
    maxReviewRounds: Number(document.getElementById('maxReviewRounds').value)
  });
}
async function runSelfTest() {
  const data = await post('/api/self-test');
  if (data?.result) document.getElementById('self-test').textContent = JSON.stringify(data.result, null, 2);
}
async function removeLabel(name, force) {
  const warning = force
    ? 'Force-delete '+name+'? GitHub removes it from every issue that currently uses it.'
    : 'Remove the package-created label '+name+'? Removal is refused if an open issue uses it.';
  if (!window.confirm(warning)) return;
  await post('/api/remove/label', {label:name, force});
}
async function removeAllLabels(force) {
  const warning = force
    ? 'Force-delete every package-created lifecycle label, including labels used by open issues?'
    : 'Remove all package-created lifecycle labels that are not used by open issues?';
  if (!window.confirm(warning)) return;
  await post('/api/remove/labels', {force});
}
async function clearState(force) {
  const warning = force
    ? 'Force-clear local state? This permanently loses ownership records used for safe cleanup.'
    : 'Clear local state after all package-managed components have been removed?';
  if (!window.confirm(warning)) return;
  await post('/api/clear-state', {force});
}
async function guidedUninstall() {
  if (!window.confirm('Run the selected uninstall steps? New claims will be paused. Active issue runs block this action.')) return;
  const data = await post('/api/uninstall', {
    issueTemplate: document.getElementById('uninstall-template').checked,
    paseoService: document.getElementById('uninstall-paseo').checked,
    labels: document.getElementById('uninstall-labels').checked,
    workspace: document.getElementById('uninstall-workspace').checked,
    localState: document.getElementById('uninstall-state').checked,
    forceLabels: document.getElementById('uninstall-force-labels').checked
  });
  if (data?.result?.npmRemovalCommand) {
    document.getElementById('npm-uninstall-command').textContent = data.result.npmRemovalCommand;
  }
}
function showSetupAgain() { forceSetup = true; refresh(); }
function showDashboardAgain() { forceSetup = false; refresh(); }
function renderLabels(data) {
  const list = document.getElementById('label-list');
  list.innerHTML = '';
  for (const label of Object.values(data.integration.labels || {})) {
    const item = document.createElement('div');
    item.className = 'component';
    const status = !label.present ? 'Missing'
      : label.createdByPackage ? 'Created by this package'
        : 'Pre-existing label reused by the automation';
    item.innerHTML = '<div class="component-head"><code>'+escapeHtml(label.name)+'</code><span>'+(label.present?'✓':'✕')+'</span></div><p>'+escapeHtml(status)+'</p>';
    const actions = document.createElement('div'); actions.className = 'actions';
    if (label.canRepair) {
      const repair = document.createElement('button'); repair.className='warning'; repair.textContent='Repair'; repair.onclick=()=>post('/api/repair/label',{label:label.name}); actions.appendChild(repair);
    }
    if (label.createdByPackage) {
      const remove = document.createElement('button'); remove.className='danger'; remove.textContent='Remove'; remove.onclick=()=>removeLabel(label.name,false); actions.appendChild(remove);
      const force = document.createElement('button'); force.className='danger'; force.textContent='Force remove'; force.onclick=()=>removeLabel(label.name,true); actions.appendChild(force);
    }
    item.appendChild(actions); list.appendChild(item);
  }
}
function renderFileControls(data) {
  const issue = data.integration.management.issueTemplate;
  const paseo = data.integration.management.paseoJson;
  document.getElementById('issue-template-badge').textContent = issue.present ? '✓' : '✕';
  document.getElementById('issue-template-status').textContent = !issue.present ? 'Not installed.'
    : issue.changedSinceInstall ? 'Package-created file changed afterward. Automatic deletion is disabled until restored.'
      : issue.createdByPackage ? 'Package-created and unchanged.' : 'Pre-existing matching file; not package-owned.';
  document.getElementById('install-issue-template').classList.toggle('hidden', issue.present);
  document.getElementById('repair-issue-template').classList.toggle('hidden', !issue.canRepair);
  document.getElementById('remove-issue-template').classList.toggle('hidden', !issue.createdByPackage);
  document.getElementById('remove-issue-template').disabled = !issue.canRemove;

  document.getElementById('paseo-json-badge').textContent = paseo.servicePresent ? '✓' : '✕';
  document.getElementById('paseo-json-status').textContent = !paseo.servicePresent ? 'Automation service not installed.'
    : paseo.changedSinceInstall ? 'Package-owned service changed afterward. Restore it before safe removal.'
      : paseo.removalMode === 'file' ? 'Package-created file containing only the automation service.'
        : paseo.serviceAddedByPackage ? 'Package-owned service added to an existing file; unrelated content is preserved.'
          : 'Pre-existing matching service; not package-owned.';
  document.getElementById('install-paseo-service').classList.toggle('hidden', paseo.servicePresent);
  document.getElementById('repair-paseo-service').classList.toggle('hidden', !paseo.canRepair);
  document.getElementById('remove-paseo-integration').classList.toggle('hidden', !paseo.serviceAddedByPackage);
  document.getElementById('remove-paseo-integration').disabled = !paseo.canRemove;
  document.getElementById('remove-paseo-integration').textContent = paseo.removalMode === 'file' ? 'Remove installed file' : 'Remove added service';
}
function render(data) {
  const operational = data.config.setupComplete && data.checks.ready;
  const showSetup = forceSetup || !operational;
  document.getElementById('setup').classList.toggle('hidden', !showSetup);
  document.getElementById('dashboard').classList.toggle('hidden', showSetup);
  document.getElementById('return-dashboard').classList.toggle('hidden', !forceSetup || !operational);
  document.getElementById('subtitle').textContent = showSetup ? 'Guided setup, repair, and reversible uninstall' : 'Autonomous GitHub issue coding through Paseo';
  const req = data.requirements;
  document.getElementById('requirements').textContent = [
    'Git: '+req.git,
    'GitHub CLI: '+req.githubCli,
    'GitHub authenticated: '+req.githubAuthenticated,
    'Paseo CLI: '+req.paseoCli,
    'Paseo reachable: '+req.paseoReachable,
    'Remote: '+(req.remote || 'missing')
  ].join('\n');
  document.getElementById('install-preview').textContent = JSON.stringify(data.preview, null, 2);
  renderFileControls(data); renderLabels(data);
  document.getElementById('labels-badge').textContent = data.integration.labelsReady ? '✓' : '✕';
  document.getElementById('workspace-badge').textContent = data.workspace?.id ? '✓' : '✕';
  document.getElementById('workspace').textContent = data.workspace?.id ? data.workspace.title+'\n'+data.workspace.id : 'Not created';
  document.getElementById('remove-workspace').classList.toggle('hidden', !data.workspaceManagement.canRemove);
  document.getElementById('baseBranch').value = data.config.baseBranch || req.defaultBranch || '';
  document.getElementById('orchestrator').value = data.config.models.orchestrator || '';
  document.getElementById('coder').value = data.config.models.coder || '';
  document.getElementById('reviewer').value = data.config.models.reviewer || '';
  document.getElementById('pollIntervalSeconds').value = data.config.pollIntervalSeconds;
  document.getElementById('maxActive').value = data.config.maxActive;
  document.getElementById('maxReviewRounds').value = data.config.maxReviewRounds;
  document.getElementById('verification').textContent = JSON.stringify(data.checks, null, 2);
  document.getElementById('state-path').textContent = data.stateDirectory;
  document.getElementById('npm-uninstall-command').textContent = data.npmUninstallCommand;
  document.getElementById('requirements-card').classList.toggle('done', req.githubAuthenticated && req.paseoReachable && req.remote);
  document.getElementById('preview-card').classList.toggle('done', data.integration.issueTemplate && data.integration.paseoService && data.integration.labelsReady);
  document.getElementById('integration-card').classList.toggle('done', data.integration.issueTemplate && data.integration.paseoService && data.integration.labelsReady && Boolean(data.workspace?.id));
  document.getElementById('config-card').classList.toggle('done', data.checks.modelsConfigured && data.checks.baseBranchExists);
  document.getElementById('finish-card').classList.toggle('done', data.checks.ready);
  document.getElementById('claim-state').textContent = data.runtime.claimsEnabled ? 'running' : 'paused';
  const counts = data.automation?.counts || {};
  for (const key of ['ready','running','blocked','failed','humanReview']) document.getElementById('count-'+key).textContent = counts[key] || 0;
  document.getElementById('final-config').textContent = JSON.stringify({
    baseBranch: data.config.baseBranch,
    models: data.config.models,
    pollIntervalSeconds: data.config.pollIntervalSeconds,
    maxActive: data.config.maxActive,
    maxReviewRounds: data.config.maxReviewRounds,
    workspace: data.workspace
  }, null, 2);
}
async function refresh() {
  try { render(await api('/api/status')); showMessage(''); }
  catch (error) { showMessage(error.message, true); }
}
refresh(); setInterval(refresh, 15000);
</script>
</main></body></html>`;
}
