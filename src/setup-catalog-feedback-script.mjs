export function setupCatalogFeedback(data) {
  if (!data?.requirements?.paseoReachable) return null;

  const catalog = data?.setupOptions?.catalog || {};
  if (catalog.skipped) return null;

  const providers = Array.isArray(catalog.providers) ? catalog.providers : [];
  const checked = data.setupCheckedAt
    ? ` Checked ${new Date(data.setupCheckedAt).toLocaleTimeString()}.`
    : '';

  if (!providers.length) {
    return {
      hasHarnesses: false,
      text: `No Paseo provider or harness found.${checked}`,
      className: 'muted bad-text',
      toast: 'No Paseo provider or harness found.',
    };
  }

  const harnessNames = providers.map((provider) => {
    const id = String(provider?.id || '').trim();
    const label = String(provider?.label || id || 'Unnamed harness').trim();
    return id && label.toLowerCase() !== id.toLowerCase()
      ? `${label} (${id})`
      : label;
  });
  const models = providers.reduce((total, provider) => {
    return total + (Array.isArray(provider?.models) ? provider.models.length : 0);
  }, 0);
  const harnessWord = providers.length === 1 ? 'harness' : 'harnesses';
  const modelWord = models === 1 ? 'model' : 'models';

  return {
    hasHarnesses: true,
    text: `Found Paseo ${harnessWord}: ${harnessNames.join(', ')}. ${models} ${modelWord} available.${checked}`,
    className: 'muted good-text',
    toast: `Paseo ${harnessWord} refreshed: ${harnessNames.join(', ')}.`,
  };
}

export const SETUP_CATALOG_FEEDBACK_SCRIPT = `
(function installSetupCatalogFeedback(buildFeedback) {
  let latestData = null;
  let applying = false;

  function statusElement() {
    return document.getElementById('setup-options-status');
  }

  function isCatalogSummary(text) {
    return text.startsWith('Paseo is reachable. Loaded ')
      || text.startsWith('Paseo is reachable, but no usable harnesses were loaded.');
  }

  function applyFeedback(data, force) {
    const status = statusElement();
    const feedback = buildFeedback(data);
    if (!status || !feedback) return;
    const currentText = String(status.textContent || '');
    if (!force && !isCatalogSummary(currentText)) return;
    if (status.textContent === feedback.text && status.className === feedback.className) return;
    applying = true;
    status.textContent = feedback.text;
    status.className = feedback.className;
    applying = false;
  }

  const previousRenderSettings = window.renderSettings;
  if (typeof previousRenderSettings === 'function') {
    window.renderSettings = function(data) {
      latestData = data;
      previousRenderSettings(data);
      applyFeedback(data, true);
    };
    try { renderSettings = window.renderSettings; } catch {}
  }

  const status = statusElement();
  if (status && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(function() {
      if (applying || !latestData) return;
      const text = String(status.textContent || '');
      if (!isCatalogSummary(text)) return;
      applyFeedback(latestData, false);
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  const previousToast = window.toast;
  if (typeof previousToast === 'function') {
    window.toast = function(message, bad) {
      const feedback = buildFeedback(latestData);
      if (feedback) {
        const catalog = latestData?.setupOptions?.catalog || {};
        const errors = Array.isArray(catalog.errors) ? catalog.errors.filter(Boolean) : [];
        const loadedWithDiagnostics = message === 'Harnesses loaded, but some provider diagnostics need attention.';
        const loadedSuccessfully = message === 'Branches, Paseo harnesses, and models were refreshed.';
        const noHarness = !feedback.hasHarnesses
          && (message === 'Paseo did not report any usable harnesses.' || errors.includes(message));
        if (loadedWithDiagnostics || loadedSuccessfully || noHarness) {
          return previousToast(feedback.toast, !feedback.hasHarnesses);
        }
      }
      return previousToast(message, bad);
    };
    try { toast = window.toast; } catch {}
  }
})(${setupCatalogFeedback.toString()});
`;
