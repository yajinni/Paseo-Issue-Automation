export const MANAGER_LIFECYCLE_STAGE_FOCUS_STYLE = String.raw`
.lifecycle-step[role="button"]{cursor:pointer;text-align:left;color:inherit;font:inherit}.lifecycle-step[role="button"]:hover{border-color:#4a5b72;background:#151f2c}.lifecycle-step[role="button"]:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px}.lifecycle-step.stage-focused{border-color:#4387ef!important;background:#11223b!important;box-shadow:0 0 0 1px #4387ef55,0 0 18px #2869d81f!important;opacity:1!important}.lifecycle-focus-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding:8px 10px;border:1px solid #30415a;border-radius:9px;background:#0f1824}.lifecycle-focus-copy{display:flex;align-items:center;gap:7px;min-width:0}.lifecycle-focus-copy span{font-size:10px;color:#7f90a5}.lifecycle-focus-copy strong{font-size:11px;color:#dce8fb}.lifecycle-focus-clear{padding:5px 8px!important;font-size:10px!important}.lifecycle-stage-focus-card{margin-top:12px;border:1px solid #30415a;border-radius:10px;background:#101720;padding:13px}.lifecycle-stage-focus-card h3{margin:0 0 10px;color:#b9c7d8;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.lifecycle-stage-focus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 18px}.lifecycle-stage-focus-fact span{display:block;font-size:10px;color:#718298}.lifecycle-stage-focus-fact strong,.lifecycle-stage-focus-fact a{display:block;margin-top:3px;font-size:12px;color:#dce8fb;overflow-wrap:anywhere}.lifecycle-stage-focus-fact a{color:#78adf8}.activity-event.focus-muted{opacity:.32}.activity-event.focus-match{margin-left:-5px;padding-left:5px;border-radius:7px;background:#112039}.activity-event.focus-match .activity-icon{border-color:#4b84ce}.activity-card.stage-focused{border-color:#375476}
@media(max-width:560px){.lifecycle-focus-bar{align-items:flex-start}.lifecycle-focus-copy{display:grid;gap:2px}.lifecycle-stage-focus-grid{grid-template-columns:1fr}}
`;

