export const MODEL_THINKING_UI_SCRIPT = String.raw`
(function installModelThinkingControls() {
  let latestCatalog = [];
  let latestConfig = null;

  function option(value, label, selected) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    element.selected = selected === true;
    return element;
  }

  function readableThinking(id) {
    const value = String(id || '');
    const names = {
      none: 'None',
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'Extra high',
      max: 'Maximum'
    };
    return names[value.toLowerCase()] || value.replace(/[-_]+/g, ' ').replace(/^./, function(letter) { return letter.toUpperCase(); });
  }

  function modelRecord(value) {
    for (const provider of latestCatalog) {
      const model = (provider.models || []).find(function(candidate) { return candidate.value === value; });
      if (model) return model;
    }
    return null;
  }

  function ensureThinkingControl(id, roleLabel) {
    if (document.getElementById(id + 'Thinking')) return;
    const modelSelect = document.getElementById(id);
    const wrapper = modelSelect?.closest('.setup-model-selection');
    const help = document.getElementById(id + 'ModelHelp');
    if (!modelSelect || !wrapper) return;

    const label = document.createElement('label');
    label.setAttribute('for', id + 'Thinking');
    label.innerHTML = roleLabel + ' thinking level<select id="' + id + 'Thinking" aria-label="' + roleLabel + ' thinking level"></select>';
    wrapper.insertBefore(label, help || null);

    modelSelect.addEventListener('change', function() {
      populateThinking(id, '', true);
    });
    const provider = document.getElementById(id + 'Provider');
    provider?.addEventListener('change', function() {
      queueMicrotask(function() { populateThinking(id, '', true); });
    });
  }

  function populateThinking(id, savedValue, useModelDefault) {
    const select = document.getElementById(id + 'Thinking');
    const modelSelect = document.getElementById(id);
    if (!select || !modelSelect) return;
    const model = modelRecord(modelSelect.value);
    const choices = Array.isArray(model?.thinkingOptionIds) ? model.thinkingOptionIds : [];
    const defaultValue = model?.defaultThinkingOptionId == null ? '' : String(model.defaultThinkingOptionId);
    const desired = savedValue || (useModelDefault ? defaultValue : '');

    select.replaceChildren();
    if (!choices.length) {
      select.appendChild(option('', 'Default for this model', true));
      select.disabled = true;
      select.title = 'This Paseo harness did not report selectable thinking levels for the chosen model.';
      return;
    }

    if (!defaultValue || !choices.includes(defaultValue)) {
      select.appendChild(option('', 'Default for this model', !desired));
    }
    if (desired && !choices.includes(desired)) {
      select.appendChild(option(desired, readableThinking(desired) + ' (saved; not currently reported)', true));
    }
    choices.forEach(function(choice) {
      const value = String(choice);
      const suffix = value === defaultValue ? ' — default' : '';
      select.appendChild(option(value, readableThinking(value) + suffix, value === desired));
    });
    if (!select.value && defaultValue) select.value = defaultValue;
    select.disabled = false;
    select.title = 'Controls the Paseo --thinking option for this model when the controller starts an agent.';
  }

  function renderThinkingControls(data) {
    latestConfig = data?.config || latestConfig || {};
    latestCatalog = Array.isArray(data?.setupOptions?.catalog?.providers)
      ? data.setupOptions.catalog.providers
      : latestCatalog;
    ensureThinkingControl('coder', 'Coder');
    ensureThinkingControl('reviewer', 'Independent Reviewer');
    populateThinking('coder', latestConfig?.models?.coderThinking || '', false);
    populateThinking('reviewer', latestConfig?.models?.reviewerThinking || '', false);
  }

  const previousRenderSettings = window.renderSettings;
  if (typeof previousRenderSettings === 'function') {
    window.renderSettings = function(data) {
      previousRenderSettings(data);
      renderThinkingControls(data);
    };
    renderSettings = window.renderSettings;
  }

  window.saveConfig = async function() {
    await postAction('/api/config', {
      baseBranch: document.getElementById('baseBranch').value,
      models: {
        coder: document.getElementById('coder').value,
        coderThinking: document.getElementById('coderThinking')?.value || '',
        reviewer: document.getElementById('reviewer').value,
        reviewerThinking: document.getElementById('reviewerThinking')?.value || ''
      },
      pollIntervalSeconds: Number(document.getElementById('pollIntervalSeconds').value),
      maxActive: Number(document.getElementById('maxActive').value),
      maxReviewRounds: Number(document.getElementById('maxReviewRounds').value)
    }, 'Configuration saved.');
  };
  saveConfig = window.saveConfig;

  document.addEventListener('DOMContentLoaded', function() {
    ensureThinkingControl('coder', 'Coder');
    ensureThinkingControl('reviewer', 'Independent Reviewer');
  });
})();
`;
