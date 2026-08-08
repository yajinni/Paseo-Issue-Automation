import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_VIEW_IDS = Object.freeze([
  'overview',
  'work-queue',
  'automation',
  'reviews',
  'configuration',
  'integration',
  'maintenance',
  'manager-settings',
]);

export const MANAGER_NAVIGATION_STYLE = String.raw`
.shell{max-width:none!important;padding:0!important}
.manager-app-shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
.manager-sidebar{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--paseo-border);background:#111821;padding:18px 14px;z-index:80}
.manager-sidebar-brand{padding:4px 8px 16px;border-bottom:1px solid var(--paseo-border)}
.manager-sidebar-brand .eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#93a4b8}
.manager-sidebar-brand strong{display:block;font-size:17px;margin-top:4px}
.manager-repository-context{padding:16px 8px;border-bottom:1px solid var(--paseo-border)}
.manager-repository-context label{display:block;font-size:12px;font-weight:650;color:var(--paseo-muted);margin-bottom:7px}
.manager-repository-context select{width:100%;min-width:0}
.manager-repository-context .manager-setup-link{display:flex;justify-content:center;width:100%;margin-top:9px}
.manager-sidebar-group{padding:15px 4px 0}
.manager-sidebar-heading{padding:0 8px 7px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#718298;font-weight:700}
.manager-nav-button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;text-align:left;border:0!important;background:transparent!important;color:#9aabc0!important;padding:10px!important;border-radius:9px!important;font-weight:650!important}
.manager-nav-button:hover{background:#1a2432!important;color:var(--paseo-text)!important}
.manager-nav-button[aria-current="page"]{background:var(--paseo-selected)!important;color:#fff!important}
.manager-nav-badge{display:none;min-width:20px;height:20px;padding:0 6px;border:1px solid #526074;border-radius:999px;align-items:center;justify-content:center;font-size:11px;color:#dbe7f7;background:#182231}
.manager-nav-badge.visible{display:inline-flex}.manager-nav-badge.attention{border-color:#8c4945;background:#5f302d}
.manager-main{min-width:0;padding:24px;max-width:1440px;width:100%;margin:0 auto}
.manager-content-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}
.manager-content-title-row{display:flex;gap:10px;align-items:flex-start}.manager-content-header h1{font-size:28px;margin:0 0 6px}.manager-content-header p{margin:0;color:var(--paseo-muted);line-height:1.45}
.manager-content-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.manager-current-repository{font-size:12px;color:#8fa0b4;margin-top:5px}
.manager-last-updated{font-size:12px;color:#718298;white-space:nowrap}
.manager-mobile-menu{display:none!important;padding:9px 11px!important;min-width:42px}
.manager-view{display:grid;gap:14px}.manager-view[hidden]{display:none!important}
.manager-view>.card,.manager-view>.manager-overview{margin:0!important;width:100%}
.manager-view-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.manager-view-grid>.wide{grid-column:1/-1}
.manager-view .card.wide{grid-column:auto}
.manager-view-empty{padding:22px;border:1px dashed #344153;border-radius:12px;color:var(--paseo-muted);background:#111821}
.manager-review-summary .facts{margin-bottom:0}
.manager-sidebar-scrim{display:none}
.manager-overview-support{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.manager-overview-support .card{margin:0!important}.overview-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.overview-card-head h2{margin-bottom:5px}.overview-card-head p{margin:0;color:var(--paseo-muted);font-size:13px;line-height:1.4}
.overview-summary-list{display:grid;gap:8px;margin-top:14px}.overview-summary-row{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid #253042}.overview-summary-row:last-child{border-bottom:0}.overview-summary-row span{color:var(--paseo-muted)}.overview-summary-row strong{text-align:right;overflow-wrap:anywhere}
.overview-latest-result{margin-top:12px;padding:11px 12px;border:1px solid #2d394b;border-radius:9px;background:#0f1620;color:#b9c7d8;line-height:1.45}.overview-latest-result strong{color:var(--paseo-text)}
.overview-quick-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
#mode-banner{margin-bottom:16px}
@media(max-width:900px){
  .manager-app-shell{grid-template-columns:1fr}
  .manager-sidebar{position:fixed;left:0;top:0;bottom:0;width:min(300px,86vw);height:100vh;transform:translateX(-105%);transition:transform .18s ease;box-shadow:14px 0 45px #0008}
  body.manager-sidebar-open .manager-sidebar{transform:translateX(0)}
  .manager-sidebar-scrim{position:fixed;inset:0;z-index:70;border:0!important;border-radius:0!important;background:#05070a99!important;padding:0!important}
  body.manager-sidebar-open .manager-sidebar-scrim{display:block}
  .manager-main{padding:18px}
  .manager-mobile-menu{display:inline-flex!important}
  .manager-content-header{align-items:center}
  .manager-content-header h1{font-size:24px}
}
@media(max-width:720px){.manager-overview-support{grid-template-columns:1fr}}
@media(max-width:640px){
  .manager-main{padding:14px}.manager-content-header{display:block}.manager-content-title-row{align-items:flex-start}.manager-content-actions{margin-top:12px;padding-left:52px}.manager-view-grid{grid-template-columns:1fr}
}
`;

