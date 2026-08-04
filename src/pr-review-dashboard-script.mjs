export const PR_REVIEW_DASHBOARD_SCRIPT = String.raw`
(function installPrReviewDashboard() {
  let prData = null;
  let prRefreshInFlight = null;
  let confirmPath = null;
  let confirmPhrase = null;

  function escapePr(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  function shortPrSha(value) {
    return value ? String(value).slice(0, 9) : '—';
  }

  async function prApi(path, options) {
    const response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  function setPrChip(id, text, state) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = text;
    node.className = 'chip ' + (state || '');
  }

  function prBadge(state) {
    const style = ['failed', 'closed_unmerged'].includes(state)
      ? 'failed'
      : ['fixing', 'submitting', 'awaiting_result'].includes(state)
        ? 'running'
        : ['queued', 'ready_to_merge', 'merged'].includes(state)
          ? 'ready'
          : 'blocked';
    return '<span class="badge ' + style + '">' + escapePr(state) + '</span>';
  }

  function prReviewJobCard(job, index) {
    if (!job) return '<div class="empty">No active review.</div>';
    const managed = (prData.managedPullRequests || []).find(function(item) {
      return item.id === job.managedPullRequestId;
    }) || {};
    const controls = index == null ? '' : [
      '<button class="small secondary" onclick="prReviewPost(\'/api/pr-reviews/move\',{reviewJobId:\'' + escapePr(job.id) + '\',direction:\'up\'})">Move up</button>',
      '<button class="small secondary" onclick="prReviewPost(\'/api/pr-reviews/move\',{reviewJobId:\'' + escapePr(job.id) + '\',direction:\'down\'})">Move down</button>',
      '<button class="small danger" onclick="prReviewPost(\'/api/pr-reviews/cancel\',{reviewJobId:\'' + escapePr(job.id) + '\'})">Cancel</button>'
    ].join('');
    const error = job.lastError
      ? '<div class="pr-review-error">' + escapePr(job.lastError) + (job.diagnosticScreenshot ? '\nDiagnostic screenshot: ' + escapePr(job.diagnosticScreenshot) : '') + '</div>'
      : '';
    return [
      '<div class="pr-review-item ' + (job.state === 'submitting' ? 'active' : '') + '">',
      '<div class="issue-head"><div><div class="pr-review-title">PR #' + escapePr(job.pullRequestNumber) + ' · ' + escapePr(managed.repository || job.repository) + '</div>',
      '<div class="badges">' + prBadge(job.state) + '<span class="badge">SHA ' + escapePr(shortPrSha(job.headSha)) + '</span><span class="badge">Round ' + escapePr(job.reviewRound) + '</span></div></div>',
      '<div class="actions">' + controls + '</div></div>',
      '<div class="meta-grid"><span>Request: <strong class="code">' + escapePr(job.reviewRequestId) + '</strong></span><span>Due: <strong>' + escapePr(job.dueAt || '—') + '</strong></span><span>Attempts: <strong>' + escapePr(job.attempts) + '</strong></span><span>Conversation: <strong>' + escapePr(job.conversationUrlUsed || job.conversationUrlOverride || 'resolved at submission') + '</strong></span></div>',
      error,
      '</div>'
    ].join('');
  }

  function closedPrControls(record) {
    if (record.reviewState !== 'closed_unmerged') return '';
    const id = escapePr(record.id);
    return '<div class="actions pr-review-section">' + [
      '<button onclick="prReviewPost(\'/api/pr-reviews/closed/reopen\',{managedPullRequestId:\'' + id + '\'})">Reopen PR</button>',
      '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/closed/return-coding\',{managedPullRequestId:\'' + id + '\'})">Return to coding</button>',
      '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/closed/backlog\',{managedPullRequestId:\'' + id + '\'})">Return to backlog</button>',
      '<button class="danger" onclick="prReviewPost(\'/api/pr-reviews/closed/cancel-issue\',{managedPullRequestId:\'' + id + '\'})">Cancel issue</button>',
      '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/closed/manual-resolved\',{managedPullRequestId:\'' + id + '\'})">Mark resolved</button>'
    ].join('') + '</div>';
  }

  function managedPrCard(record) {
    const review = record.currentReviewJob;
    const fix = record.currentFixJob;
    const id = escapePr(record.id);
    const links = [
      '<a class="pr-review-link" href="' + escapePr(record.pullRequestUrl) + '" target="_blank" rel="noreferrer">Open PR</a>',
      record.issueUrl ? '<a class="pr-review-link" href="' + escapePr(record.issueUrl) + '" target="_blank" rel="noreferrer">Open issue</a>' : '',
      record.resolvedConversationUrl ? '<a class="pr-review-link" href="' + escapePr(record.resolvedConversationUrl) + '" target="_blank" rel="noreferrer">Open ChatGPT</a>' : ''
    ].join('');
    const reviewControls = [
      '<button onclick="prReviewPost(\'/api/pr-reviews/review-now\',{managedPullRequestId:\'' + id + '\'})">Review now</button>',
      '<button class="secondary" onclick="openPrReviewOverride(\'' + id + '\',\'' + escapePr(record.resolvedConversationUrl || '') + '\')">One-time destination</button>',
      review && review.state === 'failed' ? '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/retry\',{reviewJobId:\'' + escapePr(review.id) + '\'})">Retry failed submission</button>' : '',
      record.reviewState === 'paused'
        ? '<button onclick="prReviewPost(\'/api/pr-reviews/resume-pr\',{managedPullRequestId:\'' + id + '\'})">Resume PR</button>'
        : '<button class="warning" onclick="prReviewPost(\'/api/pr-reviews/pause-pr\',{managedPullRequestId:\'' + id + '\'})">Pause PR</button>',
      '<button class="secondary" onclick="openPrManualResult(\'' + id + '\')">Manual result</button>'
    ].join('');
    const reviewSummary = review
      ? '<div class="pr-review-finding">Review job: ' + escapePr(review.state) + ' · ' + escapePr(shortPrSha(review.headSha)) + '</div>'
      : '';
    const fixSummary = fix
      ? '<div class="pr-review-finding">Fix job: ' + escapePr(fix.state) + ' · reviewed ' + escapePr(shortPrSha(fix.reviewedHeadSha)) + '<div class="actions pr-review-section"><button onclick="prReviewPost(\'/api/pr-reviews/send-to-coding\')">Send queued fix to coding</button></div></div>'
      : '';
    const error = record.lastError
      ? '<div class="pr-review-error">' + escapePr(record.lastError) + (record.diagnosticScreenshot ? '\nDiagnostic screenshot: ' + escapePr(record.diagnosticScreenshot) : '') + '</div>'
      : '';
    const itemClass = record.reviewState === 'failed' ? 'failed' : record.reviewState === 'fixing' ? 'fixing' : '';
    return [
      '<div class="pr-review-item ' + itemClass + '">',
      '<div class="issue-head"><div><div class="pr-review-title">PR #' + escapePr(record.pullRequestNumber) + ' · Issue #' + escapePr(record.issueNumber) + '</div>',
      '<div class="badges">' + prBadge(record.reviewState) + '<span class="badge">Current ' + escapePr(shortPrSha(record.currentHeadSha)) + '</span><span class="badge">Reviewed ' + escapePr(shortPrSha(record.lastCompletedReviewSha)) + '</span><span class="badge">Round ' + escapePr(record.reviewRound) + '</span></div></div>',
      '<div class="actions">' + links + reviewControls + '</div></div>',
      '<div class="meta-grid"><span>Branch: <strong class="code">' + escapePr(record.branchName) + '</strong></span><span>Last activity: <strong>' + escapePr(record.lastActivityAt || '—') + '</strong></span><span>Last reconciliation: <strong>' + escapePr(record.lastReconciledAt || '—') + '</strong></span><span>Conversation: <strong>' + escapePr(record.resolvedConversationUrl || 'Not configured') + '</strong></span></div>',
      reviewSummary,
      fixSummary,
      error,
      closedPrControls(record),
      '</div>'
    ].join('');
  }

  window.renderManagedPrReviews = function() {
    if (!prData) return;
    const filter = document.getElementById('pr-state-filter').value;
    const records = (prData.managedPullRequests || []).filter(function(record) {
      return filter === 'all' || record.reviewState === filter;
    });
    document.getElementById('pr-managed-list').innerHTML = records.length
      ? records.map(managedPrCard).join('')
      : '<div class="empty">No managed PRs match this filter.</div>';
  };

  function renderPrReviews() {
    if (!prData) return;
    const config = prData.config;
    const browser = prData.browser;
    document.getElementById('pr-active-review').innerHTML = prReviewJobCard(prData.activeReview);
    document.getElementById('pr-waiting-reviews').innerHTML = prData.waitingReviews && prData.waitingReviews.length
      ? prData.waitingReviews.map(prReviewJobCard).join('')
      : '<div class="empty">No queued reviews.</div>';
    window.renderManagedPrReviews();

    setPrChip('pr-queue-chip', config.reviewQueue.paused ? 'Reviews paused' : 'Reviews running', config.reviewQueue.paused ? 'warn' : 'good');
    setPrChip('pr-browser-chip', browser.library.installed ? 'Playwright installed' : 'Playwright missing', browser.library.installed ? 'good' : 'bad');
    setPrChip('pr-auth-chip', browser.profile.lastAuthenticatedAt ? 'Profile authenticated' : 'Authentication unverified', browser.profile.lastAuthenticatedAt ? 'good' : 'warn');
    const conversation = config.browserReview.projectConversationUrl || prData.globalConversationUrl;
    setPrChip('pr-conversation-chip', conversation ? 'Conversation configured' : 'Conversation missing', conversation ? 'good' : 'bad');
    setPrChip('pr-reconcile-chip', prData.runtime.lastReconciledAt ? 'Reconciled ' + prData.runtime.lastReconciledAt : 'Not reconciled', prData.runtime.lastReconciledAt ? 'info' : 'warn');

    const queueToggle = document.getElementById('pr-review-queue-toggle');
    queueToggle.disabled = false;
    queueToggle.textContent = config.reviewQueue.paused ? 'Resume reviews' : 'Pause reviews';
    queueToggle.className = config.reviewQueue.paused ? '' : 'warning';

    document.getElementById('pr-enabled').value = String(config.enabled);
    document.getElementById('pr-browser-enabled').value = String(config.browserReview.enabled);
    document.getElementById('pr-project-url').value = config.browserReview.projectConversationUrl || '';
    document.getElementById('pr-debounce').value = config.browserReview.reviewDebounceMs;
    document.getElementById('pr-active-interval').value = config.reconciliation.activeIntervalMs;
    document.getElementById('pr-idle-interval').value = config.reconciliation.idleIntervalMs;
    document.getElementById('pr-max-attempts').value = config.browserReview.maxSubmissionAttempts;
    document.getElementById('pr-allow-merge').value = String(config.githubActions.allowChatGPTMerge);
    document.getElementById('pr-verify-closure').value = String(config.githubActions.verifyIssueClosure);
    document.getElementById('pr-closure-fallback').value = String(config.githubActions.allowPaseoIssueClosureFallback);
    document.getElementById('pr-prompt').value = config.browserReview.reviewPromptTemplate;
    document.getElementById('pr-browser-status').innerHTML = [
      '<span>Library: <strong>' + escapePr(browser.library.installed ? 'Installed' : 'Missing') + '</strong></span>',
      '<span>Profile: <strong>' + escapePr(browser.profile.profileExists ? 'Ready' : 'Missing') + '</strong></span>',
      '<span>Profile lock: <strong>' + escapePr(browser.profile.locked ? 'In use' : 'Available') + '</strong></span>',
      '<span>Global conversation: <strong>' + escapePr(prData.globalConversationUrl || 'Not configured') + '</strong></span>'
    ].join('');
    document.getElementById('pr-history').innerHTML = prData.history && prData.history.length
      ? prData.history.map(function(event) {
        return '<div class="pr-review-event"><time>' + escapePr(event.timestamp) + '</time><div><strong>' + escapePr(event.entityType) + ' · ' + escapePr(event.newState || event.reason) + '</strong></div><div class="details">' + escapePr(event.reason) + ' · ' + escapePr(event.actor) + (event.sha ? ' · ' + escapePr(shortPrSha(event.sha)) : '') + (event.error ? ' · ' + escapePr(event.error) : '') + '</div></div>';
      }).join('')
      : '<div class="empty">No history.</div>';
  }

  window.refreshPrReviews = function(force) {
    if (prRefreshInFlight && !force) return prRefreshInFlight;
    prRefreshInFlight = prApi('/api/pr-reviews/status')
      .then(function(result) {
        prData = result;
        renderPrReviews();
        return result;
      })
      .catch(function(error) {
        toast(error.message, true);
        throw error;
      })
      .finally(function() {
        prRefreshInFlight = null;
      });
    return prRefreshInFlight;
  };

  window.prReviewPost = async function(path, body) {
    try {
      const result = await prApi(path, { method: 'POST', body: JSON.stringify(body || {}) });
      toast('Action completed.');
      await Promise.allSettled([window.refreshPrReviews(true), refreshStatus()]);
      return result;
    } catch (error) {
      toast(error.message, true);
      return null;
    }
  };

  window.togglePrReviewQueue = function() {
    if (!prData) return;
    return window.prReviewPost(prData.config.reviewQueue.paused ? '/api/pr-reviews/resume' : '/api/pr-reviews/pause');
  };

  window.savePrReviewSettings = function() {
    if (!prData) return;
    return window.prReviewPost('/api/pr-reviews/config', {
      enabled: document.getElementById('pr-enabled').value === 'true',
      browserReview: {
        enabled: document.getElementById('pr-browser-enabled').value === 'true',
        projectConversationUrl: document.getElementById('pr-project-url').value || null,
        reviewPromptTemplate: document.getElementById('pr-prompt').value,
        reviewPromptVersion: prData.config.browserReview.reviewPromptVersion,
        reviewDebounceMs: Number(document.getElementById('pr-debounce').value),
        maxSubmissionAttempts: Number(document.getElementById('pr-max-attempts').value)
      },
      reconciliation: {
        enabled: true,
        activeIntervalMs: Number(document.getElementById('pr-active-interval').value),
        idleIntervalMs: Number(document.getElementById('pr-idle-interval').value)
      },
      githubActions: {
        allowChatGPTMerge: document.getElementById('pr-allow-merge').value === 'true',
        verifyIssueClosure: document.getElementById('pr-verify-closure').value === 'true',
        allowPaseoIssueClosureFallback: document.getElementById('pr-closure-fallback').value === 'true'
      }
    });
  };

  window.openPrReviewOverride = function(id, current) {
    document.getElementById('pr-override-managed-id').value = id;
    document.getElementById('pr-override-url').value = current || '';
    document.getElementById('pr-override-dialog').showModal();
  };

  window.submitPrReviewOverride = function() {
    const id = document.getElementById('pr-override-managed-id').value;
    const url = document.getElementById('pr-override-url').value.trim();
    closeDialog('pr-override-dialog');
    return window.prReviewPost('/api/pr-reviews/review-now', { managedPullRequestId: id, conversationUrlOverride: url });
  };

  window.openPrManualResult = function(id) {
    document.getElementById('pr-manual-managed-id').value = id;
    document.getElementById('pr-manual-findings').value = '';
    document.getElementById('pr-manual-dialog').showModal();
  };

  window.submitPrManualResult = function() {
    const body = {
      managedPullRequestId: document.getElementById('pr-manual-managed-id').value,
      result: document.getElementById('pr-manual-result').value,
      findings: document.getElementById('pr-manual-findings').value
    };
    closeDialog('pr-manual-dialog');
    return window.prReviewPost('/api/pr-reviews/manual-result', body);
  };

  window.openPrReviewConfirm = function(title, phrase, path) {
    confirmPath = path;
    confirmPhrase = phrase;
    document.getElementById('pr-confirm-title').textContent = title;
    document.getElementById('pr-confirm-text').textContent = 'Type ' + phrase + ' to continue.';
    const input = document.getElementById('pr-confirm-input');
    const confirm = document.getElementById('pr-confirm-button');
    input.value = '';
    confirm.disabled = true;
    input.oninput = function() {
      confirm.disabled = input.value !== confirmPhrase;
    };
    confirm.onclick = async function() {
      closeDialog('pr-confirm-dialog');
      await window.prReviewPost(confirmPath);
    };
    document.getElementById('pr-confirm-dialog').showModal();
    input.focus();
  };

  const previousShowView = window.showView;
  window.showView = function(name) {
    previousShowView(name);
    if (name === 'pr-reviews') window.refreshPrReviews();
  };
  showView = window.showView;

  document.addEventListener('DOMContentLoaded', function() {
    const panel = document.getElementById('view-pr-reviews');
    if (panel && panel.classList.contains('active')) window.refreshPrReviews();
    setInterval(function() {
      if (document.hidden) return;
      const activePanel = document.getElementById('view-pr-reviews');
      if (activePanel && activePanel.classList.contains('active')) window.refreshPrReviews();
    }, 15000);
  });
})();
`;
