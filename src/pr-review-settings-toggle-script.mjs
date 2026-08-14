export const PR_REVIEW_SETTINGS_TOGGLE_SCRIPT = String.raw`
(function installPrReviewSettingsToggle() {
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
      container.insertAdjacentHTML('afterbegin', [
        '<article class="card" id="automatic-pr-review-card">',
        '<label class="automatic-pr-review-toggle" title="PR review lifecycle is controlled from the Overview controls.">',
        '<input id="automatic-pr-review-enabled" type="checkbox" aria-readonly="true" disabled aria-controls="pr-review-settings-grid">',
        '<span class="automatic-pr-review-switch" aria-hidden="true"></span>',
        '<span class="automatic-pr-review-copy"><strong>Automatic PR Review With ChatGPT</strong><small>Configure review behavior here. Start or stop the PR-review lifecycle from Overview.</small></span>',
        '</label>',
        '<p id="automatic-pr-review-status" aria-live="polite">Loading PR review status…</p>',
        '</article>'
      ].join(''));
    }

    let grid = document.getElementById('pr-review-settings-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'grid two';
      grid.id = 'pr-review-settings-grid';
      grid.hidden = true;
      container.appendChild(grid);
    }

    const projectCard = projectSettingsCard();
    const browserCard = browserSettingsCard();
    if (projectCard && projectCard.parentElement !== grid) grid.appendChild(projectCard);
    if (browserCard && browserCard.parentElement !== grid) grid.appendChild(browserCard);
    hideLegacyEnableControls();

    const toggle = document.getElementById('automatic-pr-review-enabled');
    if (toggle) toggle.disabled = true;
    return { container, grid, toggle };
  }

  function automaticReviewConfigured(data) {
    return data?.config?.browserReview?.enabled === true;
  }

  function renderAutomaticPrReview(data) {
    const layout = ensureSettingsLayout();
    if (!layout) return;
    const enabled = automaticReviewConfigured(data);
    layout.toggle.checked = enabled;
    layout.toggle.disabled = true;
    layout.grid.hidden = false;
    const status = document.getElementById('automatic-pr-review-status');
    if (status) {
      status.textContent = enabled
        ? 'Configured. Start or stop PR Reviews from the Overview controls.'
        : 'Configure review settings below. Start or stop PR Reviews from the Overview controls.';
    }
    const nav = document.getElementById('pr-reviews-nav');
    if (nav) nav.classList.remove('hidden');
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
