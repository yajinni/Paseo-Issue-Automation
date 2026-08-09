export const MANAGER_WORK_QUEUE_SCRIPT_PART_3 = String.raw`    const skipped = (statusData?.automation?.skippedIssueNumbers || []).includes(Number(item.issueNumber));
    if (item.stage === 'ready' && !skipped) menu.append(actionEntry('Start issue', 'Begin coding this available issue now.', 'start-issue', item));
    if (isAttention(item)) {
      const recovery = document.createElement('div'); recovery.className = 'lifecycle-recovery-mode';
      const label = document.createElement('label'); label.textContent = 'Recovery mode';
      const select = document.createElement('select'); if (openActionsIssue === item.issueNumber) select.id = 'branch-action'; else select.dataset.branchActionFor = String(item.issueNumber); select.innerHTML = '<option value="keep">Recover existing work first</option><option value="delete">Start fresh and delete old branch</option>';
      recovery.append(label, select); menu.append(recovery, actionEntry('Recover issue', 'Retry the interrupted or failed coding attempt.', 'restart-issue', item));
    }
    const mutable = !['completed', 'merged', 'closure-verified'].includes(item.stage);
    if (mutable && skipped) menu.append(actionEntry('Unskip', 'Allow automatic selection of this issue again.', 'unskip-issue', item));
    else if (mutable) menu.append(actionEntry('Skip', 'Stop automatically selecting this issue for now.', 'skip-issue', item));
    if (mutable && isActive(item)) {
      const separator = document.createElement('div'); separator.className = 'lifecycle-actions-separator'; menu.append(separator);
      menu.append(actionEntry('Abandon', 'Stop this active automation attempt and record a reason.', 'abandon-issue', item, { danger: true }));
    }
    return menu;
  }

  function rowActions(item) {
    const actions = document.createElement('div'); actions.className = 'lifecycle-row-actions';
    const details = document.createElement('button'); details.type = 'button'; details.className = 'secondary'; details.textContent = 'Details'; details.dataset.workDetails = 'true'; details.addEventListener('click', function(event) { event.stopPropagation(); openDrawer(item, event.currentTarget); });
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'secondary'; toggle.textContent = 'Actions ▾'; toggle.dataset.actionsToggle = 'true'; toggle.setAttribute('aria-haspopup', 'menu'); toggle.setAttribute('aria-expanded', openActionsIssue === item.issueNumber ? 'true' : 'false');
    toggle.addEventListener('click', function(event) { event.stopPropagation(); const same = openActionsIssue === item.issueNumber; closeActionMenus(); openActionsIssue = same ? null : item.issueNumber; render(); if (!same) { const reopened = document.querySelector('.lifecycle-actions-popover[data-issue-number="' + item.issueNumber + '"]'); if (reopened) reopened.hidden = false; } });
    const chevron = document.createElement('button'); chevron.type = 'button'; chevron.className = 'lifecycle-chevron'; chevron.setAttribute('aria-label', expandedIssue === item.issueNumber ? 'Collapse issue lifecycle' : 'Expand issue lifecycle'); chevron.textContent = expandedIssue === item.issueNumber ? '⌃' : '⌄'; chevron.addEventListener('click', function(event) { event.stopPropagation(); toggleExpanded(item.issueNumber); });
    actions.append(details, toggle, chevron, actionMenu(item)); return actions;
  }

  function compactPrHealth(item) {
    const health = prHealthFor(item);
    if (!health) return null;
    const badge = document.createElement('span'); badge.className = 'lifecycle-pr-health ' + (health.tone || 'neutral'); badge.textContent = health.label || 'Unknown';
    badge.title = (health.problems || []).map(function(problem) { return problem.title; }).filter(Boolean).join(' · ') || 'Current PR health';
    return badge;
  }

  function renderRow(item) {
    const article = document.createElement('article'); article.className = 'lifecycle-item' + (expandedIssue === item.issueNumber ? ' expanded' : ''); article.dataset.issueNumber = String(item.issueNumber);
    const head = document.createElement('div'); head.className = 'lifecycle-row-head'; head.tabIndex = 0; head.setAttribute('role', 'button'); head.setAttribute('aria-expanded', expandedIssue === item.issueNumber ? 'true' : 'false');
    head.addEventListener('click', function(event) { if (event.target.closest('a,button,select,input')) return; toggleExpanded(item.issueNumber); });
    head.addEventListener('keydown', function(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpanded(item.issueNumber); } });
    const issue = document.createElement('div'); issue.className = 'lifecycle-issue'; issue.textContent = '#' + item.issueNumber;
    const title = document.createElement('div'); title.className = 'lifecycle-title';
    const heading = item.issueUrl ? document.createElement('a') : document.createElement('strong'); heading.textContent = item.title; if (item.issueUrl) { heading.href = item.issueUrl; heading.target = '_blank'; heading.rel = 'noreferrer'; }
    const subtitle = document.createElement('div'); subtitle.className = 'lifecycle-subtitle'; subtitle.textContent = item.branch || item.nextAction || '';
    title.append(heading, subtitle);
    const stage = document.createElement('div'); stage.className = 'lifecycle-stage-current ' + stageTone(item); stage.textContent = item.stageLabel || item.stage || 'Unknown';
    const summaryData = runSummary(item); const summary = document.createElement('div'); summary.className = 'lifecycle-run-summary'; const summaryTitle = document.createElement('strong'); summaryTitle.textContent = summaryData.title; const summaryCopy = document.createElement('span'); summaryCopy.textContent = summaryData.secondary; summary.append(summaryTitle, summaryCopy);
    const pr = document.createElement('div'); pr.className = 'lifecycle-pr';
    if (item.pullRequest?.number) {
      const link = document.createElement('a'); link.textContent = '#' + item.pullRequest.number; if (item.pullRequest.url) { link.href = item.pullRequest.url; link.target = '_blank'; link.rel = 'noreferrer'; } pr.append(link);
      const health = compactPrHealth(item); if (health) pr.append(health);
    } else pr.textContent = '—';
    const started = document.createElement('div'); started.className = 'lifecycle-date'; started.textContent = formatDate(item.startedAt);
    const updated = document.createElement('div'); updated.className = 'lifecycle-date'; updated.textContent = formatDate(item.updatedAt || item.completedAt);
    const duration = document.createElement('div'); duration.className = 'lifecycle-elapsed'; duration.textContent = elapsed(item);
    head.append(issue, title, stage, summary, pr, started, updated, duration, rowActions(item)); article.append(head);
    if (expandedIssue === item.issueNumber) article.append(expandedPanel(item));
    return article;
  }

  function toggleExpanded(issueNumber) { closeActionMenus(); expandedIssue = expandedIssue === issueNumber ? null : issueNumber; render(); }

  function paginationButton(label, targetPage, options) {
    options = options || {};
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    if (options.current) { button.className = 'current'; button.setAttribute('aria-current', 'page'); }
    button.disabled = options.disabled === true;
    button.addEventListener('click', function() { page = targetPage; render(); });
    return button;
  }

  function renderPagination(totalItems) {
    const target = document.getElementById('work-queue-pagination'); if (!target) return;
    target.textContent = '';
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    page = Math.min(Math.max(1, page), totalPages);
    target.append(paginationButton('‹', Math.max(1, page - 1), { disabled: page === 1 }));
    const pages = [];
    for (let value = 1; value <= totalPages; value += 1) {
      if (value === 1 || value === totalPages || Math.abs(value - page) <= 1) pages.push(value);
    }
    let previous = 0;
    for (const value of pages) {
      if (previous && value - previous > 1) { const gap = document.createElement('span'); gap.textContent = '…'; target.append(gap); }
      target.append(paginationButton(String(value), value, { current: value === page })); previous = value;
    }
    target.append(paginationButton('›', Math.min(totalPages, page + 1), { disabled: page === totalPages }));
  }

  function render() {
    const list = document.getElementById('work-queue-list'); if (!list) return;
    const matching = (queueData.items || []).filter(matches);
    const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE)); page = Math.min(page, totalPages);
    const startIndex = matching.length ? (page - 1) * PAGE_SIZE : 0;
    const items = matching.slice(startIndex, startIndex + PAGE_SIZE);
    const endIndex = startIndex + items.length;
    const prProblems = Number(queueData?.prHealth?.counts?.blocking || 0) + Number(queueData?.prHealth?.counts?.attention || 0) + Number(queueData?.prHealth?.counts?.unavailable || 0);
    const count = document.getElementById('work-queue-count'); if (count) count.textContent = matching.length + ' matching · ' + (queueData.total || 0) + ' recorded' + (prProblems ? ' · ' + prProblems + ' PR problem' + (prProblems === 1 ? '' : 's') : '');
    const footer = document.getElementById('work-queue-footer-summary'); if (footer) footer.textContent = matching.length ? 'Showing ' + (startIndex + 1) + '–' + endIndex + ' of ' + matching.length + ' matching issues. Click a row to expand lifecycle, PR health, and activity.' : 'No matching issues.';
    renderPagination(matching.length);
    if (expandedIssue && !items.some(function(item) { return item.issueNumber === expandedIssue; })) expandedIssue = null;
    list.textContent = '';
    if (!items.length) { const empty = document.createElement('div'); empty.className = 'work-queue-empty'; empty.textContent = queueData.total ? 'No recorded work matches these filters.' : 'No issue automation runs have been recorded yet.'; list.append(empty); return; }
    for (const item of items) list.append(renderRow(item));
    syncViewHeading();
  }

  function drawerFact(label, value, href) {
    const root = document.createElement('div'); root.className = 'work-detail-fact'; const name = document.createElement('span'); name.textContent = label; const result = href ? document.createElement('a') : document.createElement('strong'); result.textContent = text(value); if (href) { result.href = href; result.target = '_blank'; result.rel = 'noreferrer'; } root.append(name, result); return root;
  }

  function drawerSection(title, facts) {
    const section = document.createElement('section'); section.className = 'work-detail-section'; const heading = document.createElement('h3'); heading.textContent = title; const grid = document.createElement('div'); grid.className = 'work-detail-grid'; facts.forEach(function(entry) { grid.append(drawerFact(entry[0], entry[1], entry[2])); }); section.append(heading, grid); return section;
  }

  function rawTimelineSection(item) {
    const section = document.createElement('section'); section.className = 'work-detail-section'; const heading = document.createElement('h3'); heading.textContent = 'Recorded lifecycle evidence'; section.append(heading);
    const list = document.createElement('div'); list.className = 'work-detail-raw-list';
    for (const event of item.timeline || []) {
      const row = document.createElement('article'); row.className = 'work-detail-raw-event'; const label = document.createElement('strong'); label.textContent = event.type || 'activity'; const meta = document.createElement('small'); meta.textContent = [formatDate(event.at), event.source, event.status].filter(Boolean).join(' · '); row.append(label, meta);
      if (event.detail || Object.keys(event.evidence || {}).length) { const pre = document.createElement('pre'); pre.textContent = [event.detail, Object.keys(event.evidence || {}).length ? JSON.stringify(event.evidence, null, 2) : ''].filter(Boolean).join('\n'); row.append(pre); }
      list.append(row);
    }
    if (!(item.timeline || []).length) { const empty = document.createElement('div'); empty.className = 'activity-empty'; empty.textContent = 'No lifecycle evidence is recorded.'; list.append(empty); }
    section.append(list); return section;
  }

  function openDrawer(item, returnFocus, options) {
    options = options || {}; selectedIssue = item.issueNumber; if (returnFocus) drawerReturnFocus = returnFocus;
    const drawer = document.getElementById('work-detail-drawer'); const scrim = document.getElementById('work-detail-scrim'); if (!drawer || !scrim) return;
    const scrollTop = options.preserveInteraction ? drawer.scrollTop : 0; drawer.textContent = '';
`;
