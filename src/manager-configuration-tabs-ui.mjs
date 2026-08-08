import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_CONFIGURATION_TABS_STYLE = String.raw`
.manager-config-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px;margin-bottom:14px;border:1px solid #293445;border-radius:12px;background:#111821}
.manager-config-tab{flex:0 0 auto;border:0!important;background:transparent!important;color:#9aabc0!important;border-radius:9px!important;padding:9px 12px!important;font-weight:650!important;white-space:nowrap}
.manager-config-tab:hover{background:#1a2432!important;color:#eef2f7!important}
.manager-config-tab[aria-selected="true"]{background:#243044!important;color:#fff!important}
.manager-config-step-link{display:flex;align-items:center;justify-content:space-between;gap:16px}
.manager-config-step-link h2{margin-bottom:5px}.manager-config-step-link p{margin:0;color:var(--paseo-muted);line-height:1.45}
.manager-config-step-link .paseo-action{flex:0 0 auto}
[data-config-step][hidden],[data-config-step-group][hidden],[data-manager-config-edit-card][hidden]{display:none!important}
[data-manager-view-target="integration"],[data-manager-view-target="maintenance"]{display:none!important}
.manager-config-fields .manager-auto-merge-setting{grid-column:1/-1!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:16px!important;align-items:center!important;margin-top:4px!important;padding:14px 16px!important;border:1px solid #334156;border-radius:11px;background:#101925;color:var(--paseo-text)!important;cursor:pointer;transition:border-color .15s ease,background .15s ease}
.manager-config-fields .manager-auto-merge-setting:hover{border-color:#43526a;background:#141e2b}.manager-config-fields .manager-auto-merge-setting[aria-disabled="true"]{cursor:not-allowed;opacity:.72}
.manager-auto-merge-copy{display:grid;gap:5px;min-width:0}.manager-auto-merge-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.manager-auto-merge-heading strong{font-size:14px;color:var(--paseo-text)}
.manager-auto-merge-state{display:inline-flex;align-items:center;border:1px solid #526074;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:750;letter-spacing:.02em;color:#aab8c9;background:#182231}.manager-auto-merge-state.enabled{border-color:#2f8d55;background:#163424;color:#b9e9ca}.manager-auto-merge-state.disabled{border-color:#526074;background:#182231;color:#aab8c9}.manager-auto-merge-state.unavailable{border-color:#6c5b35;background:#2b2515;color:#e2cf91}
.manager-auto-merge-help{margin:0!important;padding:0!important;border:0!important;background:transparent!important;color:var(--paseo-muted)!important;font-size:12px!important;line-height:1.45!important}
.manager-auto-merge-switch{position:relative;width:46px;height:26px;flex:0 0 auto}.manager-auto-merge-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:2}.manager-auto-merge-switch input:disabled{cursor:not-allowed}.manager-auto-merge-track{position:absolute;inset:0;border:1px solid #526074;border-radius:999px;background:#202b39;transition:background .15s ease,border-color .15s ease}.manager-auto-merge-track::after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#c8d3e0;transition:transform .15s ease,background .15s ease}.manager-auto-merge-switch input:checked + .manager-auto-merge-track{background:#2f6fed;border-color:#5f8ff3}.manager-auto-merge-switch input:checked + .manager-auto-merge-track::after{transform:translateX(20px);background:#fff}.manager-auto-merge-switch input:focus-visible + .manager-auto-merge-track{outline:2px solid #8ab8ff;outline-offset:3px}.manager-auto-merge-setting[aria-disabled="true"] .manager-auto-merge-track{opacity:.55}
@media(max-width:720px){.manager-config-step-link{display:block}.manager-config-step-link .paseo-action{display:inline-flex;margin-top:12px}.manager-config-tabs{margin-inline:-2px}.manager-config-fields .manager-auto-merge-setting{grid-template-columns:minmax(0,1fr) auto!important;padding:13px!important}}
`;

export const MANAGER_CONFIGURATION_TABS_SCRIPT = String.raw`
(function managerConfigurationTabs() {
  const STEPS = [
    ['paseo', 'Connect Paseo', '/setup/paseo', 'Change the Paseo daemon connection, authentication, and compatibility checks.'],
    ['harness', 'Coding harness', '/setup/harness', 'Change the Provider/Coding Harness plus coding and review model selections.'],
    ['repository', 'GitHub repository', '/setup/repository', 'Change repository/base-branch setup and inspect manager-owned repository integration.'],
    ['issues', 'Issues setup', '/setup/issues', 'Change issue selection, concurrency, retries, exclusions, and polling behavior.'],
    ['review', 'Review setup', '/setup/review', 'Change the review workflow, review limits, auto-merge policy, and Web ChatGPT profile settings.'],
    ['readiness', 'Final readiness', '/setup/readiness', 'Review health, managed installation state, repair, removal, and recovery controls.'],
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

  function setupLinkCard(step) {
    const meta = STEPS.find(([id]) => id === step);
    if (!meta) return null;
    const [, label, path, description] = meta;
    const card = document.createElement('section');
    card.className = 'card manager-config-step-link';
    card.dataset.configStep = step;
    const copy = document.createElement('div');
    const heading = document.createElement('h2'); heading.textContent = label;
    const text = document.createElement('p'); text.textContent = description;
    copy.append(heading, text);
    const link = document.createElement('a');
    link.className = 'paseo-action'; link.href = path; link.textContent = 'Edit this setup step';
    card.append(copy, link);
    return card;
  }

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
      harness: 'Coding harness settings',
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
    document.dispatchEvent(new CustomEvent('paseo:configuration-tab', { detail: { step } }));
    if (focus) document.querySelector('.manager-config-tab[aria-selected="true"]')?.focus();
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

    let insertionPoint = tabs;
    for (const [id] of STEPS) {
      const linkCard = setupLinkCard(id);
      if (!linkCard) continue;
      insertionPoint.after(linkCard);
      insertionPoint = linkCard;
    }

    moveViewCards(integration, configuration, 'repository');
    moveViewCards(maintenance, configuration, 'readiness');
    patchOverview();
    showStep(activeStep);
    redirectLegacyViews();

    document.getElementById('review-workflow')?.addEventListener('change', () => {
      queueMicrotask(() => { syncAutoMergeSetting(); showStep(activeStep); });
    });

    const title = document.getElementById('manager-view-title');
    const description = document.getElementById('manager-view-description');
    const navObserver = document.querySelector('.manager-sidebar-nav');
    if (navObserver) {
      new MutationObserver(() => {
        const current = document.querySelector('[data-manager-view-target][aria-current="page"]')?.dataset.managerViewTarget;
        if (current === 'configuration') {
          if (title) title.textContent = 'Configuration';
          if (description) description.textContent = 'Setup-aligned repository settings, integration, health, and recovery.';
          showStep(activeStep);
        } else if (current === 'integration' || current === 'maintenance') redirectLegacyViews();
      }).observe(navObserver, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    }
  }

  const previousRenderStatus = window.renderStatus;
  if (typeof previousRenderStatus === 'function') {
    window.renderStatus = function managerConfigurationTabsRenderStatus(data) {
      const result = previousRenderStatus(data);
      syncAutoMergeSetting();
      return result;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithConfigurationTabs(html) {
  const styled = injectIntoHead(html, `<style data-manager-configuration-tabs-style>${MANAGER_CONFIGURATION_TABS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-configuration-tabs>${MANAGER_CONFIGURATION_TABS_SCRIPT}</script>`);
}
