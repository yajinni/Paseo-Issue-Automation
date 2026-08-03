export const SETUP_CONTROLS_SCRIPT = String.raw`
(function setupDiscoveryControls() {
  let latestOptions = null;
  let latestRequirements = null;

  const requirementDefinitions = {
    git: {
      label: 'Git',
      why: 'The controller uses Git to inspect the repository, create and compare branches, verify exact commits, and coordinate isolated worktrees.',
      checked: 'Runs Git commands in this repository and verifies that it is a usable Git checkout.',
      fixes: [
        'Install Git for Windows if Git is missing.',
        'Open the controller from inside the repository you want to automate.',
        'Click Check again after correcting the installation or repository path.'
      ],
      commands: ['git --version', 'git status', 'git rev-parse --show-toplevel']
    },
    githubCli: {
      label: 'GitHub CLI',
      why: 'The controller uses GitHub CLI to read issues and native dependencies, create and inspect pull requests, read checks, and update lifecycle labels.',
      checked: 'Looks for the gh executable and runs GitHub CLI commands against the current repository.',
      fixes: [
        'Install GitHub CLI from the official GitHub CLI installer.',
        'Ensure gh is available from the terminal that launched this dashboard.',
        'Click Check again after installation.'
      ],
      commands: ['gh --version', 'where.exe gh']
    },
    githubAuthenticated: {
      label: 'GitHub authenticated',
      why: 'The controller needs permission to read and update issues, branches, pull requests, labels, comments, and CI status in this repository.',
      checked: 'Runs gh auth status and verifies that GitHub CLI can access the configured remote.',
      fixes: [
        'Run gh auth login and choose the GitHub account with access to this repository.',
        'Confirm that the account can read and write yajinni/JuliesDashboard.',
        'Click Check again after authentication completes.'
      ],
      commands: ['gh auth status', 'gh auth login', 'gh repo view']
    },
    paseoCli: {
      label: 'Paseo CLI',
      why: 'The controller uses Paseo’s command interface to discover harnesses and models, create workspaces, start coding agents, wait for completion, and open or archive workspaces.',
      checked: 'Searches the current PATH on every forced refresh and also checks standard Paseo Desktop and global npm installation folders on Windows.',
      fixes: [
        'Use Paseo Desktop’s CLI installation action or install the official Paseo CLI.',
        'The dashboard now detects the bundled Paseo Desktop CLI even when this server started before PATH changed.',
        'Click Check again; restarting the controller should not be required when the CLI is in a standard location.'
      ],
      commands: ['where.exe paseo', 'paseo --version']
    },
    paseoReachable: {
      label: 'Paseo reachable',
      why: 'Finding the command is not enough. The controller must also reach the Paseo daemon that actually creates workspaces and runs agents.',
      checked: 'Runs paseo daemon status --json, with structured compatibility probes for older Paseo releases.',
      fixes: [
        'Start Paseo Desktop and wait for its daemon to finish starting.',
        'Resolve any daemon authentication or connection warning shown in Paseo.',
        'Use the diagnostic below, then click Check again.'
      ],
      commands: ['paseo daemon status --json', 'paseo provider ls --json']
    },
    remote: {
      label: 'GitHub remote',
      why: 'The controller needs a GitHub origin remote to identify the repository, push issue branches, and create pull requests in the correct project.',
      checked: 'Reads the origin remote from Git and verifies that the repository can be associated with GitHub.',
      fixes: [
        'Confirm that origin points to the intended GitHub repository.',
        'Add or correct the origin remote if it is missing or wrong.',
        'Click Check again after changing the remote.'
      ],
      commands: ['git remote -v', 'git remote get-url origin']
    }
  };

  function safe(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  function optionElement(value, label, selected) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = selected === true;
    return option;
  }

  function transformBaseBranch() {
    const input = document.getElementById('baseBranch');
    if (!input || input.tagName === 'SELECT') return;
    const select = document.createElement('select');
    select.id = input.id;
    select.name = 'baseBranch';
    select.setAttribute('aria-label', 'Base branch');
    input.replaceWith(select);
  }

  function transformModelControl(id, roleLabel) {
    const input = document.getElementById(id);
    if (!input || input.tagName === 'SELECT') return;
    const originalLabel = input.closest('label');
    if (!originalLabel) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'setup-model-selection';
    wrapper.style.display = 'grid';
    wrapper.style.gap = '8px';
    wrapper.innerHTML = [
      '<label for="' + id + 'Provider">' + roleLabel + ' harness<select id="' + id + 'Provider" aria-label="' + roleLabel + ' harness"></select></label>',
      '<label for="' + id + '">' + roleLabel + ' model<select id="' + id + '" aria-label="' + roleLabel + ' model"></select></label>',
      '<div class="muted" id="' + id + 'ModelHelp">Models are loaded from the selected Paseo harness.</div>'
    ].join('');
    originalLabel.replaceWith(wrapper);
    document.getElementById(id + 'Provider').addEventListener('change', function() {
      populateModelSelect(id, this.value, document.getElementById(id).value);
    });
  }

  function transformRequirementsPanel() {
    const existing = document.getElementById('requirements');
    if (!existing || existing.dataset.structured === 'true') return;
    const replacement = document.createElement('div');
    replacement.id = 'requirements';
    replacement.dataset.structured = 'true';
    replacement.className = 'component-list';
    existing.replaceWith(replacement);
  }

  function ensureRequirementDialog() {
    if (document.getElementById('requirement-details-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'requirement-details-dialog';
    dialog.innerHTML = [
      '<div class="dialog-head"><div><h2 id="requirement-details-title">Requirement details</h2><p class="muted" id="requirement-details-status"></p></div><button class="ghost small" type="button" id="requirement-details-close-top">Close</button></div>',
      '<div class="dialog-body" id="requirement-details-body"></div>',
      '<div class="dialog-footer"><button class="secondary" type="button" id="requirement-details-recheck">Check again</button><button type="button" id="requirement-details-close">Close</button></div>'
    ].join('');
    document.body.appendChild(dialog);
    document.getElementById('requirement-details-close-top').addEventListener('click', function() { dialog.close(); });
    document.getElementById('requirement-details-close').addEventListener('click', function() { dialog.close(); });
    document.getElementById('requirement-details-recheck').addEventListener('click', function() { forceSetupRefresh(this); });
  }

  function requirementState(id, requirements) {
    const values = {
      git: { ok: requirements.git === true, value: requirements.git ? 'Installed and repository detected' : 'Git was not detected' },
      githubCli: { ok: requirements.githubCli === true, value: requirements.githubCli ? 'GitHub CLI detected' : 'GitHub CLI was not detected' },
      githubAuthenticated: { ok: requirements.githubAuthenticated === true, value: requirements.githubAuthenticated ? 'Authenticated for GitHub access' : 'GitHub CLI is not authenticated' },
      paseoCli: {
        ok: requirements.paseoCli === true,
        value: requirements.paseoCli
          ? (requirements.paseoCommandPath || 'Paseo CLI detected') + (requirements.paseoCommandSource ? ' · ' + requirements.paseoCommandSource : '')
          : 'Paseo CLI was not detected'
      },
      paseoReachable: { ok: requirements.paseoReachable === true, value: requirements.paseoMessage || (requirements.paseoReachable ? 'Paseo daemon reachable' : 'Paseo daemon unreachable') },
      remote: { ok: Boolean(requirements.remote), value: requirements.remote || 'No origin remote detected' }
    };
    return values[id];
  }

  function openRequirementDetails(id) {
    ensureRequirementDialog();
    const definition = requirementDefinitions[id];
    const state = requirementState(id, latestRequirements || {});
    if (!definition || !state) return;
    document.getElementById('requirement-details-title').textContent = definition.label;
    document.getElementById('requirement-details-status').textContent = (state.ok ? 'Passing' : 'Needs attention') + ' · ' + state.value;
    document.getElementById('requirement-details-body').innerHTML = [
      '<div class="section-stack">',
      '<section><h3>Why it is needed</h3><p class="muted">' + safe(definition.why) + '</p></section>',
      '<section><h3>How it is checked</h3><p class="muted">' + safe(definition.checked) + '</p></section>',
      '<section><h3>How to enable or fix it</h3><ol>' + definition.fixes.map(function(step) { return '<li>' + safe(step) + '</li>'; }).join('') + '</ol></section>',
      '<section><h3>Diagnostic commands</h3><pre>' + safe(definition.commands.join('\n')) + '</pre></section>',
      '</div>'
    ].join('');
    document.getElementById('requirement-details-dialog').showModal();
  }

  function renderRequirementRows(data) {
    transformRequirementsPanel();
    ensureRequirementDialog();
    const container = document.getElementById('requirements');
    const requirements = data.requirements || {};
    latestRequirements = requirements;
    container.replaceChildren();
    Object.keys(requirementDefinitions).forEach(function(id) {
      const definition = requirementDefinitions[id];
      const state = requirementState(id, requirements);
      const row = document.createElement('div');
      row.className = 'component';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'auto minmax(0, 1fr) auto';
      row.style.alignItems = 'center';
      row.style.gap = '12px';
      row.innerHTML = [
        '<button type="button" class="small secondary requirement-details-button">Details</button>',
        '<div><strong>' + safe(definition.label) + '</strong><p style="margin:4px 0 0">' + safe(state.value) + '</p></div>',
        '<span class="status-dot ' + (state.ok ? 'good' : 'bad') + '" title="' + (state.ok ? 'Passing' : 'Needs attention') + '"></span>'
      ].join('');
      row.querySelector('button').addEventListener('click', function() { openRequirementDetails(id); });
      container.appendChild(row);
    });
    const checked = document.createElement('p');
    checked.id = 'requirements-last-checked';
    checked.className = 'muted';
    checked.style.margin = '2px 0 0';
    checked.textContent = 'Last checked: ' + (data.setupCheckedAt ? new Date(data.setupCheckedAt).toLocaleString() : 'unknown');
    container.appendChild(checked);
  }

  async function forceSetupRefresh(button) {
    const buttons = [
      button,
      document.getElementById('requirements-check-again'),
      document.getElementById('refresh-setup-options'),
      document.getElementById('requirement-details-recheck')
    ].filter(Boolean);
    const labels = buttons.map(function(item) { return item.textContent; });
    buttons.forEach(function(item) { item.disabled = true; item.textContent = 'Checking…'; });
    try {
      const data = await api('/api/status?refresh=setup&_=' + Date.now());
      render(data);
      toast('Requirements, branches, Paseo harnesses, and models were rechecked.');
      return data;
    } catch (error) {
      toast(error.message, true);
      return null;
    } finally {
      buttons.forEach(function(item, index) {
        if (!item.isConnected) return;
        item.disabled = false;
        item.textContent = labels[index] || 'Check again';
      });
    }
  }
  window.forceSetupRefresh = forceSetupRefresh;

  function wireRequirementsRefresh() {
    const button = document.querySelector('#requirements-card .card-head button');
    if (!button || button.dataset.forcedRefresh === 'true') return;
    button.dataset.forcedRefresh = 'true';
    button.id = 'requirements-check-again';
    button.removeAttribute('onclick');
    button.addEventListener('click', function() { forceSetupRefresh(this); });
  }

  function ensureRefreshControl() {
    const head = document.querySelector('#config-card .card-head');
    if (!head || document.getElementById('refresh-setup-options')) return;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = '<button type="button" class="small secondary" id="refresh-setup-options">Refresh branches and models</button>';
    head.appendChild(actions);
    const status = document.createElement('p');
    status.id = 'setup-options-status';
    status.className = 'muted';
    status.style.margin = '10px 0 0';
    head.parentElement.insertBefore(status, head.nextSibling);
    document.getElementById('refresh-setup-options').addEventListener('click', function() { forceSetupRefresh(this); });
  }

  function providerForValue(value) {
    const text = String(value || '');
    const slash = text.indexOf('/');
    return slash > 0 ? text.slice(0, slash) : '';
  }

  function providerCatalog() {
    return latestOptions && latestOptions.catalog && Array.isArray(latestOptions.catalog.providers)
      ? latestOptions.catalog.providers
      : [];
  }

  function populateProviderSelect(id, currentValue) {
    const select = document.getElementById(id + 'Provider');
    if (!select) return;
    const providers = providerCatalog();
    const currentProvider = providerForValue(currentValue);
    select.replaceChildren();
    if (!providers.length) {
      select.appendChild(optionElement(currentProvider, currentProvider || 'No available Paseo harnesses', true));
      select.disabled = !currentProvider;
      return;
    }
    const known = new Set(providers.map(function(provider) { return provider.id; }));
    if (currentProvider && !known.has(currentProvider)) {
      select.appendChild(optionElement(currentProvider, currentProvider + ' (saved; not currently reported)', true));
    }
    providers.forEach(function(provider, index) {
      const label = provider.label === provider.id ? provider.id : provider.label + ' (' + provider.id + ')';
      const selected = currentProvider ? provider.id === currentProvider : index === 0;
      select.appendChild(optionElement(provider.id, label, selected));
    });
    select.disabled = false;
  }

  function populateModelSelect(id, providerId, currentValue) {
    const select = document.getElementById(id);
    const help = document.getElementById(id + 'ModelHelp');
    if (!select) return;
    const provider = providerCatalog().find(function(item) { return item.id === providerId; });
    const models = provider && Array.isArray(provider.models) ? provider.models : [];
    select.replaceChildren();
    const known = new Set(models.map(function(model) { return model.value; }));
    if (currentValue && !known.has(currentValue)) {
      select.appendChild(optionElement(currentValue, currentValue + ' (saved; not currently reported)', true));
    }
    models.forEach(function(model, index) {
      const detail = model.description ? ' — ' + model.description : '';
      const selected = currentValue ? model.value === currentValue : index === 0;
      select.appendChild(optionElement(model.value, model.label + detail, selected));
    });
    if (!models.length && !currentValue) {
      select.appendChild(optionElement('', providerId ? 'No models reported by this harness' : 'Select a harness first', true));
    }
    select.disabled = !models.length && !currentValue;
    if (help) {
      help.textContent = provider && provider.error
        ? provider.error
        : models.length
          ? models.length + ' model' + (models.length === 1 ? '' : 's') + ' reported by Paseo.'
          : 'No models were reported for this harness.';
    }
  }

  function populateRole(id, currentValue) {
    populateProviderSelect(id, currentValue);
    const provider = document.getElementById(id + 'Provider');
    populateModelSelect(id, provider ? provider.value : providerForValue(currentValue), currentValue);
  }

  function populateBranches(currentValue) {
    const select = document.getElementById('baseBranch');
    if (!select) return;
    const branches = latestOptions && latestOptions.branches && Array.isArray(latestOptions.branches.branches)
      ? latestOptions.branches.branches
      : [];
    select.replaceChildren();
    const known = new Set(branches.map(function(branch) { return branch.name; }));
    if (currentValue && !known.has(currentValue)) {
      select.appendChild(optionElement(currentValue, currentValue + ' (saved; not found locally or on origin)', true));
    }
    branches.forEach(function(branch, index) {
      const locations = branch.local && branch.remote ? 'local + origin' : branch.local ? 'local' : 'origin';
      const label = branch.name + (branch.current ? ' — current branch' : ' — ' + locations);
      const selected = currentValue ? branch.name === currentValue : branch.current || index === 0;
      select.appendChild(optionElement(branch.name, label, selected));
    });
    if (!branches.length && !currentValue) {
      select.appendChild(optionElement('', 'No branches discovered', true));
    }
    select.disabled = !branches.length && !currentValue;
  }

  function renderDiscoveryStatus(data) {
    const status = document.getElementById('setup-options-status');
    if (!status) return;
    const requirements = data.requirements || {};
    const branches = latestOptions && latestOptions.branches && latestOptions.branches.branches || [];
    const providers = providerCatalog();
    const models = providers.reduce(function(total, provider) { return total + (provider.models || []).length; }, 0);
    const checked = data.setupCheckedAt ? ' Checked ' + new Date(data.setupCheckedAt).toLocaleTimeString() + '.' : '';
    status.textContent = requirements.paseoReachable
      ? (requirements.paseoMessage || 'Paseo is reachable.') + ' Loaded ' + branches.length + ' branches, ' + providers.length + ' harnesses, and ' + models + ' models.' + checked
      : (requirements.paseoMessage || 'Paseo is not reachable. Branches are available, but harness and model discovery is paused.') + checked;
    status.className = 'muted ' + (requirements.paseoReachable ? 'good-text' : 'bad-text');
  }

  function renderSetupDiscovery(data) {
    latestOptions = data.setupOptions || latestOptions || { branches: { branches: [] }, catalog: { providers: [] } };
    const currentBranch = data.config && data.config.baseBranch || data.requirements && data.requirements.defaultBranch || '';
    const coder = data.config && data.config.models && data.config.models.coder || '';
    const reviewer = data.config && data.config.models && data.config.models.reviewer || '';
    renderRequirementRows(data);
    populateBranches(currentBranch);
    populateRole('coder', coder);
    populateRole('reviewer', reviewer);
    renderDiscoveryStatus(data);
  }

  transformRequirementsPanel();
  transformBaseBranch();
  transformModelControl('coder', 'Coder');
  transformModelControl('reviewer', 'Independent Reviewer');
  wireRequirementsRefresh();
  ensureRefreshControl();
  ensureRequirementDialog();

  const originalRenderSettings = window.renderSettings;
  if (typeof originalRenderSettings === 'function') {
    window.renderSettings = function(data) {
      originalRenderSettings(data);
      renderSetupDiscovery(data);
    };
    renderSettings = window.renderSettings;
  }
})();
`;
