import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_CONFIGURATION_TABS_STYLE = String.raw`
.manager-config-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px;margin-bottom:14px;border:1px solid #293445;border-radius:12px;background:#111821}
.manager-config-tab{flex:0 0 auto;border:0!important;background:transparent!important;color:#9aabc0!important;border-radius:9px!important;padding:9px 12px!important;font-weight:650!important;white-space:nowrap}
.manager-config-tab:hover{background:#1a2432!important;color:#eef2f7!important}
.manager-config-tab[aria-selected="true"]{background:#243044!important;color:#fff!important}
[data-config-step][hidden],[data-config-step-group][hidden],[data-manager-config-edit-card][hidden]{display:none!important}
[data-manager-view-target="integration"],[data-manager-view-target="maintenance"]{display:none!important}
.manager-config-fields .manager-auto-merge-setting{grid-column:1/-1!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:16px!important;align-items:center!important;margin-top:4px!important;padding:14px 16px!important;border:1px solid #334156;border-radius:11px;background:#101925;color:var(--paseo-text)!important;cursor:pointer;transition:border-color .15s ease,background .15s ease}
.manager-config-fields .manager-auto-merge-setting:hover{border-color:#43526a;background:#141e2b}.manager-config-fields .manager-auto-merge-setting[aria-disabled="true"]{cursor:not-allowed;opacity:.72}
.manager-auto-merge-copy{display:grid;gap:5px;min-width:0}.manager-auto-merge-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.manager-auto-merge-heading strong{font-size:14px;color:var(--paseo-text)}
.manager-auto-merge-state{display:inline-flex;align-items:center;border:1px solid #526074;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:750;letter-spacing:.02em;color:#aab8c9;background:#182231}.manager-auto-merge-state.enabled{border-color:#2f8d55;background:#163424;color:#b9e9ca}.manager-auto-merge-state.disabled{border-color:#526074;background:#182231;color:#aab8c9}.manager-auto-merge-state.unavailable{border-color:#6c5b35;background:#2b2515;color:#e2cf91}
.manager-auto-merge-help{margin:0!important;padding:0!important;border:0!important;background:transparent!important;color:var(--paseo-muted)!important;font-size:12px!important;line-height:1.45!important}
.manager-auto-merge-switch{position:relative;width:46px;height:26px;flex:0 0 auto}.manager-auto-merge-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:2}.manager-auto-merge-switch input:disabled{cursor:not-allowed}.manager-auto-merge-track{position:absolute;inset:0;border:1px solid #526074;border-radius:999px;background:#202b39;transition:background .15s ease,border-color .15s ease}.manager-auto-merge-track::after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#c8d3e0;transition:transform .15s ease,background .15s ease}.manager-auto-merge-switch input:checked + .manager-auto-merge-track{background:#2f6fed;border-color:#5f8ff3}.manager-auto-merge-switch input:checked + .manager-auto-merge-track::after{transform:translateX(20px);background:#fff}.manager-auto-merge-switch input:focus-visible + .manager-auto-merge-track{outline:2px solid #8ab8ff;outline-offset:3px}.manager-auto-merge-setting[aria-disabled="true"] .manager-auto-merge-track{opacity:.55}
.manager-model-catalog-note{grid-column:1/-1;color:var(--paseo-muted);font-size:11px;line-height:1.4;margin-top:2px}.manager-model-catalog-note.error{color:#ffaca5}
.manager-integration-summary{display:grid;gap:14px;padding:15px;border:1px solid #334156;border-radius:11px;background:#101925}.manager-integration-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.manager-integration-state{display:flex;align-items:center;gap:9px}.manager-integration-state-dot{width:11px;height:11px;border-radius:999px;background:#718097;box-shadow:0 0 0 3px #71809722}.manager-integration-state.connected .manager-integration-state-dot{background:#55bd78;box-shadow:0 0 0 3px #55bd7822}.manager-integration-state.attention .manager-integration-state-dot{background:#e2ad45;box-shadow:0 0 0 3px #e2ad4522}.manager-integration-state.blocked .manager-integration-state-dot{background:#e06f78;box-shadow:0 0 0 3px #e06f7822}.manager-integration-state strong{display:block;font-size:15px}.manager-integration-state small{display:block;color:var(--paseo-muted);font-size:11px;margin-top:3px}.manager-integration-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.manager-integration-fact{border:1px solid #2d394b;border-radius:9px;background:#111a26;padding:10px}.manager-integration-fact span{display:block;color:var(--paseo-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}.manager-integration-fact strong{font-size:12px;line-height:1.4;overflow-wrap:anywhere}.manager-integration-actions{display:flex;gap:8px;flex-wrap:wrap}.manager-integration-advanced{margin-top:12px;border-top:1px solid #2c3849;padding-top:12px}.manager-integration-advanced>summary{cursor:pointer;color:#aebed1;font-weight:650;font-size:12px}.manager-integration-advanced-body{display:grid;gap:12px;margin-top:12px}.manager-integration-advanced-body>p{margin:0;color:var(--paseo-muted);line-height:1.45}.manager-integration-advanced-body .facts{margin:0}.manager-integration-advanced-body .actions{margin-top:0!important}
.manager-readiness-card{display:grid;gap:14px}.manager-readiness-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px;border:1px solid #334156;border-radius:11px;background:#101925}.manager-readiness-state{display:flex;gap:10px;align-items:flex-start}.manager-readiness-dot{width:12px;height:12px;margin-top:4px;border-radius:999px;background:#718097;box-shadow:0 0 0 3px #71809722}.manager-readiness-state.ready .manager-readiness-dot{background:#55bd78;box-shadow:0 0 0 3px #55bd7822}.manager-readiness-state.attention .manager-readiness-dot{background:#e2ad45;box-shadow:0 0 0 3px #e2ad4522}.manager-readiness-state.blocked .manager-readiness-dot{background:#e06f78;box-shadow:0 0 0 3px #e06f7822}.manager-readiness-state strong{display:block;font-size:17px}.manager-readiness-state p{margin:4px 0 0;color:var(--paseo-muted);font-size:12px;line-height:1.45}.manager-readiness-list{display:grid;gap:8px}.manager-readiness-check{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid #2d394b;border-radius:9px;background:#111a26}.manager-readiness-check.bad{border-color:#74424b;background:#28191e}.manager-readiness-check.pending{border-color:#6c5b35;background:#272214}.manager-readiness-check-dot{width:20px;height:20px;border-radius:999px;display:grid;place-items:center;border:1px solid #526074;color:#c6d2e1;font-size:11px}.manager-readiness-check.ok .manager-readiness-check-dot{border-color:#2f8d55;background:#163424;color:#b9e9ca}.manager-readiness-check.bad .manager-readiness-check-dot{border-color:#98514b;background:#5f302d;color:#ffd2d0}.manager-readiness-check.pending .manager-readiness-check-dot{border-color:#80672c;background:#3b3015;color:#f1d38a}.manager-readiness-check-copy strong{display:block;font-size:12px}.manager-readiness-check-copy small{display:block;color:var(--paseo-muted);font-size:11px;margin-top:3px;line-height:1.4}.manager-readiness-passed,.manager-readiness-advanced{border-top:1px solid #2c3849;padding-top:12px}.manager-readiness-passed>summary,.manager-readiness-advanced>summary{cursor:pointer;color:#aebed1;font-weight:650;font-size:12px}.manager-readiness-passed-list{display:grid;gap:6px;margin-top:10px}.manager-readiness-passed-row{display:flex;align-items:center;gap:8px;color:#aebed1;font-size:11px}.manager-readiness-passed-row span{color:#65c987}.manager-readiness-advanced-body{display:grid;gap:12px;margin-top:12px}.manager-readiness-advanced-body>.card{margin:0!important}.manager-readiness-empty{padding:12px;border:1px solid #356b4a;border-radius:9px;background:#12261a;color:#b9e9ca;font-size:12px}
@media(max-width:820px){.manager-integration-facts{grid-template-columns:1fr}.manager-integration-head,.manager-readiness-hero{display:block}.manager-integration-actions,.manager-readiness-hero>button{margin-top:10px}.manager-readiness-check{grid-template-columns:22px minmax(0,1fr)}.manager-readiness-check button{grid-column:2}}
@media(max-width:720px){.manager-config-tabs{margin-inline:-2px}.manager-config-fields .manager-auto-merge-setting{grid-template-columns:minmax(0,1fr) auto!important;padding:13px!important}}
`;

