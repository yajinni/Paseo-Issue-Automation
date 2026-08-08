import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_WORK_QUEUE_STYLE = String.raw`
.work-queue-card{padding:0!important;overflow:hidden}.work-queue-toolbar{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--paseo-border)}.work-queue-toolbar-fields{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.work-queue-toolbar label{display:grid;gap:5px;color:var(--paseo-muted);font-size:12px}.work-queue-toolbar input{min-width:240px}.work-queue-toolbar select{min-width:180px}.work-queue-count{font-size:12px;color:#8fa0b4;padding-bottom:10px;white-space:nowrap}
.work-queue-list{display:grid}.work-queue-item{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(140px,.75fr) minmax(140px,.75fr) auto;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #253042}.work-queue-item:last-child{border-bottom:0}.work-queue-title{min-width:0}.work-queue-title strong{display:block;overflow-wrap:anywhere}.work-queue-title a{color:#dbeafe;text-decoration:none}.work-queue-title a:hover{text-decoration:underline}.work-queue-subtitle{font-size:12px;color:#8fa0b4;margin-top:4px;overflow-wrap:anywhere}.work-queue-meta{font-size:12px;color:var(--paseo-muted)}.work-queue-meta strong{display:block;color:var(--paseo-text);font-size:13px;margin-top:2px}.work-queue-actions{display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap}.work-queue-actions button{padding:7px 10px;font-size:12px}
.work-stage{display:inline-flex;align-items:center;border:1px solid #526074;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700;background:#182231;color:#dbe7f7}.work-stage-ready{border-color:#356b4a;background:#12261a}.work-stage-queued,.work-stage-review-queued{border-color:#365f8b;background:#122238}.work-stage-coding,.work-stage-reviewing,.work-stage-fixing{border-color:#4b5f86;background:#18213a}.work-stage-changes-requested,.work-stage-waiting{border-color:#80672c;background:#2b2515}.work-stage-failed,.work-stage-review-failed,.work-stage-needs-attention{border-color:#894351;background:#301820}.work-stage-completed{border-color:#356b4a;background:#12261a;color:#b9e9ca}.work-stage-unknown{opacity:.75}
.work-queue-empty{padding:28px;text-align:center;color:var(--paseo-muted)}.work-queue-advanced{border:1px solid #2d394b;border-radius:12px;background:#111821}.work-queue-advanced>summary{cursor:pointer;padding:13px 15px;font-weight:650}.work-queue-advanced-content{display:grid;gap:12px;padding:0 14px 14px}.work-queue-advanced .card{box-shadow:none}
.work-detail-scrim{position:fixed;inset:0;z-index:120;background:#05070a99}.work-detail-scrim[hidden]{display:none}.work-detail-drawer{position:fixed;z-index:130;right:0;top:0;bottom:0;width:min(620px,94vw);background:#111821;border-left:1px solid #344153;box-shadow:-18px 0 55px #0008;padding:20px;overflow:auto;transform:translateX(0)}.work-detail-drawer[hidden]{display:none}.work-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--paseo-border)}.work-detail-head h2{margin:5px 0 0;font-size:21px}.work-detail-head .eyebrow{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8fa0b4}.work-detail-section{padding:16px 0;border-bottom:1px solid #253042}.work-detail-section h3{font-size:14px;margin:0 0 10px}.work-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px}.work-detail-fact{padding:9px 0}.work-detail-fact span{display:block;font-size:11px;color:#8fa0b4}.work-detail-fact strong{display:block;margin-top:3px;overflow-wrap:anywhere}.work-detail-reason{padding:11px 12px;border:1px solid #334156;border-radius:9px;background:#0f1620;color:#b9c7d8;line-height:1.45}.work-detail-timeline{display:grid;gap:9px}.work-detail-event{display:grid;grid-template-columns:9px minmax(0,1fr);gap:9px}.work-detail-event-dot{width:9px;height:9px;border-radius:50%;background:#526b8d;margin-top:5px}.work-detail-event strong{display:block;font-size:13px}.work-detail-event small{display:block;color:#718298;margin-top:2px}.work-detail-event div{color:#aab8c9;font-size:12px;margin-top:3px;line-height:1.4}.work-detail-actions{display:flex;gap:8px;flex-wrap:wrap}.work-detail-actions select{min-width:150px}.work-detail-link{color:#8ab8ff}
@media(max-width:900px){.work-queue-item{grid-template-columns:minmax(0,1fr) auto}.work-queue-meta{display:none}.work-queue-toolbar{align-items:stretch}.work-queue-toolbar-fields{width:100%}.work-queue-toolbar label{flex:1}.work-queue-toolbar input,.work-queue-toolbar select{min-width:0;width:100%}.work-queue-count{display:none}}
@media(max-width:560px){.work-queue-item{grid-template-columns:1fr}.work-queue-actions{justify-content:flex-start}.work-detail-grid{grid-template-columns:1fr}.work-queue-toolbar{display:block}.work-queue-toolbar-fields{display:grid;grid-template-columns:1fr}.work-detail-drawer{width:100%}}
`;

