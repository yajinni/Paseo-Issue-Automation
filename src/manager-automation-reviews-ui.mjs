import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_AUTOMATION_REVIEWS_STYLE = String.raw`
.manager-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.manager-ops-grid>.wide{grid-column:1/-1}
.manager-ops-card{margin:0!important}
.manager-ops-card h2{margin-bottom:5px}.manager-ops-card .muted{margin-top:0}
.manager-ops-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.manager-ops-actions:empty{display:none}
.manager-profile-state{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.manager-profile-copy{min-width:0}.manager-profile-copy p{margin:5px 0 0;line-height:1.45}
.manager-profile-blockers{display:grid;gap:8px;margin-top:12px}
.manager-profile-blocker{padding:9px 11px;border:1px solid #5f4144;border-radius:9px;background:#2a191d;color:#e6c8cc}
.manager-review-stage-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.manager-review-stage-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #344357;border-radius:999px;padding:6px 9px;background:#151f2c;color:#c9d5e5;font-size:12px}
.manager-review-stage-chip strong{color:#fff}
.manager-technical-details{margin:0!important}.manager-technical-details>summary{cursor:pointer;font-weight:650;color:#dce8fb}.manager-technical-details>.card{margin-top:12px!important}
@media(max-width:760px){.manager-ops-grid{grid-template-columns:1fr}.manager-ops-grid>.wide{grid-column:auto}.manager-profile-state{display:block}.manager-profile-state .manager-ops-actions{margin-top:12px}}
`;

