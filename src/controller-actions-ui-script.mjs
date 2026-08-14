export const CONTROLLER_ACTIONS_UI_SCRIPT = String.raw`
(function installControllerActionsUi() {
  function controllerIsOperational(data) {
    return Boolean(data.config && data.config.setupComplete && data.checks && data.checks.ready);
  }

  function repositoryIsReadable(data) {
    return Boolean(data.requirements && data.requirements.git && data.requirements.githubAuthenticated && data.requirements.remote);
  }

  function updateActionButton(button, options) {
    if (!button) return;
    button.textContent = options.text;
    button.disabled = Boolean(options.disabled);
    button.className = options.className || '';
    button.title = options.title || '';
  }

  function buttonByText(root, text) {
    return Array.from((root || document).querySelectorAll('button')).find(function(button) {
      return String(button.textContent || '').replace(/\s+/g, ' ').trim() === text;
    }) || null;
  }

  function normalizeChatGptBrowserControls(data) {
    if (data && typeof window.renderPrReviewBrowserSetup === 'function') {
      window.renderPrReviewBrowserSetup(data);
    }
  }

  function replaceVisibleClaimsLanguage(value) {
    if (typeof value === 'string') {
      return value
        .replace(/Claims are paused\./g, 'Issues Processing is stopped.')
        .replace(/Claims paused\./g, 'Issues Processing stopped.')
        .replace(/Claims resumed\./g, 'Issues Processing resumed.');
    }
    if (Array.isArray(value)) {
      value.forEach(function(item, index) { value[index] = replaceVisibleClaimsLanguage(item); });
      return value;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function(key) { value[key] = replaceVisibleClaimsLanguage(value[key]); });
    }
    return value;
  }

  function normalizePrReviewControls(data) {
    const actionBar = document.getElementById('controller-actions');
    const reviewToggle = document.getElementById('pr-review-queue-toggle');
    if (actionBar && reviewToggle && reviewToggle.parentElement !== actionBar) actionBar.appendChild(reviewToggle);

    const reviewPanel = document.getElementById('view-pr-reviews');
    const refreshButton = buttonByText(reviewPanel, 'Refresh');
    if (refreshButton) refreshButton.remove();

    const forceSync = buttonByText(reviewPanel, 'Reconcile GitHub') || buttonByText(reviewPanel, 'Force Sync PR States');
    if (forceSync) {
      forceSync.textContent = 'Force Sync PR States';
      forceSync.title = 'Immediately compare managed pull requests with GitHub and process current commits, reviews, checks, merges, and closures.';
    }

    if (reviewToggle) {
      const enabled = data && data.config ? data.config.browserReview?.enabled === true : null;
      const paused = data && data.config && data.config.reviewQueue
        ? data.config.reviewQueue.paused === true
        : null;
      if (enabled !== null) reviewToggle.classList.toggle('hidden', !enabled);
      if (paused === true) {
        reviewToggle.textContent = 'Resume PR Reviews';
        reviewToggle.classList.remove('warning');
        reviewToggle.title = 'Allow the serial PR review scheduler to start the next eligible review.';
      } else if (paused === false) {
        reviewToggle.textContent = 'Pause PR Reviews';
        reviewToggle.classList.add('warning');
        reviewToggle.title = 'Stop new PR review submissions without interrupting an active submission.';
      } else {
        reviewToggle.textContent = 'PR Reviews loading…';
        reviewToggle.title = 'Loading the PR review queue state.';
      }
    }

    normalizeChatGptBrowserControls(data);
  }

  window.toggleClaims = function() {
    const controller = dashboardData && dashboardData.automation && dashboardData.automation.controller;
    if (!controller || !controllerIsOperational(dashboardData)) return;
    const pausing = Boolean(controller.claimsEnabled);
    return postAction(
      pausing ? '/api/pause' : '/api/resume',
      {},
      pausing ? 'Issues Processing stopped.' : 'Issues Processing resumed.',
    );
  };

  window.renderHealth = function(data) {
    const controller = data.automation && data.automation.controller || {};
    replaceVisibleClaimsLanguage(controller.lastDispatchResult);
    const capacity = controller.capacity || { active: 0, maximum: data.config.maxActive };
    const operational = controllerIsOperational(data);
    const repositoryReadable = repositoryIsReadable(data);
    const claimsEnabled = Boolean(controller.claimsEnabled);

    setChip('health-claims', operational ? (claimsEnabled ? 'Issues Processing running' : 'Issues Processing stopped') : 'Issues Processing unavailable', operational ? (claimsEnabled ? 'good' : 'warn') : 'bad');
    setChip('health-capacity', 'Capacity ' + capacity.active + ' / ' + capacity.maximum, operational && capacity.active < capacity.maximum ? 'good' : 'info');
    setChip('health-poll', controller.nextPollAt ? 'Next poll ' + formatRelative(controller.nextPollAt) : 'Next poll pending', 'info');
    setChip('health-github', data.requirements.githubAuthenticated ? 'GitHub connected' : 'GitHub disconnected', data.requirements.githubAuthenticated ? 'good' : 'bad');
    setChip('health-paseo', data.requirements.paseoReachable ? 'Paseo connected' : 'Paseo unavailable', data.requirements.paseoReachable ? 'good' : 'bad');

    const actionBar = document.getElementById('controller-actions');
    const actionState = document.getElementById('controller-action-state');
    const toggle = document.getElementById('claims-toggle-button');

    if (actionBar) {
      actionBar.classList.remove('hidden');
      actionBar.dataset.state = operational ? (claimsEnabled ? 'running' : 'paused') : repositoryReadable ? 'read-only' : 'setup-required';
    }

    if (actionState) {
      actionState.textContent = operational
        ? (claimsEnabled ? 'Controller running' : 'Controller paused')
        : repositoryReadable ? 'Read-only discovery' : 'Setup required';
      actionState.className = 'chip ' + (operational ? (claimsEnabled ? 'good' : 'warn') : repositoryReadable ? 'info' : 'bad');
    }

    updateActionButton(toggle, operational ? {
      text: claimsEnabled ? 'Stop Issues Processing' : 'Resume Issues Processing',
      disabled: false,
      className: claimsEnabled ? 'danger' : '',
      title: claimsEnabled ? 'Stop starting new issue work. Active work is not cancelled.' : 'Allow the controller to start eligible issue work.',
    } : {
      text: 'Issues Processing unavailable',
      disabled: true,
      className: 'secondary',
      title: 'Complete the required setup checks before enabling Issues Processing.',
    });

    document.getElementById('subtitle').textContent = operational
      ? 'Autonomous GitHub issue coding through Paseo · Base ' + data.config.baseBranch
      : repositoryReadable
        ? 'Repository issues and GitHub issue relationships are available read-only. Complete setup to enable autonomous execution.'
        : 'Connect the GitHub repository to load issues and dependencies.';
  };

  const initialIssuesToggle = document.getElementById('claims-toggle-button');
  if (initialIssuesToggle) initialIssuesToggle.textContent = 'Issues Processing unavailable';
  const initialIssuesChip = document.getElementById('health-claims');
  if (initialIssuesChip) initialIssuesChip.textContent = 'Issues Processing unknown';
  normalizePrReviewControls();

  document.addEventListener('DOMContentLoaded', function() {
    normalizePrReviewControls();
    setTimeout(function() { normalizePrReviewControls(); }, 0);
    const originalRefreshPrReviews = window.refreshPrReviews;
    if (typeof originalRefreshPrReviews === 'function') {
      window.refreshPrReviews = function(force) {
        return Promise.resolve(originalRefreshPrReviews(force)).then(function(data) {
          normalizePrReviewControls(data);
          setTimeout(function() { normalizePrReviewControls(data); }, 0);
          return data;
        });
      };
    }
  });

  renderHealth = window.renderHealth;
})();
`;
