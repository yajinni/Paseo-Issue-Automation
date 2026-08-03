export const SETUP_CONTROLS_SCRIPT = String.raw`
(function setupDiscoveryControls() {
  let latestOptions = null;

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
    document.getElementById('refresh-setup-options').addEventListener('click', function() {
      this.disabled = true;
      this.textContent = 'Refreshing…';
      refreshStatus().finally(function() {
        const button = document.getElementById('refresh-setup-options');
        if (button) {
          button.disabled = false;
          button.textContent = 'Refresh branches and models';
        }
      });
    });
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
    status.textContent = requirements.paseoReachable
      ? (requirements.paseoMessage || 'Paseo is reachable.') + ' Loaded ' + branches.length + ' branches, ' + providers.length + ' harnesses, and ' + models + ' models.'
      : requirements.paseoMessage || 'Paseo is not reachable. Branches are available, but harness and model discovery is paused.';
    status.className = 'muted ' + (requirements.paseoReachable ? 'good-text' : 'bad-text');
  }

  function enrichRequirements(data) {
    const element = document.getElementById('requirements');
    if (!element) return;
    const requirements = data.requirements || {};
    const method = requirements.paseoProbe && requirements.paseoProbe.method;
    const lines = element.textContent.split('\n').filter(function(line) {
      return !line.startsWith('Paseo detail:') && !line.startsWith('Paseo probe:');
    });
    lines.push('Paseo detail: ' + (requirements.paseoMessage || 'No diagnostic available'));
    if (method) lines.push('Paseo probe: ' + method);
    element.textContent = lines.join('\n');
  }

  function renderSetupDiscovery(data) {
    latestOptions = data.setupOptions || latestOptions || { branches: { branches: [] }, catalog: { providers: [] } };
    const currentBranch = data.config && data.config.baseBranch || data.requirements && data.requirements.defaultBranch || '';
    const coder = data.config && data.config.models && data.config.models.coder || '';
    const reviewer = data.config && data.config.models && data.config.models.reviewer || '';
    populateBranches(currentBranch);
    populateRole('coder', coder);
    populateRole('reviewer', reviewer);
    renderDiscoveryStatus(data);
    enrichRequirements(data);
  }

  transformBaseBranch();
  transformModelControl('coder', 'Coder');
  transformModelControl('reviewer', 'Independent Reviewer');
  ensureRefreshControl();

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
