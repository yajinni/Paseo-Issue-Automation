import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_OVERVIEW_ACTIVITY_STYLE = String.raw`
.manager-overview-support{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px!important}
.manager-overview-support>.card{margin:0!important;min-width:0}
.manager-overview-activity-card{overflow:hidden}
.manager-overview-activity-card h2{margin-bottom:5px}
.manager-overview-table{margin-top:12px;border-top:1px solid #2b3748}
.manager-overview-table-head,.manager-overview-table-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(105px,.42fr) minmax(112px,.42fr) minmax(72px,.28fr);gap:10px;align-items:center;padding:9px 4px}
.manager-overview-table-head{color:#8798ad;font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}
.manager-overview-table-row{border-top:1px solid #253042;min-height:44px}.manager-overview-table-row:first-of-type{border-top:0}
.manager-overview-primary{min-width:0;display:flex;align-items:flex-start;gap:8px}.manager-overview-primary-copy{min-width:0}.manager-overview-primary-copy strong,.manager-overview-primary-copy a{display:block;color:#e1eaf8;font-size:12px;font-weight:750;text-decoration:none;line-height:1.3;overflow-wrap:anywhere}.manager-overview-primary-copy a:hover{text-decoration:underline}.manager-overview-primary-copy small{display:block;color:#75879e;font-size:10px;margin-top:3px;line-height:1.35;overflow-wrap:anywhere}
.manager-overview-dot{width:9px;height:9px;border-radius:999px;border:2px solid #4bb675;margin-top:3px;flex:0 0 auto}.manager-overview-dot.pr{border-color:#5591dc}
.manager-overview-chip{display:inline-flex;width:max-content;max-width:100%;border:1px solid #3b4b61;border-radius:7px;padding:4px 7px;background:#151f2c;color:#c7d3e3;font-size:10px;font-weight:700;line-height:1.2}.manager-overview-chip.coding,.manager-overview-chip.reviewing{border-color:#486e9b;color:#bcd4f5}.manager-overview-chip.queued,.manager-overview-chip.review-queued{border-color:#5f4d85;color:#d2c1f3}.manager-overview-chip.changes-requested,.manager-overview-chip.review-failed,.manager-overview-chip.needs-attention{border-color:#79505a;color:#e6bdc5}.manager-overview-chip.fixing{border-color:#84632a;color:#e9cc8d}.manager-overview-chip.merged,.manager-overview-chip.closure-verified{border-color:#39704f;color:#b9e9ca}
.manager-overview-date,.manager-overview-elapsed{font-size:11px;color:#a7b6c9;white-space:nowrap}.manager-overview-elapsed{color:#c7d3e3}
.manager-overview-empty{padding:18px 4px 8px;color:#8394aa;font-size:12px;line-height:1.45}
.manager-overview-card-footer{margin-top:12px;padding-top:10px;border-top:1px solid #253042;display:flex;justify-content:flex-start}
.manager-overview-summary-card{grid-column:1/-1!important}.manager-overview-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin-top:12px}.manager-overview-summary-column+ .manager-overview-summary-column{border-left:1px solid #2a3545;padding-left:22px}.manager-overview-summary-heading{display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:12px;font-weight:750}.manager-overview-summary-list{display:grid}.manager-overview-summary-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:8px 0;border-top:1px solid #253042}.manager-overview-summary-row:first-child{border-top:0}.manager-overview-summary-row a,.manager-overview-summary-row strong{color:#dce7f6;font-size:11px;line-height:1.35;text-decoration:none}.manager-overview-summary-row a:hover{text-decoration:underline}.manager-overview-summary-row small{display:block;color:#7f91a8;font-size:10px;margin-top:2px;line-height:1.35}.manager-overview-summary-time{color:#91a3b8;font-size:10px;white-space:nowrap}.manager-overview-summary-icon{margin-right:6px}.manager-overview-attention-icon{color:#e2ad45}.manager-overview-recent-icon{color:#55bd78}
.overview-metrics{grid-template-columns:repeat(7,minmax(0,1fr))!important}
@media(max-width:1180px){.overview-metrics{grid-template-columns:repeat(4,minmax(0,1fr))!important}}
@media(max-width:900px){.manager-overview-support{grid-template-columns:1fr!important}.manager-overview-summary-card{grid-column:auto!important}.manager-overview-summary-grid{grid-template-columns:1fr}.manager-overview-summary-column+ .manager-overview-summary-column{border-left:0;border-top:1px solid #2a3545;padding-left:0;padding-top:14px}}
@media(max-width:640px){.overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important}.manager-overview-table-head{display:none}.manager-overview-table-row{grid-template-columns:minmax(0,1fr) auto;gap:6px 10px}.manager-overview-table-row>.manager-overview-primary{grid-column:1/-1}.manager-overview-date,.manager-overview-elapsed{text-align:left}.manager-overview-summary-row{grid-template-columns:1fr}.manager-overview-summary-time{white-space:normal}}
`;

