export const PR_REVIEW_BROWSER_SETUP_UI_SCRIPT = String.raw`
(function installPrReviewBrowserSetupUi() {
  let currentData = null;
  let testing = false;
  let lastTestResult = null;

  function savedProjectUrl(data) {
    return String(data && data.config && data.config.browserReview
      && data.config.browserReview.projectConversationUrl || '').trim();
  }

  function chromiumInstalled(data) {
    return data && data.browser && data.browser.chromium
      && data.browser.chromium.installed === true;
  }

  function setDot(id, passing) {
    const host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = '<span class="status-dot ' + (passing ? 'good' : 'bad') + '"></span>';
  }

  function setHealthChip(id, text, state) {
    const chip = document.getElementById(id);
    if (!chip) return;
    chip.textContent = text;
    chip.className = 'chip ' + (state || '');
  }

  function showToast(message, bad) {
    if (typeof toast === 'function') toast(message, bad === true);
  }

  window.renderPrReviewBrowserSetup = function(data) {
    if (data) currentData = data;
    if (!currentData) return;

    const installed = chromiumInstalled(currentData);
    const projectUrl = savedProjectUrl(currentData);
    const configured = Boolean(projectUrl);
    const chromiumStatus = document.getElementById('pr-chromium-status');
    const chatStatus = document.getElementById('pr-chat-url-status');
    const installButton = document.getElementById('pr-install-chromium');
    const testButton = document.getElementById('pr-test-browser');
    const testResult = document.getElementById('pr-browser-test-result');

    if (chromiumStatus) chromiumStatus.textContent = installed ? 'Installed' : 'Not installed';
    if (chatStatus) chatStatus.textContent = configured ? 'Configured' : 'Missing';
    setDot('pr-chromium-badge', installed);
    setDot('pr-chat-url-badge', configured);

    if (installButton) {
      installButton.classList.toggle('hidden', installed);
      installButton.disabled = testing;
    }
    if (testButton) {
      testButton.disabled = testing || !installed || !configured;
      testButton.textContent = testing ? 'Testing…' : 'Test';
      testButton.title = !installed
        ? 'Install Chromium before testing.'
        : !configured
          ? 'Save a PR Review Chat URL before testing.'
          : 'Launch Chromium and verify the saved PR Review Chat URL without sending a message.';
    }
    if (testResult) {
      testResult.textContent = lastTestResult ? lastTestResult.message : '';
      testResult.dataset.state = lastTestResult ? lastTestResult.state : '';
    }

    setHealthChip('pr-browser-chip', installed ? 'Chromium installed' : 'Chromium missing', installed ? 'good' : 'bad');
    setHealthChip(
      'pr-conversation-chip',
      configured ? 'PR Review Chat URL configured' : 'PR Review Chat URL missing',
      configured ? 'good' : 'bad',
    );
  };

  window.testPrReviewBrowserSetup = async function() {
    if (testing) return null;
    const projectUrl = savedProjectUrl(currentData);
    if (!chromiumInstalled(currentData)) {
      lastTestResult = { state: 'failed', message: 'Install Chromium before running the test.' };
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }
    if (!projectUrl) {
      lastTestResult = { state: 'failed', message: 'Save a PR Review Chat URL before running the test.' };
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }

    testing = true;
    lastTestResult = { state: 'running', message: 'Launching Chromium and checking the saved PR Review Chat URL…' };
    window.renderPrReviewBrowserSetup();
    let payload = null;
    let succeeded = false;
    try {
      const response = await fetch('/api/pr-reviews/browser/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: projectUrl,
          visible: true,
          sendTestPrompt: false,
        }),
      });
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : {}; }
      catch { payload = { error: text || 'The server returned an unreadable response.' }; }
      if (!response.ok) throw new Error(payload.error || 'Chromium test failed.');
      succeeded = true;
      lastTestResult = {
        state: 'passed',
        message: 'Chromium launched and the PR Review Chat URL was verified. No message was sent.',
      };
      showToast('Chromium and PR Review Chat URL test passed.');
      return payload;
    } catch (error) {
      lastTestResult = { state: 'failed', message: String(error && error.message || error) };
      showToast(lastTestResult.message, true);
      return null;
    } finally {
      testing = false;
      window.renderPrReviewBrowserSetup();
      if (succeeded && typeof window.refreshPrReviews === 'function') {
        window.refreshPrReviews(true).catch(function() {});
      }
    }
  };

  const originalRefresh = window.refreshPrReviews;
  if (typeof originalRefresh === 'function') {
    window.refreshPrReviews = function(force) {
      return originalRefresh(force).then(function(result) {
        window.renderPrReviewBrowserSetup(result);
        return result;
      });
    };
  }
})();
`;
