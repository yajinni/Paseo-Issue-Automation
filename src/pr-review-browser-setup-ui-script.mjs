export const PR_REVIEW_BROWSER_SETUP_UI_SCRIPT = String.raw`
(function installPrReviewBrowserSetupUi() {
  let currentData = null;
  let testing = false;
  let signingIn = false;
  let signInBrowserOpen = false;
  let lastTestResult = null;
  let lastTestFingerprint = null;

  function savedProjectUrl(data) {
    return String(data && data.config && data.config.browserReview
      && data.config.browserReview.projectConversationUrl || '').trim();
  }

  function chromiumInstalled(data) {
    return data && data.browser && data.browser.chromium
      && data.browser.chromium.installed === true;
  }

  function profileLocked(data) {
    return data && data.browser && data.browser.profile
      && data.browser.profile.locked === true;
  }

  function testFingerprint(data) {
    return JSON.stringify({
      projectUrl: savedProjectUrl(data),
      chromiumInstalled: chromiumInstalled(data),
    });
  }

  function clearTestResult() {
    lastTestResult = null;
    lastTestFingerprint = null;
  }

  function ensureSignInButton() {
    let button = document.getElementById('pr-sign-in-browser');
    if (button) return button;
    const testButton = document.getElementById('pr-test-browser');
    if (!testButton || !testButton.parentElement || typeof document.createElement !== 'function') return null;
    button = document.createElement('button');
    button.id = 'pr-sign-in-browser';
    button.className = 'secondary';
    button.type = 'button';
    button.textContent = 'Sign in to ChatGPT';
    button.onclick = function() {
      return window.openPrReviewBrowserForLogin(button);
    };
    testButton.parentElement.insertBefore(button, testButton);
    return button;
  }

  function ensureUrlChangeHandler() {
    const input = document.getElementById('pr-project-url');
    if (!input || input.dataset.prBrowserResultHandler === 'true') return;
    input.dataset.prBrowserResultHandler = 'true';
    const previous = input.oninput;
    input.oninput = function(event) {
      if (typeof previous === 'function') previous.call(input, event);
      if (String(input.value || '').trim() !== savedProjectUrl(currentData)) {
        clearTestResult();
        window.renderPrReviewBrowserSetup();
      }
    };
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

  window.clearPrReviewBrowserTestResult = function() {
    clearTestResult();
    window.renderPrReviewBrowserSetup();
  };

  window.renderPrReviewBrowserSetup = function(data) {
    if (data) {
      currentData = data;
      if (!profileLocked(data)) signInBrowserOpen = false;
    }
    if (!currentData) return;

    const fingerprint = testFingerprint(currentData);
    if (lastTestResult && lastTestFingerprint && lastTestFingerprint !== fingerprint) {
      clearTestResult();
    }

    const installed = chromiumInstalled(currentData);
    const projectUrl = savedProjectUrl(currentData);
    const configured = Boolean(projectUrl);
    const locked = profileLocked(currentData) || signInBrowserOpen;
    const chromiumStatus = document.getElementById('pr-chromium-status');
    const chatStatus = document.getElementById('pr-chat-url-status');
    const installButton = document.getElementById('pr-install-chromium');
    const signInButton = ensureSignInButton();
    const testButton = document.getElementById('pr-test-browser');
    const testResult = document.getElementById('pr-browser-test-result');

    ensureUrlChangeHandler();

    if (chromiumStatus) chromiumStatus.textContent = installed ? 'Installed' : 'Not installed';
    if (chatStatus) chatStatus.textContent = configured ? 'Configured' : 'Missing';
    setDot('pr-chromium-badge', installed);
    setDot('pr-chat-url-badge', configured);

    if (installButton) {
      installButton.classList.toggle('hidden', installed);
      installButton.disabled = testing || signingIn;
    }
    if (signInButton) {
      signInButton.classList.toggle('hidden', !installed);
      signInButton.disabled = testing || signingIn || !installed || locked;
      signInButton.textContent = signingIn ? 'Opening…' : 'Sign in to ChatGPT';
      signInButton.title = !installed
        ? 'Install Chromium before signing in.'
        : locked
          ? 'Close the active dedicated ChatGPT browser before opening another one.'
          : 'Open the dedicated Chromium profile so you can sign in to ChatGPT. Close the browser when sign-in is complete.';
    }
    if (testButton) {
      testButton.disabled = testing || signingIn || !installed || !configured || locked;
      testButton.textContent = testing ? 'Testing…' : 'Test';
      testButton.title = !installed
        ? 'Install Chromium before testing.'
        : !configured
          ? 'Save a PR Review Chat URL before testing.'
          : locked
            ? 'Close the active dedicated ChatGPT browser before testing.'
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

  window.openPrReviewBrowserForLogin = async function() {
    if (signingIn) return null;
    if (!chromiumInstalled(currentData)) {
      lastTestResult = { state: 'failed', message: 'Install Chromium before signing in to ChatGPT.' };
      lastTestFingerprint = testFingerprint(currentData);
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }
    if (profileLocked(currentData) || signInBrowserOpen) {
      lastTestResult = { state: 'failed', message: 'Close the active dedicated ChatGPT browser before opening another one.' };
      lastTestFingerprint = testFingerprint(currentData);
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }

    signingIn = true;
    clearTestResult();
    window.renderPrReviewBrowserSetup();
    let payload = null;
    try {
      const response = await fetch('/api/pr-reviews/browser/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: savedProjectUrl(currentData) || 'https://chatgpt.com/',
        }),
      });
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : {}; }
      catch { payload = { error: text || 'The server returned an unreadable response.' }; }
      if (!response.ok) throw new Error(payload.error || 'Could not open Chromium for ChatGPT sign-in.');
      signInBrowserOpen = true;
      lastTestResult = {
        state: 'info',
        message: 'Chromium is open for ChatGPT sign-in. Complete sign-in, close the browser, then run Test.',
      };
      lastTestFingerprint = testFingerprint(currentData);
      showToast('Chromium opened for ChatGPT sign-in.');
      return payload;
    } catch (error) {
      lastTestResult = { state: 'failed', message: String(error && error.message || error) };
      lastTestFingerprint = testFingerprint(currentData);
      showToast(lastTestResult.message, true);
      return null;
    } finally {
      signingIn = false;
      window.renderPrReviewBrowserSetup();
    }
  };

  window.testPrReviewBrowserSetup = async function() {
    if (testing) return null;
    const projectUrl = savedProjectUrl(currentData);
    if (!chromiumInstalled(currentData)) {
      lastTestResult = { state: 'failed', message: 'Install Chromium before running the test.' };
      lastTestFingerprint = testFingerprint(currentData);
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }
    if (!projectUrl) {
      lastTestResult = { state: 'failed', message: 'Save a PR Review Chat URL before running the test.' };
      lastTestFingerprint = testFingerprint(currentData);
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }
    if (profileLocked(currentData) || signInBrowserOpen) {
      lastTestResult = { state: 'failed', message: 'Close the active dedicated ChatGPT browser before running the test.' };
      lastTestFingerprint = testFingerprint(currentData);
      window.renderPrReviewBrowserSetup();
      showToast(lastTestResult.message, true);
      return null;
    }

    testing = true;
    lastTestResult = { state: 'running', message: 'Launching Chromium and checking the saved PR Review Chat URL…' };
    lastTestFingerprint = testFingerprint(currentData);
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
      lastTestFingerprint = testFingerprint(currentData);
      showToast('Chromium and PR Review Chat URL test passed.');
      return payload;
    } catch (error) {
      lastTestResult = { state: 'failed', message: String(error && error.message || error) };
      lastTestFingerprint = testFingerprint(currentData);
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

  const originalPrReviewPost = window.prReviewPost;
  if (typeof originalPrReviewPost === 'function') {
    window.prReviewPost = function(path, body) {
      if (path === '/api/pr-reviews/browser/reset' || path === '/api/pr-reviews/browser/uninstall') {
        signInBrowserOpen = false;
        clearTestResult();
        window.renderPrReviewBrowserSetup();
      }
      return originalPrReviewPost(path, body);
    };
  }

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
