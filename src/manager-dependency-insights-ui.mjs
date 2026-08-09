import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_DEPENDENCY_INSIGHTS_STYLE = String.raw`
.manager-dependency-insights{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:10px 12px;border-bottom:1px solid #253042;background:#101823}
.manager-dependency-metric{min-width:0;border:1px solid #2c394b;border-radius:8px;padding:9px 10px;background:#0d151f}
.manager-dependency-metric span{display:block;color:#7f91a8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.manager-dependency-metric strong{display:block;margin-top:3px;color:#e5edf8;font-size:18px;line-height:1.1}.manager-dependency-metric small{display:block;margin-top:3px;color:#718298;font-size:9px;line-height:1.3}
.manager-dependency-node{transition:opacity .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}
.manager-dependency-node.is-selected{border-color:#b47cff!important;box-shadow:0 0 0 2px rgba(180,124,255,.2),0 10px 24px rgba(0,0,0,.2)!important}
.manager-dependency-node.is-upstream{border-color:#5c91dc!important;background:#111f31!important}.manager-dependency-node.is-downstream{border-color:#9a6ed0!important;background:#1d1727!important}
.manager-dependency-node.is-dimmed{opacity:.28}
.manager-selected-issue-panel{margin-top:12px;padding-top:12px;border-top:1px solid #2d394b}
.manager-selected-issue-panel h4{margin:0;color:#dce8fb;font-size:11px}.manager-selected-issue-empty{margin-top:6px;color:#718298;font-size:9px;line-height:1.4}
.manager-selected-issue-title{margin-top:5px;color:#eef4ff;font-size:11px;font-weight:750;line-height:1.35}.manager-selected-issue-status{margin-top:3px;color:#91a2b8;font-size:9px}
.manager-selected-issue-facts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;margin-top:10px}.manager-selected-issue-facts span{color:#7f91a8;font-size:9px}.manager-selected-issue-facts strong{color:#dce8fb;font-size:10px;text-align:right}
.manager-selected-issue-list{margin-top:9px;color:#8394aa;font-size:9px;line-height:1.4;overflow-wrap:anywhere}.manager-selected-issue-list b{color:#b7c6d9}
.manager-dependency-selection-key{margin-top:9px;color:#718298;font-size:8px;line-height:1.35}
@media(max-width:1050px){.manager-dependency-insights{grid-template-columns:repeat(3,minmax(0,1fr))}.manager-selected-issue-panel{grid-column:1/-1}}
@media(max-width:700px){.manager-dependency-insights{grid-template-columns:repeat(2,minmax(0,1fr))}.manager-dependency-metric:last-child{grid-column:1/-1}}
@media(prefers-reduced-motion:reduce){.manager-dependency-node{transition:none}}
`;

