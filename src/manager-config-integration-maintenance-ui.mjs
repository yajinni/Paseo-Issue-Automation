import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_CONFIG_INTEGRATION_STYLE = String.raw`
.manager-config-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.manager-config-group{background:var(--paseo-card-alt);border:1px solid #2d394b;border-radius:12px;padding:14px}
.manager-config-group.wide{grid-column:1/-1}.manager-config-group h3{margin:0 0 5px;font-size:15px}.manager-config-group>p{margin:0 0 12px;color:var(--paseo-muted);font-size:13px;line-height:1.4}
.manager-config-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.manager-config-fields label{display:grid;gap:5px;color:var(--paseo-muted)}
.manager-config-savebar{position:sticky;bottom:12px;z-index:25;margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #39485e;border-radius:11px;padding:10px 12px;background:#101720eF;backdrop-filter:blur(8px)}
.manager-config-savebar.clean{opacity:.8}.manager-config-savebar.dirty{border-color:#66572f;background:#211d12f2}.manager-config-save-copy{font-size:13px;color:var(--paseo-muted)}.manager-config-savebar.dirty .manager-config-save-copy{color:#e2cf91}
.manager-config-save-actions{display:flex;gap:8px;flex-wrap:wrap}
.manager-context-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.manager-context-grid>.wide{grid-column:1/-1}
.manager-context-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;margin-top:12px}.manager-context-summary div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #263143;padding:8px 0}.manager-context-summary span{color:var(--paseo-muted)}.manager-context-summary strong{text-align:right;overflow-wrap:anywhere}
.manager-context-note{margin-top:12px;padding:10px 12px;border:1px solid #334156;border-radius:9px;background:#111a26;color:var(--paseo-muted);line-height:1.45}
.manager-detail-disclosure{margin:0!important}.manager-detail-disclosure>summary{cursor:pointer;font-weight:650;color:#dce8fb}.manager-detail-disclosure-body{display:grid;gap:12px;margin-top:12px}.manager-detail-disclosure-body>.card{margin:0!important}
.manager-maintenance-summary-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
@media(max-width:760px){.manager-config-groups,.manager-context-grid,.manager-config-fields,.manager-context-summary{grid-template-columns:1fr}.manager-config-group.wide,.manager-context-grid>.wide{grid-column:auto}.manager-config-savebar{position:static;display:block}.manager-config-save-actions{margin-top:10px}}
`;

