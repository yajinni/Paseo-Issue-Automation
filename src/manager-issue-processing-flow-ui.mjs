import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_ISSUE_PROCESSING_FLOW_STYLE = String.raw`
.manager-issues-layout{grid-template-columns:1fr!important}
.manager-issue-processing-card{margin:0!important}
.manager-issue-processing-card .facts{grid-template-columns:minmax(190px,.55fr) minmax(0,1.45fr)}
.manager-issue-processing-state{display:inline-flex;align-items:center;gap:7px;font-weight:750}
.manager-issue-processing-state::before{content:'';width:9px;height:9px;border-radius:999px;background:#718298}
.manager-issue-processing-state.running::before{background:#3fa66a}.manager-issue-processing-state.paused::before{background:#9aa7b6}.manager-issue-processing-state.attention::before{background:#d38a3a}
.manager-issue-processing-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.manager-issue-processing-actions button{min-width:0}
.manager-issue-flow-shell{margin-top:14px;border:1px solid #2d394b;border-radius:11px;background:#0f1620;overflow:hidden}
.manager-issue-flow-toolbar{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:13px 14px;border-bottom:1px solid #253042;background:#121b27}
.manager-issue-flow-toolbar strong{display:block;margin-bottom:3px}.manager-issue-flow-toolbar p{margin:0;color:#8fa0b4;font-size:12px;line-height:1.4}.manager-issue-flow-limit{white-space:nowrap;border:1px solid #3b4b61;border-radius:999px;padding:5px 9px;color:#c9d5e5;font-size:12px}
.manager-issue-flow-scroll{overflow:auto;padding:16px}.manager-issue-flow{display:flex;align-items:stretch;gap:36px;min-width:max-content}
.manager-issue-wave{position:relative;width:285px;flex:0 0 285px;border:1px solid #344357;border-radius:11px;background:#121a25;padding:11px}.manager-issue-wave+.manager-issue-wave::before{content:'→';position:absolute;left:-27px;top:45px;color:#718298;font-size:22px;font-weight:800}
.manager-issue-wave-head{padding:2px 2px 10px;border-bottom:1px solid #253042;margin-bottom:10px}.manager-issue-wave-head strong{display:block}.manager-issue-wave-head span{display:block;color:#8fa0b4;font-size:11px;margin-top:3px;line-height:1.35}
.manager-issue-wave-nodes{display:grid;gap:9px}.manager-flow-node{border:1px solid #2d394b;border-radius:9px;padding:10px;background:#0e151f;min-width:0}.manager-flow-node.active{border-color:#476b9e}.manager-flow-node.next,.manager-flow-node.eligible{border-color:#3d7253}.manager-flow-node.blocked{border-color:#705b38}.manager-flow-node.skipped,.manager-flow-node.not-ready,.manager-flow-node.excluded-label{opacity:.72}
.manager-flow-node-title{font-weight:750;font-size:13px;line-height:1.35}.manager-flow-node-title a{color:#dbeafe;text-decoration:none}.manager-flow-node-title a:hover{text-decoration:underline}.manager-flow-node-state{display:inline-flex;margin-top:6px;border-radius:999px;padding:3px 7px;border:1px solid #3a4759;color:#aab8c9;font-size:10px;font-weight:700}.manager-flow-node.active .manager-flow-node-state{color:#b9d3ff}.manager-flow-node.next .manager-flow-node-state,.manager-flow-node.eligible .manager-flow-node-state{color:#b9e9ca}.manager-flow-node.blocked .manager-flow-node-state{color:#efc879}
.manager-flow-relations{display:grid;gap:3px;margin-top:7px;color:#8fa0b4;font-size:11px;line-height:1.35}.manager-flow-relations strong{color:#b7c6d9;font-weight:650}
.manager-issue-flow-unresolved{margin-top:14px;padding:12px;border:1px dashed #67563b;border-radius:9px;color:#d8c59d;background:#201a12}.manager-issue-flow-empty{padding:18px;color:#8fa0b4}
.manager-issue-detail-toggle{margin-top:12px;border-top:1px solid #253042;padding-top:10px}.manager-issue-detail-toggle>summary{cursor:pointer;color:#c9d5e5;font-weight:700}.manager-issue-detail-toggle .manager-issue-plan-list{margin-top:10px}
@media(max-width:700px){.manager-issue-processing-card .facts{grid-template-columns:1fr}.manager-issue-processing-card .facts dd{margin-bottom:8px}.manager-issue-flow-toolbar{display:block}.manager-issue-flow-limit{display:inline-flex;margin-top:9px}.manager-issue-wave{width:250px;flex-basis:250px}}
`;