export const MANAGER_AUTOMATION_REVIEWS_SCRIPT = String.raw`
(function managerAutomationReviews() {
  const REVIEW_STAGES = ['review-queued', 'reviewing', 'changes-requested', 'fixing', 'review-failed'];
  let built = false;

  function findCard(root, heading) {
    if (!root) return null;
    for (const card of root.querySelectorAll('section.card')) {
      if (card.querySelector('h2')?.textContent.trim() === heading) return card;
    }
    return null;
  }

  function factsList(id) {
    const dl = document.createElement('dl');
    dl.className = 'facts';
    dl.id = id;
    const dt = document.createElement('dt'); dt.textContent = 'State';
    const dd = document.createElement('dd'); dd.textContent = 'Loading…';
    dl.append(dt, dd);
    return dl;
  }

  function card(title, description, factsId) {
    const section = document.createElement('section');
    section.className = 'card manager-ops-card';
    const heading = document.createElement('h2'); heading.textContent = title;
    const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = description;
    section.append(heading, copy);
    if (factsId) section.append(factsList(factsId));
    return section;
  }

  function actionArea(section) {
    const area = document.createElement('div');
    area.className = 'manager-ops-actions';
    section.append(area);
    return area;
  }

  function moveAction(source, target, action) {
    const button = source?.querySelector('[data-action="' + action + '"]');
    if (button) target.append(button);
  }

  function workflowLabel(workflow) {
    if (workflow === 'quick-manual') return 'Quick → Manual';
    if (workflow === 'quick-web-chatgpt') return 'Quick → Web ChatGPT';
    if (workflow === 'full-immediate') return 'Full review immediately';
    return workflow || 'Not configured';
  }

  function renderFacts(id, entries) {
    const target = document.getElementById(id);
    if (!target) return;
    target.textContent = '';
    for (const [label, value] of entries) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value == null || value === '' ? 'Not configured' : String(value);
      target.append(dt, dd);
    }
  }

  function time(value) {
    if (!value) return 'Not yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function reviewCounts(data) {
    const counts = data.workQueue?.counts || {};
    return REVIEW_STAGES.map((stage) => [stage, Number(counts[stage] || 0)]).filter(([, count]) => count > 0);
  }

  function stageLabel(stage) {
    const labels = {
      'review-queued': 'Queued', reviewing: 'Reviewing', 'changes-requested': 'Changes requested',
      fixing: 'Fixing', 'review-failed': 'Failed',
    };
    return labels[stage] || stage;
  }

  function renderStageCounts(data) {
    const target = document.getElementById('manager-review-stage-counts');
    if (!target) return;
    const entries = reviewCounts(data);
    target.textContent = '';
    if (!entries.length) {
      const empty = document.createElement('span'); empty.className = 'muted'; empty.textContent = 'No recorded PRs are currently in a review stage.';
      target.append(empty);
      return;
    }
    for (const [stage, count] of entries) {
      const chip = document.createElement('span'); chip.className = 'manager-review-stage-chip';
      const label = document.createElement('span'); label.textContent = stageLabel(stage);
      const value = document.createElement('strong'); value.textContent = String(count);
      chip.append(label, value); target.append(chip);
    }
  }

  function renderProfile(data) {
    const profile = data.chatGptProfile || {};
    const title = document.getElementById('manager-profile-title');
    const summary = document.getElementById('manager-profile-summary');
    const badge = document.getElementById('manager-profile-badge');
    const blockers = document.getElementById('manager-profile-blockers');
    const setup = document.getElementById('manager-profile-setup');
    if (!title || !summary || !badge || !blockers || !setup) return;
    title.textContent = profile.required ? 'ChatGPT Profile' : 'ChatGPT Profile not required';
    summary.textContent = profile.summary || 'No ChatGPT Profile status is available.';
    badge.className = 'paseo-status-chip ' + (!profile.required ? 'neutral' : profile.ready ? 'success' : 'danger');
    badge.textContent = !profile.required ? 'Not used' : profile.ready ? 'Ready' : profile.known ? 'Needs attention' : 'Not verified';
    blockers.textContent = '';
    for (const blocker of profile.blockers || []) {
      const item = document.createElement('div'); item.className = 'manager-profile-blocker'; item.textContent = blocker.message || blocker.code;
      blockers.append(item);
    }
    setup.href = profile.setupPath || '/setup/review';
    setup.textContent = profile.required ? (profile.ready ? 'Open Review setup' : 'Verify in Review setup') : 'Open Review setup';
    setup.hidden = !profile.required;
  }

  function setReviewBadge(data) {
    const badge = document.querySelector('[data-manager-badge="reviews"]');
    if (!badge) return;
    const reviewItems = (data.workQueue?.items || []).filter((item) => REVIEW_STAGES.includes(item.stage));
    const attention = reviewItems.filter((item) => ['changes-requested', 'review-failed'].includes(item.stage)).length;
    const count = reviewItems.length;
    badge.textContent = String(count);
    badge.classList.toggle('visible', count > 0);
    badge.classList.toggle('attention', attention > 0 || data.chatGptProfile?.required && data.chatGptProfile?.ready === false);
  }

  function render(data) {
    if (!data) return;
    const automation = data.automation || {};
    const worker = data.worker || {};
    const reviewWorker = data.reviewWorker || {};
    const review = data.configuration?.review || {};
    renderFacts('manager-claims-facts', [
      ['Claims', automation.claimsEnabled ? 'Enabled' : 'Paused'],
      ['Poll interval', (automation.pollIntervalSeconds || 0) + ' seconds'],
      ['Repository max active', automation.maxActive ?? 'Not configured'],
      ['Last dispatch', time(automation.lastDispatchAt)],
    ]);
    renderFacts('manager-coding-worker-facts', [
      ['Worker', worker.running ? 'Running' : 'Stopped'],
      ['Interval', worker.intervalSeconds ? worker.intervalSeconds + ' seconds' : 'Not running'],
      ['Last tick', time(worker.lastTickAt)],
      ['Capacity wait', worker.lastScheduleReason || 'None'],
      ['Last error', worker.lastError || worker.capacityError || 'None'],
    ]);
    renderFacts('manager-review-workflow-facts', [
      ['Workflow', workflowLabel(review.workflow)],
      ['Reviewer model', data.models?.reviewer || 'Not configured'],
      ['Thinking', data.models?.reviewerThinking || 'Default'],
      ['Quick round limit', review.quickMaxRounds ?? 'Not configured'],
      ['Full round limit', review.fullMaxRounds ?? 'Not configured'],
      ['Approved PR auto-merge', review.autoMergeApproved ? 'Enabled' : 'Disabled'],
    ]);
    renderFacts('manager-review-worker-facts', [
      ['Worker', reviewWorker.running ? 'Running' : 'Stopped'],
      ['Last review tick', time(reviewWorker.lastReviewTickAt)],
      ['Review in progress', reviewWorker.reviewTicking ? 'Yes' : 'No'],
      ['Last review error', reviewWorker.lastReviewError || 'None'],
      ['Last reconciliation', time(reviewWorker.lastReconciliationAt)],
      ['Reconciliation in progress', reviewWorker.reconciling ? 'Yes' : 'No'],
      ['Reconciliation error', reviewWorker.lastReconciliationError || 'None'],
    ]);
    renderStageCounts(data);
    renderProfile(data);
    setReviewBadge(data);
  }

  function build() {
    if (built) return;
    const automationView = document.querySelector('[data-manager-view="automation"]');
    const reviewsView = document.querySelector('[data-manager-view="reviews"]');
    const maintenanceView = document.querySelector('[data-manager-view="maintenance"]');
    if (!automationView || !reviewsView) return;
    built = true;

    const oldAutomation = findCard(automationView, 'Automation');
    const oldControls = findCard(automationView, 'Automation controls');
    const oldReview = findCard(reviewsView, 'Review status');

    const automationGrid = document.createElement('div'); automationGrid.className = 'manager-ops-grid';
    const claims = card('Claims & scheduling', 'Repository-scoped scheduling controls for eligible issue work.', 'manager-claims-facts');
    const claimsActions = actionArea(claims);
    for (const action of ['resume', 'pause', 'run-now', 'reconcile']) moveAction(oldControls, claimsActions, action);
    const coding = card('Coding worker', 'Starts or stops the selected repository coding poller. Manager-wide capacity remains under Manager Settings.', 'manager-coding-worker-facts');
    const codingActions = actionArea(coding);
    for (const action of ['worker/start', 'worker/stop', 'worker/restart']) moveAction(oldControls, codingActions, action);
    automationGrid.append(claims, coding);
    automationView.prepend(automationGrid);

    const reviewGrid = document.createElement('div'); reviewGrid.className = 'manager-ops-grid';
    const workflow = card('Review workflow', 'Selected review path and reviewer configuration for coding pull requests.', 'manager-review-workflow-facts');
    const stages = card('Review workload', 'Recorded pull requests currently moving through review and fix stages.');
    const stageList = document.createElement('div'); stageList.id = 'manager-review-stage-counts'; stageList.className = 'manager-review-stage-list'; stages.append(stageList);
    const reviewWorker = card('PR-review worker', 'Repository-scoped review scheduler and reconciliation state.', 'manager-review-worker-facts');
    const reviewActions = actionArea(reviewWorker);
    for (const action of ['review-worker/start', 'review-worker/stop', 'review-worker/restart']) moveAction(oldControls, reviewActions, action);
    const profile = card('ChatGPT Profile', 'Web ChatGPT review uses the setup-managed browser profile and repository-specific review chat.');
    profile.classList.add('wide');
    const profileState = document.createElement('div'); profileState.className = 'manager-profile-state';
    profileState.innerHTML = '<div class="manager-profile-copy"><div><strong id="manager-profile-title">ChatGPT Profile</strong> <span id="manager-profile-badge" class="paseo-status-chip neutral">Loading…</span></div><p id="manager-profile-summary" class="muted">Loading…</p></div><div class="manager-ops-actions"><a id="manager-profile-setup" class="paseo-action" href="/setup/review">Open Review setup</a></div>';
    const profileBlockers = document.createElement('div'); profileBlockers.id = 'manager-profile-blockers'; profileBlockers.className = 'manager-profile-blockers';
    profile.append(profileState, profileBlockers);
    reviewGrid.append(workflow, stages, reviewWorker, profile);
    reviewsView.replaceChildren(reviewGrid);

    if (oldAutomation && maintenanceView) {
      const technical = document.createElement('details'); technical.className = 'card manager-technical-details';
      const summary = document.createElement('summary'); summary.textContent = 'Technical automation status';
      technical.append(summary, oldAutomation); maintenanceView.append(technical);
    }
    oldControls?.remove();
    oldReview?.remove();
    try { if (typeof currentStatus !== 'undefined' && currentStatus) render(currentStatus); } catch {}
  }

  const previous = window.renderStatus;
  if (typeof previous === 'function') {
    window.renderStatus = function managerAutomationReviewsRenderStatus(data) {
      const result = previous(data);
      render(data);
      return result;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithAutomationReviews(html) {
  const styled = injectIntoHead(html, `<style data-manager-automation-reviews-style>${MANAGER_AUTOMATION_REVIEWS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-automation-reviews>${MANAGER_AUTOMATION_REVIEWS_SCRIPT}</script>`);
}
