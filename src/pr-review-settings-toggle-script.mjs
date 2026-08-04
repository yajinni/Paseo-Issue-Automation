export const PR_REVIEW_SETTINGS_TOGGLE_SCRIPT = String.raw`
(function installPrReviewSettingsToggle() {
  let latestPrReviewData = null;

  function installToggleStyles() {
    if (document.getElementById('pr-review-toggle-style')) return;
    const style = document.createElement('style');
    style.id = 'pr-review-toggle-style';
    style.textContent = [
      '#automatic-pr-review-card{margin-bottom:14px}',
      '.automatic-pr-review-toggle{display:flex;align-items:center;gap:14px;color:var(--text);cursor:pointer}',
      '.automatic-pr-review-toggle input{position:absolute;opacity:0;pointer-events:none}',
      '.automatic-pr-review-switch{position:relative;flex:0 0 48px;width:48px;height:26px;border-radius:999px;background:var(--panel-3);border:1px solid var(--border-strong);transition:background .15s ease,border-color .15s ease}',
      '.automatic-pr-review-switch::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:var(--muted);transition:transform .15s ease,background .15s ease}',
      '.automatic-pr-review-toggle input:checked + .automatic-pr-review-switch{background:var(--accent-2);border-color:var(--success)}',
      '.automatic-pr-review-toggle input:checked + .automatic-pr-review-switch::after{transform:translateX(22px);background:white}',
      '.automatic-pr-review-toggle input:focus-visible + .automatic-pr-review-switch{outline:3px solid rgba(88,166,255,.55);outline-offset:2px}',
      '.automatic-pr-review-copy{display:grid;gap:3px}',
      '.automatic-pr-review-copy strong{font-size:16px}',
      '.automatic-pr-review-copy small{color:var(--muted);font-size:12px;line-height:1.4}',
      '#automatic-pr-review-status{margin:12px 0 0;color:var(--muted);font-size:12px}',
      '#pr-review-settings-grid[hidden]{display:none!important}'
    ].join('');
    document.head.appendChild(style);
  }

  function projectSettingsCard() {
    return document.getElementById('pr-enabled')?.closest('article.card') || null;
  }

  function browserSettingsCard() {
    return document.getElementById('pr-browser-status')?.closest('article.card') || null;
  }

  function hideLegacyEnableControls() {
    ['pr-enabled', 'pr-browser-enabled'].forEach(function(id) {
      const control = document.getElementById(id);
      const label = control?.closest('label');
      if (label) label.classList.add('hidden');
    });
  }

  function ensureSettingsLayout() {
    const settingsView = document.getElementById('view-settings');
    if (!settingsView) return null;

    let container = document.getElementById('pr-review-settings-container');
    if (!container) {
      container = document.createElement('section');
      container.id = 'pr-review-settings-container';
      settingsView.appendChild(container);
    }

    if (!document.getElementById('automatic-pr-review-card')) {
      container.innerHTML = [
        '<article class="card" id="automatic-pr-review-card">',
        '<label class="automatic-pr-review-toggle" title="Enable or disable automatic ChatGPT review for pull requests created by this project.">',
        '<input id="automatic-pr-review-enabled" type="checkbox" role="switch" aria-controls="pr-review-settings-grid">',
        '<span class="automatic-pr-review-switch" aria-hidden="true"></span>',
        '<span class="automatic-pr-review-copy"><strong>Automatic PR Review With ChatGPT</strong><small>When enabled, Paseo queues this project\'s pull requests for review using its dedicated ChatGPT browser.</small></span>',
        '</label>',
        '<p id="automatic-pr-review-status" aria-live="polite">Loading PR review status…</p>',
        '</article>',
        '<div class="grid two" id="pr-review-settings-grid" hidden></div>'
      ].join('');
    }

    const grid = document.getElementById('pr-review-settings-grid');
    const projectCard = projectSettingsCard();
    const browserCard = browserSettingsCard();
    if (grid && projectCard && projectCard.parentElement !== grid) grid.appendChild(projectCard);
    if (grid && browserCard && browserCard.parentElement !== grid) grid.appendChild(browserCard);
    hideLegacyEnableControls();

    const toggle = document.getElementById('automatic-pr-review-enabled');
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('change', function() {
        setAutomaticPrReview(toggle.checked);
      });
    }
    return { container, grid, toggle };
  }

  function automaticReviewEnabled(data) {
    return data?.config?.enabled === true && data?.config?.browserReview?.enabled === true;
  }

  function renderAutomaticPrReview(data) {
    latestPrReviewData = data;
    const layout = ensureSettingsLayout();
    if (!layout) return;
    const enabled = automaticReviewEnabled(data);
    layout.toggle.checked = enabled;
    layout.grid.hidden = !enabled;
    const status = document.getElementById('automatic-pr-review-status');
    if (status) {
      status.textContent = enabled
        ? 'Enabled. The settings below apply only to this project.'
        : 'Disabled. Turn this on to display and configure automatic PR review settings.';
    }
    const nav = document.getElementById('pr-reviews-nav');
    if (nav) nav.classList.toggle('hidden', !enabled);
    const panel = document.getElementById('view-pr-reviews');
    if (!enabled && panel?.classList.contains('active')) window.showView('settings');
  }

  async function setAutomaticPrReview(enabled) {
    const layout = ensureSettingsLayout();
    const master = document.getElementById('pr-enabled');
    const browser = document.getElementById('pr-browser-enabled');
    if (!layout?.toggle || !master || !browser || !latestPrReviewData) return;

    const previous = automaticReviewEnabled(latestPrReviewData);
    layout.toggle.disabled = true;
    master.value = String(enabled);
    browser.value = String(enabled);
    layout.grid.hidden = !enabled;

    try {
      const result = await window.savePrReviewSettings();
      if (!result) throw new Error('Automatic PR review could not be saved.');
      await window.refreshPrReviews(true);
    } catch (error) {
      master.value = String(previous);
      browser.value = String(previous);
      layout.toggle.checked = previous;
      layout.grid.hidden = !previous;
      if (window.toast) window.toast(error.message || String(error), true);
    } finally {
      layout.toggle.disabled = false;
    }
  }

  const previousRefreshPrReviews = window.refreshPrReviews;
  window.refreshPrReviews = function(force) {
    return Promise.resolve(previousRefreshPrReviews(force)).then(function(data) {
      renderAutomaticPrReview(data);
      return data;
    });
  };

  document.addEventListener('DOMContentLoaded', function() {
    installToggleStyles();
    ensureSettingsLayout();
    window.refreshPrReviews(true).catch(function() {});
  });
})();
`;