export const MANAGER_DEPENDENCY_INSIGHTS_SCRIPT = String.raw`
(function managerDependencyInsights() {
  let latestPlan = null;
  let latestStatus = null;
  let selectedIssueNumber = null;

  function numberList(values) {
    return [...new Set((values || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  }

  function itemMap(plan) {
    return new Map((plan?.items || []).map((item) => [Number(item.issueNumber), item]));
  }

  function walk(start, adjacency) {
    const seen = new Set();
    const stack = [...(adjacency?.[start] || [])].map(Number);
    while (stack.length) {
      const number = Number(stack.pop());
      if (!Number.isInteger(number) || seen.has(number)) continue;
      seen.add(number);
      for (const next of adjacency?.[number] || []) stack.push(Number(next));
    }
    seen.delete(Number(start));
    return seen;
  }

  function capacity(plan) {
    const maxActiveValue = Number(latestStatus?.automation?.maxActive);
    const maxActive = Number.isFinite(maxActiveValue) && maxActiveValue >= 0 ? maxActiveValue : null;
    const activeValue = Number(latestStatus?.automation?.activeRunCount);
    const active = Number.isFinite(activeValue) && activeValue >= 0 ? activeValue : Number(plan?.active || 0);
    const runnable = (plan?.items || []).filter((item) => item.statusId === 'next' || item.statusId === 'eligible').length;
    const structurallyReady = plan?.graph?.available === false
      ? 'Unknown'
      : Number(plan?.graph?.counts?.readyNow || 0);
    const availableSlots = maxActive === null ? 'Unknown' : Math.max(0, maxActive - active);
    const canStartNow = maxActive === null ? 'Unknown' : Math.min(runnable, availableSlots);
    return { structurallyReady, runnable, active, maxActive, availableSlots, canStartNow };
  }

  function metric(label, value, detail) {
    const card = document.createElement('div'); card.className = 'manager-dependency-metric';
    const name = document.createElement('span'); name.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = String(value);
    const small = document.createElement('small'); small.textContent = detail;
    card.append(name, strong, small); return card;
  }

  function renderCapacity(plan) {
    const shell = document.getElementById('manager-issue-flow-shell');
    const toolbar = shell?.querySelector('.manager-issue-flow-toolbar');
    if (!shell || !toolbar) return;
    shell.querySelector('.manager-dependency-insights')?.remove();
    const snapshot = capacity(plan);
    const bar = document.createElement('div'); bar.className = 'manager-dependency-insights'; bar.setAttribute('aria-label', 'Parallel work summary');
    bar.append(
      metric('Structurally ready', snapshot.structurallyReady, snapshot.structurallyReady === 'Unknown' ? 'Native relationship data is incomplete' : 'No unresolved open blockers'),
      metric('Runnable now', snapshot.runnable, 'Also passes issue-selection rules'),
      metric('Active', snapshot.active + ' / ' + (snapshot.maxActive === null ? '?' : snapshot.maxActive), 'Current issue-processing capacity'),
      metric('Open slots', snapshot.availableSlots, snapshot.availableSlots === 'Unknown' ? 'Capacity status has not loaded yet' : 'Configured capacity still free'),
      metric('Can start now', snapshot.canStartNow, snapshot.canStartNow === 'Unknown' ? 'Waiting for capacity status' : 'min(runnable now, open slots)'),
    );
    toolbar.after(bar);
  }

  function selectedPanel(plan) {
    const levels = document.querySelector('.manager-levels-panel');
    if (!levels) return;
    levels.querySelector('.manager-selected-issue-panel')?.remove();
    const panel = document.createElement('section'); panel.className = 'manager-selected-issue-panel';
    const heading = document.createElement('h4'); heading.textContent = 'Selected issue'; panel.append(heading);
    const items = itemMap(plan);
    const item = items.get(Number(selectedIssueNumber));
    if (!item) {
      const empty = document.createElement('div'); empty.className = 'manager-selected-issue-empty';
      empty.textContent = 'Click an issue card, or focus its GitHub link, to trace its blockers and downstream work.';
      panel.append(empty); levels.append(panel); return;
    }

    const graph = plan.graph || {};
    const number = Number(item.issueNumber);
    const blockers = numberList(graph.dependencies?.[number]);
    const dependents = numberList(graph.unlocks?.[number]);
    const upstream = walk(number, graph.dependencies || {});
    const downstream = walk(number, graph.unlocks || {});
    const immediateUnlocks = dependents.filter((dependent) =>
      numberList(graph.dependencies?.[dependent]).length === 1
      && numberList(graph.externalDependencies?.[dependent]).length === 0);
    const title = document.createElement('div'); title.className = 'manager-selected-issue-title'; title.textContent = '#' + number + ' ' + item.title;
    const status = document.createElement('div'); status.className = 'manager-selected-issue-status'; status.textContent = item.status || 'Open issue';
    const facts = document.createElement('div'); facts.className = 'manager-selected-issue-facts';
    const level = Object.hasOwn(graph.levelByIssue || {}, number) ? graph.levelByIssue[number] : null;
    const rows = [
      ['Dependency depth', level === null ? 'Unresolved' : level],
      ['Direct blockers', blockers.length],
      ['Direct dependents', dependents.length],
      ['Would become ready', immediateUnlocks.length],
      ['Total upstream', upstream.size],
      ['Total downstream', downstream.size],
    ];
    for (const row of rows) {
      const label = document.createElement('span'); label.textContent = row[0];
      const value = document.createElement('strong'); value.textContent = String(row[1]);
      facts.append(label, value);
    }
    panel.append(title, status, facts);
    if (blockers.length) {
      const line = document.createElement('div'); line.className = 'manager-selected-issue-list'; line.innerHTML = '<b>Blocked by:</b> ' + blockers.map((value) => '#' + value).join(', '); panel.append(line);
    }
    if (dependents.length) {
      const line = document.createElement('div'); line.className = 'manager-selected-issue-list'; line.innerHTML = '<b>Direct dependents:</b> ' + dependents.map((value) => '#' + value).join(', '); panel.append(line);
    }
    const key = document.createElement('div'); key.className = 'manager-dependency-selection-key';
    key.textContent = 'Blue = upstream blocker · purple = downstream dependent. “Would become ready” counts direct dependents for which this issue is the only remaining known open blocker and no external open blocker is recorded.';
    panel.append(key); levels.append(panel);
  }

  function applySelection(plan) {
    const graph = plan?.graph || {};
    const selected = Number(selectedIssueNumber);
    const exists = (plan?.items || []).some((item) => Number(item.issueNumber) === selected);
    if (!Number.isInteger(selected) || !exists) selectedIssueNumber = null;
    const upstream = selectedIssueNumber === null ? new Set() : walk(selectedIssueNumber, graph.dependencies || {});
    const downstream = selectedIssueNumber === null ? new Set() : walk(selectedIssueNumber, graph.unlocks || {});
    for (const node of document.querySelectorAll('.manager-dependency-node[data-issue-number]')) {
      const number = Number(node.dataset.issueNumber);
      const isSelected = number === Number(selectedIssueNumber);
      const isUpstream = upstream.has(number);
      const isDownstream = downstream.has(number);
      node.classList.toggle('is-selected', isSelected);
      node.classList.toggle('is-upstream', isUpstream);
      node.classList.toggle('is-downstream', isDownstream);
      node.classList.toggle('is-dimmed', selectedIssueNumber !== null && !isSelected && !isUpstream && !isDownstream);
      if (!node.querySelector('a')) node.tabIndex = 0;
      node.setAttribute('aria-label', 'Issue #' + number + '. Select to trace dependencies.');
    }
    selectedPanel(plan);
  }

  function render(plan) {
    latestPlan = plan || latestPlan;
    if (!latestPlan?.graph) return;
    renderCapacity(latestPlan);
    applySelection(latestPlan);
  }

  function selectFromNode(node) {
    const number = Number(node?.dataset?.issueNumber);
    if (!Number.isInteger(number)) return;
    selectedIssueNumber = number;
    if (latestPlan) applySelection(latestPlan);
  }

  document.addEventListener('click', (event) => {
    const node = event.target.closest?.('.manager-dependency-node[data-issue-number]');
    if (!node || event.target.closest?.('a')) return;
    selectFromNode(node);
  });
  document.addEventListener('focusin', (event) => {
    const node = event.target.closest?.('.manager-dependency-node[data-issue-number]');
    if (node) selectFromNode(node);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedIssueNumber !== null) {
      selectedIssueNumber = null;
      if (latestPlan) applySelection(latestPlan);
    }
  });

  function statusListener(status) {
    latestStatus = status || latestStatus;
    if (latestPlan) {
      renderCapacity(latestPlan);
      applySelection(latestPlan);
    }
  }
  if (typeof window.addManagerStatusListener === 'function') window.addManagerStatusListener(statusListener);

  const previousJsonRequest = window.jsonRequest;
  if (typeof previousJsonRequest === 'function') {
    window.jsonRequest = async function dependencyInsightsJsonRequest(url, options) {
      const body = await previousJsonRequest(url, options);
      if (String(url || '').includes('/issues-plan') && body?.issuePlan) render(body.issuePlan);
      return body;
    };
  }

  try { if (typeof currentStatus !== 'undefined' && currentStatus) latestStatus = currentStatus; } catch {}
})();
`;

export function enhanceManagerWithDependencyInsights(html) {
  const styled = injectIntoHead(html, `<style data-manager-dependency-insights-style>${MANAGER_DEPENDENCY_INSIGHTS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-dependency-insights>${MANAGER_DEPENDENCY_INSIGHTS_SCRIPT}</script>`);
}
