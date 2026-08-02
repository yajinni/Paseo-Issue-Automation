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
main { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { margin-bottom: 6px; }
h2 { margin-top: 0; }
p { color: #9da7b3; line-height: 1.5; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 18px; }
.card.done { border-color: #238636; }
button { background: #238636; color: white; border: 0; border-radius: 7px; padding: 10px 14px; cursor: pointer; font-weight: 700; }
button.secondary { background: #30363d; }
button.danger { background: #da3633; }
button:disabled { cursor: not-allowed; opacity: .45; }
input { width: 100%; box-sizing: border-box; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 7px; padding: 10px; margin: 5px 0 12px; }
label { display: block; font-size: 13px; color: #b1bac4; }
.ok { color: #3fb950; }
.bad { color: #f85149; }
.muted { color: #8b949e; }
pre { white-space: pre-wrap; background: #0d1117; padding: 12px; border-radius: 7px; overflow: auto; }
code { overflow-wrap: anywhere; }
.hidden { display: none !important; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.file-list { display: grid; gap: 10px; margin-top: 14px; }
.file-item { display: flex; gap: 14px; align-items: center; justify-content: space-between; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
.file-item p { margin: 5px 0 0; font-size: 13px; }
.file-item button { flex: 0 0 auto; }
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
      <p>Checks Git, the GitHub CLI and authentication, the repository remote, and Paseo. This changes nothing.</p>
      <button onclick="refresh()">Check requirements</button>
      <pre id="requirements"></pre>
    </article>
    <article class="card" id="integration-card">
      <h2>2. Install repository integration</h2>
      <p>Adds the automation-ready GitHub issue template, merges one service into <code>paseo.json</code>, and creates the lifecycle labels. Existing files are preserved, and every package-owned file or addition has its own safe removal control.</p>
      <button onclick="post('/api/install')">Install repository integration</button>
      <div class="file-list">
        <div class="file-item">
          <div>
            <code>.github/ISSUE_TEMPLATE/automated-coding-task.md</code>
            <p id="issue-template-status">Checking…</p>
          </div>
          <button id="remove-issue-template" class="danger hidden" onclick="removeManaged('/api/remove/issue-template', 'Remove the issue template file installed by this package?')">Remove installed file</button>
        </div>
        <div class="file-item">
          <div>
            <code>paseo.json</code>
            <p id="paseo-json-status">Checking…</p>
          </div>
          <button id="remove-paseo-integration" class="danger hidden" onclick="removeManaged('/api/remove/paseo-integration', 'Remove the package-owned Paseo integration? Unrelated paseo.json content will be preserved.')">Remove package addition</button>
        </div>
      </div>
      <p class="muted">GitHub labels are external repository settings, not files, so they are not included in this file-removal list.</p>
    </article>
    <article class="card" id="workspace-card">
      <h2>3. Create the permanent workspace</h2>
      <p>Creates one local Paseo workspace rooted at this repository. Its permanent name is <strong>Issue Coding Automation</strong>.</p>
      <button onclick="post('/api/workspace')">Create Automation Workspace</button>
      <pre id="workspace"></pre>
    </article>
    <article class="card" id="config-card">
      <h2>4. Configure the automation</h2>
      <p>The base branch is used both to create issue branches and as their pull-request target. Validation commands come from each issue, not this setup.</p>
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
      <h2>5. Verify and finish</h2>
      <p>Confirms every automation requirement is present. Claims remain paused after setup so no issue starts unexpectedly.</p>
      <button onclick="post('/api/finish')">Finish setup</button>
      <pre id="verification"></pre>
    </article>
  </div>
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
    <button class="secondary" onclick="showSetupAgain()">Setup, files, and configuration</button>
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
  try { showMessage('Working…'); await api(path, {method:'POST', body:JSON.stringify(body)}); showMessage('Completed.'); await refresh(); }
  catch (error) { showMessage(error.message, true); }
}
async function removeManaged(path, question) {
  if (!window.confirm(question)) return;
  await post(path);
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
function showSetupAgain() {
  forceSetup = true;
  refresh();
}
function showDashboardAgain() {
  forceSetup = false;
  refresh();
}
function renderFileControls(data) {
  const issue = data.integration.management.issueTemplate;
  const paseo = data.integration.management.paseoJson;
  const issueStatus = document.getElementById('issue-template-status');
  const issueButton = document.getElementById('remove-issue-template');
  if (!issue.present) issueStatus.textContent = 'Not installed.';
  else if (issue.changedSinceInstall) issueStatus.textContent = 'Installed by the package, but changed afterward. It will not be deleted automatically.';
  else if (issue.createdByPackage) issueStatus.textContent = 'Installed by this package. The button deletes this file only if it is still unchanged.';
  else issueStatus.textContent = 'Already present, but not recorded as a file created by this package.';
  issueButton.classList.toggle('hidden', !issue.createdByPackage);
  issueButton.disabled = !issue.canRemove;

  const paseoStatus = document.getElementById('paseo-json-status');
  const paseoButton = document.getElementById('remove-paseo-integration');
  if (!paseo.servicePresent) paseoStatus.textContent = paseo.present ? 'File exists, but the automation service is not installed.' : 'File does not exist.';
  else if (paseo.changedSinceInstall) paseoStatus.textContent = 'The package-owned service was changed afterward. It will not be removed automatically.';
  else if (paseo.removalMode === 'file') paseoStatus.textContent = 'This file was created by the package and contains only the package-owned service.';
  else if (paseo.serviceAddedByPackage) paseoStatus.textContent = 'The package added one service. Removing it preserves every unrelated paseo.json setting.';
  else paseoStatus.textContent = 'The service already existed and is not recorded as a package-owned addition.';
  paseoButton.classList.toggle('hidden', !paseo.serviceAddedByPackage);
  paseoButton.disabled = !paseo.canRemove;
  paseoButton.textContent = paseo.removalMode === 'file' ? 'Remove installed file' : 'Remove added service';
}
function render(data) {
  const operational = data.config.setupComplete && data.checks.ready;
  const showSetup = forceSetup || !operational;
  document.getElementById('setup').classList.toggle('hidden', !showSetup);
  document.getElementById('dashboard').classList.toggle('hidden', showSetup);
  document.getElementById('return-dashboard').classList.toggle('hidden', !forceSetup || !operational);
  document.getElementById('subtitle').textContent = showSetup ? 'Guided setup and repository integration management' : 'Autonomous GitHub issue coding through Paseo';
  const req = data.requirements;
  document.getElementById('requirements').textContent = [
    'Git: '+req.git,
    'GitHub CLI: '+req.githubCli,
    'GitHub authenticated: '+req.githubAuthenticated,
    'Paseo CLI: '+req.paseoCli,
    'Paseo reachable: '+req.paseoReachable,
    'Remote: '+(req.remote || 'missing')
  ].join('\n');
  renderFileControls(data);
  document.getElementById('workspace').textContent = data.workspace?.id ? data.workspace.title+'\n'+data.workspace.id : 'Not created';
  document.getElementById('baseBranch').value = data.config.baseBranch || req.defaultBranch || '';
  document.getElementById('orchestrator').value = data.config.models.orchestrator || '';
  document.getElementById('coder').value = data.config.models.coder || '';
  document.getElementById('reviewer').value = data.config.models.reviewer || '';
  document.getElementById('pollIntervalSeconds').value = data.config.pollIntervalSeconds;
  document.getElementById('maxActive').value = data.config.maxActive;
  document.getElementById('maxReviewRounds').value = data.config.maxReviewRounds;
  document.getElementById('verification').textContent = JSON.stringify(data.checks, null, 2);
  document.getElementById('requirements-card').classList.toggle('done', req.githubAuthenticated && req.paseoReachable && req.remote);
  document.getElementById('integration-card').classList.toggle('done', data.integration.issueTemplate && data.integration.paseoService);
  document.getElementById('workspace-card').classList.toggle('done', Boolean(data.workspace?.id));
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
