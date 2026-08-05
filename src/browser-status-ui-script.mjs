export function browserSetupState(data = {}) {
  const browser = data.browser || {};
  const profile = browser.profile || {};
  const browserConfig = browser.config || {};
  const reviewConfig = data.config?.browserReview || {};
  const selectedConversation = reviewConfig.projectConversationUrl || null;

  const libraryInstalled = browser.library?.installed === true;
  const chromiumInstalled = Boolean(profile.browserInstalledAt || browserConfig.browserInstalledAt);
  const authenticated = Boolean(profile.lastAuthenticatedAt || browserConfig.lastAuthenticatedAt);
  const chatSelected = Boolean(selectedConversation);
  const verified = Boolean(
    authenticated
    && chatSelected
    && browserConfig.lastConversationUrl === selectedConversation,
  );
  const readyToTest = libraryInstalled && chromiumInstalled && authenticated && chatSelected;

  const rows = [
    {
      key: 'library',
      label: 'Playwright Library',
      complete: libraryInstalled,
      status: libraryInstalled ? 'Installed' : 'Missing',
      tone: libraryInstalled ? 'success' : 'danger',
      icon: libraryInstalled ? '✓' : '×',
      visualPercent: libraryInstalled ? 100 : 0,
    },
    {
      key: 'chromium',
      label: 'Chromium Browser',
      complete: chromiumInstalled,
      status: chromiumInstalled ? 'Installed' : 'Not Installed',
      tone: chromiumInstalled ? 'success' : 'danger',
      icon: chromiumInstalled ? '✓' : '×',
      visualPercent: chromiumInstalled ? 100 : 0,
    },
    {
      key: 'authentication',
      label: 'ChatGPT Authentication',
      complete: authenticated,
      status: authenticated ? 'Signed In' : 'Not Signed In',
      tone: authenticated ? 'success' : 'warning',
      icon: authenticated ? '✓' : '!',
      visualPercent: authenticated ? 100 : 12,
    },
    {
      key: 'conversation',
      label: 'GPT Chat Selected',
      complete: chatSelected,
      status: chatSelected ? 'Selected' : 'Not Selected',
      tone: chatSelected ? 'success' : 'warning',
      icon: chatSelected ? '✓' : '!',
      visualPercent: chatSelected ? 100 : 12,
    },
    {
      key: 'verification',
      label: 'Browser Verification',
      complete: verified,
      status: verified ? 'Verified' : readyToTest ? 'Ready to Test' : 'Not Tested',
      tone: verified ? 'success' : 'info',
      icon: verified ? '✓' : '?',
      visualPercent: verified ? 100 : readyToTest ? 45 : 0,
    },
  ];

  const completed = rows.filter((row) => row.complete).length;
  return {
    rows,
    completed,
    total: rows.length,
    percent: Math.round((completed / rows.length) * 100),
    selectedConversation,
    profileLocked: profile.locked === true,
    profileLockLabel: profile.locked ? 'In Use' : 'Available',
  };
}