export const MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT = String.raw`
(function managerIssueProcessingFlow() {
  let latestStatus = null;
  let latestPlan = null;
  let built = false;

  function findCard(root, heading) {
    for (const card of root?.querySelectorAll('section.card') || []) {
      if (card.querySelector('h2')?.textContent.trim() === heading) return card;
    }
    return null;
  }

  function addFact(target, label, value, stateClass) {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd');
    if (stateClass) {
      const state = document.createElement('span'); state.className = 'manager-issue-processing-state ' + stateClass; state.textContent = value; dd.append(state);
    } else dd.textContent = value == null || value === '' ? 'None' : String(value);
    target.append(dt, dd);
  }

  function processingState(data) {
    const claims = data?.automation?.claimsEnabled === true;
    const worker = data?.worker?.running === true;
    if (claims && worker) return { label: 'Running', className: 'running' };
    if (!claims && !worker) return { label: 'Paused', className: 'paused' };
    return { label: claims ? 'Needs attention — worker stopped' : 'Needs attention — worker running while paused', className: 'attention' };
  }

  function renderProcessing(data) {
    latestStatus = data || latestStatus;
    const target = document.getElementById('manager-unified-issue-processing-facts');
    if (!target || !latestStatus) return;
    const automation = latestStatus.automation || {};
    const worker = latestStatus.worker || {};
    const selection = latestStatus.configuration?.issueSelection || {};
    const state = processingState(latestStatus);
    target.textContent = '';
    addFact(target, 'State', state.label, state.className);
    addFact(target, 'Issue selection', selection.mode === 'all-open' ? 'All open issues' : 'Recommended labels');
    addFact(target, 'Processing order', 'Lowest eligible issue number first');
    addFact(target, 'Dependencies', 'Native GitHub blocked-by relationships');
    addFact(target, 'Maximum simultaneous issues', automation.maxActive ?? 'Not configured');
    addFact(target, 'Poll interval', (worker.intervalSeconds || automation.pollIntervalSeconds) ? (worker.intervalSeconds || automation.pollIntervalSeconds) + ' seconds' : 'Not configured');
    addFact(target, 'Last check', worker.lastTickAt ? new Date(worker.lastTickAt).toLocaleString() : 'Not yet');
    addFact(target, 'Temporary failure retries', selection.temporaryFailureRetries ?? 'Not configured');
    addFact(target, 'Excluded labels', (selection.excludedLabels || []).join(', ') || 'None');
    addFact(target, 'Capacity wait', worker.lastScheduleReason || 'None');
    addFact(target, 'Last error', worker.lastError || worker.capacityError || 'None');
    const start = document.getElementById('manager-start-issue-processing');
    const pause = document.getElementById('manager-pause-issue-processing');
    if (start) start.disabled = state.className === 'running';
    if (pause) pause.disabled = state.className === 'paused';
    if (latestPlan) renderFlow(latestPlan);
  }

  async function runAction(button, action) {
    if (typeof window.postRepositoryAction !== 'function') return;
    await window.postRepositoryAction(action);
  }

  function actionButton(id, text, action, className = '') {
    const button = document.createElement('button'); button.type = 'button'; button.id = id; button.textContent = text;
    button.className = 'repository-action ' + className; button.dataset.action = action;
    button.addEventListener('click', (event) => { event.preventDefault(); runAction(button, action).catch((error) => window.showError ? window.showError(error) : console.error(error)); });
    return button;
  }

  function buildUnifiedCard() {
    const view = document.querySelector('[data-manager-view="automation"]'); if (!view) return;
    const layout = view.querySelector('.manager-issues-layout'); if (!layout) return;
    const workflow = findCard(view, 'Issue workflow');
    const worker = findCard(view, 'Issue-processing worker');
    const workload = findCard(view, 'Issue workload');
    if (!workflow || !worker || !workload) return;

    const card = document.createElement('section'); card.className = 'card manager-issue-processing-card wide';
    const title = document.createElement('h2'); title.textContent = 'Issue processing';
    const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = 'Controls the complete background issue-processing loop: selecting eligible issues, respecting dependencies and capacity, and starting coding work.';
    const facts = document.createElement('dl'); facts.className = 'facts'; facts.id = 'manager-unified-issue-processing-facts';
    const actions = document.createElement('div'); actions.className = 'manager-issue-processing-actions';
    actions.append(
      actionButton('manager-start-issue-processing', 'Start issue processing', 'issue-processing/start'),
      actionButton('manager-pause-issue-processing', 'Pause issue processing', 'issue-processing/pause', 'secondary'),
      actionButton('manager-process-now', 'Process now', 'run-now', 'secondary'),
      actionButton('manager-recheck-dependencies', 'Recheck dependencies', 'reconcile', 'secondary'),
    );
    card.append(title, copy, facts, actions);
    layout.replaceChildren(card, workload);
  }

  function prepareWorkload() {
    const view = document.querySelector('[data-manager-view="automation"]');
    const workload = findCard(view, 'Issue workload'); if (!workload) return;
    const description = workload.querySelector('p.muted');
    if (description) description.textContent = 'Dependency flow shows which issues can move together, what unlocks later work, and how the simultaneous-issue limit affects actual execution.';
    const summary = workload.querySelector('#manager-issue-plan-summary');
    const list = workload.querySelector('#manager-issue-plan-list');
    if (!summary || !list) return;
    const shell = document.createElement('div'); shell.id = 'manager-issue-flow-shell'; shell.className = 'manager-issue-flow-shell';
    shell.innerHTML = '<div class="manager-issue-flow-empty">Loading dependency flow…</div>';
    const details = document.createElement('details'); details.className = 'manager-issue-detail-toggle';
    const detailsSummary = document.createElement('summary'); detailsSummary.textContent = 'Issue details';
    list.before(shell);
    details.append(detailsSummary, list);
    shell.after(details);
  }

  function dependencyGraph(plan) {
    const items = new Map((plan.items || []).map((item) => [Number(item.issueNumber), item]));
    const automatic = new Set((plan.items || [])
      .filter((item) => ['active', 'next', 'eligible', 'blocked', 'skipped'].includes(item.statusId))
      .map((item) => Number(item.issueNumber)));
    const included = new Set(automatic);
    let changed = true;
    while (changed) {
      changed = false;
      for (const number of [...included]) {
        for (const dep of items.get(number)?.dependencies || []) {
          const dependencyNumber = Number(dep);
          if (items.has(dependencyNumber) && !included.has(dependencyNumber)) { included.add(dependencyNumber); changed = true; }
        }
      }
    }
    const dependencies = new Map();
    const unlocks = new Map([...included].map((number) => [number, []]));
    for (const number of included) {
      const deps = (items.get(number)?.dependencies || []).map(Number).filter((dep) => included.has(dep));
      dependencies.set(number, deps);
      for (const dep of deps) unlocks.get(dep)?.push(number);
    }
    const remaining = new Set(included);
    const resolved = new Set();
    const waves = [];
    while (remaining.size) {
      const wave = [...remaining]
        .filter((number) => (dependencies.get(number) || []).every((dep) => resolved.has(dep) || !remaining.has(dep)))
        .sort((a, b) => a - b);
      if (!wave.length) break;
      waves.push(wave);
      for (const number of wave) { remaining.delete(number); resolved.add(number); }
    }
    return { items, automatic, waves, unresolved: [...remaining].sort((a, b) => a - b), dependencies, unlocks };
  }

  function nodeFor(item, automatic, dependencies, unlocks) {
    const node = document.createElement('div'); node.className = 'manager-flow-node ' + (item.statusId || 'rejected');
    const title = document.createElement('div'); title.className = 'manager-flow-node-title';
    const link = item.url ? document.createElement('a') : document.createElement('span');
    if (item.url) { link.href = item.url; link.target = '_blank'; link.rel = 'noreferrer'; }
    link.textContent = '#' + item.issueNumber + ' ' + item.title; title.append(link);
    const state = document.createElement('span'); state.className = 'manager-flow-node-state';
    state.textContent = automatic ? item.status : 'Dependency outside automatic selection';
    const relations = document.createElement('div'); relations.className = 'manager-flow-relations';
    const deps = dependencies || [];
    if (deps.length) { const row = document.createElement('div'); row.innerHTML = '<strong>After:</strong> ' + deps.map((n) => '#' + n).join(', '); relations.append(row); }
    if ((unlocks || []).length) { const row = document.createElement('div'); row.innerHTML = '<strong>Unlocks:</strong> ' + unlocks.map((n) => '#' + n).join(', '); relations.append(row); }
    node.append(title, state); if (relations.childElementCount) node.append(relations); return node;
  }

  function renderFlow(plan) {
    latestPlan = plan;
    const shell = document.getElementById('manager-issue-flow-shell'); if (!shell) return;
    shell.textContent = '';
    if (!plan || plan.available === false) {
      const empty = document.createElement('div'); empty.className = 'manager-issue-flow-empty'; empty.textContent = 'Dependency flow unavailable: ' + (plan?.error || 'Unknown error'); shell.append(empty); return;
    }
    const graph = dependencyGraph(plan);
    const toolbar = document.createElement('div'); toolbar.className = 'manager-issue-flow-toolbar';
    const copy = document.createElement('div'); copy.innerHTML = '<strong>Automatic processing flow</strong><p>Each column is a dependency wave. Issues in the same wave can proceed in parallel once their prerequisites are satisfied.</p>';
    const maxActive = Number(latestStatus?.automation?.maxActive || 1);
    const limit = document.createElement('span'); limit.className = 'manager-issue-flow-limit'; limit.textContent = 'Up to ' + maxActive + ' active at once';
    toolbar.append(copy, limit); shell.append(toolbar);
    if (!graph.waves.length && !graph.unresolved.length) {
      const empty = document.createElement('div'); empty.className = 'manager-issue-flow-empty'; empty.textContent = 'No issues currently participate in automatic issue processing.'; shell.append(empty); return;
    }
    const scroll = document.createElement('div'); scroll.className = 'manager-issue-flow-scroll';
    const flow = document.createElement('div'); flow.className = 'manager-issue-flow';
    graph.waves.forEach((numbers, index) => {
      const wave = document.createElement('section'); wave.className = 'manager-issue-wave';
      const head = document.createElement('div'); head.className = 'manager-issue-wave-head';
      const name = document.createElement('strong'); name.textContent = index === 0 ? 'Wave 1 · Ready / current' : 'Wave ' + (index + 1);
      const subtitle = document.createElement('span'); subtitle.textContent = numbers.length + ' issue' + (numbers.length === 1 ? '' : 's') + ' in this dependency layer · lowest issue numbers are started first when capacity is limited.';
      head.append(name, subtitle);
      const nodes = document.createElement('div'); nodes.className = 'manager-issue-wave-nodes';
      for (const number of numbers) {
        const item = graph.items.get(number); if (!item) continue;
        nodes.append(nodeFor(item, graph.automatic.has(number), graph.dependencies.get(number), graph.unlocks.get(number)));
      }
      wave.append(head, nodes); flow.append(wave);
    });
    scroll.append(flow); shell.append(scroll);
    if (graph.unresolved.length) {
      const unresolved = document.createElement('div'); unresolved.className = 'manager-issue-flow-unresolved';
      unresolved.textContent = 'Dependency cycle or unresolved relationship: ' + graph.unresolved.map((n) => '#' + n).join(', ') + '. These issues cannot be placed into a safe execution wave.';
      shell.append(unresolved);
    }
  }

  function build() {
    if (built) return; built = true;
    buildUnifiedCard(); prepareWorkload();
    try { if (typeof currentStatus !== 'undefined' && currentStatus) renderProcessing(currentStatus); } catch {}
  }

  if (typeof window.addManagerStatusListener === 'function') {
    window.addManagerStatusListener(renderProcessing);
  }
  const previousJsonRequest = window.jsonRequest;
  if (typeof previousJsonRequest === 'function') {
    window.jsonRequest = async function unifiedIssueProcessingJsonRequest(url, options) {
      const body = await previousJsonRequest(url, options);
      if (String(url || '').includes('/issues-plan') && body?.issuePlan) renderFlow(body.issuePlan);
      return body;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
`;

export function enhanceManagerWithIssueProcessingFlow(html) {
  const styled = injectIntoHead(html, `<style data-manager-issue-processing-flow-style>${MANAGER_ISSUE_PROCESSING_FLOW_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-issue-processing-flow>${MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT}</script>`);
}
