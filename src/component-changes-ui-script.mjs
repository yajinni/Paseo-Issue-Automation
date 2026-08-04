export function shouldInstallSystemBrowserDependencies(data, requirementsText = '') {
  const modulePath = String(data?.browser?.library?.modulePath || '');
  const combined = `${modulePath}\n${requirementsText}`;
  if (/^[A-Za-z]:[\\/]/m.test(combined)) return false;
  if (/\/Users\//.test(combined) || /\/Applications\//.test(combined)) return false;
  return true;
}

export const COMPONENT_CHANGES_UI_SCRIPT = `
(function installComponentChanges(shouldInstallDependencies) {
  let latestPrData = null;

  const BUTTON_HELP = {
    'Install components': 'Install the package-managed issue template, Paseo service, lifecycle labels, and permanent workspace for this project.',
    'Uninstall components': 'Remove only package-managed components that can be removed safely from this project.',
    'Save configuration': 'Save the controller branch, models, polling interval, concurrency, and review-round limits for this project.',
    'Run self-test': 'Check the project integration without creating an issue, branch, agent, pull request, or repository file.',
    'Finish setup': 'Mark setup complete after every required check and component is ready.',
    'Save settings': 'Save the PR review configuration for this project only.',
    'Install Chromium': 'Install the Playwright Chromium browser and automatically add operating-system dependencies when the server requires them.',
    'Launch browser': 'Open the dedicated ChatGPT browser profile so you can sign in and choose this project\'s review conversation.',
    'Use current conversation': 'Save the currently open ChatGPT conversation as the review destination for this project only.',
    'Test destination': 'Open the saved project conversation and verify that ChatGPT is authenticated and its message composer is available without sending a message.',
    'Send harmless test': 'Verify the saved project conversation and send a small test message asking ChatGPT to reply with OK.',
    'Close browser': 'Close the manually opened dedicated browser and release its profile lock.',
    'Reset profile': 'Delete the dedicated browser profile and its ChatGPT login session, then create a blank profile.',
    'Uninstall browser': 'Remove the Playwright browser installation and machine-local dedicated browser state.',
    'Refresh': 'Reload the latest PR review queue, browser, reconciliation, and managed pull-request status.',
    'Reconcile GitHub': 'Immediately compare managed pull requests with GitHub and process new commits, reviews, checks, merges, and closures.',
    'Resume reviews': 'Allow the serial PR review scheduler to claim the next eligible review job.',
    'Pause reviews': 'Stop new PR review submissions without interrupting an active submission.',
    'Run now': 'Immediately ask the controller to claim eligible issue work instead of waiting for the next poll.',
    'Reconcile dependencies': 'Immediately refresh native GitHub blocked-by relationships and issue readiness.',
    'Pause claims': 'Stop the controller from claiming new coding work while allowing current work to continue.',
    'Resume claims': 'Allow the controller to claim new eligible coding work again.'
  };

  function textOf(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function installStyles() {
    if (document.getElementById('component-changes-style')) return;
    const style = document.createElement('style');
    style.id = 'component-changes-style';
    style.textContent = [
      '#installation-card.embedded-components{margin:18px 0 0!important;padding:18px 0 0!important;border:0!important;border-top:1px solid #27364a!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}',
      '#pr-review-settings-container{margin-top:14px}',
      '#pr-reviews-nav.hidden{display:none!important}',
      '[data-help-ready="true"]{cursor:help}'
    ].join('');
    document.head.appendChild(style);
  }

  function moveComponents() {
    const requirements = document.getElementById('requirements-card');
    const components = document.getElementById('installation-card');
    if (!requirements || !components || requirements.contains(components)) return;
    components.classList.remove('card', 'setup-step');
    components.classList.add('embedded-components');
    requirements.appendChild(components);
  }

  function headingCard(title) {
    return Array.from(document.querySelectorAll('#view-pr-reviews article.card')).find(function(card) {
      return textOf(card.querySelector('h2')) === title;
    }) || null;
  }

  function movePrSettings() {
    const settingsView = document.getElementById('view-settings');
    if (!settingsView) return;
    let container = document.getElementById('pr-review-settings-container');
    if (!container) {
      container = document.createElement('section');
      container.id = 'pr-review-settings-container';
      container.innerHTML = '<div class="split-header"><div><h2>PR review configuration</h2><p class="muted">Enable and configure serial ChatGPT PR review for this project.</p></div></div><div class="grid two" id="pr-review-settings-grid"></div>';
      settingsView.appendChild(container);
    }
    const grid = document.getElementById('pr-review-settings-grid');
    const projectSettings = headingCard('Project review settings');
    const browserSettings = headingCard('Dedicated ChatGPT browser');
    if (projectSettings) grid.appendChild(projectSettings);
    if (browserSettings) grid.appendChild(browserSettings);
    Array.from(document.querySelectorAll('#view-pr-reviews .grid.two')).forEach(function(candidate) {
      if (!candidate.children.length) candidate.remove();
    });
  }

  function replaceLabel(controlId, labelText) {
    const input = document.getElementById(controlId);
    const label = input?.closest('label');
    if (!label) return;
    const textNode = Array.from(label.childNodes).find(function(node) { return node.nodeType === Node.TEXT_NODE; });
    if (textNode) textNode.textContent = labelText;
  }

  function buttonByText(text) {
    return Array.from(document.querySelectorAll('button')).find(function(button) {
      return textOf(button) === text;
    }) || null;
  }

  function normalizePrControls() {
    replaceLabel('pr-enabled', 'Enable PR Reviews');
    replaceLabel('pr-browser-enabled', 'Enable automatic ChatGPT browser reviews');
    replaceLabel('pr-debounce', 'Review debounce in seconds');
    replaceLabel('pr-active-interval', 'Active reconciliation in seconds');
    replaceLabel('pr-idle-interval', 'Idle reconciliation in seconds');

    const debounce = document.getElementById('pr-debounce');
    const active = document.getElementById('pr-active-interval');
    const idle = document.getElementById('pr-idle-interval');
    if (debounce) Object.assign(debounce, { min: '0', max: '600', step: '1' });
    if (active) Object.assign(active, { min: '10', max: '3600', step: '1' });
    if (idle) Object.assign(idle, { min: '30', max: '86400', step: '1' });

    const installWithDependencies = buttonByText('Install dependencies + Chromium');
    if (installWithDependencies) installWithDependencies.remove();
    const install = buttonByText('Install Chromium');
    if (install) install.setAttribute('onclick', 'installPrReviewBrowser()');

    const currentProject = buttonByText('Use current for project');
    if (currentProject) {
      currentProject.textContent = 'Use current conversation';
      currentProject.setAttribute('onclick', "prReviewPost('/api/pr-reviews/browser/use-current',{scope:'project'})");
    }
    const currentGlobal = buttonByText('Use current globally');
    if (currentGlobal) currentGlobal.remove();

    const warning = Array.from(document.querySelectorAll('.reason')).find(function(node) {
      return textOf(node) === 'Reset and uninstall remove only machine-local browser state. They never expose cookies or uninstall the package.';
    });
    if (warning) warning.remove();

    const uninstall = buttonByText('Uninstall browser state');
    if (uninstall) uninstall.textContent = 'Uninstall browser';
  }

  function applyPrData(data) {
    latestPrData = data;
    const enabled = data?.config?.enabled === true;
    const nav = document.getElementById('pr-reviews-nav');
    if (nav) nav.classList.toggle('hidden', !enabled);
    const panel = document.getElementById('view-pr-reviews');
    if (!enabled && panel?.classList.contains('active')) window.showView('settings');

    const debounce = document.getElementById('pr-debounce');
    const active = document.getElementById('pr-active-interval');
    const idle = document.getElementById('pr-idle-interval');
    if (debounce) debounce.value = String(Number(data?.config?.browserReview?.reviewDebounceMs || 0) / 1000);
    if (active) active.value = String(Number(data?.config?.reconciliation?.activeIntervalMs || 0) / 1000);
    if (idle) idle.value = String(Number(data?.config?.reconciliation?.idleIntervalMs || 0) / 1000);

    const conversation = data?.config?.browserReview?.projectConversationUrl || null;
    const chip = document.getElementById('pr-conversation-chip');
    if (chip) {
      chip.textContent = conversation ? 'Project conversation configured' : 'Project conversation missing';
      chip.className = 'chip ' + (conversation ? 'good' : 'bad');
    }
    const status = document.getElementById('pr-browser-status');
    if (status && data?.browser) {
      status.innerHTML = [
        '<span>Library: <strong>' + (data.browser.library?.installed ? 'Installed' : 'Missing') + '</strong></span>',
        '<span>Profile: <strong>' + (data.browser.profile?.profileExists ? 'Ready' : 'Missing') + '</strong></span>',
        '<span>Profile lock: <strong>' + (data.browser.profile?.locked ? 'In use' : 'Available') + '</strong></span>',
        '<span>Project conversation: <strong>' + (conversation || 'Not configured') + '</strong></span>'
      ].join('');
    }
    applyHelp(document);
  }

  function tooltipFor(node) {
    const text = textOf(node);
    if (!text) return '';
    if (node.matches('button')) return BUTTON_HELP[text] || `${text}. This action applies to the current project dashboard.`;
    const cardHead = node.closest('.card-head, .split-header');
    const description = textOf(cardHead?.querySelector('p'));
    return description || `${text}. Open this section to review its current-project status and controls.`;
  }

  function applyHelp(root) {
    root.querySelectorAll('h1,h2,h3,button').forEach(function(node) {
      const explanation = tooltipFor(node);
      if (!explanation) return;
      node.title = explanation;
      node.dataset.helpReady = 'true';
    });
  }

  window.installPrReviewBrowser = function() {
    const requirementsText = textOf(document.getElementById('requirements-card'));
    const withSystemDependencies = shouldInstallDependencies(latestPrData, requirementsText);
    return window.prReviewPost('/api/pr-reviews/browser/install', { withSystemDependencies });
  };

  const originalSave = window.savePrReviewSettings;
  window.savePrReviewSettings = function() {
    const ids = ['pr-debounce', 'pr-active-interval', 'pr-idle-interval'];
    const originalValues = ids.map(function(id) { return document.getElementById(id)?.value; });
    ids.forEach(function(id) {
      const input = document.getElementById(id);
      if (input) input.value = String(Math.round(Number(input.value || 0) * 1000));
    });
    try {
      return originalSave();
    } finally {
      ids.forEach(function(id, index) {
        const input = document.getElementById(id);
        if (input) input.value = originalValues[index];
      });
    }
  };

  const originalRefresh = window.refreshPrReviews;
  window.refreshPrReviews = function(force) {
    return Promise.resolve(originalRefresh(force)).then(function(data) {
      applyPrData(data);
      return data;
    });
  };

  const originalShowView = window.showView;
  window.showView = function(name) {
    originalShowView(name);
    if (name === 'settings' || name === 'pr-reviews') window.refreshPrReviews();
  };
  showView = window.showView;

  document.addEventListener('DOMContentLoaded', function() {
    installStyles();
    moveComponents();
    movePrSettings();
    normalizePrControls();
    applyHelp(document);
    const observer = new MutationObserver(function() { applyHelp(document); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.refreshPrReviews(true).catch(function() {});
  });
})(${shouldInstallSystemBrowserDependencies.toString()});
`;
