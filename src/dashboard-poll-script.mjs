export const DASHBOARD_POLL_SCRIPT = String.raw`
(function installEfficientDashboardPolling() {
  const MIN_BACKGROUND_POLL_MS = 60_000;
  const REQUEST_TIMEOUT_MS = 20_000;
  let initialLoaded = false;
  let pollInFlight = false;
  let lastPollStartedAt = 0;

  function renderOperationalState(data) {
    if (!dashboardData) {
      render(data);
      initialLoaded = true;
      return;
    }

    dashboardData = Object.assign({}, dashboardData, {
      automation: data.automation || dashboardData.automation,
      prReviews: data.prReviews == null ? dashboardData.prReviews : data.prReviews,
      runtime: data.runtime || dashboardData.runtime,
      config: data.config || dashboardData.config,
      requirements: data.requirements || dashboardData.requirements,
      checks: data.checks || dashboardData.checks
    });

    if (!dashboardData.automation) {
      dashboardData.automation = { counts: {}, issues: [], attempts: [], controller: {} };
    }
    renderHealth(dashboardData);
    renderCounts(dashboardData);
    renderHumanReview();
    renderActiveExecution();
    renderDependencyQueue();
    renderScheduling();
    renderActivity();
    renderIssueBoard();
    renderDependencies();
  }

  async function efficientRefreshStatus(options) {
    const force = options && options.force === true;
    if (pollInFlight) return dashboardData;
    if (!initialLoaded && !force && location.hash === '#settings'
      && typeof window.progressiveSetupRequirements === 'function') {
      return dashboardData;
    }
    if (initialLoaded && !force) {
      if (document.hidden) return dashboardData;
      if (Date.now() - lastPollStartedAt < MIN_BACKGROUND_POLL_MS) return dashboardData;
    }

    pollInFlight = true;
    lastPollStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const data = await api('/api/status?_=' + Date.now(), { signal: controller.signal });
      if (!initialLoaded || force || !dashboardData) {
        render(data);
        initialLoaded = true;
      } else {
        renderOperationalState(data);
      }
      return data;
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'Dashboard status polling exceeded 20 seconds. The next background poll will retry.'
        : (error && error.message ? error.message : 'Dashboard status polling failed.');
      toast(message, true);
      return null;
    } finally {
      clearTimeout(timeout);
      pollInFlight = false;
    }
  }

  refreshStatus = efficientRefreshStatus;
  window.refreshStatus = efficientRefreshStatus;

  postAction = async function(path, body, successMessage) {
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      toast(successMessage || 'Action completed.');
      if (result && result.snapshot) {
        render(result.snapshot);
        initialLoaded = true;
        lastPollStartedAt = Date.now();
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
      efficientRefreshStatus();
    }
  });
})();
`;