export const MANAGER_OVERVIEW_ACTIVITY_SCRIPT = String.raw`
(function managerOverviewActivity() {
  let built = false;
  let latestOverview = null;

  function activeViewButton(view) {
    return document.querySelector('[data-manager-view-target="' + view + '"]');
  }

  function openView(view) {
    activeViewButton(view)?.click();
  }

  function formatStarted(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function elapsed(value) {
    if (!value) return '—';
    const started = new Date(value).getTime();
    if (!Number.isFinite(started)) return '—';
    const delta = Math.max(0, Date.now() - started);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 60) return minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm';
    const days = Math.floor(hours / 24);
    return days + 'd ' + (hours % 24) + 'h';
  }

  function ago(value) {
    if (!value) return '';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return '';
    const delta = Math.max(0, Date.now() - time);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text == null ? '' : String(text);
    return element;
  }

  function linkedTitle(url, text) {
    if (!url) return textElement('strong', '', text);
    const anchor = textElement('a', '', text);
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    return anchor;
  }

  function chip(stage, label) {
    return textElement('span', 'manager-overview-chip ' + (stage || 'unknown'), label || 'Unknown');
  }

  function elapsedCell(startedAt) {
    const cell = textElement('div', 'manager-overview-elapsed', elapsed(startedAt));
    if (startedAt) cell.dataset.startedAt = startedAt;
    return cell;
  }

  function issueRow(item) {
    const row = document.createElement('div'); row.className = 'manager-overview-table-row';
    const primary = document.createElement('div'); primary.className = 'manager-overview-primary';
    primary.append(textElement('span', 'manager-overview-dot', ''));
    const copy = document.createElement('div'); copy.className = 'manager-overview-primary-copy';
    copy.append(linkedTitle(item.url, '#' + item.issueNumber + '  ' + (item.title || 'Issue')));
    primary.append(copy);
    row.append(primary, chip(item.stage, item.stageLabel), textElement('div', 'manager-overview-date', formatStarted(item.startedAt)), elapsedCell(item.startedAt));
    return row;
  }

  function prRow(item) {
    const row = document.createElement('div'); row.className = 'manager-overview-table-row';
    const primary = document.createElement('div'); primary.className = 'manager-overview-primary';
    primary.append(textElement('span', 'manager-overview-dot pr', ''));
    const copy = document.createElement('div'); copy.className = 'manager-overview-primary-copy';
    copy.append(linkedTitle(item.url, 'PR #' + item.pullRequestNumber));
    copy.append(textElement('small', '', '#' + item.issueNumber + ' · ' + (item.issueTitle || 'Associated issue')));
    primary.append(copy);
    const status = item.health?.status === 'blocking' || item.health?.status === 'attention'
      ? (item.reviewType || item.stageLabel) + ' · ' + (item.health.label || 'Needs attention')
      : item.reviewType || item.stageLabel;
    row.append(primary, chip(item.stage, status), textElement('div', 'manager-overview-date', formatStarted(item.startedAt)), elapsedCell(item.startedAt));
    return row;
  }

  function renderTable(targetId, items, rowBuilder, emptyText) {
    const target = document.getElementById(targetId); if (!target) return;
    target.textContent = '';
    if (!items.length) {
      target.append(textElement('div', 'manager-overview-empty', emptyText));
      return;
    }
    const head = document.createElement('div'); head.className = 'manager-overview-table-head';
    for (const label of [targetId.includes('prs') ? 'Pull Request' : 'Issue', targetId.includes('prs') ? 'Review / Status' : 'Stage', 'Started', 'Elapsed']) head.append(textElement('div', '', label));
    target.append(head);
    for (const item of items) target.append(rowBuilder(item));
  }

  function summaryRow(item, type) {
    const row = document.createElement('div'); row.className = 'manager-overview-summary-row';
    const copy = document.createElement('div');
    const icon = type === 'attention' ? '⚠' : '✓';
    const iconClass = type === 'attention' ? 'manager-overview-attention-icon' : 'manager-overview-recent-icon';
    const title = item.action?.kind === 'link' && item.action.url
      ? linkedTitle(item.action.url, item.title || 'Item')
      : item.url ? linkedTitle(item.url, item.title || 'Item') : textElement('strong', '', item.title || 'Item');
    const iconSpan = textElement('span', 'manager-overview-summary-icon ' + iconClass, icon);
    copy.append(iconSpan, title);
    if (item.detail) copy.append(textElement('small', '', item.detail));
    row.append(copy, textElement('div', 'manager-overview-summary-time', ago(item.at)));
    return row;
  }

  function renderSummary(data) {
    const attention = document.getElementById('manager-overview-attention-list');
    const recent = document.getElementById('manager-overview-recent-list');
    if (attention) {
      attention.textContent = '';
      const items = data.needsAttention || [];
      if (!items.length) attention.append(textElement('div', 'manager-overview-empty', 'Nothing currently needs operator attention.'));
      else for (const item of items) attention.append(summaryRow(item, 'attention'));
    }
    if (recent) {
      recent.textContent = '';
      const items = data.recent || [];
      if (!items.length) recent.append(textElement('div', 'manager-overview-empty', 'No recent completed work is recorded yet.'));
      else for (const item of items) recent.append(summaryRow(item, 'recent'));
    }
  }

  function setMetric(id, label, value, state) {
    const metric = document.getElementById(id); if (!metric) return;
    const title = metric.querySelector('span'); if (title) title.textContent = label;
    const strong = metric.querySelector('strong'); if (strong) strong.textContent = String(value);
    if (state) metric.className = 'overview-metric ' + state;
  }

  function ensureActivePrMetric() {
    let metric = document.getElementById('overview-active-prs');
    if (metric) return metric;
    const attention = document.getElementById('overview-attention');
    if (!attention?.parentElement) return null;
    metric = document.createElement('div');
    metric.className = 'overview-metric';
    metric.id = 'overview-active-prs';
    metric.innerHTML = '<span>Active PRs</span><strong>0</strong>';
    attention.before(metric);
    return metric;
  }

  function render(data) {
    latestOverview = data?.overview || { activeIssues: [], activePullRequests: [], needsAttention: [], recent: [] };
    ensureLayout();
    renderTable('manager-overview-issues', latestOverview.activeIssues || [], issueRow, 'No issues are currently being worked in the managed lifecycle.');
    renderTable('manager-overview-prs', latestOverview.activePullRequests || [], prRow, 'No pull requests are currently open in the managed review lifecycle.');
    renderSummary(latestOverview);
    setMetric('overview-active-work', 'Active Issues', (latestOverview.activeIssues || []).length, (latestOverview.activeIssues || []).length ? 'overview-active' : 'overview-ready');
    ensureActivePrMetric();
    setMetric('overview-active-prs', 'Active PRs', (latestOverview.activePullRequests || []).length, (latestOverview.activePullRequests || []).length ? 'overview-active' : 'overview-ready');
    const attentionMetric = document.getElementById('overview-attention');
    if (attentionMetric) {
      const count = attentionMetric.querySelector('strong');
      if (count) count.textContent = String((latestOverview.needsAttention || []).length);
      attentionMetric.className = 'overview-metric ' + ((latestOverview.needsAttention || []).length ? 'overview-attention' : 'overview-ready');
    }
    refreshElapsed();
  }

  function refreshElapsed() {
    document.querySelectorAll('.manager-overview-elapsed[data-started-at]').forEach((element) => {
      element.textContent = elapsed(element.dataset.startedAt);
    });
    if (!latestOverview) return;
    document.querySelectorAll('.manager-overview-summary-time').forEach(() => {});
  }

  function ensureLayout() {
    const root = document.querySelector('.manager-overview-support');
    if (!root) return;
    if (built && document.getElementById('manager-overview-issues')) return;
    built = true;
    root.textContent = '';

    const issues = document.createElement('section'); issues.className = 'card manager-overview-activity-card';
    issues.innerHTML = '<h2>Active Issues</h2><p class="muted">Issues currently being worked or moving through the live workflow.</p><div id="manager-overview-issues" class="manager-overview-table"></div><div class="manager-overview-card-footer"><button type="button" class="secondary" data-overview-open="work-queue">View all issue work</button></div>';

    const prs = document.createElement('section'); prs.className = 'card manager-overview-activity-card';
    prs.innerHTML = '<h2>Active PRs / PR Reviews</h2><p class="muted">Pull requests currently open, queued, fixing, or under review.</p><div id="manager-overview-prs" class="manager-overview-table"></div><div class="manager-overview-card-footer"><button type="button" class="secondary" data-overview-open="reviews">View all PR reviews</button></div>';

    const summary = document.createElement('section'); summary.className = 'card manager-overview-summary-card';
    summary.innerHTML = '<h2>Needs Attention & Recent Changes</h2><p class="muted">The next things worth looking at across issues and pull requests.</p><div class="manager-overview-summary-grid"><div class="manager-overview-summary-column"><div class="manager-overview-summary-heading"><span class="manager-overview-attention-icon">⚠</span>Needs Attention</div><div id="manager-overview-attention-list" class="manager-overview-summary-list"></div><div class="manager-overview-card-footer"><button type="button" class="secondary" id="manager-overview-open-health">Open health</button></div></div><div class="manager-overview-summary-column"><div class="manager-overview-summary-heading"><span class="manager-overview-recent-icon">✓</span>Recently Completed</div><div id="manager-overview-recent-list" class="manager-overview-summary-list"></div><div class="manager-overview-card-footer"><button type="button" class="secondary" data-overview-open="work-queue">View all activity</button></div></div></div>';

    root.append(issues, prs, summary);
    root.querySelectorAll('[data-overview-open]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.overviewOpen)));
    root.querySelector('#manager-overview-open-health')?.addEventListener('click', () => {
      const health = document.querySelector('#overview-issue-processing .overview-health-action');
      if (health && !health.hidden) health.click();
      else openView('configuration');
    });
  }

  if (typeof window.addManagerStatusListener === 'function') window.addManagerStatusListener(render);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureLayout();
      try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
    }, { once: true });
  } else {
    ensureLayout();
    try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
  }
  setInterval(refreshElapsed, 60000);
})();
`;

export function enhanceManagerWithOverviewActivity(html) {
  const styled = injectIntoHead(html, `<style data-manager-overview-activity-style>${MANAGER_OVERVIEW_ACTIVITY_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-overview-activity>${MANAGER_OVERVIEW_ACTIVITY_SCRIPT}</script>`);
}