export const MANAGER_LIFECYCLE_STAGE_FOCUS_SCRIPT = String.raw`
(function managerLifecycleStageFocus() {
  const STAGES = [
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
  let focusedIssue = null;
  let focusedStage = null;
  let observer = null;
  let applying = false;

  function status() {
    try { return typeof currentStatus !== 'undefined' ? currentStatus : null; } catch { return null; }
  }

  function itemFor(issueNumber) {
    return status()?.workQueue?.items?.find(function(item) { return Number(item.issueNumber) === Number(issueNumber); }) || null;
  }

  function healthFor(issueNumber) {
    return status()?.workQueue?.prHealth?.byIssue?.[String(issueNumber)] || null;
  }

  function valueText(value) {
    return value == null || value === '' ? 'Not recorded' : String(value);
  }

  function formatDate(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function fact(label, value, href) {
    const root = document.createElement('div'); root.className = 'lifecycle-stage-focus-fact';
    const name = document.createElement('span'); name.textContent = label;
    const result = href ? document.createElement('a') : document.createElement('strong'); result.textContent = valueText(value);
    if (href) { result.href = href; result.target = '_blank'; result.rel = 'noreferrer'; }
    root.append(name, result); return root;
  }

  function reviewRound(review) {
    if (!review?.round) return null;
    return review.limit ? review.round + ' of ' + review.limit : review.round;
  }

  function stageCard(item, stage) {
    if (!item) return null;
    const card = document.createElement('section'); card.className = 'lifecycle-stage-focus-card'; card.dataset.lifecycleStageFocusCard = stage;
    const heading = document.createElement('h3'); heading.textContent = STAGES.find(function(entry) { return entry[0] === stage; })?.[1] || stage;
    const grid = document.createElement('div'); grid.className = 'lifecycle-stage-focus-grid';
    const review = item.review || {};
    const health = healthFor(item.issueNumber);
    const currentPr = health?.currentPr || {};
    const diagnostic = item.diagnostics || {};

    if (stage === 'ready') {
      grid.append(fact('State', 'Available'), fact('Available since', formatDate(item.startedAt)), fact('Next action', item.nextAction));
    } else if (stage === 'queued') {
      grid.append(fact('State', 'Claimed'), fact('Last updated', formatDate(item.updatedAt)), fact('Next action', item.nextAction));
    } else if (stage === 'coding') {
      grid.append(fact('Model', item.coding?.model), fact('Thinking', item.coding?.thinking), fact('Harness', item.coding?.harness), fact('Branch', item.branch), fact('Workspace', item.workspaceId), fact('Attempt', item.attempt));
    } else if (stage === 'draft-pr') {
      grid.append(fact('PR', item.pullRequest?.number ? '#' + item.pullRequest.number : null, item.pullRequest?.url), fact('PR state', currentPr.isDraft ? 'Draft' : currentPr.state), fact('Head SHA', currentPr.headSha || diagnostic.currentHeadSha), fact('Head branch', currentPr.headRefName || item.branch), fact('Base branch', currentPr.baseRefName), fact('Issue association', currentPr.issueAssociation === true ? 'Present' : currentPr.issueAssociation === false ? 'Missing' : null));
    } else if (stage === 'review-queued') {
      grid.append(fact('Review type', review.label), fact('Round', reviewRound(review)), fact('Exact head', review.headSha || currentPr.headSha), fact('Queue position', item.reviewAutomation?.queuePosition), fact('Review request', item.reviewAutomation?.activeReviewRequestId), fact('Current PR', item.pullRequest?.number ? '#' + item.pullRequest.number : null, item.pullRequest?.url));
    } else if (stage === 'reviewing') {
      grid.append(fact('Review type', review.label), fact('Round', reviewRound(review)));
      if (review.type === 'web-chatgpt') grid.append(fact('Channel', review.channel), fact('Conversation', review.conversationUrl ? 'Open conversation' : null, review.conversationUrl));
      else grid.append(fact('Model', review.model), fact('Thinking', review.thinking));
      grid.append(fact('Latest result', review.result), fact('Exact head', review.headSha || currentPr.headSha));
    } else if (stage === 'merged') {
      grid.append(fact('PR', item.pullRequest?.number ? '#' + item.pullRequest.number : null, item.pullRequest?.url), fact('Merged at', formatDate(currentPr.mergedAt || diagnostic.mergedAt)), fact('Merged head', diagnostic.mergedHeadSha || currentPr.headSha), fact('Base branch', currentPr.baseRefName));
    } else if (stage === 'closure-verified') {
      grid.append(fact('Verified at', formatDate(diagnostic.issueClosureVerifiedAt)), fact('Issue closure pending', item.reviewAutomation?.issueClosurePending ? 'Yes' : 'No'), fact('Lifecycle completion pending', item.reviewAutomation?.lifecycleCompletionPending ? 'Yes' : 'No'), fact('PR', item.pullRequest?.number ? '#' + item.pullRequest.number : null, item.pullRequest?.url));
    } else if (stage === 'completed') {
      grid.append(fact('Completed at', formatDate(item.completedAt)), fact('Merged head', diagnostic.mergedHeadSha), fact('Issue closure verified', formatDate(diagnostic.issueClosureVerifiedAt)), fact('PR', item.pullRequest?.number ? '#' + item.pullRequest.number : null, item.pullRequest?.url));
    }
    card.append(heading, grid); return card;
  }

  function eventMatchesStage(event, stage) {
    const text = String(event?.textContent || '').toLowerCase();
    const patterns = {
      ready: ['available', 'run created', 'marked available'],
      queued: ['claim', 'claimed', 'queued'],
      coding: ['coding', 'agent', 'workspace'],
      'draft-pr': ['draft pr', 'pull request', 'pr #'],
      'review-queued': ['review queued', 'review requested', 'waiting for reviewer'],
      reviewing: ['review started', 'review completed', 'review activity', 'changes requested', 'review became stale', 'web chatgpt'],
      merged: [' merged', 'merge completed'],
      'closure-verified': ['closure verified', 'issue closed', 'issue closure'],
      completed: ['completed', 'lifecycle completed'],
    };
    return (patterns[stage] || []).some(function(pattern) { return text.includes(pattern); });
  }

  function updateTimeline(panel, stage) {
    const card = panel.querySelector('.activity-card');
    if (!card) return;
    card.classList.toggle('stage-focused', Boolean(stage));
    const rows = [...card.querySelectorAll('.activity-event')];
    for (const row of rows) {
      const match = !stage || eventMatchesStage(row, stage);
      row.classList.toggle('focus-muted', Boolean(stage) && !match);
      row.classList.toggle('focus-match', Boolean(stage) && match);
    }
  }

  function addFocusBar(main, stage) {
    const existing = main.querySelector('.lifecycle-focus-bar'); existing?.remove();
    if (!stage) return;
    const bar = document.createElement('div'); bar.className = 'lifecycle-focus-bar';
    const copy = document.createElement('div'); copy.className = 'lifecycle-focus-copy';
    const prefix = document.createElement('span'); prefix.textContent = 'Focused lifecycle stage';
    const name = document.createElement('strong'); name.textContent = STAGES.find(function(entry) { return entry[0] === stage; })?.[1] || stage;
    copy.append(prefix, name);
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary lifecycle-focus-clear'; clear.textContent = 'Show all';
    clear.addEventListener('click', function(event) { event.stopPropagation(); focusedStage = null; apply(); });
    bar.append(copy, clear);
    const lifecycle = main.firstElementChild; if (lifecycle) lifecycle.after(bar); else main.prepend(bar);
  }

  function applyPanelFocus(panel, item, stage) {
    const main = panel.querySelector('.lifecycle-main'); if (!main) return;
    main.querySelector('[data-lifecycle-stage-focus-card]')?.remove();
    addFocusBar(main, stage);
    const health = main.querySelector('.pr-health-card');
    const details = main.querySelector('.lifecycle-detail-card');
    if (health) health.hidden = Boolean(stage) && ['ready', 'queued', 'coding'].includes(stage);
    if (details) details.hidden = Boolean(stage) && !['review-queued', 'reviewing'].includes(stage);
    if (stage) {
      const card = stageCard(item, stage);
      if (card && !['review-queued', 'reviewing'].includes(stage)) main.append(card);
    }
    updateTimeline(panel, stage);
  }

  function activateStage(issueNumber, stage, button) {
    focusedIssue = Number(issueNumber);
    focusedStage = focusedStage === stage ? null : stage;
    apply();
    const selector = focusedStage ? '[data-lifecycle-focus="' + focusedStage + '"]' : '.lifecycle-focus-clear';
    queueMicrotask(function() { document.querySelector('.lifecycle-item[data-issue-number="' + focusedIssue + '"] ' + selector)?.focus?.(); });
  }

  function wirePanel(panel) {
    const article = panel.closest('.lifecycle-item[data-issue-number]');
    const issueNumber = Number(article?.dataset.issueNumber);
    if (!issueNumber) return;
    const item = itemFor(issueNumber);
    const steps = [...panel.querySelectorAll('.lifecycle-flow .lifecycle-step')];
    steps.forEach(function(step, index) {
      const stage = STAGES[index]?.[0]; if (!stage) return;
      step.setAttribute('role', 'button'); step.tabIndex = 0; step.dataset.lifecycleFocus = stage; step.setAttribute('aria-label', 'Focus ' + STAGES[index][1] + ' stage');
      step.classList.toggle('stage-focused', focusedIssue === issueNumber && focusedStage === stage);
      if (step.dataset.stageFocusReady === 'true') return;
      step.dataset.stageFocusReady = 'true';
      step.addEventListener('click', function(event) { event.stopPropagation(); activateStage(issueNumber, stage, step); });
      step.addEventListener('keydown', function(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activateStage(issueNumber, stage, step); } });
    });
    const activeStage = focusedIssue === issueNumber ? focusedStage : null;
    applyPanelFocus(panel, item, activeStage);
  }

  function apply() {
    if (applying) return; applying = true;
    try {
      const panels = [...document.querySelectorAll('.lifecycle-expanded')];
      if (!panels.length) { focusedIssue = null; focusedStage = null; return; }
      const visibleIssue = Number(panels[0].closest('.lifecycle-item[data-issue-number]')?.dataset.issueNumber);
      if (focusedIssue && focusedIssue !== visibleIssue) { focusedIssue = null; focusedStage = null; }
      for (const panel of panels) wirePanel(panel);
    } finally { applying = false; }
  }

  function start() {
    apply();
    if (observer) return;
    observer = new MutationObserver(function() { queueMicrotask(apply); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
`;
