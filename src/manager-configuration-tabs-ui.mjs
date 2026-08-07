import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_CONFIGURATION_TABS_STYLE = String.raw`
.manager-config-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px;margin-bottom:14px;border:1px solid #293445;border-radius:12px;background:#111821}
.manager-config-tab{flex:0 0 auto;border:0!important;background:transparent!important;color:#9aabc0!important;border-radius:9px!important;padding:9px 12px!important;font-weight:650!important;white-space:nowrap}
.manager-config-tab:hover{background:#1a2432!important;color:#eef2f7!important}
.manager-config-tab[aria-selected="true"]{background:#243044!important;color:#fff!important}
.manager-config-step-link{display:flex;align-items:center;justify-content:space-between;gap:16px}
.manager-config-step-link h2{margin-bottom:5px}.manager-config-step-link p{margin:0;color:var(--paseo-muted);line-height:1.45}
.manager-config-step-link .paseo-action{flex:0 0 auto}
[data-manager-view-target="integration"],[data-manager-view-target="maintenance"]{display:none!important}
@media(max-width:720px){.manager-config-step-link{display:block}.manager-config-step-link .paseo-action{display:inline-flex;margin-top:12px}.manager-config-tabs{margin-inline:-2px}}
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
    ['Provider/Coding Harness', 'harness'],
    ['Review model', 'harness'],
    ['Runtime', 'repository'],
    ['Issue processing', 'issues'],
    ['Review workflow', 'review'],
  ]);
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

  function showStep(step, { focus = false } = {}) {
    if (!STEPS.some(([id]) => id === step)) step = 'paseo';
    activeStep = step;
    localStorage.setItem('paseo-manager-config-tab', step);
    for (const button of document.querySelectorAll('.manager-config-tab')) {
      const selected = button.dataset.configTab === step;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
    for (const element of document.querySelectorAll('[data-config-step]')) element.hidden = element.dataset.configStep !== step;

    const configCard = document.querySelector('[data-manager-config-edit-card]');
    const groups = [...(configCard?.querySelectorAll('[data-config-step-group]') || [])];
    const editable = groups.some((group) => group.dataset.configStepGroup === step);
    if (configCard) {
      configCard.hidden = !editable;
      setConfigCardTitle(configCard, step);
      for (const group of groups) group.hidden = group.dataset.configStepGroup !== step;
    }
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

    for (const [id] of STEPS) {
      const linkCard = setupLinkCard(id);
      if (linkCard) tabs.after(linkCard);
    }

    moveViewCards(integration, configuration, 'repository');
    moveViewCards(maintenance, configuration, 'readiness');
    patchOverview();
    showStep(activeStep);
    redirectLegacyViews();

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithConfigurationTabs(html) {
  const styled = injectIntoHead(html, `<style data-manager-configuration-tabs-style>${MANAGER_CONFIGURATION_TABS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-configuration-tabs>${MANAGER_CONFIGURATION_TABS_SCRIPT}</script>`);
}
