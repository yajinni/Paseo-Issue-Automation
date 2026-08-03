export const CONTROL_CENTER_SCRIPT = String.raw`
let dashboardData = null;
let currentIssueFilter = 'all';
let currentView = 'overview';
let actionCallback = null;
let countdownTimer = null;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
  });
}

function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatRelative(value) {
  if (!value) return '—';
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return String(value);
  const difference = target - Date.now();
  const seconds = Math.round(Math.abs(difference) / 1000);
  if (seconds < 5) return difference >= 0 ? 'now' : 'just now';
  if (seconds < 60) return (difference >= 0 ? 'in ' : '') + seconds + 's' + (difference < 0 ? ' ago' : '');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return (difference >= 0 ? 'in ' : '') + minutes + 'm' + (difference < 0 ? ' ago' : '');
  const hours = Math.round(minutes / 60);
  return (difference >= 0 ? 'in ' : '') + hours + 'h' + (difference < 0 ? ' ago' : '');
}

function shortSha(value) {
  return value ? String(value).slice(0, 9) : '—';
}

function statusLabel(status) {
  return {
    'agent-ready': 'Ready',
    'agent-running': 'Running',
    'automation-blocked': 'Blocked',
    'automation-failed': 'Failed',
    'human-review': 'Human review',
    'abandoned': 'Abandoned',
    'open': 'Open'
  }[status] || String(status || 'Unknown');
}

function statusClass(status) {
  return {
    'agent-ready': 'ready',
    'agent-running': 'running',
    'automation-blocked': 'blocked',
    'automation-failed': 'failed',
    'human-review': 'review'
  }[status] || '';
}

function toast(message, bad) {
  const region = document.getElementById('toast-region');
  const item = document.createElement('div');
  item.className = 'toast' + (bad ? ' bad' : '');
  item.textContent = message;
  region.appendChild(item);
  setTimeout(function() { item.remove(); }, bad ? 8000 : 3500);
}

async function api(path, options) {
  const response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

async function postAction(path, body, successMessage) {
  try {
    const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    toast(successMessage || 'Action completed.');
    await refreshStatus();
    return result;
  } catch (error) {
    toast(error.message, true);
    return null;
  }
}

function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(function(section) {
    section.classList.toggle('active', section.id === 'view-' + name);
  });
  document.querySelectorAll('.nav-tab').forEach(function(button) {
    button.classList.toggle('active', button.dataset.view === name);
  });
  history.replaceState(null, '', '#' + name);
}

function filterIssues(filter) {
  currentIssueFilter = filter;
  showView('issues');
  document.querySelectorAll('.filter-button').forEach(function(button) {
    button.classList.toggle('active', button.dataset.filter === filter);
  });
  renderIssueBoard();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog.open) dialog.close();
  if (id === 'action-dialog') actionCallback = null;
}

function openActionDialog(title, description, bodyHtml, confirmText, callback, danger) {
  document.getElementById('action-dialog-title').textContent = title;
  document.getElementById('action-dialog-description').textContent = description || '';
  document.getElementById('action-dialog-body').innerHTML = bodyHtml || '';
  const confirm = document.getElementById('action-dialog-confirm');
  confirm.textContent = confirmText || 'Continue';
  confirm.className = danger ? 'danger' : '';
  confirm.disabled = false;
  actionCallback = callback;
  confirm.onclick = async function() {
    if (!actionCallback) return;
    const task = actionCallback;
    actionCallback = null;
    closeDialog('action-dialog');
    await task();
  };
  document.getElementById('action-dialog').showModal();
}

function confirmAction(title, description, path, body) {
  openActionDialog(title, description, '<p class="muted">This action will be recorded by the controller.</p>', 'Continue', function() {
    return postAction(path, body || {});
  }, true);
}

function typedConfirmAction(title, description, phrase, path, body) {
  const html = '<label>Type <strong>' + escapeHtml(phrase) + '</strong> to continue<input id="typed-confirm-input" autocomplete="off"></label>';
  openActionDialog(title, description, html, 'Continue', function() {
    return postAction(path, body || {});
  }, true);
  const input = document.getElementById('typed-confirm-input');
  const confirm = document.getElementById('action-dialog-confirm');
  confirm.disabled = true;
  input.addEventListener('input', function() {
    confirm.disabled = input.value.trim() !== phrase;
  });
  input.focus();
}

function uninstallPayload() {
  return {
    issueTemplate: document.getElementById('uninstall-template').checked,
    paseoService: document.getElementById('uninstall-paseo').checked,
    labels: document.getElementById('uninstall-labels').checked,
    workspace: document.getElementById('uninstall-workspace').checked,
    localState: document.getElementById('uninstall-state').checked,
    forceLabels: document.getElementById('uninstall-force-labels').checked
  };
}

function findAttempt(issueNumber) {
  return (dashboardData && dashboardData.automation && dashboardData.automation.attempts || []).find(function(attempt) {
    return Number(attempt.issueNumber) === Number(issueNumber);
  }) || null;
}

function findIssue(issueNumber) {
  return (dashboardData && dashboardData.automation && dashboardData.automation.issues || []).find(function(issue) {
    return Number(issue.number) === Number(issueNumber);
  }) || null;
}

function openBranchChoice(issue) {
  const body = [
    '<p>The normal branch already exists. Choose how to start a fresh attempt.</p>',
    '<div class="grid two">',
    '<button id="branch-keep" class="secondary">Keep old branch and create a numbered attempt branch</button>',
    '<button id="branch-delete" class="danger">Delete the package-recorded branch after safety checks</button>',
    '</div>'
  ].join('');
  openActionDialog('Existing issue branch', 'No branch is deleted automatically.', body, 'Cancel', function() {}, false);
  document.getElementById('action-dialog-confirm').classList.add('hidden');
  document.getElementById('branch-keep').onclick = function() {
    closeDialog('action-dialog');
    postAction('/api/start-issue', { issueNumber: issue.number, branchAction: 'keep' }, 'Issue started on a numbered attempt branch.');
  };
  document.getElementById('branch-delete').onclick = function() {
    closeDialog('action-dialog');
    typedConfirmAction('Delete recorded branch', 'The controller refuses deletion when an open PR exists.', 'DELETE', '/api/start-issue', { issueNumber: issue.number, branchAction: 'delete' });
  };
}

function startIssue(issueNumber) {
  const issue = findIssue(issueNumber);
  if (!issue) return;
  if (issue.branchExists) openBranchChoice(issue);
  else postAction('/api/start-issue', { issueNumber: issue.number, branchAction: 'keep' }, 'Issue started.');
}

function restartIssue(issueNumber, branchAction) {
  const description = branchAction === 'delete'
    ? 'Archive the old attempt, delete its recorded branch only after safety checks, and start fresh.'
    : 'Archive the old attempt, keep its branch, and start a fresh numbered attempt.';
  if (branchAction === 'delete') {
    typedConfirmAction('Restart and delete old branch', description, 'DELETE', '/api/restart-issue', { issueNumber: issueNumber, branchAction: branchAction });
  } else {
    confirmAction('Restart issue attempt', description, '/api/restart-issue', { issueNumber: issueNumber, branchAction: branchAction });
  }
}

function abandonIssue(issueNumber) {
  const html = '<label>Reason<textarea id="abandon-reason">Abandoned by user</textarea></label>';
  openActionDialog('Abandon issue attempt', 'The running Coder is stopped and the workspace is archived on a best-effort basis.', html, 'Abandon attempt', function() {
    const reason = document.getElementById('abandon-reason').value.trim() || 'Abandoned by user';
    return postAction('/api/abandon-issue', { issueNumber: issueNumber, reason: reason });
  }, true);
}

function openWorkspace(issueNumber) {
  postAction('/api/open-attempt-workspace', { issueNumber: issueNumber }, 'Paseo workspace opened.');
}

function issueBadges(issue) {
  const badges = ['<span class="badge ' + statusClass(issue.status) + '">' + escapeHtml(statusLabel(issue.status)) + '</span>'];
  if (issue.phase) badges.push('<span class="badge">' + escapeHtml(issue.phase) + '</span>');
  if (issue.skipped) badges.push('<span class="badge blocked">Skipped</span>');
  if (issue.dependencies && issue.dependencies.length) badges.push('<span class="badge">' + issue.dependencies.length + ' dependencies</span>');
  if (issue.pr && issue.pr.checks) badges.push('<span class="badge ' + (issue.pr.checks.state === 'passed' ? 'ready' : issue.pr.checks.state === 'failed' ? 'failed' : '') + '">CI ' + escapeHtml(issue.pr.checks.state) + '</span>');
  return badges.join('');
}

function issueActions(issue, compact) {
  const actions = [];
  if (issue.status === 'agent-ready') {
    actions.push('<button class="small" onclick="event.stopPropagation();startIssue(' + issue.number + ')">Start</button>');
    actions.push('<button class="small secondary" onclick="event.stopPropagation();postAction(\'' + (issue.skipped ? '/api/unskip-issue' : '/api/skip-issue') + '\',{issueNumber:' + issue.number + '})">' + (issue.skipped ? 'Unskip' : 'Skip') + '</button>');
  }
  if (issue.status === 'agent-running') {
    const attempt = findAttempt(issue.number);
    if (attempt && attempt.workspaceId) actions.push('<button class="small secondary" onclick="event.stopPropagation();openWorkspace(' + issue.number + ')">Workspace</button>');
    actions.push('<button class="small danger" onclick="event.stopPropagation();abandonIssue(' + issue.number + ')">Abandon</button>');
  }
  if (issue.status === 'automation-failed' || issue.status === 'abandoned') {
    actions.push('<button class="small secondary" onclick="event.stopPropagation();restartIssue(' + issue.number + ',\'keep\')">Restart</button>');
  }
  if (issue.prUrl) actions.push('<a href="' + escapeHtml(issue.prUrl) + '" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">PR #' + escapeHtml(issue.prNumber) + '</a>');
  if (issue.url) actions.push('<a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Issue</a>');
  if (!compact) actions.push('<button class="small ghost" onclick="event.stopPropagation();openIssueDetails(' + issue.number + ')">Details</button>');
  return '<div class="actions">' + actions.join('') + '</div>';
}

function issueCard(issue, compact) {
  const dependencies = issue.dependencies && issue.dependencies.length ? issue.dependencies.map(function(number) { return '#' + number; }).join(', ') : 'None';
  const meta = compact ? '' : [
    '<div class="meta-grid">',
    '<span>Dependencies: <strong>' + escapeHtml(dependencies) + '</strong></span>',
    '<span>Branch: <strong class="code">' + escapeHtml(issue.branch || '—') + '</strong></span>',
    '<span>Review round: <strong>' + escapeHtml(issue.reviewRound || 0) + '</strong></span>',
    '<span>PR head: <strong class="code">' + escapeHtml(shortSha(issue.pr && issue.pr.head)) + '</strong></span>',
    '</div>'
  ].join('');
  const reason = issue.reason ? '<div class="reason">' + escapeHtml(issue.reason) + '</div>' : '';
  return [
    '<div class="issue-card ' + statusClass(issue.status) + (issue.status === 'human-review' ? ' important' : '') + '" onclick="openIssueDetails(' + issue.number + ')">',
    '<div class="issue-head"><div><div class="issue-title">#' + issue.number + ' ' + escapeHtml(issue.title) + '</div><div class="issue-subtitle">' + escapeHtml(issue.phase || statusLabel(issue.status)) + '</div><div class="badges">' + issueBadges(issue) + '</div></div>',
    issueActions(issue, compact),
    '</div>',
    meta,
    reason,
    '</div>'
  ].join('');
}

function renderHumanReview() {
  const list = document.getElementById('human-review-list');
  const issues = (dashboardData.automation.issues || []).filter(function(issue) { return issue.status === 'human-review'; });
  list.innerHTML = issues.length ? issues.map(function(issue) { return issueCard(issue, true); }).join('') : '<div class="empty">Nothing is waiting for human review.</div>';
}

function renderActiveExecution() {
  const list = document.getElementById('active-execution-list');
  const issues = (dashboardData.automation.issues || []).filter(function(issue) { return issue.status === 'agent-running'; });
  list.innerHTML = issues.length ? issues.map(function(issue) { return issueCard(issue, true); }).join('') : '<div class="empty">No active issue attempts.</div>';
}

function renderDependencyQueue() {
  const list = document.getElementById('dependency-queue-list');
  const issues = (dashboardData.automation.issues || []).filter(function(issue) {
    return issue.status === 'automation-blocked' && issue.dependencies && issue.dependencies.length;
  });
  list.innerHTML = issues.length ? issues.map(function(issue) { return issueCard(issue, true); }).join('') : '<div class="empty">No dependency-blocked issues.</div>';
}

function renderScheduling() {
  const controller = dashboardData.automation.controller || {};
  const capacity = controller.capacity || { active: 0, maximum: dashboardData.config.maxActive, available: dashboardData.config.maxActive };
  document.getElementById('scheduling-summary').innerHTML = [
    '<span>Active slots: <strong>' + capacity.active + ' / ' + capacity.maximum + '</strong></span>',
    '<span>Available slots: <strong>' + capacity.available + '</strong></span>',
    '<span>Polling interval: <strong>' + escapeHtml(controller.pollIntervalSeconds || dashboardData.config.pollIntervalSeconds) + 's</strong></span>',
    '<span>Last dispatch: <strong>' + escapeHtml(formatWhen(controller.lastDispatchAt)) + '</strong></span>',
    '<span>Next poll: <strong>' + escapeHtml(formatWhen(controller.nextPollAt)) + '</strong></span>',
    '<span>Base branch: <strong class="code">' + escapeHtml(dashboardData.config.baseBranch) + '</strong></span>'
  ].join('');
  document.getElementById('last-dispatch-result').textContent = controller.lastDispatchResult ? JSON.stringify(controller.lastDispatchResult, null, 2) : 'No dispatch has been recorded.';
}

function activityEntry(entry) {
  const details = [entry.result, entry.commit ? shortSha(entry.commit) : null, entry.details].filter(Boolean).join(' · ');
  return '<div class="timeline-entry"><div class="time">' + escapeHtml(formatWhen(entry.at)) + ' · Issue #' + escapeHtml(entry.issueNumber || '—') + '</div><div class="event">' + escapeHtml(entry.type || 'event') + '</div><div class="details">' + escapeHtml(details) + '</div></div>';
}

function renderActivity() {
  const activity = dashboardData.automation.controller && dashboardData.automation.controller.recentActivity || [];
  document.getElementById('overview-activity').innerHTML = activity.length ? activity.slice(0, 8).map(activityEntry).join('') : '<div class="empty">No activity recorded.</div>';
  document.getElementById('activity-list').innerHTML = activity.length ? activity.map(activityEntry).join('') : '<div class="empty">No activity recorded.</div>';
}

function renderIssueBoard() {
  if (!dashboardData) return;
  const list = document.getElementById('issue-list');
  let issues = dashboardData.automation.issues || [];
  if (currentIssueFilter !== 'all') issues = issues.filter(function(issue) { return issue.status === currentIssueFilter; });
  list.innerHTML = issues.length ? issues.map(function(issue) { return issueCard(issue, false); }).join('') : '<div class="empty">No issues match this filter.</div>';
}

function renderDependencies() {
  const controller = dashboardData.automation.controller || {};
  const waves = controller.waves || [];
  document.getElementById('execution-waves').innerHTML = waves.length ? waves.map(function(wave) {
    return '<div class="wave"><div class="wave-label">Wave ' + wave.number + '</div><div class="wave-issues">' + wave.issues.map(function(issue) {
      return '<button class="secondary small" onclick="openIssueDetails(' + issue.number + ')">#' + issue.number + ' ' + escapeHtml(issue.title) + '</button>';
    }).join('') + '</div></div>';
  }).join('') : '<div class="empty">No dependency graph available.</div>';

  const cycles = controller.cycles || [];
  const unresolved = controller.unresolvedWaveIssues || [];
  const health = [
    '<div class="component"><div class="component-head"><strong>Native dependency API</strong><span class="status-dot ' + (controller.dependencyApiAvailable ? 'good' : 'bad') + '"></span></div><p>' + (controller.dependencyApiAvailable ? 'Structured GitHub blocked-by data is available.' : 'Execution is blocked where relationship data is unavailable.') + '</p></div>',
    '<div class="component"><div class="component-head"><strong>Cycles</strong><span>' + cycles.length + '</span></div><p>' + (cycles.length ? escapeHtml(cycles.map(function(cycle) { return cycle.join(' → '); }).join('\n')) : 'No cycles detected.') + '</p></div>',
    '<div class="component"><div class="component-head"><strong>Unresolved graph nodes</strong><span>' + unresolved.length + '</span></div><p>' + (unresolved.length ? escapeHtml(unresolved.map(function(number) { return '#' + number; }).join(', ')) : 'Every node can be assigned to an execution wave.') + '</p></div>'
  ];
  document.getElementById('graph-health').innerHTML = health.join('');

  const issues = dashboardData.automation.issues || [];
  document.getElementById('dependency-map').innerHTML = issues.length ? issues.map(function(issue) {
    const blockedBy = issue.dependencies && issue.dependencies.length ? issue.dependencies.map(function(number) { return '#' + number; }).join(', ') : 'None';
    const blocking = issue.blocking && issue.blocking.length ? issue.blocking.map(function(number) { return '#' + number; }).join(', ') : 'None';
    return '<div class="dependency-node" onclick="openIssueDetails(' + issue.number + ')"><strong>#' + issue.number + ' ' + escapeHtml(issue.title) + '</strong><div class="badges">' + issueBadges(issue) + '</div><div class="dependency-line">Blocked by: ' + escapeHtml(blockedBy) + '</div><div class="dependency-line">Blocking: ' + escapeHtml(blocking) + '</div></div>';
  }).join('') : '<div class="empty">No dependency relationships found.</div>';
}

function openIssueDetails(issueNumber) {
  const issue = findIssue(issueNumber);
  const attempt = findAttempt(issueNumber);
  if (!issue) return;
  document.getElementById('issue-dialog-title').textContent = '#' + issue.number + ' ' + issue.title;
  document.getElementById('issue-dialog-subtitle').textContent = statusLabel(issue.status) + (issue.phase ? ' · ' + issue.phase : '');
  const dependencies = issue.dependencies && issue.dependencies.length ? issue.dependencies.map(function(number) { return '#' + number; }).join(', ') : 'None';
  const blocking = issue.blocking && issue.blocking.length ? issue.blocking.map(function(number) { return '#' + number; }).join(', ') : 'None';
  const pr = issue.pr || {};
  const checks = pr.checks || { state: 'none', total: 0, failed: 0, pending: 0, checks: [] };
  const review = issue.review || attempt && attempt.review;
  const validation = issue.validation || attempt && attempt.validation;
  const body = [
    '<div class="section-stack">',
    '<div class="card"><div class="badges">' + issueBadges(issue) + '</div><div class="meta-grid">',
    '<span>Status: <strong>' + escapeHtml(statusLabel(issue.status)) + '</strong></span>',
    '<span>Phase: <strong>' + escapeHtml(issue.phase || '—') + '</strong></span>',
    '<span>Branch: <strong class="code">' + escapeHtml(issue.branch || '—') + '</strong></span>',
    '<span>Workspace: <strong>' + escapeHtml(attempt && attempt.workspaceId || '—') + '</strong></span>',
    '<span>Blocked by: <strong>' + escapeHtml(dependencies) + '</strong></span>',
    '<span>Blocking: <strong>' + escapeHtml(blocking) + '</strong></span>',
    '<span>Base freshness: <strong>' + escapeHtml(issue.baseFreshness && issue.baseFreshness.state || 'unknown') + '</strong></span>',
    '<span>Review round: <strong>' + escapeHtml(issue.reviewRound || 0) + '</strong></span>',
    '</div>' + (issue.reason ? '<div class="reason">' + escapeHtml(issue.reason) + '</div>' : '') + '</div>',
    '<div class="grid two">',
    '<div class="card"><h3>Validation</h3><div class="meta-grid"><span>Commit: <strong class="code">' + escapeHtml(validation && validation.commit || '—') + '</strong></span><span>Recorded: <strong>' + escapeHtml(formatWhen(validation && validation.at)) + '</strong></span></div><p class="muted">' + escapeHtml(validation && validation.details || 'No passing validation summary recorded.') + '</p></div>',
    '<div class="card"><h3>Independent review</h3><div class="meta-grid"><span>Verdict: <strong>' + escapeHtml(review && review.result || '—') + '</strong></span><span>Commit: <strong class="code">' + escapeHtml(review && review.commit || '—') + '</strong></span></div><div class="review-findings">' + escapeHtml(review && review.findings || 'No Reviewer findings recorded.') + '</div></div>',
    '</div>',
    '<div class="card"><h3>Pull request and CI</h3><div class="meta-grid"><span>PR: <strong>' + escapeHtml(pr.number ? '#' + pr.number : '—') + '</strong></span><span>Head: <strong class="code">' + escapeHtml(pr.head || '—') + '</strong></span><span>Base: <strong class="code">' + escapeHtml(pr.base || '—') + '</strong></span><span>Draft: <strong>' + escapeHtml(pr.isDraft == null ? '—' : pr.isDraft ? 'Yes' : 'No') + '</strong></span><span>Mergeable: <strong>' + escapeHtml(pr.mergeable || '—') + '</strong></span><span>CI: <strong>' + escapeHtml(checks.state) + ' (' + checks.total + ')</strong></span></div>' + (checks.checks && checks.checks.length ? '<pre>' + escapeHtml(checks.checks.map(function(check) { return check.name + ': ' + check.state; }).join('\n')) + '</pre>' : '') + '</div>',
    '<div class="card"><h3>Attempt timeline</h3><div class="timeline">' + (attempt && attempt.activity && attempt.activity.length ? attempt.activity.map(function(entry) { return activityEntry(Object.assign({}, entry, { issueNumber: issue.number })); }).join('') : '<div class="empty">No timeline entries.</div>') + '</div></div>',
    '</div>'
  ].join('');
  document.getElementById('issue-dialog-body').innerHTML = body;
  document.getElementById('issue-dialog-footer').innerHTML = issueActions(issue, true) + '<button class="secondary" onclick="closeDialog(\'issue-dialog\')">Close</button>';
  document.getElementById('issue-dialog').showModal();
}

function copyAllActivity() {
  const activity = dashboardData.automation.controller && dashboardData.automation.controller.recentActivity || [];
  navigator.clipboard.writeText(JSON.stringify(activity, null, 2)).then(function() { toast('Activity copied.'); }).catch(function(error) { toast(error.message, true); });
}

function downloadAllActivity() {
  const activity = dashboardData.automation.controller && dashboardData.automation.controller.recentActivity || [];
  const blob = new Blob([JSON.stringify(activity, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'issue-execution-controller-activity.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadPreview() {
  try {
    const preview = await api('/api/preview');
    document.getElementById('install-preview').textContent = JSON.stringify(preview, null, 2);
  } catch (error) {
    toast(error.message, true);
  }
}

function installAll() {
  confirmAction('Install shown components', 'Install the files, labels, service, and workspace shown in the preview?', '/api/install');
}

async function saveConfig() {
  await postAction('/api/config', {
    baseBranch: document.getElementById('baseBranch').value,
    models: {
      coder: document.getElementById('coder').value,
      reviewer: document.getElementById('reviewer').value
    },
    pollIntervalSeconds: Number(document.getElementById('pollIntervalSeconds').value),
    maxActive: Number(document.getElementById('maxActive').value),
    maxReviewRounds: Number(document.getElementById('maxReviewRounds').value)
  }, 'Configuration saved.');
}

async function runSelfTest() {
  const result = await postAction('/api/self-test', {}, 'Self-test completed.');
  if (result && result.result) document.getElementById('self-test').textContent = JSON.stringify(result.result, null, 2);
}

function renderLabels(data) {
  const list = document.getElementById('label-list');
  const labels = Object.values(data.integration && data.integration.labels || {});
  list.innerHTML = labels.length ? labels.map(function(label) {
    const status = !label.present ? 'Missing' : label.createdByPackage ? 'Created by this package' : 'Pre-existing label reused';
    const actions = [];
    if (label.canRepair) actions.push('<button class="small warning" onclick="postAction(\'/api/repair/label\',{label:\'' + escapeHtml(label.name) + '\'})">Repair</button>');
    if (label.createdByPackage) {
      actions.push('<button class="small danger" onclick="confirmAction(\'Remove label\',\'Remove package-created label ' + escapeHtml(label.name) + '?\',\'/api/remove/label\',{label:\'' + escapeHtml(label.name) + '\',force:false})">Remove</button>');
    }
    return '<div class="component"><div class="component-head"><code>' + escapeHtml(label.name) + '</code><span class="status-dot ' + (label.present ? 'good' : 'bad') + '"></span></div><p>' + escapeHtml(status) + '</p><div class="actions">' + actions.join('') + '</div></div>';
  }).join('') : '<div class="empty">No lifecycle labels found.</div>';
}

function renderInstallation(data) {
  const management = data.integration && data.integration.management || {};
  const issue = management.issueTemplate || {};
  const paseo = management.paseoJson || {};
  document.getElementById('issue-template-badge').innerHTML = '<span class="status-dot ' + (issue.present ? 'good' : 'bad') + '"></span>';
  document.getElementById('issue-template-status').textContent = !issue.present ? 'Not installed.' : issue.changedSinceInstall ? 'Changed after installation; restore before safe removal.' : issue.createdByPackage ? 'Package-created and unchanged.' : 'Pre-existing matching file; not package-owned.';
  document.getElementById('install-issue-template').classList.toggle('hidden', !!issue.present);
  document.getElementById('repair-issue-template').classList.toggle('hidden', !issue.canRepair);
  document.getElementById('remove-issue-template').classList.toggle('hidden', !issue.createdByPackage);
  document.getElementById('remove-issue-template').disabled = !issue.canRemove;

  document.getElementById('paseo-json-badge').innerHTML = '<span class="status-dot ' + (paseo.servicePresent ? 'good' : 'bad') + '"></span>';
  document.getElementById('paseo-json-status').textContent = !paseo.servicePresent ? 'Automation service not installed.' : paseo.changedSinceInstall ? 'Package-owned service changed; restore before safe removal.' : paseo.serviceAddedByPackage ? 'Package-owned service installed.' : 'Pre-existing matching service; not package-owned.';
  document.getElementById('install-paseo-service').classList.toggle('hidden', !!paseo.servicePresent);
  document.getElementById('repair-paseo-service').classList.toggle('hidden', !paseo.canRepair);
  document.getElementById('remove-paseo-integration').classList.toggle('hidden', !paseo.serviceAddedByPackage);
  document.getElementById('remove-paseo-integration').disabled = !paseo.canRemove;

  document.getElementById('labels-badge').innerHTML = '<span class="status-dot ' + (data.integration && data.integration.labelsReady ? 'good' : 'bad') + '"></span>';
  document.getElementById('workspace-badge').innerHTML = '<span class="status-dot ' + (data.workspace && data.workspace.id ? 'good' : 'bad') + '"></span>';
  document.getElementById('workspace').textContent = data.workspace && data.workspace.id ? data.workspace.title + ' · ' + data.workspace.id : 'Not created';
  document.getElementById('remove-workspace').classList.toggle('hidden', !(data.workspaceManagement && data.workspaceManagement.canRemove));
  renderLabels(data);
}

function renderSettings(data) {
  const requirements = data.requirements || {};
  document.getElementById('requirements').textContent = [
    'Git: ' + requirements.git,
    'GitHub CLI: ' + requirements.githubCli,
    'GitHub authenticated: ' + requirements.githubAuthenticated,
    'Paseo CLI: ' + requirements.paseoCli,
    'Paseo reachable: ' + requirements.paseoReachable,
    'Remote: ' + (requirements.remote || 'missing')
  ].join('\n');
  document.getElementById('baseBranch').value = data.config.baseBranch || requirements.defaultBranch || '';
  document.getElementById('coder').value = data.config.models.coder || '';
  document.getElementById('reviewer').value = data.config.models.reviewer || '';
  document.getElementById('pollIntervalSeconds').value = data.config.pollIntervalSeconds;
  document.getElementById('maxActive').value = data.config.maxActive;
  document.getElementById('maxReviewRounds').value = data.config.maxReviewRounds;
  document.getElementById('install-preview').textContent = JSON.stringify(data.preview || {}, null, 2);
  document.getElementById('state-path').textContent = data.stateDirectory || 'Unknown';
  document.getElementById('npm-uninstall-command').textContent = data.npmUninstallCommand || '';
  document.getElementById('requirements-card').classList.toggle('done', !!(requirements.githubAuthenticated && requirements.paseoReachable && requirements.remote));
  document.getElementById('config-card').classList.toggle('done', !!(data.checks && data.checks.modelsConfigured && data.checks.baseBranchExists));
  document.getElementById('installation-card').classList.toggle('done', !!(data.integration && data.integration.issueTemplate && data.integration.paseoService && data.integration.labelsReady && data.workspace && data.workspace.id));
  renderInstallation(data);
}

function setChip(id, text, state) {
  const chip = document.getElementById(id);
  chip.textContent = text;
  chip.className = 'chip ' + (state || '');
}

function renderHealth(data) {
  const controller = data.automation.controller || {};
  const capacity = controller.capacity || { active: 0, maximum: data.config.maxActive };
  setChip('health-claims', controller.claimsEnabled ? 'Claims running' : 'Claims paused', controller.claimsEnabled ? 'good' : 'warn');
  setChip('health-capacity', 'Capacity ' + capacity.active + ' / ' + capacity.maximum, capacity.active < capacity.maximum ? 'good' : 'info');
  setChip('health-poll', controller.nextPollAt ? 'Next poll ' + formatRelative(controller.nextPollAt) : 'Next poll pending', 'info');
  setChip('health-github', data.requirements.githubAuthenticated ? 'GitHub connected' : 'GitHub disconnected', data.requirements.githubAuthenticated ? 'good' : 'bad');
  setChip('health-paseo', data.requirements.paseoReachable ? 'Paseo connected' : 'Paseo unavailable', data.requirements.paseoReachable ? 'good' : 'bad');
  setChip('health-dependencies', controller.dependencyApiAvailable ? 'Native dependencies available' : 'Dependency API unavailable', controller.dependencyApiAvailable ? 'good' : 'bad');
  document.getElementById('resume-button').disabled = controller.claimsEnabled;
  document.getElementById('pause-button').disabled = !controller.claimsEnabled;
  const operational = data.config.setupComplete && data.checks && data.checks.ready;
  document.getElementById('controller-actions').classList.toggle('hidden', !operational);
  document.getElementById('subtitle').textContent = operational
    ? 'Autonomous GitHub issue coding through Paseo · Base ' + data.config.baseBranch
    : 'Setup or repair is required before autonomous execution can run.';
}

function renderCounts(data) {
  const counts = data.automation.counts || {};
  ['ready','running','blocked','failed','humanReview'].forEach(function(key) {
    document.getElementById('count-' + key).textContent = counts[key] || 0;
  });
}

function render(data) {
  dashboardData = data;
  if (!data.automation) {
    data.automation = { counts: {}, issues: [], attempts: [], controller: {} };
  }
  renderHealth(data);
  renderCounts(data);
  renderHumanReview();
  renderActiveExecution();
  renderDependencyQueue();
  renderScheduling();
  renderActivity();
  renderIssueBoard();
  renderDependencies();
  renderSettings(data);
  if (!(data.config.setupComplete && data.checks && data.checks.ready) && currentView !== 'maintenance') showView('settings');
}

async function refreshStatus() {
  try {
    const data = await api('/api/status');
    render(data);
  } catch (error) {
    toast(error.message, true);
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(function() {
    if (!dashboardData || !dashboardData.automation || !dashboardData.automation.controller) return;
    const controller = dashboardData.automation.controller;
    setChip('health-poll', controller.nextPollAt ? 'Next poll ' + formatRelative(controller.nextPollAt) : 'Next poll pending', 'info');
  }, 1000);
}

window.addEventListener('hashchange', function() {
  const view = location.hash.replace('#','');
  if (document.getElementById('view-' + view)) showView(view);
});

document.addEventListener('DOMContentLoaded', function() {
  const initial = location.hash.replace('#','');
  if (document.getElementById('view-' + initial)) showView(initial);
  refreshStatus();
  startCountdown();
  setInterval(refreshStatus, 15000);
});
`;
