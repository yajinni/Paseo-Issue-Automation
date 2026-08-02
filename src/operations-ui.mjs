const OPERATIONS_MARKUP = `
  <article class="card" style="margin-top:16px">
    <h2>Ready issues</h2>
    <p>Start a specific issue immediately or skip it temporarily while automatic claiming continues with other issues.</p>
    <div id="ready-issue-list" class="operations-list"><p class="muted">No ready issues.</p></div>
  </article>
  <article class="card" style="margin-top:16px">
    <h2>Issue attempts</h2>
    <p>Interrupted work is never recovered. Abandon it or restart it as a completely fresh attempt.</p>
    <div id="attempt-list" class="operations-list"><p class="muted">No recorded attempts.</p></div>
  </article>
`;

const OPERATIONS_STYLE = `
.operations-list { display:grid; gap:12px; }
.operation-card { background:#0d1117; border:1px solid #30363d; border-radius:9px; padding:14px; }
.operation-head { display:flex; justify-content:space-between; gap:12px; align-items:start; }
.operation-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:6px 14px; margin:10px 0; color:#9da7b3; font-size:13px; }
.timeline { max-height:260px; overflow:auto; margin-top:10px; }
.timeline-entry { border-left:2px solid #30363d; padding:5px 0 5px 10px; font-size:13px; }
.timeline-entry strong { display:block; color:#e6edf3; }
.operation-card a { color:#58a6ff; }
`;

