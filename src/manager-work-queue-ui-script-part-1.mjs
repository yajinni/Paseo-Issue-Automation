export const MANAGER_WORK_QUEUE_SCRIPT_PART_1 = String.raw`
(function managerWorkQueueUi() {
  const MAIN_STAGES = [
    ['ready', 'Available'],
    ['queued', 'Claimed'],
    ['coding', 'Coding'],
    ['draft-pr', 'Draft PR Created'],
    ['review-queued', 'PR Review Queued'],
    ['reviewing', 'Reviewing'],
    ['merged', 'Merged'],
    ['closure-verified', 'Issue Closure Verified'],
    ['completed', 'Completed'],
  ];
  let queueData = { items: [], counts: {}, total: 0, active: 0, attention: 0, prHealth: { byIssue: {}, counts: {} } };
  let statusData = null;
  const PAGE_SIZE = 10;
  let filter = 'all';
  let stageFilter = 'all';
  let page = 1;
  let query = '';
  let expandedIssue = null;
  let selectedIssue = null;
  let drawerReturnFocus = null;
  let openActionsIssue = null;
  let headingObserver = null;

  function onWorkQueue() { return document.querySelector('[data-manager-view="work-queue"]'); }
  function isAttention(item) { return ['failed', 'review-failed', 'needs-attention'].includes(item.stage); }
  function isActive(item) { return !['completed', 'failed', 'review-failed', 'needs-attention', 'ready', 'waiting'].includes(item.stage); }
  function isReviewStage(item) { return ['review-queued', 'reviewing', 'changes-requested', 'fixing', 'review-failed'].includes(item.stage) || Boolean(item.review); }
  function prHealthFor(item) { return queueData?.prHealth?.byIssue?.[String(item.issueNumber)] || null; }
  function hasPrProblems(item) { const health = prHealthFor(item); return Boolean(health && ['blocking', 'attention', 'unavailable'].includes(health.status)); }
  function formatDate(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function elapsed(item) { const start = new Date(item.startedAt || item.updatedAt || 0).getTime(); const end = new Date(item.completedAt || item.updatedAt || Date.now()).getTime(); if (!start || Number.isNaN(start) || Number.isNaN(end) || end < start) return '—'; const minutes = Math.floor((end - start) / 60000); const days = Math.floor(minutes / 1440); const hours = Math.floor((minutes % 1440) / 60); const mins = minutes % 60; return (days ? days + 'd ' : '') + (hours ? hours + 'h ' : '') + mins + 'm'; }
  function text(value, fallback) { return value == null || value === '' ? (fallback || 'Not recorded') : String(value); }
  function firstLine(value) { return String(value || '').split(/\r?\n/)[0].trim(); }

  function syncViewHeading() {
    const view = onWorkQueue();
    if (!view || view.hidden) return;
    const title = document.getElementById('manager-view-title');
    const description = document.getElementById('manager-view-description');
    if (title) title.textContent = 'Issue Lifecycle';
    if (description) description.textContent = 'Track workflow progress, PR health, review identity, and activity for each recorded issue.';
  }

  function queueShell() {
    const card = document.createElement('section');
    card.className = 'work-queue-card';
    card.innerHTML = '<div class="work-queue-toolbar"><div class="work-queue-toolbar-fields">'
      + '<label>Search<input id="work-queue-search" type="search" placeholder="issue, title, branch, PR, or PR problem"></label>'
      + '<label>Status<select id="work-queue-filter"><option value="all">All recorded work</option><option value="active">Active work</option><option value="attention">Needs attention</option><option value="pr-problems">PR problems</option></select></label>'
      + '<label>Stage<select id="work-queue-stage-filter"><option value="all">All stages</option><option value="ready">Available</option><option value="waiting">Waiting for dependencies</option><option value="queued">Claimed</option><option value="coding">Coding</option><option value="review-queued">PR Review Queued</option><option value="reviewing">Reviewing</option><option value="changes-requested">Changes requested</option><option value="fixing">Fixing</option><option value="review-failed">Review failed</option><option value="failed">Failed</option><option value="merged">Merged</option><option value="closure-verified">Issue Closure Verified</option><option value="completed">Completed</option></select></label>'
      + '</div><div class="work-queue-count" id="work-queue-count">Loading…</div></div>'
      + '<div class="lifecycle-table"><div class="lifecycle-columns"><span>Issue</span><span>Title</span><span>Current stage</span><span>Run details</span><span>PR</span><span>Started</span><span>Last updated</span><span>Elapsed</span><span></span></div><div id="work-queue-list"><div class="work-queue-empty">Loading recorded work…</div></div></div>'
      + '<div class="lifecycle-footer"><span id="work-queue-footer-summary">Loading recorded work…</span><div class="lifecycle-pagination" id="work-queue-pagination" aria-label="Issue lifecycle pages"></div></div>'
      + '<pre id="dispatch-result" class="work-queue-compat" aria-hidden="true"></pre>';
    return card;
  }

  function createDrawer() {
    if (document.getElementById('work-detail-drawer')) return;
    const scrim = document.createElement('div');
    scrim.id = 'work-detail-scrim'; scrim.className = 'work-detail-scrim'; scrim.hidden = true; scrim.setAttribute('aria-hidden', 'true'); scrim.addEventListener('click', closeDrawer);
    const drawer = document.createElement('aside');
    drawer.id = 'work-detail-drawer'; drawer.className = 'work-detail-drawer'; drawer.hidden = true; drawer.tabIndex = -1; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-labelledby', 'work-detail-title');
    document.body.append(scrim, drawer);
  }

  function createConfirmUi() {
    if (document.getElementById('lifecycle-confirm-scrim')) return;
    const scrim = document.createElement('div');
    scrim.id = 'lifecycle-confirm-scrim'; scrim.className = 'lifecycle-confirm-scrim'; scrim.hidden = true;
    scrim.innerHTML = '<section class="lifecycle-confirm-card" role="dialog" aria-modal="true" aria-labelledby="lifecycle-confirm-title"><h2 id="lifecycle-confirm-title">Confirm action</h2><p id="lifecycle-confirm-message"></p><div class="lifecycle-confirm-actions"><button type="button" class="secondary" id="lifecycle-confirm-cancel">Cancel</button><button type="button" id="lifecycle-confirm-ok">Continue</button></div></section>';
    document.body.append(scrim);
  }

  function confirmLifecycleAction(title, message, confirmLabel) {
    createConfirmUi();
    const scrim = document.getElementById('lifecycle-confirm-scrim');
    const cancel = document.getElementById('lifecycle-confirm-cancel');
    const ok = document.getElementById('lifecycle-confirm-ok');
    document.getElementById('lifecycle-confirm-title').textContent = title;
    document.getElementById('lifecycle-confirm-message').textContent = message;
    ok.textContent = confirmLabel || 'Continue';
    const prior = document.activeElement;
    scrim.hidden = false;
    return new Promise(function(resolve) {
      function finish(value) { scrim.hidden = true; cancel.onclick = null; ok.onclick = null; scrim.onclick = null; scrim.onkeydown = null; try { prior && prior.focus && prior.focus(); } catch {} resolve(value); }
      cancel.onclick = function() { finish(false); };
      ok.onclick = function() { finish(true); };
      scrim.onclick = function(event) { if (event.target === scrim) finish(false); };
      scrim.onkeydown = function(event) { if (event.key === 'Escape') { event.preventDefault(); finish(false); } };
      cancel.focus();
    });
  }

  function preserveRepositoryRemoval(view) {
    const removeButton = document.getElementById('remove-button');
    const maintenance = document.querySelector('[data-manager-view="maintenance"]');
    if (!removeButton || !maintenance || document.getElementById('manager-repository-registration-actions')) return;
    const card = document.createElement('section'); card.className = 'card'; card.id = 'manager-repository-registration-actions';
    const heading = document.createElement('h2'); heading.textContent = 'Repository registration';
    const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = 'Manager-level repository removal lives here instead of the issue lifecycle controls.';
    const actions = document.createElement('div'); actions.className = 'actions'; actions.append(removeButton);
    card.append(heading, copy, actions); maintenance.append(card);
  }

  function build() {
    const view = onWorkQueue();
    if (!view || view.dataset.workQueueReady === 'lifecycle-v2') return;
    view.dataset.workQueueReady = 'lifecycle-v2';
    preserveRepositoryRemoval(view);
    view.replaceChildren(queueShell());
    document.getElementById('work-queue-search')?.addEventListener('input', function(event) { query = event.target.value; page = 1; render(); });
    document.getElementById('work-queue-filter')?.addEventListener('change', function(event) { filter = event.target.value; page = 1; render(); });
    document.getElementById('work-queue-stage-filter')?.addEventListener('change', function(event) { stageFilter = event.target.value; page = 1; render(); });
    createDrawer(); createConfirmUi(); syncViewHeading();
    if (!headingObserver && view) { headingObserver = new MutationObserver(syncViewHeading); headingObserver.observe(view, { attributes: true, attributeFilter: ['hidden'] }); }
    render();
  }

  function matches(item) {
    if (filter === 'active' && !isActive(item)) return false;
    if (filter === 'attention' && !isAttention(item)) return false;
    if (filter === 'pr-problems' && !hasPrProblems(item)) return false;
    if (stageFilter !== 'all' && item.stage !== stageFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const health = prHealthFor(item);
    const problemText = (health?.problems || []).flatMap(function(problem) { return [problem.title, problem.message, problem.code]; });
    const haystack = [item.issueNumber, item.title, item.branch, item.pullRequest?.number, item.pullRequest?.url, item.stageLabel, item.reason, item.coding?.model, item.review?.label, item.review?.model, health?.label, health?.status, ...problemText]
      .filter(function(value) { return value != null; }).join(' ').toLowerCase();
    return haystack.includes(needle);
  }

  function stageTone(item) {
    if (isAttention(item)) return 'danger';
    if (item.stage === 'waiting' || item.stage === 'changes-requested' || item.stage === 'fixing') return 'warning';
    if (item.stage === 'completed') return 'success';
    return '';
  }

  function runSummary(item) {
    if (isReviewStage(item)) {
      const review = item.review || {};
      const secondary = review.type === 'web-chatgpt' ? (review.channel || 'Browser conversation') : [review.model, review.thinking].filter(Boolean).join(' • ');
      return { title: review.label || 'Review', secondary: secondary || 'Review details recorded' };
    }
    if (['coding', 'queued', 'ready'].includes(item.stage) || item.coding?.model) {
      return { title: item.stage === 'coding' ? 'Coding' : 'Coding configuration', secondary: [item.coding?.model, item.coding?.thinking].filter(Boolean).join(' • ') || 'Model not recorded' };
    }
    return { title: item.stageLabel || 'Recorded work', secondary: item.nextAction || 'Open details' };
  }

  function stageRank(item) {
    if (item.stage === 'completed') return 8;
    if (item.stage === 'closure-verified') return 7;
    if (item.stage === 'merged') return 6;
    if (['reviewing', 'changes-requested', 'fixing', 'review-failed'].includes(item.stage)) return 5;
    if (item.stage === 'review-queued') return 4;
    if (item.pullRequest?.number) return 3;
    if (item.stage === 'coding') return 2;
    if (item.stage === 'queued') return 1;
    if (item.stage === 'ready') return 0;
    if (item.stage === 'failed' || item.stage === 'needs-attention') {
      const phase = String(item.phase || '');
      if (/review/.test(phase) || item.pullRequest?.number) return 5;
      if (/coding|agent|launch|completion|base/.test(phase)) return 2;
    }
    return Math.max(0, item.pullRequest?.number ? 3 : 0);
  }

  function timelineAscending(item) {
    return [...(item.timeline || [])].sort(function(a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
  }

  function eventSearchText(event) {
    return [event.type, event.detail, event.source, event.status, JSON.stringify(event.evidence || {})].filter(Boolean).join(' ').toLowerCase();
  }

  function milestoneTime(item, id) {
`;
