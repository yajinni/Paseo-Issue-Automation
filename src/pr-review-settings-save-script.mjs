export function prReviewSecondsToMilliseconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

export const PR_REVIEW_SETTINGS_SAVE_SCRIPT = String.raw`
(function installPrReviewSettingsSave(toMilliseconds) {
  let latestPrReviewData = null;
  let buttonResetTimer = null;

  function saveButton() {
    return document.getElementById('pr-save-settings');
  }

  function setSaveButton(text, disabled) {
    const button = saveButton();
    if (!button) return;
    button.textContent = text;
    button.disabled = disabled === true;
  }

  function resetSaveButtonLater() {
    if (buttonResetTimer) clearTimeout(buttonResetTimer);
    buttonResetTimer = setTimeout(function() {
      const button = saveButton();
      if (!button) return;
      button.textContent = 'Save settings';
      button.disabled = false;
    }, 1600);
  }

  function settingsPayload() {
    const config = latestPrReviewData && latestPrReviewData.config;
    if (!config) throw new Error('PR review settings are still loading.');
    return {
      enabled: document.getElementById('pr-enabled').value === 'true',
      browserReview: {
        enabled: document.getElementById('pr-browser-enabled').value === 'true',
        projectConversationUrl: document.getElementById('pr-project-url').value.trim() || null,
        reviewPromptTemplate: document.getElementById('pr-prompt').value,
        reviewPromptVersion: config.browserReview.reviewPromptVersion,
        reviewDebounceMs: toMilliseconds(document.getElementById('pr-debounce').value),
        maxSubmissionAttempts: Number(document.getElementById('pr-max-attempts').value)
      },
      reconciliation: {
        enabled: true,
        activeIntervalMs: toMilliseconds(document.getElementById('pr-active-interval').value),
        idleIntervalMs: toMilliseconds(document.getElementById('pr-idle-interval').value)
      },
      githubActions: {
        allowChatGPTMerge: document.getElementById('pr-allow-merge').value === 'true',
        verifyIssueClosure: document.getElementById('pr-verify-closure').value === 'true',
        allowPaseoIssueClosureFallback: document.getElementById('pr-closure-fallback').value === 'true'
      }
    };
  }

  const previousRefreshPrReviews = window.refreshPrReviews;
  window.refreshPrReviews = function(force) {
    return Promise.resolve(previousRefreshPrReviews(force)).then(function(data) {
      latestPrReviewData = data;
      return data;
    });
  };

  window.savePrReviewSettings = async function() {
    if (buttonResetTimer) clearTimeout(buttonResetTimer);
    setSaveButton('Saving…', true);
    try {
      const response = await fetch('/api/pr-reviews/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settingsPayload())
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project review settings could not be saved.');
      await Promise.allSettled([
        window.refreshPrReviews(true),
        typeof window.refreshStatus === 'function' ? window.refreshStatus({ force: true }) : null
      ]);
      setSaveButton('Saved', false);
      if (window.toast) window.toast('Project review settings saved.');
      resetSaveButtonLater();
      return result;
    } catch (error) {
      setSaveButton('Save failed', false);
      if (window.toast) window.toast(error.message || String(error), true);
      resetSaveButtonLater();
      return null;
    }
  };

  document.addEventListener('DOMContentLoaded', function() {
    window.refreshPrReviews(true).catch(function() {});
  });
})(${prReviewSecondsToMilliseconds.toString()});
`;
