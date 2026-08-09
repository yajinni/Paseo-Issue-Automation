import { injectIntoBody } from './ui-html.mjs';

export const MANAGER_WEEKLY_LOGS_SCRIPT = String.raw`
(function managerWeeklyLogs() {
  if (window.__paseoManagerWeeklyLogs) return;
  window.__paseoManagerWeeklyLogs = true;

  const WINDOW_DAYS = 7;
  let latest = { events: [], categories: [], hasMore: false };
  let loading = false;

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function selectedRepositoryId() {
    return document.getElementById('repository-select')?.value || null;
  }

  function logsView() {
    return document.querySelector('[data-manager-view="logs"]');
  }

  function logsVisible() {
    return logsView()?.hidden === false && !document.hidden;
  }

  function setHeader() {
    const title = document.getElementById('manager-view-title');
    const description = document.getElementById('manager-view-description');
    if (title) title.textContent = 'Logs';
    if (description) description.textContent = 'Operational history for the selected repository from the last 7 days.';
  }

  function showLogs({ historyMode = 'push', focusHeading = false } = {}) {
    const view = logsView();
    if (!view) return;
    document.querySelectorAll('[data-manager-view]').forEach((item) => { item.hidden = item !== view; });
    document.querySelectorAll('[data-manager-view-target]').forEach((button) => {
      button.setAttribute('aria-current', button.dataset.managerViewTarget === 'logs' ? 'page' : 'false');
    });
    setHeader();
    if (historyMode !== 'none') {
      const url = new URL(location.href);
      url.searchParams.set('view', 'logs');
      history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ managerView: 'logs' }, '', url);
    }
    document.body.classList.remove('manager-sidebar-open');
    if (focusHeading) {
      const title = document.getElementById('manager-view-title');
      if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
    }
    refreshWeeklyLogs(true).catch(() => {});
  }

  function installStyle() {
    if (document.getElementById('manager-weekly-logs-style')) return;
    const style = document.createElement('style');
    style.id = 'manager-weekly-logs-style';
    style.textContent = [
      '.weekly-logs-toolbar{display:grid;grid-template-columns:minmax(200px,1fr) 150px 190px auto;gap:10px;align-items:end}',
      '.weekly-logs-toolbar label{display:grid;gap:6px;color:var(--paseo-muted)}',
      '.weekly-logs-list{display:grid;gap:9px;margin-top:14px}',
      '.weekly-log-entry{border:1px solid #27364a;border-radius:10px;background:#0d1420;padding:11px 12px}',
      '.weekly-log-entry.error{border-color:#7f1d1d}.weekly-log-entry.warn{border-color:#854d0e}',
      '.weekly-log-head{display:grid;grid-template-columns:175px 72px 150px minmax(0,1fr);gap:10px;align-items:center}',
      '.weekly-log-message{margin:7px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.weekly-log-entry details{margin-top:8px}.weekly-log-entry pre{max-height:360px;overflow:auto}',
      '.weekly-log-level{text-transform:uppercase;font-size:12px;font-weight:700}',
      '.weekly-log-level.error{color:#fca5a5}.weekly-log-level.warn{color:#fcd34d}.weekly-log-level.info{color:#93c5fd}.weekly-log-level.debug{color:#c4b5fd}',
      '@media(max-width:900px){.weekly-logs-toolbar{grid-template-columns:1fr 1fr}.weekly-log-head{grid-template-columns:1fr 90px}.weekly-log-head .weekly-log-category{grid-column:1/-1}}',
      '@media(max-width:560px){.weekly-logs-toolbar{grid-template-columns:1fr}.weekly-log-head{grid-template-columns:1fr}}'
    ].join('');
    document.head.append(style);
  }

  function installNavigation() {
    if (document.querySelector('[data-manager-view-target="logs"]')) return;
    const groups = Array.from(document.querySelectorAll('.manager-sidebar-group'));
    const repositoryGroup = groups.find((group) => group.querySelector('.manager-sidebar-heading')?.textContent.trim() === 'Repository');
    if (!repositoryGroup) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'manager-nav-button';
    button.dataset.managerViewTarget = 'logs';
    button.setAttribute('aria-current', 'false');
    button.innerHTML = '<span>Logs</span><span class="manager-nav-badge" data-manager-badge="logs" aria-hidden="true"></span>';
    button.addEventListener('click', () => showLogs({ historyMode: 'push', focusHeading: true }));
    repositoryGroup.append(button);
  }

  function installView() {
    if (logsView()) return;
    const root = document.querySelector('.manager-view-root');
    if (!root) return;
    const section = document.createElement('section');
    section.className = 'manager-view';
    section.dataset.managerView = 'logs';
    section.hidden = true;
    section.setAttribute('aria-labelledby', 'manager-view-title');
    section.innerHTML = [
      '<section class="card">',
      '  <div class="split-header">',
      '    <div><h2>Last 7 days</h2><p class="muted">Meaningful controller, issue-processing, PR-review, browser, reconciliation, setup, and operator events. Sensitive values are redacted before they are written.</p></div>',
      '    <div class="actions"><button type="button" class="secondary" id="weekly-logs-refresh">Refresh</button><button type="button" class="secondary" id="weekly-logs-copy">Copy visible</button><button type="button" class="secondary" id="weekly-logs-download">Download JSON</button></div>',
      '  </div>',
      '  <div class="weekly-logs-toolbar" style="margin-top:12px">',
      '    <label>Search<input id="weekly-logs-query" type="search" placeholder="Issue, PR, review job, error…"></label>',
      '    <label>Level<select id="weekly-logs-level"><option value="">All levels</option><option value="error">Error</option><option value="warn">Warning</option><option value="info">Info</option><option value="debug">Debug</option></select></label>',
      '    <label>Category<select id="weekly-logs-category"><option value="">All categories</option></select></label>',
      '    <div class="muted" id="weekly-logs-window">Rolling 7-day window</div>',
      '  </div>',
      '  <p class="muted" id="weekly-logs-summary" style="margin:12px 0 0">Loading logs…</p>',
      '  <div class="weekly-logs-list" id="weekly-logs-list"><div class="manager-view-empty">No logs recorded yet.</div></div>',
      '</section>'
    ].join('');
    root.append(section);

    document.getElementById('weekly-logs-refresh')?.addEventListener('click', () => refreshWeeklyLogs(true).catch(() => {}));
    document.getElementById('weekly-logs-copy')?.addEventListener('click', copyVisibleLogs);
    document.getElementById('weekly-logs-download')?.addEventListener('click', downloadVisibleLogs);
    ['weekly-logs-query', 'weekly-logs-level', 'weekly-logs-category'].forEach((id) => {
      const control = document.getElementById(id);
      if (!control) return;
      control.addEventListener(id === 'weekly-logs-query' ? 'input' : 'change', () => {
        clearTimeout(control.__weeklyLogDebounce);
        control.__weeklyLogDebounce = setTimeout(render, id === 'weekly-logs-query' ? 180 : 0);
      });
    });
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
  }

  function filteredEvents() {
    const query = document.getElementById('weekly-logs-query')?.value.trim().toLowerCase() || '';
    const level = document.getElementById('weekly-logs-level')?.value || '';
    const category = document.getElementById('weekly-logs-category')?.value || '';
    return (latest.events || []).filter((event) => {
      if (level && event.level !== level) return false;
      if (category && event.category !== category) return false;
      if (!query) return true;
      const haystack = [event.category, event.action, event.status, event.source, event.message, JSON.stringify(event.details || {})].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderCategories() {
    const select = document.getElementById('weekly-logs-category');
    if (!select) return;
    const prior = select.value;
    select.innerHTML = '<option value="">All categories</option>' + (latest.categories || []).map((category) => '<option value="' + esc(category) + '">' + esc(category) + '</option>').join('');
    if (Array.from(select.options).some((option) => option.value === prior)) select.value = prior;
  }

  function render() {
    renderCategories();
    const events = filteredEvents();
    const list = document.getElementById('weekly-logs-list');
    const summary = document.getElementById('weekly-logs-summary');
    if (summary) {
      const total = (latest.events || []).length;
      summary.textContent = events.length + ' visible of ' + total + ' event' + (total === 1 ? '' : 's') + ' from the last 7 days. Newest first.' + (latest.hasMore ? ' The server safety limit was reached; export may be incomplete.' : '');
    }
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="manager-view-empty">No events match the selected filters.</div>';
      return;
    }
    list.innerHTML = events.map((event) => {
      const level = String(event.level || 'info').toLowerCase();
      const details = event.details && Object.keys(event.details).length
        ? '<details><summary>Details</summary><pre>' + esc(JSON.stringify(event.details, null, 2)) + '</pre></details>'
        : '';
      return '<article class="weekly-log-entry ' + esc(level) + '">'
        + '<div class="weekly-log-head"><time title="' + esc(event.timestamp) + '">' + esc(formatTime(event.timestamp)) + '</time>'
        + '<span class="weekly-log-level ' + esc(level) + '">' + esc(level) + '</span>'
        + '<span class="chip info weekly-log-category">' + esc(event.category || 'controller') + '</span>'
        + '<strong>' + esc(event.action || 'event') + ' · ' + esc(event.status || 'success') + '</strong></div>'
        + '<p class="weekly-log-message">' + esc(event.message || '') + '</p>'
        + '<p class="muted" style="margin:6px 0 0">Source: ' + esc(event.source || 'system') + ' · ID: ' + esc(event.id || '') + '</p>'
        + details + '</article>';
    }).join('');
  }

  async function refreshWeeklyLogs(force) {
    if (loading && !force) return latest;
    const repositoryId = selectedRepositoryId();
    if (!repositoryId) {
      latest = { events: [], categories: [], hasMore: false };
      render();
      return latest;
    }
    loading = true;
    try {
      const response = await fetch('/api/repositories/' + encodeURIComponent(repositoryId) + '/logs', { headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load repository logs.');
      latest = payload;
      render();
      return payload;
    } catch (error) {
      const list = document.getElementById('weekly-logs-list');
      if (list) list.innerHTML = '<div class="manager-view-empty">' + esc(error.message || String(error)) + '</div>';
      throw error;
    } finally {
      loading = false;
    }
  }

  async function copyVisibleLogs() {
    const text = filteredEvents().map((event) => JSON.stringify(event)).join('\n');
    await navigator.clipboard.writeText(text);
    if (typeof window.toast === 'function') window.toast('Visible weekly logs copied.');
  }

  function downloadVisibleLogs() {
    const content = JSON.stringify(filteredEvents(), null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'paseo-weekly-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function install() {
    installStyle();
    installNavigation();
    installView();
    const baseShowManagerView = window.showManagerView;
    if (typeof baseShowManagerView === 'function' && !baseShowManagerView.__weeklyLogsWrapped) {
      const wrapped = function(id) {
        if (id === 'logs') return showLogs({ historyMode: 'push', focusHeading: true });
        return baseShowManagerView(id);
      };
      wrapped.__weeklyLogsWrapped = true;
      window.showManagerView = wrapped;
    }
    const requested = new URL(location.href).searchParams.get('view');
    if (requested === 'logs') showLogs({ historyMode: 'none' });
  }

  document.addEventListener('paseo:manager-ui-ready', () => setTimeout(install, 0), { once: true });
  document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  window.addEventListener('popstate', () => {
    if (new URL(location.href).searchParams.get('view') === 'logs') setTimeout(() => showLogs({ historyMode: 'none' }), 0);
  });
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'repository-select' && logsVisible()) refreshWeeklyLogs(true).catch(() => {});
  });
  setInterval(() => { if (logsVisible()) refreshWeeklyLogs(false).catch(() => {}); }, 5_000);
})();
`;

export function enhanceManagerWithWeeklyLogs(html) {
  return injectIntoBody(html, `<script data-manager-weekly-logs>${MANAGER_WEEKLY_LOGS_SCRIPT}</script>`);
}
