export const LOGS_UI_SCRIPT = String.raw`
(function installLogsUi() {
  let latestLogData = { events: [], categories: [] };
  let logsLoading = false;

  function escapeLogHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function installLogsStyle() {
    if (document.getElementById('controller-logs-style')) return;
    const style = document.createElement('style');
    style.id = 'controller-logs-style';
    style.textContent = [
      '.logs-toolbar{display:grid;grid-template-columns:minmax(180px,1fr) 150px 190px auto;gap:10px;align-items:end}',
      '.logs-toolbar label{display:grid;gap:6px}',
      '.logs-list{display:grid;gap:8px;margin-top:14px}',
      '.log-entry{border:1px solid #27364a;border-radius:10px;background:#0d1420;padding:10px 12px}',
      '.log-entry.error{border-color:#7f1d1d}',
      '.log-entry.warn{border-color:#854d0e}',
      '.log-entry-head{display:grid;grid-template-columns:170px 74px 140px minmax(0,1fr);gap:10px;align-items:center}',
      '.log-entry-message{margin:7px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.log-entry details{margin-top:8px}',
      '.log-entry pre{max-height:320px;overflow:auto}',
      '.log-level{text-transform:uppercase;font-size:12px;font-weight:700}',
      '.log-level.error{color:#fca5a5}',
      '.log-level.warn{color:#fcd34d}',
      '.log-level.info{color:#93c5fd}',
      '.log-level.debug{color:#c4b5fd}',
      '@media (max-width:900px){.logs-toolbar{grid-template-columns:1fr 1fr}.log-entry-head{grid-template-columns:1fr 90px}.log-entry-head .log-category{grid-column:1/-1}}',
      '@media (max-width:560px){.logs-toolbar{grid-template-columns:1fr}.log-entry-head{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(style);
  }

  function installLogsView() {
    const nav = document.querySelector('.nav-tabs');
    const main = document.getElementById('main-content');
    if (!nav || !main) return;
    if (!document.getElementById('logs-nav')) {
      const button = document.createElement('button');
      button.id = 'logs-nav';
      button.className = 'nav-tab';
      button.dataset.view = 'logs';
      button.textContent = 'Logs';
      button.setAttribute('onclick', "showView('logs')");
      const settings = nav.querySelector('[data-view="settings"]');
      nav.insertBefore(button, settings || null);
    }
    if (!document.getElementById('view-logs')) {
      const section = document.createElement('section');
      section.className = 'view';
      section.id = 'view-logs';
      section.innerHTML = [
        '<article class="card">',
        '  <div class="split-header">',
        '    <div><h2>Controller logs</h2><p class="muted">Append-only local records for setup, Issues Processing, PR Reviews, browser automation, reconciliation, and failures. Read-only refresh polling is not logged.</p></div>',
        '    <div class="actions"><button class="secondary" onclick="refreshControllerLogs(true)">Refresh</button><button class="secondary" onclick="copyControllerLogs()">Copy visible</button><button class="secondary" onclick="downloadControllerLogs()">Download JSON</button></div>',
        '  </div>',
        '  <div class="logs-toolbar" style="margin-top:12px">',
        '    <label>Search<input id="logs-query" type="search" placeholder="Issue, PR, action, error…"></label>',
        '    <label>Level<select id="logs-level"><option value="">All levels</option><option value="error">Error</option><option value="warn">Warning</option><option value="info">Info</option><option value="debug">Debug</option></select></label>',
        '    <label>Category<select id="logs-category"><option value="">All categories</option></select></label>',
        '    <label>Rows<select id="logs-limit"><option value="100">100</option><option value="250" selected>250</option><option value="500">500</option><option value="1000">1000</option></select></label>',
        '  </div>',
        '  <p class="muted" id="logs-summary" style="margin:12px 0 0">Loading logs…</p>',
        '  <div class="logs-list" id="logs-list"><div class="empty">No controller logs recorded.</div></div>',
        '</article>'
      ].join('');
      const settingsView = document.getElementById('view-settings');
      main.insertBefore(section, settingsView || null);
    }
  }

  function formatLogTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
  }

  function renderCategoryOptions(categories) {
    const select = document.getElementById('logs-category');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = '<option value="">All categories</option>' + (categories || []).map(function(category) {
      return '<option value="' + escapeLogHtml(category) + '">' + escapeLogHtml(category) + '</option>';
    }).join('');
    if (Array.from(select.options).some(function(option) { return option.value === selected; })) select.value = selected;
  }

  function renderControllerLogs(data) {
    latestLogData = data || { events: [], categories: [] };
    renderCategoryOptions(latestLogData.categories || []);
    const events = latestLogData.events || [];
    const list = document.getElementById('logs-list');
    const summary = document.getElementById('logs-summary');
    if (summary) {
      const suffix = latestLogData.hasMore ? ' (limited; refine filters to narrow results)' : '';
      summary.textContent = events.length + ' log entr' + (events.length === 1 ? 'y' : 'ies') + suffix + '. Newest first.';
    }
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="empty">No controller logs match the selected filters.</div>';
      return;
    }
    list.innerHTML = events.map(function(event) {
      const level = String(event.level || 'info').toLowerCase();
      const details = event.details && Object.keys(event.details).length
        ? '<details><summary>Details</summary><pre>' + escapeLogHtml(JSON.stringify(event.details, null, 2)) + '</pre></details>'
        : '';
      return [
        '<article class="log-entry ' + escapeLogHtml(level) + '">',
        '  <div class="log-entry-head">',
        '    <time title="' + escapeLogHtml(event.timestamp) + '">' + escapeLogHtml(formatLogTime(event.timestamp)) + '</time>',
        '    <span class="log-level ' + escapeLogHtml(level) + '">' + escapeLogHtml(level) + '</span>',
        '    <span class="chip info log-category">' + escapeLogHtml(event.category || 'controller') + '</span>',
        '    <strong>' + escapeLogHtml(event.action || 'event') + ' · ' + escapeLogHtml(event.status || 'success') + '</strong>',
        '  </div>',
        '  <p class="log-entry-message">' + escapeLogHtml(event.message || '') + '</p>',
        '  <p class="muted" style="margin:6px 0 0">Source: ' + escapeLogHtml(event.source || 'system') + ' · ID: ' + escapeLogHtml(event.id || '') + '</p>',
        details,
        '</article>'
      ].join('');
    }).join('');
  }

  function logQueryString() {
    const params = new URLSearchParams();
    params.set('limit', document.getElementById('logs-limit')?.value || '250');
    const level = document.getElementById('logs-level')?.value || '';
    const category = document.getElementById('logs-category')?.value || '';
    const query = document.getElementById('logs-query')?.value.trim() || '';
    if (level) params.set('level', level);
    if (category) params.set('category', category);
    if (query) params.set('query', query);
    return params.toString();
  }

  window.refreshControllerLogs = async function(force) {
    if (logsLoading && !force) return latestLogData;
    logsLoading = true;
    try {
      const response = await fetch('/api/logs?' + logQueryString(), { headers: { accept: 'application/json' } });
      const payload = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(payload.error || 'Could not load controller logs.');
      renderControllerLogs(payload);
      return payload;
    } catch (error) {
      const list = document.getElementById('logs-list');
      if (list) list.innerHTML = '<div class="empty">' + escapeLogHtml(error.message || String(error)) + '</div>';
      throw error;
    } finally {
      logsLoading = false;
    }
  };

  window.copyControllerLogs = async function() {
    const text = (latestLogData.events || []).map(function(event) { return JSON.stringify(event); }).join('\n');
    await navigator.clipboard.writeText(text);
    if (typeof toast === 'function') toast('Visible controller logs copied.');
  };

  window.downloadControllerLogs = function() {
    const content = JSON.stringify(latestLogData.events || [], null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'paseo-controller-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  function logsVisible() {
    return document.getElementById('view-logs')?.classList.contains('active') && !document.hidden;
  }

  document.addEventListener('DOMContentLoaded', function() {
    installLogsStyle();
    installLogsView();
    ['logs-query', 'logs-level', 'logs-category', 'logs-limit'].forEach(function(id) {
      const control = document.getElementById(id);
      if (!control) return;
      control.addEventListener(id === 'logs-query' ? 'input' : 'change', function() {
        clearTimeout(control.__logsDebounce);
        control.__logsDebounce = setTimeout(function() { refreshControllerLogs(true).catch(function() {}); }, id === 'logs-query' ? 250 : 0);
      });
    });
    const originalShowView = window.showView;
    window.showView = function(name) {
      originalShowView(name);
      if (name === 'logs') refreshControllerLogs(true).catch(function() {});
    };
    showView = window.showView;
    setInterval(function() {
      if (logsVisible()) refreshControllerLogs(false).catch(function() {});
    }, 5_000);
  });
})();
`;
