import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_ISSUES_PR_REVIEWS_STYLE = String.raw`
.manager-issues-layout,.manager-pr-reviews-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.manager-issues-layout>.wide,.manager-pr-reviews-layout>.wide{grid-column:1/-1}
.manager-issue-plan-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 2px}.manager-issue-plan-summary span{border:1px solid #344357;border-radius:999px;padding:5px 9px;background:#151f2c;color:#c9d5e5;font-size:12px}.manager-issue-plan-summary strong{color:#fff}
.manager-issue-plan-list{display:grid;margin-top:12px;border:1px solid #2d394b;border-radius:10px;overflow:hidden}.manager-issue-plan-head,.manager-issue-plan-row{display:grid;grid-template-columns:74px minmax(240px,1.3fr) minmax(150px,.7fr) minmax(230px,1fr);gap:12px;align-items:start;padding:11px 12px}.manager-issue-plan-head{background:#151f2c;color:#8fa0b4;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.manager-issue-plan-row{border-top:1px solid #253042}.manager-issue-plan-row:first-of-type{border-top:0}.manager-issue-plan-order{font-weight:750;color:#dbe7f7}.manager-issue-plan-order.muted{font-weight:500;color:#718298}.manager-issue-plan-title a{color:#dbeafe;text-decoration:none;font-weight:700}.manager-issue-plan-title a:hover{text-decoration:underline}.manager-issue-plan-labels{margin-top:4px;color:#718298;font-size:11px;overflow-wrap:anywhere}.manager-issue-plan-status{font-size:12px;font-weight:700}.manager-issue-plan-status.next{color:#b9e9ca}.manager-issue-plan-status.blocked,.manager-issue-plan-status.invalid-contract{color:#efc879}.manager-issue-plan-status.active{color:#a9c8ff}.manager-issue-plan-status.skipped,.manager-issue-plan-status.not-ready,.manager-issue-plan-status.excluded-label{color:#8fa0b4}.manager-issue-plan-reason{font-size:12px;color:#aab8c9;line-height:1.4}.manager-issue-plan-deps{margin-top:4px;color:#8fa0b4}.manager-issue-plan-empty{padding:18px;color:var(--paseo-muted)}
.manager-issues-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
@media(max-width:900px){.manager-issue-plan-head{display:none}.manager-issue-plan-row{grid-template-columns:56px minmax(0,1fr)}.manager-issue-plan-status,.manager-issue-plan-reason{grid-column:2}.manager-issues-layout,.manager-pr-reviews-layout{grid-template-columns:1fr}.manager-issues-layout>.wide,.manager-pr-reviews-layout>.wide{grid-column:auto}}
`;