export const MANAGER_CONFIG_INTEGRATION_SCRIPT = String.raw`
(function managerConfigIntegrationMaintenance() {
  const CONFIG_GROUPS = [
    ['Provider/Coding Harness', 'Provider and model choices used for coding work.', ['coding-harness', 'coder-model', 'coder-thinking']],
    ['Review model', 'Reviewer model and thinking level. Workflow behavior is configured separately.', ['reviewer-model', 'reviewer-thinking']],
    ['Issue processing', 'Eligibility, concurrency, retry, and exclusion settings for repository issues.', ['issue-selection-mode', 'max-active', 'temporary-failure-retries', 'excluded-labels']],
    ['Review workflow', 'Quick/full review path, round limits, and optional exact-head auto-merge policy.', ['review-workflow', 'quick-review-rounds', 'full-review-rounds', 'auto-merge-approved']],
    ['Runtime', 'Repository branch and polling cadence.', ['base-branch', 'poll-interval']],
  ];
  let built = false;
  let baseline = null;

  function cardByHeading(root, heading) {
    if (!root) return null;
    for (const card of root.querySelectorAll('section.card')) if (card.querySelector('h2')?.textContent.trim() === heading) return card;
    return null;
  }

  function fieldContainerFor(id) {
    const input = document.getElementById(id);
    if (!input) return null;
    return input.closest('label') || input;
  }

  function snapshotConfigForm() {
    const form = document.getElementById('config-form');
    if (!form) return '';
    const values = [];
    for (const element of form.querySelectorAll('input,select')) {
      if (!element.id) continue;
      values.push([element.id, element.type === 'checkbox' ? element.checked : element.value]);
    }
    return JSON.stringify(values);
  }

  function validateConfigForm() {
    const errors = [];
    const integer = (id, min, max, label) => {
      const value = Number(document.getElementById(id)?.value);
      if (!Number.isInteger(value) || value < min || value > max) errors.push(label + ' must be ' + min + '–' + max + '.');
    };
    if (!String(document.getElementById('base-branch')?.value || '').trim()) errors.push('Base branch is required.');
    if (!String(document.getElementById('coding-harness')?.value || '').trim()) errors.push('Provider/Coding Harness is required.');
    integer('poll-interval', 60, 3600, 'Poll interval');
    integer('max-active', 1, 20, 'Maximum active issues');
    integer('temporary-failure-retries', 0, 20, 'Transient failure retries');
    integer('quick-review-rounds', 1, 20, 'Quick review rounds');
    integer('full-review-rounds', 1, 20, 'Full review rounds');
    return errors;
  }

  function renderDirtyState() {
    const bar = document.getElementById('manager-config-savebar');
    const copy = document.getElementById('manager-config-save-copy');
    const save = document.getElementById('manager-config-save');
    const discard = document.getElementById('manager-config-discard');
    if (!bar || !copy || !save || !discard) return;
    const dirty = baseline !== null && snapshotConfigForm() !== baseline;
    const errors = validateConfigForm();
    bar.classList.toggle('dirty', dirty);
    bar.classList.toggle('clean', !dirty);
    copy.textContent = errors.length ? errors[0] : dirty ? 'Unsaved configuration changes.' : 'Configuration matches the last server status.';
    save.disabled = !dirty || errors.length > 0;
    discard.disabled = !dirty;
  }

  function buildConfiguration() {
    const view = document.querySelector('[data-manager-view="configuration"]');
    const existing = cardByHeading(view, 'Configuration');
    const form = document.getElementById('config-form');
    if (!view || !existing || !form) return;
    existing.querySelector('h2').textContent = 'Repository configuration';
    const oldGrid = form.querySelector('.field-grid');
    const groups = document.createElement('div'); groups.className = 'manager-config-groups';
    for (const [title, description, ids] of CONFIG_GROUPS) {
      const group = document.createElement('section'); group.className = 'manager-config-group';
      if (title === 'Review workflow' || title === 'Runtime') group.classList.add('wide');
      const h3 = document.createElement('h3'); h3.textContent = title;
      const copy = document.createElement('p'); copy.textContent = description;
      const fields = document.createElement('div'); fields.className = 'manager-config-fields';
      for (const id of ids) {
        const field = fieldContainerFor(id);
        if (field) fields.append(field);
      }
      if (title === 'Review workflow') {
        const help = document.getElementById('auto-merge-help');
        if (help) fields.append(help);
      }
      group.append(h3, copy, fields); groups.append(group);
    }
    oldGrid?.replaceWith(groups);

    const existingActions = form.querySelector('.actions');
    const submit = existingActions?.querySelector('button[type="submit"]');
    const savebar = document.createElement('div'); savebar.id = 'manager-config-savebar'; savebar.className = 'manager-config-savebar clean';
    const saveCopy = document.createElement('div'); saveCopy.id = 'manager-config-save-copy'; saveCopy.className = 'manager-config-save-copy'; saveCopy.textContent = 'Configuration matches the last server status.';
    const actions = document.createElement('div'); actions.className = 'manager-config-save-actions';
    const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'secondary'; discard.id = 'manager-config-discard'; discard.textContent = 'Discard changes';
    if (submit) { submit.id = 'manager-config-save'; submit.textContent = 'Save configuration'; actions.append(discard, submit); }
    savebar.append(saveCopy, actions); existingActions?.replaceWith(savebar);
    form.addEventListener('input', renderDirtyState);
    form.addEventListener('change', renderDirtyState);
    discard.addEventListener('click', () => { try { if (typeof currentStatus !== 'undefined' && currentStatus) window.renderStatus(currentStatus); } catch {} });
  }

  function summaryRow(target, label, value) {
    const row = document.createElement('div'); const name = document.createElement('span'); const result = document.createElement('strong');
    name.textContent = label; result.textContent = value == null || value === '' ? 'None' : String(value); row.append(name, result); target.append(row);
  }

  function buildIntegration() {
    const view = document.querySelector('[data-manager-view="integration"]');
    if (!view) return;
    const repository = cardByHeading(view, 'Repository');
    const setup = cardByHeading(view, 'Setup');
    const integration = cardByHeading(view, 'Repository integration');
    const summary = document.createElement('section'); summary.className = 'card'; summary.id = 'manager-integration-summary-card';
    summary.innerHTML = '<h2>Integration summary</h2><p class="muted">Repository ownership, controller mode, setup state, and managed changes at a glance.</p><div id="manager-integration-summary" class="manager-context-summary"></div>';
    const note = document.createElement('div'); note.className = 'manager-context-note'; note.textContent = 'Integration actions only change manager-owned components. Embedded migration and removal continue to use reviewed pull requests before local ownership state changes.'; summary.append(note);
    if (integration) integration.querySelector('h2').textContent = 'Managed repository integration';
    const details = document.createElement('details'); details.className = 'card manager-detail-disclosure';
    const detailSummary = document.createElement('summary'); detailSummary.textContent = 'Repository and setup technical details';
    const body = document.createElement('div'); body.className = 'manager-detail-disclosure-body';
    if (repository) body.append(repository); if (setup) body.append(setup); details.append(detailSummary, body);
    view.prepend(summary);
    view.append(details);
  }

  function buildMaintenance() {
    const view = document.querySelector('[data-manager-view="maintenance"]');
    if (!view) return;
    const summary = document.createElement('section'); summary.className = 'card'; summary.id = 'manager-maintenance-summary-card';
    summary.innerHTML = '<h2>Health & recovery</h2><p class="muted">Current blockers and safe recovery paths for the selected repository.</p><div id="manager-maintenance-summary" class="manager-context-summary"></div>';
    view.prepend(summary);
    const registration = view.querySelector('[data-manager-manual-registration]');
    if (registration) registration.classList.add('manager-detail-disclosure');
  }

  function renderIntegration(data) {
    const target = document.getElementById('manager-integration-summary');
    if (!target) return;
    const setup = data.setup || {};
    const changes = setup.repositoryChanges || {};
    target.textContent = '';
    summaryRow(target, 'Controller mode', setup.externalController ? 'Standalone manager' : setup.embeddedController ? 'Embedded repository' : 'Not installed');
    summaryRow(target, 'Setup complete', setup.complete ? 'Yes' : 'No');
    summaryRow(target, 'Base branch', setup.baseBranch || 'Not configured');
    summaryRow(target, 'Workspace', setup.workspaceId || 'Not configured');
    summaryRow(target, 'Managed files', (changes.managedFiles || []).length);
    summaryRow(target, 'Pending managed files', (changes.expectedFiles || []).length);
    summaryRow(target, 'Unrelated changes', (changes.unexpectedFiles || []).length);
    summaryRow(target, 'Migration', setup.migration?.state || 'Not started');
  }

  function renderMaintenance(data) {
    const target = document.getElementById('manager-maintenance-summary');
    if (!target) return;
    const operational = data.operational || {};
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    const warnings = blockers.filter((item) => item.severity === 'warning').length;
    const errors = blockers.filter((item) => item.severity === 'error').length;
    target.textContent = '';
    summaryRow(target, 'Issue processing', operational.issueProcessing || 'Unknown');
    summaryRow(target, 'PR reviews', operational.prReviews || 'Unknown');
    summaryRow(target, 'Blocking conditions', operational.blockingCount || 0);
    summaryRow(target, 'Errors', errors);
    summaryRow(target, 'Warnings', warnings);
    summaryRow(target, 'Removal state', data.maintenance?.removal?.state || 'Not started');
  }

  function render(data) {
    if (!data) return;
    baseline = snapshotConfigForm();
    renderDirtyState();
    renderIntegration(data);
    renderMaintenance(data);
  }

  function build() {
    if (built) return;
    if (!document.querySelector('[data-manager-view="configuration"]')) return;
    built = true;
    buildConfiguration(); buildIntegration(); buildMaintenance();
    baseline = snapshotConfigForm(); renderDirtyState();
    try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
  }

  const previous = window.renderStatus;
  if (typeof previous === 'function') {
    window.renderStatus = function managerConfigIntegrationRenderStatus(data) {
      const result = previous(data);
      render(data);
      return result;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithConfigIntegrationMaintenance(html) {
  const styled = injectIntoHead(html, `<style data-manager-config-integration-style>${MANAGER_CONFIG_INTEGRATION_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-config-integration>${MANAGER_CONFIG_INTEGRATION_SCRIPT}</script>`);
}
