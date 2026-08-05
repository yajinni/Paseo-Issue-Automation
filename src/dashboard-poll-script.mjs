export const DASHBOARD_POLL_SCRIPT = String.raw`
(function installEfficientDashboardPolling() {
  const MIN_BACKGROUND_POLL_MS = 60_000;
  const REQUEST_TIMEOUT_MS = 20_000;
  const REFRESH_FOLLOW_UP_MS = 2_000;
  const STALE_WARNING_MS = 120_000;
  let initialLoaded = false;
  let pollInFlight = null;
  let lastPollStartedAt = 0;
  let lastSuccessfulPollAt = 0;
  let consecutiveFailures = 0;
  let followUpTimer = null;
  let lastWarningKey = null;

  function relativeAge(milliseconds) {
    if (!Number.isFinite(milliseconds)) return 'unknown age';
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    return Math.round(minutes / 60) + 'h ago';
  }

  function setFreshnessChip(text, state) {
    const chip = document.getElementById('health-poll');
    if (!chip) return;
    chip.textContent = text;
    chip.className = 'chip ' + (state || '');
  }

  function renderStatusFreshness(data) {
    const meta = data && data.statusMeta || {};
    if (meta.state === 'fresh') {
      setFreshnessChip('Up to date · ' + relativeAge(meta.remoteAgeMs), 'good');
    } else if (meta.state === 'refreshing') {
      const suffix = meta.remoteUpdatedAt ? ' · showing ' + relativeAge(meta.remoteAgeMs) : '';
      setFreshnessChip('Refreshing status' + suffix, 'info');
    } else if (meta.state === 'stale') {
      setFreshnessChip('Data may be stale · ' + relativeAge(meta.remoteAgeMs), 'warn');
    } else if (meta.state === 'failed') {
      setFreshnessChip('Refresh failed · showing local data', 'bad');
    } else {
      setFreshnessChip('Waiting for remote status', 'info');
    }
  }

  function maybeWarnAboutStaleData(data) {
    const meta = data && data.statusMeta || {};
    const oldEnough = Number(meta.remoteAgeMs) >= STALE_WARNING_MS;
    if (!['stale', 'failed'].includes(meta.state) || (!oldEnough && meta.state !== 'failed')) return;
    const key = [meta.state, meta.lastError || '', meta.remoteUpdatedAt || 'none'].join('|');
    if (key === lastWarningKey) return;
    lastWarningKey = key;
    toast(meta.lastError
      ? 'Status refresh failed; showing the last successful data. ' + meta.lastError
      : 'Dashboard data has remained stale for more than two minutes.', true);
  }

  function scheduleRefreshFollowUp(data) {
    const meta = data && data.statusMeta || {};
    if (!meta.refreshing || followUpTimer) return;
    followUpTimer = setTimeout(function() {
      followUpTimer = null;
      efficientRefreshStatus({ force: true, background: true });
    }, REFRESH_FOLLOW_UP_MS);
  }

  function renderOperationalState(data) {
    if (!dashboardData) {
      render(data);
      renderStatusFreshness(data);
      initialLoaded = true;
      return;
    }

    dashboardData = Object.assign({}, dashboardData, {
      automation: data.automation || dashboardData.automation,
      prReviews: data.prReviews == null ? dashboardData.prReviews : data.prReviews,
      runtime: data.runtime || dashboardData.runtime,
      config: data.config || dashboardData.config,
      requirements: data.requirements || dashboardData.requirements,
      checks: data.checks || dashboardData.checks,
      statusMeta: data.statusMeta || dashboardData.statusMeta
    });

    if (!dashboardData.automation) {
      dashboardData.automation = { counts: {}, issues: [], attempts: [], controller: {} };
    }
    renderHealth(dashboardData);
    renderStatusFreshness(dashboardData);
    renderCounts(dashboardData);
    renderHumanReview();
    renderActiveExecution();
    renderDependencyQueue();
    renderScheduling();
    renderActivity();
    renderIssueBoard();
    renderDependencies();
  }

  function efficientRefreshStatus(options) {
    const force = options && options.force === true;
    if (pollInFlight) return pollInFlight;
    if (!initialLoaded && !force && location.hash === '#settings'
      && typeof window.progressiveSetupRequirements === 'function') {
      return Promise.resolve(dashboardData);
    }
    if (initialLoaded && !force) {
      if (document.hidden) return Promise.resolve(dashboardData);
      if (Date.now() - lastPollStartedAt < MIN_BACKGROUND_POLL_MS) return Promise.resolve(dashboardData);
    }

    pollInFlight = (async function() {
      lastPollStartedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);
      try {
        const data = await api('/api/status?_=' + Date.now(), { signal: controller.signal });
        consecutiveFailures = 0;
        lastSuccessfulPollAt = Date.now();
        if (!initialLoaded || force || !dashboardData) {
          render(data);
          renderStatusFreshness(data);
          initialLoaded = true;
        } else {
          renderOperationalState(data);
        }
        scheduleRefreshFollowUp(data);
        maybeWarnAboutStaleData(data);
        return data;
      } catch (error) {
        consecutiveFailures += 1;
        const timedOut = error && error.name === 'AbortError';
        const staleFor = lastSuccessfulPollAt ? Date.now() - lastSuccessfulPollAt : Number.POSITIVE_INFINITY;
        setFreshnessChip(timedOut ? 'Status request timed out · retrying' : 'Status request failed · retrying', 'warn');
        if (consecutiveFailures >= 2 || staleFor >= STALE_WARNING_MS) {
          const message = timedOut
            ? 'Dashboard status is temporarily unavailable. Existing data is still displayed and the next background poll will retry.'
            : (error && error.message ? error.message : 'Dashboard status polling failed.');
          const key = 'poll|' + message;
          if (key !== lastWarningKey) {
            lastWarningKey = key;
            toast(message, true);
          }
        }
        return null;
      } finally {
        clearTimeout(timeout);
      }
    })().finally(function() {
      pollInFlight = null;
    });

    return pollInFlight;
  }

  refreshStatus = efficientRefreshStatus;
  window.refreshStatus = efficientRefreshStatus;

  startCountdown = function() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(function() {
      if (dashboardData) renderStatusFreshness(dashboardData);
    }, 1000);
  };

  postAction = async function(path, body, successMessage) {
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      toast(successMessage || 'Action completed.');
      if (result && result.snapshot) {
        render(result.snapshot);
        renderStatusFreshness(result.snapshot);
        initialLoaded = true;
        lastPollStartedAt = Date.now();
        lastSuccessfulPollAt = Date.now();
        scheduleRefreshFollowUp(result.snapshot);
      } else {
        await efficientRefreshStatus({ force: true });
      }
      return result;
    } catch (error) {
      toast(error.message, true);
      return null;
    }
  };
  window.postAction = postAction;

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && initialLoaded && Date.now() - lastPollStartedAt >= MIN_BACKGROUND_POLL_MS) {
      efficientRefreshStatus({ background: true });
    }
  });
})();
`;