export const BROWSER_STATUS_UI_SCRIPT = String.raw`
(function installDedicatedBrowserStatus(computeState) {
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  function findBrowserCard() {
    return Array.from(document.querySelectorAll('article.card')).find(function(card) {
      return String(card.querySelector('h2')?.textContent || '').trim().toLowerCase() === 'dedicated chatgpt browser';
    }) || null;
  }

  function installBrowserCard() {
    const card = findBrowserCard();
    if (!card || card.dataset.browserUiInstalled === 'true') return card;
    card.dataset.browserUiInstalled = 'true';
    card.classList.add('dedicated-browser-card');
    card.innerHTML = [
      '<div class="browser-card-heading">',
        '<div class="browser-monitor-icon" aria-hidden="true"><span></span></div>',
        '<div><h2>Dedicated ChatGPT Browser</h2><p>Complete these items to enable automated PR reviews.</p></div>',
      '</div>',
      '<div id="pr-browser-status" class="browser-status-shell" aria-live="polite"><div class="browser-status-loading">Loading browser status…</div></div>',
      '<div class="browser-profile-lock">',
        '<span class="browser-lock-icon" aria-hidden="true">▣</span>',
        '<strong>Profile Lock</strong>',
        '<span id="browser-profile-lock-chip" class="browser-lock-chip">Checking…</span>',
      '</div>',
      '<div class="browser-action-grid">',
        '<button class="browser-primary-action" onclick="installPrReviewBrowser()"><span aria-hidden="true">⇩</span>Install Chromium</button>',
        '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/browser/open\')"><span aria-hidden="true">↗</span>Launch Browser</button>',
        '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/browser/use-current\',{scope:\'project\'})"><span aria-hidden="true">◯</span>Use Current Conversation</button>',
        '<button class="secondary" onclick="prReviewPost(\'/api/pr-reviews/browser/test\')"><span aria-hidden="true">✓</span>Test Destination</button>',
        '<button class="secondary" onclick="openPrReviewConfirm(\'Reset ChatGPT Credentials\',\'RESET\',\'/api/pr-reviews/browser/reset\')"><span aria-hidden="true">↺</span>Reset ChatGPT Credentials</button>',
        '<button class="danger browser-uninstall-action" onclick="openPrReviewConfirm(\'Uninstall Browser\',\'UNINSTALL\',\'/api/pr-reviews/browser/uninstall\')"><span aria-hidden="true">⌫</span>Uninstall Browser</button>',
      '</div>',
      '<p class="browser-helper"><span aria-hidden="true">ⓘ</span>Install Chromium, sign into ChatGPT, select the destination chat, then test the browser setup.</p>'
    ].join('');
    return card;
  }

  function rowHtml(row) {
    return [
      '<div class="browser-status-row browser-tone-' + escapeHtml(row.tone) + '" data-browser-status="' + escapeHtml(row.key) + '">',
        '<span class="browser-status-icon" aria-hidden="true">' + escapeHtml(row.icon) + '</span>',
        '<strong class="browser-status-label">' + escapeHtml(row.label) + '</strong>',
        '<span class="browser-status-track" aria-hidden="true"><span style="width:' + Number(row.visualPercent || 0) + '%"></span></span>',
        '<span class="browser-status-value"><i></i>' + escapeHtml(row.status) + '</span>',
      '</div>'
    ].join('');
  }

  window.renderDedicatedBrowserStatus = function(data) {
    installBrowserCard();
    const state = computeState(data || {});
    const status = document.getElementById('pr-browser-status');
    if (status) {
      status.innerHTML = [
        '<div class="browser-progress-summary">',
          '<span class="browser-summary-icon" aria-hidden="true">✓</span>',
          '<strong>Browser setup progress: <em>' + state.completed + ' of ' + state.total + '</em> complete</strong>',
          '<span class="browser-overall-track" role="progressbar" aria-label="Browser setup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + state.percent + '"><span style="width:' + state.percent + '%"></span></span>',
          '<strong class="browser-progress-percent">' + state.percent + '%</strong>',
        '</div>',
        '<div class="browser-status-list">' + state.rows.map(rowHtml).join('') + '</div>'
      ].join('');
    }
    const lock = document.getElementById('browser-profile-lock-chip');
    if (lock) {
      lock.textContent = state.profileLockLabel;
      lock.className = 'browser-lock-chip ' + (state.profileLocked ? 'busy' : 'available');
    }
    return state;
  };

  const originalRefresh = window.refreshPrReviews;
  window.refreshPrReviews = function(force) {
    return Promise.resolve(originalRefresh(force)).then(function(data) {
      window.renderDedicatedBrowserStatus(data);
      return data;
    });
  };

  document.addEventListener('DOMContentLoaded', function() {
    installBrowserCard();
  });
})(${browserSetupState.toString()});
`;