export const MANAGER_WORK_QUEUE_SCRIPT = String.raw`
(function managerWorkQueueUi() {
  let queueData = { items: [], counts: {}, total: 0, active: 0, attention: 0 };
  let statusData = null;
  let filter = 'all';
  let query = '';
  let selectedIssue = null;
  let drawerReturnFocus = null;

  function escapeText(value) { return value == null ? '' : String(value); }
  function onWorkQueue() { return document.querySelector('[data-manager-view="work-queue"]'); }
  function isAttention(item) { return ['failed', 'review-failed', 'needs-attention'].includes(item.stage); }
  function isActive(item) { return !['completed', 'failed', 'review-failed', 'needs-attention', 'ready', 'waiting'].includes(item.stage); }

  function queueShell() {
    const card = document.createElement('section');
    card.className = 'card work-queue-card';
    card.innerHTML = '<div class="work-queue-toolbar"><div class="work-queue-toolbar-fields">'
      + '<label>Search<input id="work-queue-search" type="search" placeholder="issue, title, branch, or PR"></label>'
      + '<label>Status<select id="work-queue-filter"><option value="all">All recorded work</option><option value="active">Active work</option><option value="attention">Needs attention</option><option value="ready">Ready</option><option value="waiting">Waiting for dependencies</option><option value="queued">Queued</option><option value="coding">Coding</option><option value="review-queued">Review queued</option><option value="reviewing">Reviewing</option><option value="changes-requested">Changes requested</option><option value="fixing">Fixing</option><option value="review-failed">Review failed</option><option value="failed">Failed</option><option value="completed">Completed</option></select></label>'
      + '</div><div class="work-queue-count" id="work-queue-count">Loading…</div></div><div class="work-queue-list" id="work-queue-list"><div class="work-queue-empty">Loading recorded work…</div></div>';
    return card;
  }

  function advancedShell(manualPanel, rawPanel) {
    const details = document.createElement('details');
    details.className = 'work-queue-advanced';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced manual issue controls and raw action result';
    const content = document.createElement('div');
    content.className = 'work-queue-advanced-content';
    if (manualPanel) content.append(manualPanel);
    if (rawPanel) content.append(rawPanel);
    details.append(summary, content);
    return details;
  }

  function createDrawer() {
    if (document.getElementById('work-detail-drawer')) return;
    const scrim = document.createElement('div');
    scrim.id = 'work-detail-scrim';
    scrim.className = 'work-detail-scrim';
    scrim.hidden = true;
    scrim.setAttribute('aria-hidden', 'true');
    scrim.addEventListener('click', closeDrawer);
    const drawer = document.createElement('aside');
    drawer.id = 'work-detail-drawer';
    drawer.className = 'work-detail-drawer';
    drawer.hidden = true;
    drawer.tabIndex = -1;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'work-detail-title');
    document.body.append(scrim, drawer);
  }

  function build() {
    const view = onWorkQueue();
    if (!view || view.dataset.workQueueReady === 'true') return;
    view.dataset.workQueueReady = 'true';
    const panels = [...view.children];
    const manual = panels.find((panel) => panel.querySelector?.('h2')?.textContent.trim() === 'Manual issue action') || null;
    const raw = panels.find((panel) => panel.querySelector?.('h2')?.textContent.trim() === 'Latest action result') || null;
    view.replaceChildren(queueShell(), advancedShell(manual, raw));
    document.getElementById('work-queue-search')?.addEventListener('input', (event) => { query = event.target.value; render(); });
    document.getElementById('work-queue-filter')?.addEventListener('change', (event) => { filter = event.target.value; render(); });
    createDrawer();
    render();
  }

  function matches(item) {
    if (filter === 'active' && !isActive(item)) return false;
    if (filter === 'attention' && !isAttention(item)) return false;
    if (!['all', 'active', 'attention'].includes(filter) && item.stage !== filter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [item.issueNumber, item.title, item.branch, item.pullRequest?.number, item.pullRequest?.url, item.stageLabel, item.reason]
      .filter((value) => value != null).join(' ').toLowerCase();
    return haystack.includes(needle);
  }

  function stageChip(item) {
    const span = document.createElement('span');
    span.className = 'work-stage work-stage-' + item.stage;
    span.textContent = item.stageLabel || item.stage || 'Unknown';
    return span;
  }

  function itemSubtitle(item) {
    const bits = [];
    if (item.branch) bits.push(item.branch);
    if (item.attempt) bits.push('attempt ' + item.attempt);
    if (item.pullRequest?.number) bits.push('PR #' + item.pullRequest.number);
    return bits.join(' · ') || item.nextAction || '';
  }

  function actionButton(label, action, item, className = 'secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.issueAction = action;
    button.textContent = label;
    button.addEventListener('click', (event) => { event.stopPropagation(); runItemAction(action, item).catch(showQueueError); });
    return button;
  }

  function itemActions(item) {
    const actions = document.createElement('div');
    actions.className = 'work-queue-actions';
    const details = document.createElement('button');
    details.type = 'button'; details.className = 'secondary'; details.textContent = 'Details'; details.dataset.workDetails = 'true';
    details.addEventListener('click', (event) => openDrawer(item, event.currentTarget));
    actions.append(details);
    const skipped = (statusData?.automation?.skippedIssueNumbers || []).includes(Number(item.issueNumber));
    if (skipped) actions.append(actionButton('Unskip', 'unskip-issue', item));
    else actions.append(actionButton('Skip', 'skip-issue', item));
    if (item.stage === 'ready' && !skipped) actions.append(actionButton('Start', 'start-issue', item, ''));
    if (isAttention(item)) actions.append(actionButton('Recover', 'restart-issue', item, 'warning'));
    if (isActive(item)) actions.append(actionButton('Abandon', 'abandon-issue', item, 'danger'));
    return actions;
  }

  function render() {
    const list = document.getElementById('work-queue-list');
    if (!list) return;
    const items = (queueData.items || []).filter(matches);
    const count = document.getElementById('work-queue-count');
    if (count) count.textContent = items.length + ' shown · ' + (queueData.total || 0) + ' recorded';
    list.textContent = '';
    if (!items.length) {
      const empty = document.createElement('div'); empty.className = 'work-queue-empty';
      empty.textContent = queueData.total ? 'No recorded work matches this filter.' : 'No issue automation runs have been recorded yet.';
      list.append(empty); return;
    }
    for (const item of items) {
      const row = document.createElement('article');
      row.className = 'work-queue-item';
      row.dataset.issueNumber = String(item.issueNumber);
      const title = document.createElement('div'); title.className = 'work-queue-title';
      const heading = item.issueUrl ? document.createElement('a') : document.createElement('strong');
      if (item.issueUrl) { heading.href = item.issueUrl; heading.target = '_blank'; heading.rel = 'noreferrer'; }
      heading.textContent = '#' + item.issueNumber + ' ' + item.title;
      const subtitle = document.createElement('div'); subtitle.className = 'work-queue-subtitle'; subtitle.textContent = itemSubtitle(item);
      title.append(heading, subtitle);
      const stage = document.createElement('div'); stage.className = 'work-queue-meta'; stage.append('Stage ', stageChip(item));
      const next = document.createElement('div'); next.className = 'work-queue-meta'; next.innerHTML = '<span>Next / blocker</span>';
      const nextText = document.createElement('strong'); nextText.textContent = item.nextAction || 'Open details'; next.append(nextText);
      row.append(title, stage, next, itemActions(item));
      list.append(row);
    }
  }

  function fact(label, value) {
    const root = document.createElement('div'); root.className = 'work-detail-fact';
    const name = document.createElement('span'); name.textContent = label;
    const result = document.createElement('strong'); result.textContent = value == null || value === '' ? 'Not recorded' : String(value);
    root.append(name, result); return root;
  }

  function reviewFacts(item) {
    const review = item.review;
    if (!review) return null;
    const section = document.createElement('section'); section.className = 'work-detail-section';
    const heading = document.createElement('h3'); heading.textContent = 'Review identity';
    const grid = document.createElement('div'); grid.className = 'work-detail-grid';
    grid.append(
      fact('Stage', review.stage || 'Not recorded'),
      fact('Round', review.round ? (review.limit ? review.round + ' / ' + review.limit : review.round) : 'Not recorded'),
      fact('Latest result', review.result || 'Not recorded'),
      fact('Exact head', review.headSha || 'Not recorded'),
      fact('Validation', review.validationApproved ? 'Approved' : 'Not approved'),
      fact('Review approval', review.reviewApproved ? 'Approved' : 'Not approved'),
    );
    section.append(heading, grid); return section;
  }

  function timelineSection(item) {
    const section = document.createElement('section'); section.className = 'work-detail-section';
    const heading = document.createElement('h3'); heading.textContent = 'Timeline'; section.append(heading);
    const list = document.createElement('div'); list.className = 'work-detail-timeline';
    for (const event of item.timeline || []) {
      const row = document.createElement('div'); row.className = 'work-detail-event';
      const dot = document.createElement('span'); dot.className = 'work-detail-event-dot';
      const copy = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = event.type || 'Activity';
      const at = document.createElement('small'); at.textContent = event.at ? new Date(event.at).toLocaleString() : 'Time not recorded';
      copy.append(title, at);
      if (event.detail) { const detail = document.createElement('div'); detail.textContent = event.detail; copy.append(detail); }
      row.append(dot, copy); list.append(row);
    }
    if (!(item.timeline || []).length) { const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = 'No timeline entries are recorded.'; list.append(empty); }
    section.append(list); return section;
  }

  function drawerActions(item) {
    const section = document.createElement('section'); section.className = 'work-detail-section';
    const heading = document.createElement('h3'); heading.textContent = 'Issue actions';
    const actions = document.createElement('div'); actions.className = 'work-detail-actions';
    const branch = document.createElement('select'); branch.id = 'work-detail-branch-action'; branch.innerHTML = '<option value="keep">Recover existing work first (recommended)</option><option value="delete">Start fresh and delete old branch</option>';
    actions.append(branch);
    const skipped = (statusData?.automation?.skippedIssueNumbers || []).includes(Number(item.issueNumber));
    if (skipped) actions.append(actionButton('Unskip', 'unskip-issue', item)); else actions.append(actionButton('Skip', 'skip-issue', item));
    if (item.stage === 'ready' && !skipped) actions.append(actionButton('Start', 'start-issue', item, ''));
    if (isAttention(item)) actions.append(actionButton('Recover', 'restart-issue', item, 'warning'));
    if (isActive(item)) actions.append(actionButton('Abandon', 'abandon-issue', item, 'danger'));
    section.append(heading, actions); return section;
  }

  function openDrawer(item, returnFocus = null) {
    selectedIssue = item.issueNumber;
    if (returnFocus) drawerReturnFocus = returnFocus;
    const drawer = document.getElementById('work-detail-drawer');
    const scrim = document.getElementById('work-detail-scrim');
    if (!drawer || !scrim) return;
    drawer.textContent = '';
    const head = document.createElement('header'); head.className = 'work-detail-head';
    const title = document.createElement('div'); title.innerHTML = '<div class="eyebrow">Work item</div>';
    const h2 = document.createElement('h2'); h2.id = 'work-detail-title'; h2.textContent = '#' + item.issueNumber + ' ' + item.title; title.append(h2);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary'; close.textContent = 'Close'; close.addEventListener('click', closeDrawer);
    head.append(title, close); drawer.append(head);
    const state = document.createElement('section'); state.className = 'work-detail-section';
    const stateHeading = document.createElement('h3'); stateHeading.textContent = 'Current state';
    const grid = document.createElement('div'); grid.className = 'work-detail-grid';
    grid.append(fact('Stage', item.stageLabel), fact('Lifecycle label', item.lifecycleLabel || (item.waitingForDependencies ? 'No blocked label — native dependency wait' : 'Not recorded')), fact('Phase', item.phase), fact('Attempt', item.attempt), fact('Branch', item.branch), fact('Workspace', item.workspaceId), fact('Started', item.startedAt ? new Date(item.startedAt).toLocaleString() : null), fact('Updated', item.updatedAt ? new Date(item.updatedAt).toLocaleString() : null));
    state.append(stateHeading, grid);
    const reason = document.createElement('div'); reason.className = 'work-detail-reason'; reason.textContent = item.reason || item.nextAction || 'No blocker or next action is recorded.'; state.append(reason);
    if (item.issueUrl || item.pullRequest?.url) {
      const links = document.createElement('div'); links.className = 'overview-quick-actions';
      if (item.issueUrl) { const issue = document.createElement('a'); issue.className = 'work-detail-link'; issue.href = item.issueUrl; issue.target = '_blank'; issue.rel = 'noreferrer'; issue.textContent = 'Open issue #' + item.issueNumber; links.append(issue); }
      if (item.pullRequest?.url) { const pr = document.createElement('a'); pr.className = 'work-detail-link'; pr.href = item.pullRequest.url; pr.target = '_blank'; pr.rel = 'noreferrer'; pr.textContent = 'Open PR' + (item.pullRequest.number ? ' #' + item.pullRequest.number : ''); links.append(pr); }
      state.append(links);
    }
    drawer.append(state);
    const review = reviewFacts(item); if (review) drawer.append(review);
    drawer.append(timelineSection(item), drawerActions(item));
    drawer.hidden = false; scrim.hidden = false; close.focus();
  }

  function closeDrawer() {
    const closingIssue = selectedIssue;
    selectedIssue = null;
    const drawer = document.getElementById('work-detail-drawer'); const scrim = document.getElementById('work-detail-scrim');
    if (drawer) drawer.hidden = true; if (scrim) scrim.hidden = true;
    const returnFocus = drawerReturnFocus;
    drawerReturnFocus = null;
    const currentDetails = closingIssue == null ? null : document.querySelector('.work-queue-item[data-issue-number="' + String(closingIssue) + '"] [data-work-details="true"]');
    const focusTarget = returnFocus?.isConnected ? returnFocus : currentDetails || document.getElementById('work-queue-search');
    try { focusTarget?.focus?.(); } catch {}
  }

  function drawerFocusables() {
    const drawer = document.getElementById('work-detail-drawer');
    if (!drawer || drawer.hidden) return [];
    return [...drawer.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.disabled && !element.hidden);
  }

  function handleDrawerKeydown(event) {
    if (!selectedIssue) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
    if (event.key !== 'Tab') return;
    const items = drawerFocusables();
    if (!items.length) { event.preventDefault(); document.getElementById('work-detail-drawer')?.focus(); return; }
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function runItemAction(action, item) {
    if (typeof postRepositoryAction !== 'function') throw new Error('Repository actions are unavailable.');
    if (action === 'restart-issue' || action === 'abandon-issue') {
      throw new Error('Dangerous issue actions require the manager confirmation layer.');
    }
    const payload = { issueNumber: Number(item.issueNumber), branchAction: document.getElementById('work-detail-branch-action')?.value || 'keep' };
    await postRepositoryAction(action, payload);
    if (selectedIssue === item.issueNumber) {
      const refreshed = queueData.items?.find((candidate) => candidate.issueNumber === item.issueNumber);
      if (refreshed) openDrawer(refreshed); else closeDrawer();
    }
  }

  function showQueueError(error) {
    if (typeof showError === 'function') showError(error);
    else console.error(error);
  }

  function renderStatusQueue(data) {
    statusData = data || null;
    queueData = data?.workQueue || { items: [], counts: {}, total: 0, active: 0, attention: 0 };
    render();
    if (selectedIssue) {
      const selected = queueData.items?.find((item) => item.issueNumber === selectedIssue);
      if (selected) openDrawer(selected); else closeDrawer();
    }
    const badge = document.querySelector('[data-manager-badge="work-queue"]');
    if (badge) {
      const count = Number(queueData.active || 0) + Number(queueData.attention || 0);
      badge.textContent = String(count);
      badge.classList.toggle('visible', count > 0);
      badge.classList.toggle('attention', Number(queueData.attention || 0) > 0);
    }
  }

  const baseRenderStatus = window.renderStatus;
  if (typeof baseRenderStatus === 'function') {
    window.renderStatus = function managerWorkQueueRenderStatus(data) {
      const result = baseRenderStatus(data);
      renderStatusQueue(data);
      return result;
    };
  }
  document.addEventListener('keydown', handleDrawerKeydown);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true }); else build();
  try { if (typeof currentStatus !== 'undefined' && currentStatus) renderStatusQueue(currentStatus); } catch {}
})();
`;

export function enhanceManagerWithWorkQueue(html) {
  const themed = injectIntoHead(html, `<style data-manager-work-queue-style>${MANAGER_WORK_QUEUE_STYLE}</style>`);
  return injectIntoBody(themed, `<script data-manager-work-queue>${MANAGER_WORK_QUEUE_SCRIPT}</script>`);
}