const OPERATIONS_SCRIPT = `
function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function issueActionButton(text, className, handler) {
  const button = document.createElement('button');
  button.textContent = text;
  if (className) button.className = className;
  button.onclick = handler;
  return button;
}
async function startSpecificIssue(number, branchExists) {
  let branchAction = 'keep';
  if (branchExists) {
    const choice = window.prompt('The normal issue branch already exists. Type KEEP to preserve it and start a numbered attempt branch, DELETE to delete the package-recorded old branch after safety checks, or CANCEL.', 'KEEP');
    if (!choice || choice.trim().toUpperCase() === 'CANCEL') return;
    const normalized = choice.trim().toUpperCase();
    if (normalized === 'DELETE') branchAction = 'delete';
    else if (normalized !== 'KEEP') { showMessage('Start cancelled: enter KEEP, DELETE, or CANCEL.', true); return; }
  }
  await post('/api/start-issue', {issueNumber:number, branchAction});
}
async function restartAttempt(number, branchAction) {
  const explanation = branchAction === 'delete'
    ? 'Archive the old attempt, delete its recorded branch only if it has no open PR, and start fresh?'
    : 'Archive the old attempt, keep its branch, and start a fresh numbered attempt branch?';
  if (!window.confirm(explanation)) return;
  await post('/api/restart-issue', {issueNumber:number, branchAction});
}
async function abandonAttempt(number) {
  const reason = window.prompt('Why are you abandoning this attempt?', 'Abandoned by user');
  if (reason === null) return;
  await post('/api/abandon-issue', {issueNumber:number, reason:reason || 'Abandoned by user'});
}
function activityText(attempt) {
  return (attempt.activity || []).map((entry) => [entry.at, entry.type, entry.result, entry.commit, entry.details].filter(Boolean).join(' | ')).join('\n');
}
function copyActivity(attempt) {
  navigator.clipboard.writeText(activityText(attempt)).then(() => showMessage('Activity copied.')).catch((error) => showMessage(error.message, true));
}
function downloadActivity(attempt) {
  const blob = new Blob([JSON.stringify(attempt, null, 2)], {type:'application/json'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'issue-'+attempt.issueNumber+'-attempt-'+attempt.attempt+'.json';
  link.click();
  URL.revokeObjectURL(link.href);
}
function renderReadyIssues(data) {
  const list = document.getElementById('ready-issue-list');
  if (!list) return;
  list.innerHTML = '';
  const issues = data.automation?.readyIssues || [];
  if (!issues.length) { list.innerHTML = '<p class="muted">No ready issues.</p>'; return; }
  for (const issue of issues) {
    const card = document.createElement('div'); card.className = 'operation-card';
    const head = document.createElement('div'); head.className = 'operation-head';
    head.innerHTML = '<div><strong>#'+issue.number+' '+escapeHtml(issue.title)+'</strong><div class="muted">'+(issue.skipped?'Skipped for automatic claiming':'Eligible for automatic claiming')+(issue.branchExists?' · normal branch exists':'')+'</div></div>';
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.appendChild(issueActionButton('Start this issue', '', () => startSpecificIssue(issue.number, issue.branchExists)));
    actions.appendChild(issueActionButton(issue.skipped ? 'Unskip' : 'Skip for now', 'secondary', () => post(issue.skipped?'/api/unskip-issue':'/api/skip-issue', {issueNumber:issue.number})));
    const open = document.createElement('a'); open.href=issue.url; open.target='_blank'; open.rel='noreferrer'; open.textContent='Open issue'; open.style.padding='10px'; actions.appendChild(open);
    head.appendChild(actions); card.appendChild(head); list.appendChild(card);
  }
}
function renderAttempts(data) {
  const list = document.getElementById('attempt-list');
  if (!list) return;
  list.innerHTML = '';
  const attempts = data.automation?.attempts || [];
  if (!attempts.length) { list.innerHTML = '<p class="muted">No recorded attempts.</p>'; return; }
  for (const attempt of attempts) {
    const card = document.createElement('div'); card.className = 'operation-card';
    const title = document.createElement('div'); title.className = 'operation-head';
    title.innerHTML = '<div><strong>#'+attempt.issueNumber+' '+escapeHtml(attempt.issueTitle)+'</strong><div class="muted">Attempt '+attempt.attempt+' · '+escapeHtml(attempt.status || 'unknown')+'</div></div>';
    const links = document.createElement('div'); links.className='actions';
    if (attempt.issueUrl) { const a=document.createElement('a'); a.href=attempt.issueUrl; a.target='_blank'; a.rel='noreferrer'; a.textContent='Issue'; a.style.padding='10px'; links.appendChild(a); }
    if (attempt.prUrl) { const a=document.createElement('a'); a.href=attempt.prUrl; a.target='_blank'; a.rel='noreferrer'; a.textContent='PR #'+attempt.prNumber; a.style.padding='10px'; links.appendChild(a); }
    title.appendChild(links); card.appendChild(title);
    const meta = document.createElement('div'); meta.className='operation-meta';
    meta.innerHTML = '<span>Phase: '+escapeHtml(attempt.phase || '—')+'</span><span>Branch: '+escapeHtml(attempt.branch || '—')+'</span><span>Started: '+escapeHtml(formatWhen(attempt.startedAt))+'</span><span>Last heartbeat: '+escapeHtml(formatWhen(attempt.heartbeatAt))+'</span><span>Review round: '+attempt.reviewRound+' / '+data.config.maxReviewRounds+'</span><span>Workspace: '+escapeHtml(attempt.workspaceId || '—')+'</span>';
    card.appendChild(meta);
    const actions = document.createElement('div'); actions.className='actions';
    if (attempt.workspaceId) actions.appendChild(issueActionButton('Open Paseo workspace', 'secondary', () => post('/api/open-attempt-workspace',{issueNumber:attempt.issueNumber})));
    if (attempt.status === 'agent-running') actions.appendChild(issueActionButton('Abandon attempt', 'danger', () => abandonAttempt(attempt.issueNumber)));
    if (attempt.status !== 'agent-running' && attempt.status !== 'human-review') {
      actions.appendChild(issueActionButton('Restart, keep old branch', 'secondary', () => restartAttempt(attempt.issueNumber,'keep')));
      actions.appendChild(issueActionButton('Restart, delete old branch', 'warning', () => restartAttempt(attempt.issueNumber,'delete')));
    }
    actions.appendChild(issueActionButton('Copy activity', 'secondary', () => copyActivity(attempt)));
    actions.appendChild(issueActionButton('Download JSON', 'secondary', () => downloadActivity(attempt)));
    card.appendChild(actions);
    const timeline = document.createElement('div'); timeline.className='timeline';
    const entries = attempt.activity || [];
    timeline.innerHTML = entries.length ? entries.map((entry) => '<div class="timeline-entry"><strong>'+escapeHtml(entry.type)+'</strong><span>'+escapeHtml(formatWhen(entry.at))+(entry.details?' · '+escapeHtml(entry.details):'')+(entry.result?' · '+escapeHtml(entry.result):'')+'</span></div>').join('') : '<p class="muted">No activity recorded.</p>';
    card.appendChild(timeline); list.appendChild(card);
  }
}
const originalRenderForOperations = render;
render = function(data) {
  originalRenderForOperations(data);
  renderReadyIssues(data);
  renderAttempts(data);
};
`;

export function enhanceDashboardHtml(html) {
  return html
    .replace('</style>', `${OPERATIONS_STYLE}\n</style>`)
    .replace(/(<article class="card" style="margin-top:16px">\s*<h2>Configuration<\/h2>)/, `${OPERATIONS_MARKUP}\n$1`)
    .replace('</body>', `<script>${OPERATIONS_SCRIPT}</script>\n</body>`);
}