export const MANAGER_NAVIGATION_SCRIPT = String.raw`
(function managerNavigationShell() {
  const VIEW_META = {
    overview: { title: 'Overview', description: 'Repository health, readiness, and the most important next action.' },
    'work-queue': { title: 'Work Queue', description: 'Issue execution controls and the latest dispatch result.' },
    automation: { title: 'Automation', description: 'Claims, coding workers, PR-review workers, and repository scheduling.' },
    reviews: { title: 'Reviews', description: 'Review workflow, worker state, models, and round limits.' },
    configuration: { title: 'Configuration', description: 'Edit post-setup repository automation settings.' },
    integration: { title: 'Integration', description: 'Standalone-manager installation, setup PRs, and migration state.' },
    maintenance: { title: 'Maintenance', description: 'Repository health, repair, removal, reconciliation, and recovery tools.' },
    'manager-settings': { title: 'Manager Settings', description: 'Machine-wide coding capacity and manager scheduling.' },
  };
  const VIEW_IDS = Object.keys(VIEW_META);
  const NAV_GROUPS = [
    ['Repository', [
      ['overview', 'Overview'], ['work-queue', 'Work Queue'], ['automation', 'Automation'], ['reviews', 'Reviews'],
      ['configuration', 'Configuration'], ['integration', 'Integration'], ['maintenance', 'Maintenance'],
    ]],
    ['Manager', [['manager-settings', 'Manager Settings']]],
  ];
  let activeView = 'overview';
  let lastUpdatedAt = null;

  function panelByHeading(root, heading) {
    for (const panel of root.querySelectorAll('section.card')) {
      const title = panel.querySelector('h2');
      if (title && title.textContent.trim() === heading) return panel;
    }
    return null;
  }

  function buildNav() {
    const nav = document.createElement('nav');
    nav.className = 'manager-sidebar-nav';
    nav.setAttribute('aria-label', 'Manager sections');
    for (const [groupName, entries] of NAV_GROUPS) {
      const group = document.createElement('div');
      group.className = 'manager-sidebar-group';
      const heading = document.createElement('div');
      heading.className = 'manager-sidebar-heading';
      heading.textContent = groupName;
      group.append(heading);
      for (const [id, label] of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'manager-nav-button';
        button.dataset.managerViewTarget = id;
        button.setAttribute('aria-current', 'false');
        const text = document.createElement('span');
        text.textContent = label;
        const badge = document.createElement('span');
        badge.className = 'manager-nav-badge';
        badge.dataset.managerBadge = id;
        badge.setAttribute('aria-hidden', 'true');
        button.append(text, badge);
        button.addEventListener('click', () => showView(id, { historyMode: 'push', focusHeading: true }));
        group.append(button);
      }
      nav.append(group);
    }
    return nav;
  }

  function createView(id) {
    const section = document.createElement('section');
    section.className = 'manager-view';
    section.dataset.managerView = id;
    section.hidden = id !== 'overview';
    section.setAttribute('aria-labelledby', 'manager-view-title');
    return section;
  }

  function appendPanel(view, panel, moved) {
    if (!panel || moved.has(panel)) return;
    moved.add(panel);
    view.append(panel);
  }

  function reviewSummaryCard() {
    const card = document.createElement('section');
    card.className = 'card manager-review-summary';
    card.innerHTML = '<h2>Review status</h2><dl class="facts" id="manager-review-summary-facts"><dt>Workflow</dt><dd>Loading…</dd></dl>';
    return card;
  }

  function overviewSupport() {
    const root = document.createElement('div');
    root.className = 'manager-overview-support';
    root.innerHTML = '<section class="card" id="overview-current-work-card">'
      + '<div class="overview-card-head"><div><h2>Current work</h2><p>Live repository workload from the manager state.</p></div></div>'
      + '<div class="overview-summary-list" id="overview-current-work"><div class="muted">Loading…</div></div>'
      + '<div class="overview-quick-actions"><button type="button" class="secondary" data-overview-view="work-queue">Open Work Queue</button><button type="button" class="secondary" data-overview-view="reviews">Open Reviews</button></div></section>'
      + '<section class="card" id="overview-recent-activity-card">'
      + '<div class="overview-card-head"><div><h2>Latest controller activity</h2><p>The most recent scheduler action already recorded by this repository.</p></div></div>'
      + '<div class="overview-summary-list" id="overview-recent-activity"><div class="muted">Loading…</div></div>'
      + '<div class="overview-latest-result" id="overview-latest-result"><strong>Latest result</strong><div>No dispatch has been recorded.</div></div>'
      + '<div class="overview-quick-actions"><button type="button" class="secondary" data-overview-view="automation">Open Automation</button><button type="button" class="secondary" data-overview-view="maintenance">Open Maintenance</button></div></section>';
    root.querySelectorAll('[data-overview-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.overviewView, { historyMode: 'push', focusHeading: true })));
    return root;
  }

  function reviewWorkflowLabel(workflow) {
    if (workflow === 'quick-manual') return 'Quick → Manual';
    if (workflow === 'quick-web-chatgpt') return 'Quick → Web ChatGPT';
    if (workflow === 'full-immediate') return 'Full review immediately';
    return workflow || 'Not configured';
  }

  function renderPairs(targetId, entries) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.textContent = '';
    for (const [label, value] of entries) {
      const row = document.createElement('div');
      row.className = 'overview-summary-row';
      const name = document.createElement('span'); name.textContent = label;
      const result = document.createElement('strong'); result.textContent = value == null || value === '' ? 'None' : String(value);
      row.append(name, result);
      target.append(row);
    }
  }

  function renderReviewSummary(data) {
    const target = document.getElementById('manager-review-summary-facts');
    if (!target || !data) return;
    const review = data.configuration?.review || {};
    const entries = [
      ['Workflow', reviewWorkflowLabel(review.workflow)],
      ['PR-review worker', data.reviewWorker?.running ? 'Running' : 'Stopped'],
      ['Reviewer model', data.models?.reviewer || 'Not configured'],
      ['Reviewer thinking', data.models?.reviewerThinking || 'Default'],
      ['Quick review limit', review.quickMaxRounds ?? 'Not configured'],
      ['Full review limit', review.fullMaxRounds ?? 'Not configured'],
      ['Approved PR auto-merge', review.autoMergeApproved ? 'Enabled' : 'Disabled'],
    ];
    target.textContent = '';
    for (const [label, value] of entries) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = String(value);
      target.append(dt, dd);
    }
  }

  function dispatchSummary(result) {
    if (!result) return 'No dispatch has been recorded.';
    if (typeof result === 'string') return result;
    const issue = result.issueNumber || result.issue || result.number;
    const text = result.message || result.summary || result.reason || result.status || result.action;
    if (issue && text) return 'Issue #' + issue + ' · ' + text;
    if (text) return String(text);
    if (issue) return 'Issue #' + issue + ' was the latest dispatch target.';
    return 'A controller action completed. Open Work Queue or Automation for current state.';
  }

  function statusBreakdown(statusCounts) {
    const counts = Object.entries(statusCounts || {}).filter(([, count]) => Number(count) > 0);
    if (!counts.length) return 'No recorded run states';
    return counts.slice(0, 4).map(([status, count]) => status + ': ' + count).join(' · ');
  }

  function renderOverview(data) {
    const automation = data.automation || {};
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    const attentionCount = blockers.filter((item) => item.severity === 'error' || item.severity === 'warning').length;
    renderPairs('overview-current-work', [
      ['Active automation', Number(automation.activeRunCount || 0) + ' active'],
      ['Recorded runs', Number(automation.runCount || 0)],
      ['Run states', statusBreakdown(automation.statusCounts)],
      ['Claims', automation.claimsEnabled ? 'Enabled' : 'Paused'],
    ]);
    renderPairs('overview-recent-activity', [
      ['Last dispatch', automation.lastDispatchAt ? new Date(automation.lastDispatchAt).toLocaleString() : 'Not yet'],
      ['Coding worker', data.worker?.running ? 'Running' : 'Stopped'],
      ['PR-review worker', data.reviewWorker?.running ? 'Running' : 'Stopped'],
      ['Needs attention', attentionCount],
    ]);
    const latest = document.getElementById('overview-latest-result');
    if (latest) {
      latest.textContent = '';
      const title = document.createElement('strong'); title.textContent = 'Latest result';
      const detail = document.createElement('div'); detail.textContent = dispatchSummary(automation.lastDispatchResult);
      latest.append(title, detail);
    }
    lastUpdatedAt = Date.now();
    renderLastUpdated();
    setBadge('work-queue', Number(automation.activeRunCount || 0), false);
    setBadge('maintenance', attentionCount, attentionCount > 0);
  }

  function setBadge(viewId, value, attention) {
    const badge = document.querySelector('[data-manager-badge="' + viewId + '"]');
    if (!badge) return;
    const count = Number(value || 0);
    badge.textContent = String(count);
    badge.classList.toggle('visible', count > 0);
    badge.classList.toggle('attention', attention && count > 0);
  }

  function renderLastUpdated() {
    const target = document.getElementById('manager-last-updated');
    if (!target || !lastUpdatedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000));
    target.textContent = seconds < 5 ? 'Updated just now' : 'Updated ' + seconds + 's ago';
  }

  function renderSidebarState(data) {
    if (!data) return;
    const label = document.getElementById('manager-current-repository');
    if (label) {
      const name = data.repository?.repository || data.repository?.name || 'Selected repository';
      const branch = data.setup?.baseBranch || data.repository?.branch || '';
      label.textContent = branch ? name + ' · ' + branch : name;
    }
    renderReviewSummary(data);
    renderOverview(data);
  }

  function closeSidebar() {
    document.body.classList.remove('manager-sidebar-open');
    const toggle = document.getElementById('manager-mobile-menu');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function openSidebar() {
    document.body.classList.add('manager-sidebar-open');
    const toggle = document.getElementById('manager-mobile-menu');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function viewFromLocation() {
    const candidate = new URL(location.href).searchParams.get('view');
    return VIEW_IDS.includes(candidate) ? candidate : 'overview';
  }

  function showView(id, { historyMode = 'none', focusHeading = false } = {}) {
    if (!VIEW_IDS.includes(id)) id = 'overview';
    activeView = id;
    for (const view of document.querySelectorAll('[data-manager-view]')) view.hidden = view.dataset.managerView !== id;
    for (const button of document.querySelectorAll('[data-manager-view-target]')) button.setAttribute('aria-current', button.dataset.managerViewTarget === id ? 'page' : 'false');
    const meta = VIEW_META[id];
    const title = document.getElementById('manager-view-title');
    const description = document.getElementById('manager-view-description');
    if (title) title.textContent = meta.title;
    if (description) description.textContent = meta.description;
    if (historyMode !== 'none') {
      const url = new URL(location.href);
      if (id === 'overview') url.searchParams.delete('view');
      else url.searchParams.set('view', id);
      history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ managerView: id }, '', url);
    }
    closeSidebar();
    if (focusHeading && title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  }

  function buildShell() {
    const shell = document.querySelector('main.shell');
    if (!shell || shell.dataset.managerNavigationReady === 'true') return;
    shell.dataset.managerNavigationReady = 'true';

    const oldHeader = shell.querySelector('.header');
    const select = document.getElementById('repository-select');
    const setupLink = shell.querySelector('[data-manager-setup-link]');
    const refreshButton = document.getElementById('refresh-button');
    const banner = document.getElementById('mode-banner');
    const overview = shell.querySelector('.manager-overview');
    const advancedRegistration = shell.querySelector('.manager-manual-registration');
    const repositoryHealth = document.getElementById('repository-health-panel');
    const maintenance = document.getElementById('repository-maintenance-panel');

    const views = Object.fromEntries(VIEW_IDS.map((id) => [id, createView(id)]));
    const moved = new Set();

    appendPanel(views.overview, overview, moved);
    views.overview.append(overviewSupport());

    appendPanel(views['work-queue'], panelByHeading(shell, 'Manual issue action'), moved);
    appendPanel(views['work-queue'], panelByHeading(shell, 'Latest action result'), moved);

    appendPanel(views.automation, panelByHeading(shell, 'Automation'), moved);
    appendPanel(views.automation, panelByHeading(shell, 'Automation controls'), moved);

    appendPanel(views.reviews, reviewSummaryCard(), moved);

    appendPanel(views.configuration, panelByHeading(shell, 'Configuration'), moved);

    appendPanel(views.integration, panelByHeading(shell, 'Repository'), moved);
    appendPanel(views.integration, panelByHeading(shell, 'Setup'), moved);
    appendPanel(views.integration, panelByHeading(shell, 'Repository integration'), moved);

    appendPanel(views.maintenance, repositoryHealth, moved);
    appendPanel(views.maintenance, maintenance, moved);
    appendPanel(views.maintenance, advancedRegistration, moved);

    appendPanel(views['manager-settings'], panelByHeading(shell, 'Manager-wide coding capacity'), moved);

    for (const panel of shell.querySelectorAll('section.card')) {
      if (!moved.has(panel)) appendPanel(views.maintenance, panel, moved);
    }

    for (const [id, view] of Object.entries(views)) {
      if (!view.children.length) {
        const empty = document.createElement('div');
        empty.className = 'manager-view-empty';
        empty.textContent = id === 'work-queue'
          ? 'No work controls are available for the selected repository yet.'
          : 'No information is available for this view yet.';
        view.append(empty);
      }
    }

    const sidebar = document.createElement('aside');
    sidebar.className = 'manager-sidebar';
    sidebar.id = 'manager-sidebar';
    sidebar.innerHTML = '<div class="manager-sidebar-brand"><div class="eyebrow">Paseo Issue Automation</div><strong>Repository Manager</strong></div>';

    const repositoryContext = document.createElement('div');
    repositoryContext.className = 'manager-repository-context';
    const repositoryLabel = document.createElement('label');
    repositoryLabel.htmlFor = 'repository-select';
    repositoryLabel.textContent = 'Repository';
    if (select) repositoryContext.append(repositoryLabel, select);
    if (setupLink) repositoryContext.append(setupLink);
    sidebar.append(repositoryContext, buildNav());

    const main = document.createElement('div');
    main.className = 'manager-main';
    const header = document.createElement('header');
    header.className = 'manager-content-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'manager-content-title-row';
    const mobile = document.createElement('button');
    mobile.type = 'button';
    mobile.className = 'manager-mobile-menu secondary';
    mobile.id = 'manager-mobile-menu';
    mobile.setAttribute('aria-controls', 'manager-sidebar');
    mobile.setAttribute('aria-expanded', 'false');
    mobile.setAttribute('aria-label', 'Open navigation');
    mobile.textContent = '☰';
    mobile.addEventListener('click', () => document.body.classList.contains('manager-sidebar-open') ? closeSidebar() : openSidebar());
    const headingBox = document.createElement('div');
    headingBox.innerHTML = '<h1 id="manager-view-title">Overview</h1><p id="manager-view-description"></p><div class="manager-current-repository" id="manager-current-repository"></div>';
    titleRow.append(mobile, headingBox);
    const headerActions = document.createElement('div');
    headerActions.className = 'manager-content-actions';
    const updated = document.createElement('span');
    updated.className = 'manager-last-updated';
    updated.id = 'manager-last-updated';
    updated.setAttribute('aria-live', 'polite');
    if (refreshButton) headerActions.append(refreshButton);
    headerActions.append(updated);
    header.append(titleRow, headerActions);
    main.append(header);
    if (banner) main.append(banner);
    const viewRoot = document.createElement('div');
    viewRoot.className = 'manager-view-root';
    for (const id of VIEW_IDS) viewRoot.append(views[id]);
    main.append(viewRoot);

    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'manager-sidebar-scrim';
    scrim.setAttribute('aria-label', 'Close navigation');
    scrim.addEventListener('click', closeSidebar);

    const app = document.createElement('div');
    app.className = 'manager-app-shell';
    app.append(sidebar, main);
    shell.replaceChildren(app, scrim);
    if (oldHeader) oldHeader.remove();

    select?.addEventListener('change', () => {
      const label = document.getElementById('manager-current-repository');
      if (label) label.textContent = select.options[select.selectedIndex]?.textContent || '';
    });

    const initial = viewFromLocation();
    showView(initial, { historyMode: initial === 'overview' && new URL(location.href).searchParams.has('view') ? 'replace' : 'none' });
    try { if (typeof currentStatus !== 'undefined' && currentStatus) renderSidebarState(currentStatus); } catch {}
  }

  if (typeof window.addManagerStatusListener === 'function') {
    window.addManagerStatusListener(renderSidebarState);
  }

  window.showManagerView = (id) => showView(id, { historyMode: 'push', focusHeading: true });
  window.addEventListener('popstate', () => showView(viewFromLocation(), { historyMode: 'none' }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSidebar(); });
  setInterval(renderLastUpdated, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildShell, { once: true });
  else buildShell();
})();
`;

export function enhanceManagerWithNavigation(html) {
  const themed = injectIntoHead(html, `<style data-manager-navigation-style>${MANAGER_NAVIGATION_STYLE}</style>`);
  return injectIntoBody(themed, `<script data-manager-navigation>${MANAGER_NAVIGATION_SCRIPT}</script>`);
}
