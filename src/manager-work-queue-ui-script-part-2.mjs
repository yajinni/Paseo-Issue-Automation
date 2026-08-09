export const MANAGER_WORK_QUEUE_SCRIPT_PART_2 = String.raw`    const patterns = {
      ready: ['available', 'ready', 'run-created'],
      queued: ['claimed', 'claim', 'phase=ready -> queued', 'phase=null -> queued', ' queued'],
      coding: ['coding started', 'agent-started', 'phase=queued -> coding', 'phase=starting-agent', 'starting coding'],
      'draft-pr': ['draft pr', 'pull request', 'pr-created', 'pr opened', 'prnumber'],
      'review-queued': ['review queued', 'review-queued'],
      reviewing: ['reviewing', 'review started', 'browser review', 'review submission'],
      merged: ['pr-merged', ' merged'],
      'closure-verified': ['closure verified', 'issue closed', 'issueclosureverified'],
      completed: [' completed', 'phase=completed'],
    };
    for (const event of timelineAscending(item)) {
      const search = eventSearchText(event);
      if ((patterns[id] || []).some(function(pattern) { return search.includes(pattern); })) return event.at || null;
    }
    if (id === 'ready') return item.startedAt || null;
    if (id === 'draft-pr' && item.pullRequest?.number) return item.updatedAt || null;
    if (id === 'merged') return item.diagnostics?.mergedAt || null;
    if (id === 'closure-verified') return item.diagnostics?.issueClosureVerifiedAt || null;
    if (id === 'completed') return item.completedAt || null;
    return null;
  }

  function stepState(item, id, index) {
    if (item.stage === 'completed') return 'completed';
    if (id === 'merged' && item.diagnostics?.mergedAt) return item.stage === 'merged' ? 'current' : 'completed';
    if (id === 'closure-verified' && item.diagnostics?.issueClosureVerifiedAt) return 'completed';
    const rank = stageRank(item);
    if (index < rank) return 'completed';
    if (index === rank) return isAttention(item) ? 'attention' : 'current';
    return 'future';
  }

  function lifecycleFlow(item) {
    const wrapper = document.createElement('div');
    const heading = document.createElement('h3'); heading.className = 'lifecycle-section-title'; heading.textContent = 'Lifecycle'; wrapper.append(heading);
    const flow = document.createElement('div'); flow.className = 'lifecycle-flow';
    MAIN_STAGES.forEach(function(stage, index) {
      const id = stage[0]; const label = stage[1]; const state = stepState(item, id, index);
      const step = document.createElement('div'); step.className = 'lifecycle-step ' + state;
      const top = document.createElement('div');
      const number = document.createElement('div'); number.className = 'lifecycle-step-number'; number.textContent = (index + 1) + (state === 'completed' ? '  ✓' : '');
      const name = document.createElement('div'); name.className = 'lifecycle-step-label'; name.textContent = label;
      top.append(number, name);
      const time = document.createElement('div'); time.className = 'lifecycle-step-time';
      const at = milestoneTime(item, id);
      time.textContent = state === 'current' ? ('Current · ' + (at ? formatDate(at) : 'in progress')) : at ? formatDate(at) : state === 'future' ? 'Pending' : 'Recorded';
      step.append(top, time); flow.append(step);
    });
    wrapper.append(flow);
    if (['changes-requested', 'fixing'].includes(item.stage) || timelineAscending(item).some(function(event) { return /changes.requested|fixing|retry/i.test(eventSearchText(event)); })) {
      const fixing = document.createElement('div'); fixing.className = 'lifecycle-fixing-loop'; fixing.innerHTML = '<span>If changes requested</span><strong>↳ Fixing</strong><span>↻ returns to review</span>'; wrapper.append(fixing);
    }
    return wrapper;
  }

  function detailFact(label, value, href) {
    const root = document.createElement('div'); root.className = 'lifecycle-detail-fact';
    const name = document.createElement('span'); name.textContent = label;
    const result = href ? document.createElement('a') : document.createElement('strong');
    result.textContent = text(value); if (href) { result.href = href; result.target = '_blank'; result.rel = 'noreferrer'; }
    root.append(name, result); return root;
  }

  function prHealthRow(title, message, severity) {
    const row = document.createElement('div'); row.className = 'pr-health-row ' + (severity || 'info');
    const icon = document.createElement('span'); icon.className = 'pr-health-row-icon'; icon.textContent = severity === 'blocking' ? '!' : severity === 'attention' ? '!' : severity === 'waiting' ? '◷' : '✓';
    const copy = document.createElement('div'); const heading = document.createElement('strong'); heading.textContent = title; const detail = document.createElement('span'); detail.textContent = message || ''; copy.append(heading, detail); row.append(icon, copy); return row;
  }

  function prHealthCard(item) {
    const health = prHealthFor(item);
    if (!health || !item.pullRequest?.number) return null;
    const card = document.createElement('section'); card.className = 'pr-health-card ' + (health.status || 'unknown');
    const heading = document.createElement('h3'); heading.className = 'lifecycle-section-title'; heading.textContent = 'PR Health';
    const header = document.createElement('div'); header.className = 'pr-health-header';
    const identity = document.createElement('div'); identity.className = 'pr-health-identity';
    const pr = item.pullRequest?.url ? document.createElement('a') : document.createElement('strong'); pr.textContent = 'PR #' + item.pullRequest.number; if (item.pullRequest?.url) { pr.href = item.pullRequest.url; pr.target = '_blank'; pr.rel = 'noreferrer'; }
    const state = document.createElement('span'); state.className = 'pr-health-state'; state.textContent = health.currentPr?.isDraft ? 'Draft' : text(health.currentPr?.state, 'Recorded');
    const badge = document.createElement('span'); badge.className = 'pr-health-badge ' + (health.tone || 'neutral'); badge.textContent = health.label || 'Unknown';
    identity.append(pr, state, badge); header.append(identity); card.append(heading, header);

    const list = document.createElement('div'); list.className = 'pr-health-list';
    if (health.status === 'healthy') {
      if (health.checks?.total) list.append(prHealthRow('Required checks passed', health.checks.passingCount + ' of ' + health.checks.total + ' checks are passing.', 'healthy'));
      if (health.currentPr?.headSha) list.append(prHealthRow('Current head verified', 'GitHub reports head ' + String(health.currentPr.headSha).slice(0, 12) + '.', 'healthy'));
      if (health.currentPr?.issueAssociation === true) list.append(prHealthRow('Issue association present', 'The current PR explicitly closes issue #' + item.issueNumber + '.', 'healthy'));
      if (!list.children.length) list.append(prHealthRow('Current PR is healthy', 'No current PR blockers or wait conditions are recorded.', 'healthy'));
    } else {
      for (const problem of health.problems || []) list.append(prHealthRow(problem.title || problem.code, problem.message, problem.severity));
      if (!list.children.length) list.append(prHealthRow('PR health needs review', 'No detailed PR health evidence is available.', 'attention'));
    }
    card.append(list);
    if (health.currentPr?.url || item.pullRequest?.url) { const link = document.createElement('a'); link.className = 'pr-health-link'; link.href = health.currentPr?.url || item.pullRequest.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'View PR #' + item.pullRequest.number + ' on GitHub ↗'; card.append(link); }
    return card;
  }

  function inlineDetails(item) {
    const card = document.createElement('section'); card.className = 'lifecycle-detail-card';
    const heading = document.createElement('h3'); heading.className = 'lifecycle-section-title';
    const grid = document.createElement('div'); grid.className = 'lifecycle-detail-grid';
    if (isReviewStage(item)) {
      const review = item.review || {};
      heading.textContent = 'Review details';
      grid.append(
        detailFact('Type', review.label || 'Review'),
        detailFact('Round', review.round ? (review.limit ? review.round + ' of ' + review.limit : review.round) : null),
      );
      if (review.type === 'web-chatgpt') {
        grid.append(detailFact('Channel', review.channel || 'Browser conversation'), detailFact('Conversation', review.conversationUrl ? 'Open conversation' : null, review.conversationUrl));
      } else {
        grid.append(detailFact('Model', review.model), detailFact('Thinking', review.thinking));
      }
      grid.append(detailFact('Latest result', review.result), detailFact('Exact head', review.headSha));
    } else {
      heading.textContent = 'Coding details';
      grid.append(
        detailFact('Workflow', 'Coding'),
        detailFact('Model', item.coding?.model),
        detailFact('Thinking', item.coding?.thinking),
        detailFact('Harness', item.coding?.harness),
        detailFact('Branch', item.branch),
        detailFact('Workspace', item.workspaceId),
      );
    }
    card.append(heading, grid);
    const next = document.createElement('div'); next.className = 'lifecycle-next-action'; next.textContent = item.reason || item.nextAction || 'No blocker or next action is recorded.'; card.append(next);
    return card;
  }

  function friendlyActivity(event, item) {
    const type = String(event.type || 'activity');
    const search = eventSearchText(event);
    if (type === 'operator-action' || String(event.source || '').toLowerCase() === 'operator') return firstLine(event.detail) || 'Manual operator action recorded.';
    if (type === 'run-created') return 'Issue automation run created and marked available.';
    if (search.includes('phase=ready -> queued') || search.includes('claimed')) return 'Claimed by automation.';
    if (search.includes('phase=queued -> coding') || search.includes('agent-started')) return 'Coding started in workspace.';
    if ((search.includes('pull request') || search.includes('pr-created')) && item.pullRequest?.number) return 'Draft PR #' + item.pullRequest.number + ' opened.';
    if (search.includes('review-queued') || search.includes('review queued')) return 'PR review queued.';
    if (search.includes('reviewing') || search.includes('review started')) return (item.review?.label || 'Review') + ' started.';
    if (search.includes('pr-merged')) return 'PR' + (item.pullRequest?.number ? ' #' + item.pullRequest.number : '') + ' merged.';
    if (search.includes('closure verified') || search.includes('issueclosureverified')) return 'Issue closure verified.';
    if (search.includes('completed') && type === 'run-state-changed') return 'Issue lifecycle completed.';
    return firstLine(event.detail) || type.replaceAll('-', ' ').replace(/\b\w/g, function(letter) { return letter.toUpperCase(); });
  }

  function activityIcon(event) {
    const search = eventSearchText(event);
    if (String(event.source || '').toLowerCase() === 'operator') return '✦';
    if (/failed|error/.test(search)) return '!';
    if (/review/.test(search)) return '⌕';
    if (/pull request|pr-/.test(search)) return '▤';
    if (/coding|agent/.test(search)) return '</>';
    if (/claim|queued/.test(search)) return '◎';
    if (/merged|closed|completed/.test(search)) return '✓';
    return '•';
  }

  function activityTimeline(item) {
    const card = document.createElement('aside'); card.className = 'activity-card';
    const heading = document.createElement('h3'); heading.className = 'lifecycle-section-title'; heading.textContent = 'Activity Timeline'; card.append(heading);
    const list = document.createElement('div'); list.className = 'activity-timeline';
    const events = timelineAscending(item).slice(-18);
    if (!events.length) { const empty = document.createElement('div'); empty.className = 'activity-empty'; empty.textContent = 'No activity has been recorded for this issue yet.'; list.append(empty); }
    for (const event of events) {
      const row = document.createElement('div');
      const failed = /failed|error/i.test(String(event.status || '') + ' ' + String(event.detail || ''));
      const operator = String(event.source || '').toLowerCase() === 'operator';
      row.className = 'activity-event' + (failed ? ' failed' : '') + (operator ? ' operator' : '');
      const icon = document.createElement('div'); icon.className = 'activity-icon'; icon.textContent = activityIcon(event);
      const copy = document.createElement('div'); copy.className = 'activity-copy';
      const at = document.createElement('div'); at.className = 'activity-time'; at.textContent = formatDate(event.at);
      const message = document.createElement('div'); message.className = 'activity-message'; message.textContent = friendlyActivity(event, item);
      copy.append(at, message);
      if (event.source && !['lifecycle', 'state'].includes(event.source)) { const source = document.createElement('div'); source.className = 'activity-source'; source.textContent = event.source; copy.append(source); }
      row.append(icon, copy); list.append(row);
    }
    card.append(list); return card;
  }

  function expandedPanel(item) {
    const panel = document.createElement('div'); panel.className = 'lifecycle-expanded'; panel.dataset.lifecycleExpanded = String(item.issueNumber);
    const main = document.createElement('div'); main.className = 'lifecycle-main'; main.append(lifecycleFlow(item));
    const health = prHealthCard(item); if (health) main.append(health);
    main.append(inlineDetails(item));
    panel.append(main, activityTimeline(item));
    return panel;
  }

  function closeActionMenus(exceptIssue) {
    document.querySelectorAll('.lifecycle-actions-popover').forEach(function(menu) {
      if (exceptIssue && menu.dataset.issueNumber === String(exceptIssue)) return;
      menu.hidden = true;
      const button = menu.parentElement?.querySelector('[data-actions-toggle]'); if (button) button.setAttribute('aria-expanded', 'false');
    });
    if (!exceptIssue) openActionsIssue = null;
  }

  function actionEntry(label, description, action, item, options) {
    options = options || {};
    const button = document.createElement('button'); button.type = 'button'; button.className = 'lifecycle-action-entry' + (options.danger ? ' danger' : '');
    if (action) button.dataset.issueAction = action;
    const title = document.createElement('strong'); title.textContent = label;
    const copy = document.createElement('span'); copy.textContent = description;
    button.append(title, copy);
    if (action && !['restart-issue', 'abandon-issue'].includes(action)) {
      button.addEventListener('click', async function(event) {
        event.stopPropagation();
        if (action === 'skip-issue') {
          const approved = await confirmLifecycleAction('Skip issue #' + item.issueNumber + '?', 'Paseo will stop automatically selecting this issue until it is unskipped.', 'Skip issue');
          if (!approved) return;
        }
        try { await runItemAction(action, item); } catch (error) { showQueueError(error); }
        closeActionMenus();
      });
    }
    return button;
  }

  function actionMenu(item) {
    const menu = document.createElement('div'); menu.className = 'lifecycle-actions-popover'; menu.hidden = openActionsIssue !== item.issueNumber; menu.dataset.issueNumber = String(item.issueNumber);
    const title = document.createElement('div'); title.className = 'lifecycle-actions-title'; title.textContent = 'Actions'; menu.append(title);
`;