export const MANAGER_CONFIGURATION_TABS_SCRIPT = String.raw`
(function managerConfigurationTabs() {
  const STEPS = [
    ['paseo', 'Connect Paseo'],
    ['harness', 'Coding'],
    ['repository', 'GitHub repository'],
    ['issues', 'Issues setup'],
    ['review', 'Review setup'],
    ['readiness', 'Readiness'],
  ];
  const GROUP_STEP = new Map([
    ['Coder model', 'harness'],
    ['Review model', 'harness'],
    ['Provider/Coding Harness', 'harness'],
    ['GitHub repository', 'repository'],
    ['Issue processing', 'issues'],
    ['Review workflow', 'review'],
    ['ChatGPT Profile', 'review'],
  ]);
  const AUTO_MERGE_ENABLED_COPY = 'When enabled, Paseo requests merge only after exact-head full-review approval, passing validation and checks, a current mergeable base, and repository policy allow it.';
  const AUTO_MERGE_UNAVAILABLE_COPY = 'Unavailable for Light model review → Manual review. A person must merge the PR after manual review.';
  let built = false;
  let activeStep = localStorage.getItem('paseo-manager-config-tab') || 'paseo';
  let modelCatalog = null;
  let modelCatalogLoading = false;
  let modelCatalogError = null;

  function moveViewCards(source, target, step) {
    if (!source || !target) return;
    for (const child of [...source.children]) {
      child.dataset.configStep = step;
      target.append(child);
    }
  }

  function markConfigGroups(configurationCard) {
    for (const group of configurationCard?.querySelectorAll('.manager-config-group') || []) {
      const step = GROUP_STEP.get(group.querySelector('h3')?.textContent.trim());
      if (step) group.dataset.configStepGroup = step;
    }
  }

  function syncAutoMergeSetting() {
    const input = document.getElementById('auto-merge-approved');
    const label = input?.closest('.manager-auto-merge-setting');
    const state = document.getElementById('manager-auto-merge-state');
    const help = document.getElementById('auto-merge-help');
    if (!input || !label || !state) return;
    const available = !input.disabled;
    label.setAttribute('aria-disabled', available ? 'false' : 'true');
    state.className = 'manager-auto-merge-state ' + (!available ? 'unavailable' : input.checked ? 'enabled' : 'disabled');
    state.textContent = !available ? 'Unavailable' : input.checked ? 'Enabled' : 'Disabled';
    if (help) help.textContent = available ? AUTO_MERGE_ENABLED_COPY : AUTO_MERGE_UNAVAILABLE_COPY;
  }

  function enhanceAutoMergeSetting() {
    const input = document.getElementById('auto-merge-approved');
    const label = input?.closest('label');
    if (!input || !label) return;
    if (label.dataset.managerAutoMergeSetting === 'true') { syncAutoMergeSetting(); return; }
    const existingTitle = label.querySelector('span')?.textContent.trim() || 'Automatically merge fully approved coding PRs';
    const help = document.getElementById('auto-merge-help');
    const copy = document.createElement('div'); copy.className = 'manager-auto-merge-copy';
    const heading = document.createElement('div'); heading.className = 'manager-auto-merge-heading';
    const title = document.createElement('strong'); title.textContent = existingTitle;
    const state = document.createElement('span'); state.id = 'manager-auto-merge-state'; state.className = 'manager-auto-merge-state disabled'; state.textContent = 'Disabled';
    heading.append(title, state); copy.append(heading);
    if (help) { help.classList.add('manager-auto-merge-help'); copy.append(help); }
    const control = document.createElement('span'); control.className = 'manager-auto-merge-switch'; control.setAttribute('aria-hidden', 'false');
    const track = document.createElement('span'); track.className = 'manager-auto-merge-track'; track.setAttribute('aria-hidden', 'true');
    label.textContent = '';
    label.className = 'manager-auto-merge-setting';
    label.dataset.managerAutoMergeSetting = 'true';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', existingTitle);
    if (help) input.setAttribute('aria-describedby', help.id);
    control.append(input, track);
    label.append(copy, control);
    input.addEventListener('change', syncAutoMergeSetting);
    syncAutoMergeSetting();
  }

  function setConfigCardTitle(card, step) {
    const heading = card?.querySelector('h2');
    if (!heading) return;
    const labels = {
      harness: 'Coding settings',
      repository: 'GitHub repository settings',
      issues: 'Issues setup settings',
      review: 'Review setup settings',
    };
    heading.textContent = labels[step] || 'Repository configuration';
  }

  function setElementHidden(element, hidden) {
    if (!element) return;
    element.hidden = hidden;
    if (hidden) element.style.setProperty('display', 'none', 'important');
    else element.style.removeProperty('display');
  }

  function ensureSelect(id, ariaLabel) {
    const existing = document.getElementById(id);
    if (!existing || existing.tagName === 'SELECT') return existing;
    const select = document.createElement('select');
    select.id = id;
    select.setAttribute('aria-label', ariaLabel);
    select.value = existing.value || '';
    select.dataset.configOriginalValue = existing.value || '';
    existing.replaceWith(select);
    return select;
  }

  function preserveOption(select, value, suffix = 'currently configured; not reported by Paseo') {
    const current = String(value || '').trim();
    if (!select || !current || [...select.options].some((option) => option.value === current)) return;
    const option = document.createElement('option');
    option.value = current;
    option.textContent = current + ' (' + suffix + ')';
    option.dataset.unavailable = 'true';
    select.append(option);
  }

  function providerForHarness() {
    const providers = modelCatalog?.catalog?.providers || [];
    const harness = String(document.getElementById('coding-harness')?.value || '').trim();
    return providers.find((provider) => String(provider.id) === harness)
      || (providers.length === 1 ? providers[0] : null);
  }

  function allModels() {
    const provider = providerForHarness();
    return provider ? (provider.models || []) : (modelCatalog?.catalog?.providers || []).flatMap((item) => item.models || []);
  }

  function modelByValue(value) {
    const wanted = String(value || '').trim();
    for (const provider of modelCatalog?.catalog?.providers || []) {
      const found = (provider.models || []).find((model) => String(model.value || '') === wanted);
      if (found) return found;
    }
    return null;
  }

  function syncThinkingSelect(modelId, thinkingId, label) {
    const modelSelect = document.getElementById(modelId);
    const select = ensureSelect(thinkingId, label);
    if (!modelSelect || !select) return;
    const current = String(select.value || select.dataset.configOriginalValue || '').trim();
    const model = modelByValue(modelSelect.value);
    const values = Array.isArray(model?.thinkingOptionIds) ? model.thinkingOptionIds.map(String) : [];
    select.textContent = '';
    if (!values.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Default / not reported'; select.append(option);
    } else {
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value + (value === String(model?.defaultThinkingOptionId || '') ? ' — default' : '');
        select.append(option);
      }
    }
    preserveOption(select, current);
    const preferred = current && [...select.options].some((option) => option.value === current)
      ? current
      : String(model?.defaultThinkingOptionId || '');
    select.value = [...select.options].some((option) => option.value === preferred) ? preferred : '';
  }

  function syncModelSelect(id, label) {
    const select = ensureSelect(id, label);
    if (!select) return;
    const current = String(select.value || select.dataset.configOriginalValue || '').trim();
    const models = allModels();
    select.textContent = '';
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = models.length ? 'Choose a model' : 'No models reported'; select.append(placeholder);
    for (const model of models) {
      const option = document.createElement('option');
      option.value = String(model.value || model.id || '');
      option.textContent = String(model.label || model.id || option.value);
      if (model.description) option.title = String(model.description);
      select.append(option);
    }
    preserveOption(select, current);
    select.value = current && [...select.options].some((option) => option.value === current) ? current : '';
  }

  function modelCatalogNote(message, error = false) {
    const group = [...document.querySelectorAll('.manager-config-group')].find((item) => item.querySelector('h3')?.textContent.trim() === 'Provider/Coding Harness');
    if (!group) return;
    let note = group.querySelector('.manager-model-catalog-note');
    if (!note) { note = document.createElement('div'); note.className = 'manager-model-catalog-note'; group.append(note); }
    note.className = 'manager-model-catalog-note' + (error ? ' error' : '');
    note.textContent = message;
  }

  function renderModelCatalog() {
    if (!modelCatalog) return;
    syncModelSelect('coder-model', 'Coder model');
    syncModelSelect('reviewer-model', 'Reviewer model');
    syncThinkingSelect('coder-model', 'coder-thinking', 'Coder thinking level');
    syncThinkingSelect('reviewer-model', 'reviewer-thinking', 'Reviewer thinking level');
    const provider = providerForHarness();
    const count = allModels().length;
    modelCatalogNote(provider
      ? 'Showing ' + count + ' model' + (count === 1 ? '' : 's') + ' currently reported for ' + (provider.label || provider.id) + '.'
      : 'Choose a coding harness to load its currently reported models.');
  }

  async function loadModelCatalog(force = false) {
    if (modelCatalogLoading || modelCatalog && !force) { renderModelCatalog(); renderCurrentReadiness(); return; }
    if (typeof selectedPath !== 'function') { modelCatalogError = 'Model catalog is unavailable in this view.'; modelCatalogNote(modelCatalogError, true); renderCurrentReadiness(); return; }
    modelCatalogLoading = true;
    modelCatalogError = null;
    modelCatalogNote('Loading models and thinking levels from Paseo…');
    renderCurrentReadiness();
    try {
      const response = await fetch(selectedPath('configuration/harnesses'), { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load the Paseo model catalog.');
      modelCatalog = body;
      renderModelCatalog();
    } catch (error) {
      modelCatalogError = error?.message || String(error);
      modelCatalogNote(modelCatalogError, true);
      syncModelSelect('coder-model', 'Coder model');
      syncModelSelect('reviewer-model', 'Reviewer model');
      syncThinkingSelect('coder-model', 'coder-thinking', 'Coder thinking level');
      syncThinkingSelect('reviewer-model', 'reviewer-thinking', 'Reviewer thinking level');
    } finally {
      modelCatalogLoading = false;
      renderCurrentReadiness();
    }
  }

  function prepareModelSelects() {
    ensureSelect('coder-model', 'Coder model');
    ensureSelect('coder-thinking', 'Coder thinking level');
    ensureSelect('reviewer-model', 'Reviewer model');
    ensureSelect('reviewer-thinking', 'Reviewer thinking level');
    document.getElementById('coder-model')?.addEventListener('change', () => { syncThinkingSelect('coder-model', 'coder-thinking', 'Coder thinking level'); renderCurrentReadiness(); });
    document.getElementById('reviewer-model')?.addEventListener('change', () => { syncThinkingSelect('reviewer-model', 'reviewer-thinking', 'Reviewer thinking level'); renderCurrentReadiness(); });
    document.getElementById('coding-harness')?.addEventListener('change', () => { renderModelCatalog(); renderCurrentReadiness(); });
    document.getElementById('manager-refresh-harnesses')?.addEventListener('click', () => {
      modelCatalog = null;
      modelCatalogError = null;
      setTimeout(() => loadModelCatalog(true), 0);
    });
  }

  function integrationCard() {
    return document.getElementById('controller-mode-facts')?.closest('section.card') || null;
  }

  function simplifyRepositoryIntegration() {
    const card = integrationCard();
    if (!card || card.dataset.managerSimpleIntegration === 'true') return card;
    card.dataset.managerSimpleIntegration = 'true';
    const heading = card.querySelector('h2');
    if (heading) heading.textContent = 'Repository Integration';

    const existing = [...card.children].filter((child) => child !== heading);
    const summary = document.createElement('div');
    summary.className = 'manager-integration-summary';
    summary.innerHTML = '<div class="manager-integration-head"><div class="manager-integration-state" id="manager-integration-state"><span class="manager-integration-state-dot"></span><div><strong>Checking integration…</strong><small>Reading the latest manager state.</small></div></div></div><div class="manager-integration-facts"><div class="manager-integration-fact"><span>Mode</span><strong id="manager-integration-mode">Unknown</strong></div><div class="manager-integration-fact"><span>Managed components</span><strong id="manager-integration-components">Checking…</strong></div><div class="manager-integration-fact"><span>Last checked</span><strong id="manager-integration-checked">—</strong></div></div><div class="manager-integration-actions"><button type="button" class="secondary" id="manager-integration-recheck">Recheck</button><button type="button" class="secondary" id="manager-integration-repair" hidden>Repair</button><button type="button" class="warning" id="manager-integration-migration-action" hidden>Migration action</button></div>';

    const advanced = document.createElement('details');
    advanced.className = 'manager-integration-advanced';
    const advancedSummary = document.createElement('summary');
    advancedSummary.textContent = 'Advanced / Migration history';
    const body = document.createElement('div');
    body.className = 'manager-integration-advanced-body';
    for (const child of existing) body.append(child);
    advanced.append(advancedSummary, body);
    card.append(summary, advanced);

    document.getElementById('manager-integration-recheck')?.addEventListener('click', () => document.getElementById('refresh-button')?.click());
    document.getElementById('manager-integration-repair')?.addEventListener('click', () => document.getElementById('repair-external-controller')?.click());
    document.getElementById('manager-integration-migration-action')?.addEventListener('click', (event) => {
      const targetId = event.currentTarget?.dataset.targetId;
      if (targetId) document.getElementById(targetId)?.click();
    });
    return card;
  }

  function integrationComponents(setup = {}) {
    const components = [];
    if (setup.issueTemplateManaged === true) components.push('Issue template');
    if (Number(setup.managedLabelCount || 0) > 0) components.push(String(setup.managedLabelCount) + ' managed labels');
    if (setup.workspaceId) components.push('Paseo workspace');
    return components.length ? components.join(' · ') : setup.externalController ? 'Managed repository components' : 'Not installed';
  }

  function renderRepositoryIntegration(data) {
    if (!data) return;
    simplifyRepositoryIntegration();
    const setup = data.setup || {};
    const capabilities = data.capabilities || {};
    const state = document.getElementById('manager-integration-state');
    const mode = document.getElementById('manager-integration-mode');
    const components = document.getElementById('manager-integration-components');
    const checked = document.getElementById('manager-integration-checked');
    const repair = document.getElementById('manager-integration-repair');
    const migrationAction = document.getElementById('manager-integration-migration-action');
    if (!state || !mode || !components || !checked || !repair || !migrationAction) return;

    const external = setup.externalController === true || setup.controllerMode === 'external-manager';
    const embedded = setup.embeddedController === true || setup.controllerMode === 'embedded-repository';
    const migrationPending = setup.migrationPending === true;
    const adoptionReady = capabilities.migrationAdoption === true;
    const pendingFiles = setup.repositoryChanges?.expectedFiles || [];
    const syncError = setup.migration?.syncError || null;
    let tone = 'blocked';
    let title = 'Setup required';
    let detail = 'This repository is not ready for the standalone manager.';

    if (migrationPending) {
      tone = syncError ? 'blocked' : 'attention';
      title = syncError ? 'Migration needs attention' : 'Migration in progress';
      detail = syncError || 'A migration PR is pending or waiting for local synchronization.';
    } else if (embedded && adoptionReady) {
      tone = 'attention';
      title = 'Migration ready to finalize';
      detail = 'Repository files already match standalone-manager mode; finalize the local controller state.';
    } else if (embedded) {
      tone = 'attention';
      title = 'Migration required';
      detail = 'This repository still uses the legacy embedded Paseo installation.';
    } else if (external && setup.complete === true && pendingFiles.length === 0) {
      tone = 'connected';
      title = 'Connected';
      detail = 'This repository is configured for the Paseo standalone manager.';
    } else if (external) {
      tone = 'attention';
      title = 'Integration needs attention';
      detail = pendingFiles.length ? 'Managed repository files need to be reconciled.' : 'Standalone-manager setup is incomplete.';
    }

    state.className = 'manager-integration-state ' + tone;
    state.querySelector('strong').textContent = title;
    state.querySelector('small').textContent = detail;
    mode.textContent = external ? 'Standalone manager' : embedded ? 'Legacy embedded installation' : 'Not installed';
    components.textContent = integrationComponents(setup);
    checked.textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    repair.hidden = !(external && capabilities.externalRepair === true);
    repair.disabled = document.getElementById('repair-external-controller')?.disabled === true;

    let migrationTarget = null;
    let migrationLabel = '';
    if (capabilities.migrationReconciliation === true && migrationPending) {
      migrationTarget = 'reconcile-controller-migration'; migrationLabel = 'Reconcile migration';
    } else if (capabilities.migrationAdoption === true) {
      migrationTarget = 'finalize-existing-migration'; migrationLabel = 'Finalize migration';
    } else if (capabilities.embeddedMigration === true || embedded) {
      migrationTarget = 'migrate-embedded-controller'; migrationLabel = 'Migrate to standalone manager';
    }
    migrationAction.hidden = !migrationTarget;
    migrationAction.dataset.targetId = migrationTarget || '';
    migrationAction.textContent = migrationLabel || 'Migration action';
    migrationAction.disabled = migrationTarget ? document.getElementById(migrationTarget)?.disabled === true : true;
  }

  function buildReadiness(configuration) {
    if (!configuration || document.getElementById('manager-readiness-card')) return;
    const legacy = [...configuration.children].filter((child) => child.dataset.configStep === 'readiness');
    const card = document.createElement('section');
    card.className = 'card wide manager-readiness-card';
    card.id = 'manager-readiness-card';
    card.dataset.configStep = 'readiness';
    card.innerHTML = '<div><h2>Readiness</h2><p class="muted">Can Paseo autonomously claim, code, review, and complete work for this repository?</p></div><div class="manager-readiness-hero"><div class="manager-readiness-state" id="manager-readiness-state"><span class="manager-readiness-dot"></span><div><strong>Checking readiness…</strong><p>Reading current configuration and service availability.</p></div></div><button type="button" class="secondary" id="manager-readiness-recheck">Recheck</button></div><div class="manager-readiness-list" id="manager-readiness-problems"></div><details class="manager-readiness-passed" id="manager-readiness-passed"><summary>Passed checks</summary><div class="manager-readiness-passed-list" id="manager-readiness-passed-list"></div></details>';

    const advanced = document.createElement('details');
    advanced.className = 'manager-readiness-advanced';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced maintenance and diagnostics';
    const body = document.createElement('div');
    body.className = 'manager-readiness-advanced-body';
    for (const item of legacy) body.append(item);
    advanced.append(summary, body);
    card.append(advanced);
    configuration.append(card);

    document.getElementById('manager-readiness-recheck')?.addEventListener('click', () => {
      modelCatalog = null;
      modelCatalogError = null;
      loadModelCatalog(true);
      document.getElementById('refresh-button')?.click();
    });
  }

  function readinessCheck(id, label, ok, detail, step, pending = false) {
    return { id, label, ok: ok === true, detail, step, pending: pending === true };
  }

  function readinessChecks(data) {
    const setup = data?.setup || {};
    const config = data?.configuration || {};
    const automation = data?.automation || {};
    const models = data?.models || {};
    const external = setup.externalController === true || setup.controllerMode === 'external-manager';
    const provider = providerForHarness();
    const catalogKnown = Boolean(modelCatalog);
    const catalogPending = modelCatalogLoading || (!catalogKnown && !modelCatalogError);
    const coderConfigured = Boolean(String(models.coder || document.getElementById('coder-model')?.value || '').trim());
    const reviewerConfigured = Boolean(String(models.reviewer || document.getElementById('reviewer-model')?.value || '').trim());
    const coderValue = String(document.getElementById('coder-model')?.value || models.coder || '').trim();
    const reviewerValue = String(document.getElementById('reviewer-model')?.value || models.reviewer || '').trim();
    const workerRequired = data?.capabilities?.backgroundWorkers !== false;
    const checks = [];

    checks.push(readinessCheck('setup', 'Repository setup', setup.complete === true, setup.complete === true ? 'Required setup is complete.' : 'Repository setup has not completed.', 'repository'));
    checks.push(readinessCheck('integration', 'Standalone repository integration', external && setup.migrationPending !== true, external ? (setup.migrationPending ? 'Migration is still pending.' : 'Standalone-manager integration is active.') : 'Repository is not using the standalone manager.', 'repository'));
    checks.push(readinessCheck('github', 'GitHub base branch', Boolean(setup.baseBranch), setup.baseBranch ? 'Base branch: ' + setup.baseBranch : 'Choose a base branch.', 'repository'));

    if (catalogPending) checks.push(readinessCheck('paseo-catalog', 'Paseo coding catalog', false, 'Checking available harnesses and models…', 'harness', true));
    else checks.push(readinessCheck('paseo-catalog', 'Paseo coding catalog', !modelCatalogError && Boolean(provider), modelCatalogError || (provider ? 'Paseo currently reports the selected coding harness.' : 'The selected coding harness is not currently reported by Paseo.'), 'harness'));

    const coderAvailable = catalogKnown ? Boolean(modelByValue(coderValue)) : coderConfigured;
    checks.push(readinessCheck('coder-model', 'Coder model', coderConfigured && coderAvailable, !coderConfigured ? 'Choose a coder model.' : coderAvailable ? 'Configured coder model is currently available.' : 'Configured coder model is not currently reported by Paseo.', 'harness', catalogPending));
    const reviewerAvailable = catalogKnown ? Boolean(modelByValue(reviewerValue)) : reviewerConfigured;
    checks.push(readinessCheck('reviewer-model', 'Reviewer model', reviewerConfigured && reviewerAvailable, !reviewerConfigured ? 'Choose a reviewer model.' : reviewerAvailable ? 'Configured reviewer model is currently available.' : 'Configured reviewer model is not currently reported by Paseo.', 'harness', catalogPending));

    checks.push(readinessCheck('issues', 'Issue automation configuration', Number(automation.maxActive || 0) > 0, Number(automation.maxActive || 0) > 0 ? 'Issue concurrency is configured.' : 'Configure issue-processing capacity.', 'issues'));
    const workflow = String(config.review?.workflow || '').trim();
    checks.push(readinessCheck('review', 'Review workflow', Boolean(workflow), workflow ? 'Review workflow is configured.' : 'Choose a review workflow.', 'review'));
    if (data?.chatGptProfile?.required === true) checks.push(readinessCheck('chatgpt', 'ChatGPT review profile', data.chatGptProfile.ready === true, data.chatGptProfile.summary || 'Complete the ChatGPT review profile.', 'review'));
    checks.push(readinessCheck('coding-worker', 'Coding worker availability', !workerRequired || data?.worker?.running === true, !workerRequired || data?.worker?.running === true ? 'Automatic coding worker is available.' : 'Automatic coding worker is unavailable.', 'harness'));
    checks.push(readinessCheck('review-state', 'PR review state', data?.prReviews?.available !== false, data?.prReviews?.available === false ? (data.prReviews.error || 'PR review state could not be read.') : 'PR review state is available. The review queue may be intentionally stopped without affecting readiness.', 'review'));
    return checks;
  }

  function readinessCheckElement(check) {
    const row = document.createElement('div');
    row.className = 'manager-readiness-check ' + (check.pending ? 'pending' : check.ok ? 'ok' : 'bad');
    const dot = document.createElement('span'); dot.className = 'manager-readiness-check-dot'; dot.textContent = check.pending ? '…' : check.ok ? '✓' : '!';
    const copy = document.createElement('div'); copy.className = 'manager-readiness-check-copy';
    const strong = document.createElement('strong'); strong.textContent = check.label;
    const small = document.createElement('small'); small.textContent = check.detail || '';
    copy.append(strong, small); row.append(dot, copy);
    if (!check.ok && !check.pending && check.step) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Open ' + (check.step === 'harness' ? 'Coding' : check.step === 'repository' ? 'GitHub' : check.step === 'issues' ? 'Issues' : check.step === 'review' ? 'Reviews' : 'settings');
      button.addEventListener('click', () => showStep(check.step)); row.append(button);
    }
    return row;
  }

  function renderReadiness(data) {
    const card = document.getElementById('manager-readiness-card');
    if (!card || !data) return;
    const checks = readinessChecks(data);
    const failed = checks.filter((check) => !check.ok && !check.pending);
    const pending = checks.filter((check) => check.pending);
    const passed = checks.filter((check) => check.ok && !check.pending);
    const state = document.getElementById('manager-readiness-state');
    const problems = document.getElementById('manager-readiness-problems');
    const passedDetails = document.getElementById('manager-readiness-passed');
    const passedList = document.getElementById('manager-readiness-passed-list');
    const recheck = document.getElementById('manager-readiness-recheck');
    if (!state || !problems || !passedDetails || !passedList || !recheck) return;

    const ready = failed.length === 0 && pending.length === 0;
    state.className = 'manager-readiness-state ' + (ready ? 'ready' : failed.length ? 'blocked' : 'attention');
    state.querySelector('strong').textContent = ready ? 'Ready for autonomous work' : failed.length ? (failed.length + ' thing' + (failed.length === 1 ? '' : 's') + ' need attention') : 'Checking readiness…';
    state.querySelector('p').textContent = ready
      ? 'Paseo has the configuration and services it needs to process this repository.'
      : failed.length ? 'Fix the items below before relying on autonomous issue processing.' : 'Verifying the current Paseo coding catalog.';
    recheck.disabled = modelCatalogLoading;
    recheck.textContent = modelCatalogLoading ? 'Checking…' : 'Recheck';

    problems.textContent = '';
    if (ready) {
      const empty = document.createElement('div'); empty.className = 'manager-readiness-empty'; empty.textContent = 'All required configuration checks are passing.'; problems.append(empty);
    } else {
      for (const check of [...failed, ...pending]) problems.append(readinessCheckElement(check));
    }

    passedDetails.querySelector('summary').textContent = passed.length + ' check' + (passed.length === 1 ? '' : 's') + ' passed';
    passedList.textContent = '';
    for (const check of passed) {
      const row = document.createElement('div'); row.className = 'manager-readiness-passed-row';
      const mark = document.createElement('span'); mark.textContent = '✓';
      const label = document.createElement('div'); label.textContent = check.label;
      row.append(mark, label); passedList.append(row);
    }
  }

  function renderCurrentReadiness() {
    try { if (typeof currentStatus !== 'undefined' && currentStatus) renderReadiness(currentStatus); } catch {}
  }

  function showStep(step, { focus = false } = {}) {
    if (!STEPS.some(([id]) => id === step)) step = 'paseo';
    activeStep = step;
    localStorage.setItem('paseo-manager-config-tab', step);
    for (const button of document.querySelectorAll('.manager-config-tab')) {
      const selected = button.dataset.configTab === step;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
    for (const element of document.querySelectorAll('[data-config-step]')) {
      setElementHidden(element, element.dataset.configStep !== step);
    }

    const configCard = document.querySelector('[data-manager-config-edit-card]');
    const groups = [...(configCard?.querySelectorAll('[data-config-step-group]') || [])];
    const editable = groups.some((group) => group.dataset.configStepGroup === step);
    if (configCard) {
      setElementHidden(configCard, !editable);
      setConfigCardTitle(configCard, step);
      for (const group of groups) {
        const conditionalHidden = group.dataset.configConditionalHidden === 'true';
        setElementHidden(group, group.dataset.configStepGroup !== step || conditionalHidden);
      }
    }
    if (step === 'harness') loadModelCatalog(false);
    if (step === 'repository') renderCurrentIntegration();
    if (step === 'readiness') { renderCurrentReadiness(); loadModelCatalog(false); }
    document.dispatchEvent(new CustomEvent('paseo:configuration-tab', { detail: { step } }));
    if (focus) document.querySelector('.manager-config-tab[aria-selected="true"]')?.focus();
  }

  function renderCurrentIntegration() {
    try { if (typeof currentStatus !== 'undefined' && currentStatus) renderRepositoryIntegration(currentStatus); } catch {}
  }

  function redirectLegacyViews() {
    const current = document.querySelector('[data-manager-view-target][aria-current="page"]')?.dataset.managerViewTarget;
    if (current !== 'integration' && current !== 'maintenance') return;
    activeStep = current === 'integration' ? 'repository' : 'readiness';
    const config = document.querySelector('[data-manager-view-target="configuration"]');
    config?.click();
    queueMicrotask(() => showStep(activeStep));
  }

  function patchOverview() {
    for (const button of document.querySelectorAll('[data-overview-view="maintenance"]')) {
      button.dataset.overviewView = 'configuration';
      button.textContent = 'Open Configuration';
    }
  }

  function build() {
    if (built) return;
    const configuration = document.querySelector('[data-manager-view="configuration"]');
    const integration = document.querySelector('[data-manager-view="integration"]');
    const maintenance = document.querySelector('[data-manager-view="maintenance"]');
    if (!configuration) return;
    built = true;

    const editable = [...configuration.querySelectorAll('section.card')]
      .find((card) => card.querySelector('#config-form'));
    if (editable) editable.dataset.managerConfigEditCard = 'true';
    markConfigGroups(editable);
    enhanceAutoMergeSetting();
    prepareModelSelects();

    const tabs = document.createElement('div');
    tabs.className = 'manager-config-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Configuration setup steps');
    for (const [id, label] of STEPS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'manager-config-tab'; button.dataset.configTab = id;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false'); button.textContent = label;
      button.addEventListener('click', () => showStep(id));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const index = STEPS.findIndex(([step]) => step === id);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = STEPS[(index + direction + STEPS.length) % STEPS.length][0];
        showStep(next, { focus: true });
      });
      tabs.append(button);
    }
    configuration.prepend(tabs);

    moveViewCards(integration, configuration, 'repository');
    moveViewCards(maintenance, configuration, 'readiness');
    simplifyRepositoryIntegration();
    buildReadiness(configuration);
    patchOverview();
    showStep(activeStep);
    redirectLegacyViews();

    document.getElementById('review-workflow')?.addEventListener('change', () => {
      queueMicrotask(() => { syncAutoMergeSetting(); showStep(activeStep); renderCurrentReadiness(); });
    });

    const title = document.getElementById('manager-view-title');
    const description = document.getElementById('manager-view-description');
    const navObserver = document.querySelector('.manager-sidebar-nav');
    if (navObserver) {
      new MutationObserver(() => {
        const current = document.querySelector('[data-manager-view-target][aria-current="page"]')?.dataset.managerViewTarget;
        if (current === 'configuration') {
          if (title) title.textContent = 'Configuration';
          if (description) description.textContent = 'Current repository settings and readiness for autonomous work.';
          showStep(activeStep);
        } else if (current === 'integration' || current === 'maintenance') redirectLegacyViews();
      }).observe(navObserver, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    }
  }

  if (typeof window.addManagerStatusListener === 'function') {
    window.addManagerStatusListener((data) => {
      syncAutoMergeSetting();
      renderRepositoryIntegration(data);
      renderReadiness(data);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithConfigurationTabs(html) {
  const styled = injectIntoHead(html, `<style data-manager-configuration-tabs-style>${MANAGER_CONFIGURATION_TABS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-configuration-tabs>${MANAGER_CONFIGURATION_TABS_SCRIPT}</script>`);
}
