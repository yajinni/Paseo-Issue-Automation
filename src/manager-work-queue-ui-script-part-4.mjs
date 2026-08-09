export const MANAGER_WORK_QUEUE_SCRIPT_PART_4 = String.raw`    const head = document.createElement('header'); head.className = 'work-detail-head'; const title = document.createElement('div'); title.innerHTML = '<div class="eyebrow">Deep troubleshooting</div>'; const h2 = document.createElement('h2'); h2.id = 'work-detail-title'; h2.textContent = '#' + item.issueNumber + ' ' + item.title; title.append(h2); const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary'; close.textContent = 'Close'; close.dataset.workDetailClose = 'true'; close.addEventListener('click', closeDrawer); head.append(title, close); drawer.append(head);
    const diagnostic = item.diagnostics || {};
    drawer.append(drawerSection('Dashboard and run state', [
      ['Displayed stage', item.stageLabel], ['Raw lifecycle label', item.lifecycleLabel || (item.waitingForDependencies ? 'Native dependency wait' : null)], ['Raw phase', item.phase], ['Raw status', diagnostic.rawStatus], ['Attempt', item.attempt], ['Reason / blocker', item.reason || item.nextAction], ['Started', item.startedAt ? formatDate(item.startedAt) : null], ['Last heartbeat', diagnostic.heartbeatAt ? formatDate(diagnostic.heartbeatAt) : null], ['State directory', statusData?.stateDirectory], ['Repository branch', statusData?.repository?.branch],
    ]));
    const repositoryBlockers = (statusData?.blockers || []).map(function(blocker) { return blocker?.message || blocker?.reason || blocker?.code; }).filter(Boolean).join(' | ');
    drawer.append(drawerSection('Repository controller context', [
      ['Claims enabled', statusData?.automation?.claimsEnabled === true ? 'Yes' : 'No'], ['Coding worker', statusData?.worker?.running ? 'Running' : 'Stopped'], ['Coding worker state', statusData?.worker?.state], ['PR-review worker', statusData?.reviewWorker?.running ? 'Running' : 'Stopped'], ['Review worker state', statusData?.reviewWorker?.state], ['Review store', statusData?.prReviews?.available === false ? 'Unavailable' : statusData?.prReviews?.enabled ? 'Enabled' : 'Disabled'], ['Active review job ID', statusData?.prReviews?.activeReviewJobId], ['Waiting review jobs', statusData?.prReviews?.waitingReviewCount], ['Last review reconciliation', statusData?.reviewWorker?.lastReconciliationAt ? formatDate(statusData.reviewWorker.lastReconciliationAt) : null], ['Review reconciliation error', statusData?.reviewWorker?.lastReconciliationError || statusData?.prReviews?.error], ['Last dispatch', statusData?.automation?.lastDispatchAt ? formatDate(statusData.automation.lastDispatchAt) : null], ['Latest dispatch result', statusData?.automation?.lastDispatchResult ? JSON.stringify(statusData.automation.lastDispatchResult) : null], ['Repository blockers', repositoryBlockers || null],
    ]));
    drawer.append(drawerSection('Execution identity', [
      ['Branch', item.branch], ['Workspace', item.workspaceId], ['Worktree path', diagnostic.worktreePath], ['Coder agent ID', diagnostic.coderAgentId], ['Controller PID', diagnostic.controllerPid], ['Coding harness', item.coding?.harness], ['Configured coder model', item.coding?.model], ['Configured coder thinking', item.coding?.thinking],
    ]));
    const review = item.review || {};
    drawer.append(drawerSection('PR and review evidence', [
      ['PR', item.pullRequest?.number ? '#' + item.pullRequest.number : null, item.pullRequest?.url], ['Review type', review.label], ['Review stage', review.stage], ['Review round', review.round ? (review.limit ? review.round + ' / ' + review.limit : review.round) : null], ['Review source', review.source], ['Review result', review.result], ['Current head SHA', diagnostic.currentHeadSha || review.headSha], ['Validation approved', review.validationApproved ? 'Yes' : 'No'], ['Validation head SHA', review.validationHeadSha || diagnostic.validationHeadSha], ['Review approved', review.reviewApproved ? 'Yes' : 'No'], ['Approved head SHA', review.approvedHeadSha || diagnostic.approvedHeadSha], ['Approved commit', diagnostic.approvedCommit], ['Merged head SHA', diagnostic.mergedHeadSha], ['Merged at', diagnostic.mergedAt ? formatDate(diagnostic.mergedAt) : null], ['Issue closure verified', diagnostic.issueClosureVerifiedAt ? formatDate(diagnostic.issueClosureVerifiedAt) : null], ['Conversation', review.conversationUrl ? 'Open Web ChatGPT conversation' : null, review.conversationUrl],
    ]));
    const prAutomation = item.reviewAutomation || null;
    if (prAutomation) {
      const reviewJob = prAutomation.latestReviewJob || {};
      const fixJob = prAutomation.latestFixJob || {};
      drawer.append(drawerSection('PR-review automation record', [
        ['Managed PR ID', prAutomation.managedId], ['Stored review state', prAutomation.reviewState], ['Stored branch', prAutomation.branchName], ['Stored current head', prAutomation.currentHeadSha], ['Last submitted review SHA', prAutomation.lastSubmittedReviewSha], ['Last completed review SHA', prAutomation.lastCompletedReviewSha], ['Stored review round', prAutomation.reviewRound], ['Queue position', prAutomation.queuePosition], ['Active review request', prAutomation.activeReviewRequestId], ['Last processed review request', prAutomation.lastProcessedReviewRequestId], ['Last review comment ID', prAutomation.lastReviewCommentId], ['Last reconciled', prAutomation.lastReconciledAt ? formatDate(prAutomation.lastReconciledAt) : null], ['Last PR activity', prAutomation.lastActivityAt ? formatDate(prAutomation.lastActivityAt) : null], ['PR automation error', prAutomation.lastError], ['Issue closure pending', prAutomation.issueClosurePending ? 'Yes' : 'No'], ['Lifecycle completion pending', prAutomation.lifecycleCompletionPending ? 'Yes' : 'No'], ['Review evidence missing', prAutomation.reviewEvidenceMissing ? 'Yes' : 'No'], ['Latest review job', reviewJob.id], ['Review job state', reviewJob.state], ['Review job head', reviewJob.headSha], ['Review request ID', reviewJob.reviewRequestId], ['Review job attempts', reviewJob.attempts], ['Review conversation', reviewJob.conversationUrl ? 'Open conversation' : null, reviewJob.conversationUrl], ['Review job error', reviewJob.lastError], ['Latest fix job', fixJob.id], ['Fix job state', fixJob.state], ['Reviewed head', fixJob.reviewedHeadSha], ['New head', fixJob.newHeadSha], ['Fix coder agent', fixJob.coderAgentId], ['Fix attempts', fixJob.attempts], ['Fix error', fixJob.lastError],
      ]));
    }
    const reason = document.createElement('section'); reason.className = 'work-detail-section'; const reasonHeading = document.createElement('h3'); reasonHeading.textContent = 'Current explanation'; const reasonCopy = document.createElement('div'); reasonCopy.className = 'work-detail-reason'; reasonCopy.textContent = item.reason || item.nextAction || 'No blocker or next action is recorded.'; reason.append(reasonHeading, reasonCopy);
    if (item.issueUrl || item.pullRequest?.url) { const links = document.createElement('div'); links.className = 'work-detail-links'; if (item.issueUrl) { const issue = document.createElement('a'); issue.className = 'work-detail-link'; issue.href = item.issueUrl; issue.target = '_blank'; issue.rel = 'noreferrer'; issue.textContent = 'Open issue #' + item.issueNumber; links.append(issue); } if (item.pullRequest?.url) { const pr = document.createElement('a'); pr.className = 'work-detail-link'; pr.href = item.pullRequest.url; pr.target = '_blank'; pr.rel = 'noreferrer'; pr.textContent = 'Open PR #' + item.pullRequest.number; links.append(pr); } reason.append(links); }
    drawer.append(reason, rawTimelineSection(item)); drawer.hidden = false; scrim.hidden = false; drawer.scrollTop = scrollTop; if (!options.preserveInteraction) close.focus();
  }

  function closeDrawer() {
    const closingIssue = selectedIssue; selectedIssue = null; const drawer = document.getElementById('work-detail-drawer'); const scrim = document.getElementById('work-detail-scrim'); if (drawer) drawer.hidden = true; if (scrim) scrim.hidden = true;
    const returnFocus = drawerReturnFocus; drawerReturnFocus = null; const currentDetails = closingIssue == null ? null : document.querySelector('.lifecycle-item[data-issue-number="' + String(closingIssue) + '"] [data-work-details="true"]'); const focusTarget = returnFocus?.isConnected ? returnFocus : currentDetails || document.getElementById('work-queue-search'); try { focusTarget?.focus?.(); } catch {}
  }

  function drawerFocusables() { const drawer = document.getElementById('work-detail-drawer'); if (!drawer || drawer.hidden) return []; return [...drawer.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(function(element) { return !element.disabled && !element.hidden; }); }
  function handleKeydown(event) {
    if (event.key === 'Escape' && openActionsIssue) { closeActionMenus(); render(); return; }
    if (!selectedIssue) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
    if (event.key !== 'Tab') return;
    const items = drawerFocusables(); if (!items.length) { event.preventDefault(); document.getElementById('work-detail-drawer')?.focus(); return; } const first = items[0]; const last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function runItemAction(action, item) {
    if (typeof postRepositoryAction !== 'function') throw new Error('Repository actions are unavailable.');
    if (action === 'restart-issue' || action === 'abandon-issue') throw new Error('Dangerous issue actions require the manager confirmation layer.');
    const payload = { issueNumber: Number(item.issueNumber), branchAction: document.getElementById('branch-action')?.value || 'keep' };
    await postRepositoryAction(action, payload);
  }

  function showQueueError(error) { if (typeof showError === 'function') showError(error); else console.error(error); }

  function renderStatusQueue(data) {
    statusData = data || null; queueData = data?.workQueue || { items: [], counts: {}, total: 0, active: 0, attention: 0 }; render();
    if (selectedIssue) { const selected = queueData.items?.find(function(item) { return item.issueNumber === selectedIssue; }); if (selected) openDrawer(selected, null, { preserveInteraction: true }); else closeDrawer(); }
    const badge = document.querySelector('[data-manager-badge="work-queue"]'); if (badge) { const count = Number(queueData.active || 0) + Number(queueData.attention || 0); badge.textContent = String(count); badge.classList.toggle('visible', count > 0); badge.classList.toggle('attention', Number(queueData.attention || 0) > 0); }
  }

  document.addEventListener('click', function(event) { if (!event.target.closest?.('.lifecycle-row-actions')) { if (openActionsIssue) { closeActionMenus(); render(); } } });
  document.addEventListener('keydown', handleKeydown);
  if (typeof window.addManagerStatusListener === 'function') window.addManagerStatusListener(renderStatusQueue);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true }); else build();
  try { if (typeof currentStatus !== 'undefined' && currentStatus) renderStatusQueue(currentStatus); } catch {}
})();
`;
