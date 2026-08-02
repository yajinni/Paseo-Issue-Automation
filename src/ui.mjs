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
input { width: 100%; box-sizing: border-box; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 7px; padding: 10px; margin: 5px 0 12px; }
label { display: block; font-size: 13px; color: #b1bac4; }
.ok { color: #3fb950; }
.bad { color: #f85149; }
pre { white-space: pre-wrap; background: #0d1117; padding: 12px; border-radius: 7px; overflow: auto; }
.hidden { display: none; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
</head>
<body><main>
<h1>Issue Coding Automation</h1>
<p id="subtitle">Loading setup status…</p>
<div id="message"></div>
<section id="setup" class="hidden">
  <div class="grid">
    <article class="card" id="requirements-card">
      <h2>1. Check requirements</h2>
      <p>Checks Git, the GitHub CLI and authentication, the repository remote, and Paseo. This changes nothing.</p>
      <button onclick="refresh()">Check requirements</button>
      <pre id="requirements"></pre>
    </article>
    <article class="card" id="integration-card">
      <h2>2. Install repository integration</h2>
      <p>Adds the automation-ready GitHub issue template, merges one service into <code>paseo.json</code>, and creates the five lifecycle labels. Existing <code>paseo.json</code> settings are preserved.</p>
      <button onclick="post('/api/install')">Install repository files</button>
      <pre>.github/ISSUE_TEMPLATE/automated-coding-task.md\npaseo.json\nGitHub lifecycle labels</pre>
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
    <button class="secondary" onclick="showSetupAgain()">Setup and configuration</button>
  </article>
</section>
<script>
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
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('subtitle').textContent = 'Setup and configuration';
}
function render(data) {
  const setupDone = data.config.setupComplete;
  document.getElementById('setup').classList.toggle('hidden', setupDone);
  document.getElementById('dashboard').classList.toggle('hidden', !setupDone);
  document.getElementById('subtitle').textContent = setupDone ? 'Autonomous GitHub issue coding through Paseo' : 'Guided setup';
  const req = data.requirements;
  document.getElementById('requirements').textContent = [
    'Git: '+req.git,
    'GitHub CLI: '+req.githubCli,
    'GitHub authenticated: '+req.githubAuthenticated,
    'Paseo CLI: '+req.paseoCli,
    'Paseo reachable: '+req.paseoReachable,
    'Remote: '+(req.remote || 'missing')
  ].join('\n');
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