export const MANAGER_ISSUES_PR_REVIEWS_SCRIPT = String.raw`
(function managerIssuesAndPrReviews() {
  let built = false;
  let issuePlanRequest = 0;
  let issuePlanInFlight = null;
  let issuePlanRepositoryId = null;
  let issuePlanLoadedAt = 0;
  let issuePlanRefreshTimer = null;
  const ISSUE_PLAN_CACHE_MS = 15000;

  function findCard(root, heading) {
    if (!root) return null;
    for (const card of root.querySelectorAll('section.card')) {
      if (card.querySelector('h2')?.textContent.trim() === heading) return card;
    }
    return null;
  }

  function factsList(id) {
    const dl = document.createElement('dl');
    dl.className = 'facts'; dl.id = id;
    const dt = document.createElement('dt'); dt.textContent = 'State';
    const dd = document.createElement('dd'); dd.textContent = 'Loading…';
    dl.append(dt, dd); return dl;
  }

  function card(title, description, factsId) {
    const section = document.createElement('section'); section.className = 'card manager-ops-card';
    const heading = document.createElement('h2'); heading.textContent = title;
    const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = description;
    section.append(heading, copy);
    if (factsId) section.append(factsList(factsId));
    return section;
  }

  function moveActions(source, target) {
    const area = document.createElement('div'); area.className = 'manager-issues-actions';
    for (const button of [...(source?.querySelectorAll('.manager-ops-actions button') || [])]) area.append(button);
    if (area.childElementCount) target.append(area);
    return area;
  }

  function renderFacts(id, entries) {
    const target = document.getElementById(id); if (!target) return;
    target.textContent = '';
    for (const [label, value] of entries) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value == null || value === '' ? 'None' : String(value);
      target.append(dt, dd);
    }
  }

  function time(value) {
    if (!value) return 'Not yet';
    const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function issueModeLabel(mode) {
    return mode === 'all-open' ? 'All open issues' : 'Recommended labels';
  }

  function workflowLabel(workflow) {
    if (workflow === 'quick-manual') return 'Light model review → Manual review';
    if (workflow === 'quick-web-chatgpt') return 'Light model review → Web ChatGPT full review';
    if (workflow === 'full-immediate') return 'I selected a heavy review model to do the job.';
    return workflow || 'Not configured';
  }

  function activeView() {
    return document.querySelector('[data-manager-view-target][aria-current="page"]')?.dataset.managerViewTarget || 'overview';
  }

  function renameNavigation() {
    const issuesButton = document.querySelector('[data-manager-view-target="automation"]');
    const reviewsButton = document.querySelector('[data-manager-view-target="reviews"]');
    if (issuesButton?.firstElementChild) issuesButton.firstElementChild.textContent = 'Issues';
    if (reviewsButton?.firstElementChild) reviewsButton.firstElementChild.textContent = 'PR Reviews';
    document.querySelectorAll('[data-overview-view="automation"]').forEach((button) => { button.textContent = 'Open Issues'; });
    document.querySelectorAll('[data-overview-view="reviews"]').forEach((button) => { button.textContent = 'Open PR Reviews'; });
  }

  function patchVisibleHeader() {
    const active = activeView();
    const title = document.getElementById('manager-view-title');
    const description = document.getElementById('manager-view-description');
    if (active === 'automation') {
      if (title) title.textContent = 'Issues';
      if (description) description.textContent = 'Issue-processing rules, worker state, and the planned order for every open GitHub issue.';
    } else if (active === 'reviews') {
      if (title) title.textContent = 'PR Reviews';
      if (description) description.textContent = 'Pull request review workflow, review worker state, and current review workload.';
    }
  }

  function patchOverviewTerminology() {
    const replacements = new Map([
      ['Active automation', 'Active issues'],
      ['Claims', 'Issue processing'],
      ['Coding worker', 'Issue-processing worker'],
    ]);
    document.querySelectorAll('.overview-summary-row span').forEach((label) => {
      const replacement = replacements.get(label.textContent.trim()); if (replacement) label.textContent = replacement;
    });
    const latest = document.querySelector('#overview-latest-result div');
    if (latest && latest.textContent.includes('Automation')) latest.textContent = latest.textContent.replace('Automation', 'Issues');
  }

  function relabelWorkerButtons(root) {
    const labels = {
      'worker/start': 'Start issue-processing worker',
      'worker/stop': 'Stop issue-processing worker',
      'worker/restart': 'Restart issue-processing worker',
      'resume': 'Resume issue processing',
      'pause': 'Pause issue processing',
      'run-now': 'Process now',
      'reconcile': 'Recheck dependencies',
    };
    for (const [action, label] of Object.entries(labels)) {
      const button = root?.querySelector('[data-action="' + action + '"]');
      if (button) button.textContent = label;
    }
  }

  function buildIssues() {
    const view = document.querySelector('[data-manager-view="automation"]'); if (!view) return;
    const oldClaims = findCard(view, 'Claims & scheduling');
    const oldWorker = findCard(view, 'Coding worker');
    const layout = document.createElement('div'); layout.className = 'manager-issues-layout';

    const workflow = card('Issue workflow', 'The rules Paseo uses to decide which open GitHub issue can be processed next.', 'manager-issue-workflow-facts');
    moveActions(oldClaims, workflow);
    const worker = card('Issue-processing worker', 'The repository poller that keeps issue processing moving in the background.', 'manager-issue-worker-facts');
    moveActions(oldWorker, worker);
    const workload = card('Issue workload', 'All open GitHub issues, with the actual processing order and any rule or native dependency that keeps an issue from running.');
    workload.classList.add('wide');
    const summary = document.createElement('div'); summary.id = 'manager-issue-plan-summary'; summary.className = 'manager-issue-plan-summary';
    const list = document.createElement('div'); list.id = 'manager-issue-plan-list'; list.className = 'manager-issue-plan-list';
    workload.append(summary, list);
    layout.append(workflow, worker, workload);
    view.replaceChildren(layout);
    relabelWorkerButtons(view);
    renderIssuePlan({ loading: true });
  }

  function buildPrReviews() {
    const view = document.querySelector('[data-manager-view="reviews"]'); if (!view) return;
    const workflow = findCard(view, 'Review workflow');
    const workload = findCard(view, 'Review workload');
    const worker = findCard(view, 'PR-review worker');
    const profile = findCard(view, 'ChatGPT Profile');
    profile?.remove();
    if (!workflow || !worker || !workload) return;
    const layout = document.createElement('div'); layout.className = 'manager-pr-reviews-layout';
    workload.classList.add('wide');
    layout.append(workflow, worker, workload);
    view.replaceChildren(layout);
  }

  function planOrder(item) {
    if (item.statusId === 'active') return 'Active';
    if (item.processingOrder) return '#' + item.processingOrder;
    if (item.statusId === 'blocked') return 'Wait';
    if (item.statusId === 'skipped') return 'Skip';
    return '—';
  }

  function setIssueBadge(plan) {
    const badge = document.querySelector('[data-manager-badge="automation"]'); if (!badge) return;
    if (!plan || plan.available === false) {
      badge.classList.remove('visible', 'attention'); return;
    }
    const count = Number(plan.total || 0);
    badge.textContent = String(count);
    badge.classList.toggle('visible', count > 0);
    badge.classList.remove('attention');
  }

  function renderIssuePlan(plan) {
    const summary = document.getElementById('manager-issue-plan-summary');
    const list = document.getElementById('manager-issue-plan-list');
    if (!summary || !list) return;
    summary.textContent = '';
    list.textContent = '';
    if (plan?.loading) {
      const loading = document.createElement('div'); loading.className = 'manager-issue-plan-empty'; loading.textContent = 'Loading open issues and dependency plan…'; list.append(loading); return;
    }
    const entries = [
      ['Open', plan.total || 0], ['Active', plan.active || 0], ['Eligible', plan.eligible || 0],
      ['Blocked', plan.blocked || 0], ['Skipped', plan.skipped || 0],
    ];
    for (const [label, value] of entries) {
      const chip = document.createElement('span'); chip.textContent = label + ' ';
      const strong = document.createElement('strong'); strong.textContent = String(value); chip.append(strong); summary.append(chip);
    }
    if (plan.available === false) {
      const error = document.createElement('div'); error.className = 'manager-issue-plan-empty'; error.textContent = 'Issue plan unavailable: ' + (plan.error || 'Unknown error'); list.append(error); setIssueBadge(plan); return;
    }
    const head = document.createElement('div'); head.className = 'manager-issue-plan-head';
    for (const text of ['Order', 'Issue', 'Status', 'Why / dependencies']) { const cell = document.createElement('div'); cell.textContent = text; head.append(cell); }
    list.append(head);
    if (!(plan.items || []).length) {
      const empty = document.createElement('div'); empty.className = 'manager-issue-plan-empty'; empty.textContent = 'No open GitHub issues.'; list.append(empty); setIssueBadge(plan); return;
    }
    for (const item of plan.items || []) {
      const row = document.createElement('div'); row.className = 'manager-issue-plan-row';
      const order = document.createElement('div'); order.className = 'manager-issue-plan-order' + (item.processingOrder || item.statusId === 'active' ? '' : ' muted'); order.textContent = planOrder(item);
      const issue = document.createElement('div'); issue.className = 'manager-issue-plan-title';
      const title = item.url ? document.createElement('a') : document.createElement('strong');
      if (item.url) { title.href = item.url; title.target = '_blank'; title.rel = 'noreferrer'; }
      title.textContent = '#' + item.issueNumber + ' ' + item.title; issue.append(title);
      if ((item.labels || []).length) { const labels = document.createElement('div'); labels.className = 'manager-issue-plan-labels'; labels.textContent = item.labels.join(' · '); issue.append(labels); }
      const status = document.createElement('div'); status.className = 'manager-issue-plan-status ' + item.statusId; status.textContent = item.status;
      const reason = document.createElement('div'); reason.className = 'manager-issue-plan-reason'; reason.textContent = item.reason || '';
      if ((item.dependencies || []).length) { const deps = document.createElement('div'); deps.className = 'manager-issue-plan-deps'; deps.textContent = 'Blocked by: ' + item.dependencies.map((number) => '#' + number).join(', '); reason.append(deps); }
      row.append(order, issue, status, reason); list.append(row);
    }
    setIssueBadge(plan);
  }

  function clearIssuePlanRefreshTimer() {
    if (issuePlanRefreshTimer === null) return;
    clearTimeout(issuePlanRefreshTimer);
    issuePlanRefreshTimer = null;
  }

  function scheduleIssuePlanRefresh(delayMs) {
    if (issuePlanRefreshTimer !== null) return;
    issuePlanRefreshTimer = setTimeout(() => {
      issuePlanRefreshTimer = null;
      if (activeView() === 'automation') loadIssuePlan();
    }, Math.max(0, delayMs));
  }

  async function loadIssuePlan({ force = false } = {}) {
    if (activeView() !== 'automation') return;
    const repositoryId = document.getElementById('repository-select')?.value;
    if (!repositoryId || typeof jsonRequest !== 'function' || typeof selectedPath !== 'function') return;
    const sameRepository = issuePlanRepositoryId === repositoryId;
    if (sameRepository && issuePlanInFlight) return issuePlanInFlight;
    const cacheAge = sameRepository && issuePlanLoadedAt ? Date.now() - issuePlanLoadedAt : null;
    if (!force && cacheAge !== null && cacheAge < ISSUE_PLAN_CACHE_MS) {
      scheduleIssuePlanRefresh(ISSUE_PLAN_CACHE_MS - cacheAge);
      return;
    }

    clearIssuePlanRefreshTimer();
    const request = ++issuePlanRequest;
    if (!sameRepository || !issuePlanLoadedAt) renderIssuePlan({ loading: true });
    issuePlanRepositoryId = repositoryId;
    const promise = (async () => {
      try {
        const body = await jsonRequest(selectedPath('issues-plan'));
        if (request !== issuePlanRequest || repositoryId !== document.getElementById('repository-select')?.value) return;
        issuePlanLoadedAt = Date.now();
        renderIssuePlan(body.issuePlan || { available: false, error: 'No issue plan was returned.', items: [] });
      } catch (error) {
        if (request !== issuePlanRequest) return;
        issuePlanLoadedAt = Date.now();
        renderIssuePlan({ available: false, error: error.message || String(error), items: [] });
      } finally {
        if (issuePlanInFlight === promise) issuePlanInFlight = null;
      }
    })();
    issuePlanInFlight = promise;
    return promise;
  }

  function render(data) {
    if (!data) return;
    const automation = data.automation || {};
    const issueSelection = data.configuration?.issueSelection || {};
    const worker = data.worker || {};
    renderFacts('manager-issue-workflow-facts', [
      ['Issue selection', issueModeLabel(issueSelection.mode)],
      ['Issue processing', automation.claimsEnabled ? 'Enabled' : 'Paused'],
      ['Processing order', 'Lowest eligible issue number first'],
      ['Dependencies', 'Native GitHub blocked-by relationships'],
      ['Maximum simultaneous issues', automation.maxActive ?? 'Not configured'],
      ['Temporary failure retries', issueSelection.temporaryFailureRetries ?? 'Not configured'],
      ['Excluded labels', (issueSelection.excludedLabels || []).join(', ') || 'None'],
    ]);
    renderFacts('manager-issue-worker-facts', [
      ['Worker', worker.running ? 'Running' : 'Stopped'],
      ['Poll interval', worker.intervalSeconds ? worker.intervalSeconds + ' seconds' : automation.pollIntervalSeconds ? automation.pollIntervalSeconds + ' seconds' : 'Not configured'],
      ['Last check', time(worker.lastTickAt)],
      ['Capacity wait', worker.lastScheduleReason || 'None'],
      ['Last error', worker.lastError || worker.capacityError || 'None'],
    ]);

    const review = data.configuration?.review || {};
    renderFacts('manager-review-workflow-facts', [
      ['Workflow', workflowLabel(review.workflow)],
      ['Reviewer model', data.models?.reviewer || 'Not configured'],
      ['Thinking', data.models?.reviewerThinking || 'Default'],
      ['Light-model round limit', review.quickMaxRounds ?? 'Not configured'],
      ...(review.workflow === 'quick-manual' ? [] : [['Full-review round limit', review.fullMaxRounds ?? 'Not configured']]),
      ['Approved PR auto-merge', review.autoMergeApproved ? 'Enabled' : 'Disabled'],
    ]);

    const reviewBadge = document.querySelector('[data-manager-badge="reviews"]');
    if (reviewBadge) {
      const reviewItems = (data.workQueue?.items || []).filter((item) => ['review-queued', 'reviewing', 'changes-requested', 'fixing', 'review-failed'].includes(item.stage));
      const attention = reviewItems.filter((item) => ['changes-requested', 'review-failed'].includes(item.stage)).length;
      reviewBadge.textContent = String(reviewItems.length);
      reviewBadge.classList.toggle('visible', reviewItems.length > 0);
      reviewBadge.classList.toggle('attention', attention > 0);
    }
    renameNavigation(); patchVisibleHeader(); patchOverviewTerminology();
    if (activeView() === 'automation') queueMicrotask(() => loadIssuePlan());
  }

  function onViewChanged() {
    patchVisibleHeader();
    if (activeView() === 'automation') loadIssuePlan({ force: true });
    else clearIssuePlanRefreshTimer();
  }

  function build() {
    if (built) return; built = true;
    renameNavigation(); buildIssues(); buildPrReviews(); patchVisibleHeader(); patchOverviewTerminology();
    const nav = document.querySelector('.manager-sidebar-nav');
    if (nav) {
      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'aria-current')) queueMicrotask(onViewChanged);
      });
      observer.observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    }
    window.addEventListener('popstate', () => queueMicrotask(onViewChanged));
    try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
    if (activeView() === 'automation') loadIssuePlan({ force: true });
  }

  const previous = window.renderStatus;
  if (typeof previous === 'function') {
    window.renderStatus = function managerIssuesPrReviewsRenderStatus(data) {
      const result = previous(data); render(data); return result;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithIssuesPrReviews(html) {
  const styled = injectIntoHead(html, `<style data-manager-issues-pr-reviews-style>${MANAGER_ISSUES_PR_REVIEWS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-issues-pr-reviews>${MANAGER_ISSUES_PR_REVIEWS_SCRIPT}</script>`);
}
