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
.manager-dependency-map-layout{display:grid;grid-template-columns:minmax(0,1fr) 230px;min-height:560px}
.manager-dependency-map-main{min-width:0;border-right:1px solid #253042;background:radial-gradient(circle at 35% 10%,rgba(45,77,120,.12),transparent 42%),#0d141e}
.manager-dependency-map-scroll{height:100%;max-height:720px;overflow:auto;overscroll-behavior:contain}
.manager-dependency-map-canvas{position:relative;min-width:max-content;min-height:100%;padding:20px 22px 28px}
.manager-dependency-map-edges{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:visible}
.manager-dependency-map-edge{fill:none;stroke:#53647b;stroke-width:1.5;opacity:.72;vector-effect:non-scaling-stroke}
.manager-dependency-map-levels{position:relative;z-index:2;display:grid;grid-auto-flow:column;grid-auto-columns:270px;gap:76px;align-items:start}
.manager-dependency-level{min-width:0}
.manager-dependency-level-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;padding:0 2px 9px;border-bottom:1px solid #2d394b}
.manager-dependency-level-head strong{display:block;color:#dce8fb;font-size:13px}.manager-dependency-level-head span{display:block;color:#7f91a8;font-size:10px;margin-top:3px;line-height:1.35}.manager-dependency-level-count{flex:0 0 auto;border:1px solid #3b4b61;border-radius:999px;padding:3px 7px;color:#aebed2!important;margin:0!important}
.manager-dependency-level-nodes{display:grid;gap:11px}
.manager-dependency-node{position:relative;z-index:2;border:1px solid #344357;border-radius:9px;background:#111a25;padding:10px 11px;box-shadow:0 7px 18px rgba(0,0,0,.14);min-width:0}
.manager-dependency-node.active{border-color:#4775aa;background:#111f31}.manager-dependency-node.next,.manager-dependency-node.eligible{border-color:#39704f;background:#102019}.manager-dependency-node.blocked{border-color:#725c38;background:#211a12}.manager-dependency-node.skipped{border-color:#505b68;opacity:.72}.manager-dependency-node.not-ready,.manager-dependency-node.excluded-label,.manager-dependency-node.rejected{border-color:#394657;background:#111821}.manager-dependency-node.invalid-contract,.manager-dependency-node.needs-attention{border-color:#83525a;background:#24151a}
.manager-dependency-node-title{display:flex;gap:7px;align-items:flex-start;font-size:12px;font-weight:750;line-height:1.35}.manager-dependency-node-number{flex:0 0 auto;color:#8ab8ff}.manager-dependency-node-title a{color:#e2ebf8;text-decoration:none;overflow-wrap:anywhere}.manager-dependency-node-title a:hover{text-decoration:underline}.manager-dependency-node-title a:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px;border-radius:3px}
.manager-dependency-node-state{display:inline-flex;margin-top:7px;border-radius:999px;padding:3px 7px;border:1px solid #3a4759;color:#aab8c9;font-size:10px;font-weight:700}.manager-dependency-node.active .manager-dependency-node-state{color:#b9d3ff}.manager-dependency-node.next .manager-dependency-node-state,.manager-dependency-node.eligible .manager-dependency-node-state{color:#b9e9ca}.manager-dependency-node.blocked .manager-dependency-node-state{color:#efc879}
.manager-dependency-node-relations{display:grid;gap:3px;margin-top:7px;color:#8394aa;font-size:10px;line-height:1.35}.manager-dependency-node-relations strong{color:#b7c6d9;font-weight:650}
.manager-levels-panel{padding:14px;background:#101720;min-width:0}.manager-levels-panel h3{margin:0 0 4px;font-size:13px}.manager-levels-panel-intro{margin:0 0 10px;color:#718298;font-size:10px;line-height:1.35}.manager-level-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px 0;border-top:1px solid #253042}.manager-level-row:first-of-type{border-top:0}.manager-level-dot{width:8px;height:8px;border-radius:999px;margin-top:4px;background:#718298}.manager-level-row.ready .manager-level-dot{background:#4eb477}.manager-level-row.one .manager-level-dot{background:#5591dc}.manager-level-row.two .manager-level-dot{background:#9a6ed0}.manager-level-row.deep .manager-level-dot{background:#d49a3e}.manager-level-row.unresolved .manager-level-dot{background:#d55d6d}.manager-level-row strong{display:block;font-size:11px}.manager-level-row small{display:block;color:#718298;font-size:9px;margin-top:2px;line-height:1.3}.manager-level-row b{font-size:14px;color:#dce8fb}.manager-level-source{margin-top:12px;padding-top:10px;border-top:1px solid #253042;color:#718298;font-size:9px;line-height:1.4}
.manager-dependency-map-message{padding:22px;color:#9dacbf;line-height:1.5}.manager-dependency-map-message strong{display:block;color:#dce8fb;margin-bottom:4px}.manager-dependency-map-message.attention{color:#d8c59d;background:#1c1711}
.manager-issue-flow-unresolved{margin:0;padding:11px 14px;border-top:1px solid #67563b;color:#d8c59d;background:#201a12;font-size:11px;line-height:1.4}
.manager-issue-detail-toggle{margin-top:12px;border-top:1px solid #253042;padding-top:10px}.manager-issue-detail-toggle>summary{cursor:pointer;color:#c9d5e5;font-weight:700}.manager-issue-detail-toggle .manager-issue-plan-list{margin-top:10px}
@media(max-width:1050px){.manager-dependency-map-layout{grid-template-columns:1fr}.manager-dependency-map-main{border-right:0;border-bottom:1px solid #253042}.manager-levels-panel{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0 12px}.manager-levels-panel h3,.manager-levels-panel-intro,.manager-level-source{grid-column:1/-1}.manager-level-row{border-top:0}}
@media(max-width:700px){.manager-issue-processing-card .facts{grid-template-columns:1fr}.manager-issue-processing-card .facts dd{margin-bottom:8px}.manager-issue-flow-toolbar{display:block}.manager-issue-flow-limit{display:inline-flex;margin-top:9px}.manager-dependency-map-layout{min-height:460px}.manager-dependency-map-scroll{max-height:620px}.manager-dependency-map-levels{grid-auto-columns:235px;gap:54px}.manager-levels-panel{grid-template-columns:1fr}.manager-level-row{border-top:1px solid #253042}.manager-level-row:first-of-type{border-top:0}}
`;

export const MANAGER_ISSUE_PROCESSING_FLOW_SCRIPT = String.raw`
(function managerIssueProcessingFlow() {
  let latestStatus = null;
  let latestPlan = null;
  let latestPlanFingerprint = null;
  let latestPlanRepositoryId = null;
  let built = false;
  let edgeFrame = null;
  let mapResizeObserver = null;

  function currentRepositoryId() {
    return document.getElementById('repository-select')?.value || null;
  }

  function issuePlanFingerprint(plan) {
    return JSON.stringify(plan || null);
  }

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

  function updateFlowLimit() {
    const limit = document.querySelector('.manager-issue-flow-limit');
    if (!limit) return;
    const maxActive = Number(latestStatus?.automation?.maxActive || 1);
    limit.textContent = 'Up to ' + maxActive + ' active at once';
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
    updateFlowLimit();
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
    if (description) description.textContent = 'Dependency map shows how every open GitHub issue depends on the others, which work is structurally ready, and how dependency depth affects parallel work.';
    const summary = workload.querySelector('#manager-issue-plan-summary');
    const list = workload.querySelector('#manager-issue-plan-list');
    if (!summary || !list) return;
    const shell = document.createElement('div'); shell.id = 'manager-issue-flow-shell'; shell.className = 'manager-issue-flow-shell';
    shell.innerHTML = '<div class="manager-dependency-map-message">Loading dependency map…</div>';
    const details = document.createElement('details'); details.className = 'manager-issue-detail-toggle';
    const detailsSummary = document.createElement('summary'); detailsSummary.textContent = 'Issue details';
    list.before(shell);
    details.append(detailsSummary, list);
    shell.after(details);
  }

  function levelTitle(level) {
    if (level === 0) return 'Ready now';
    if (level === 1) return 'Waiting on 1 level';
    return 'Waiting on ' + level + ' levels';
  }

  function levelSubtitle(level) {
    if (level === 0) return 'No unresolved open blockers';
    return 'Longest open prerequisite chain: ' + level + ' level' + (level === 1 ? '' : 's');
  }

  function itemByNumber(plan) {
    return new Map((plan.items || []).map((item) => [Number(item.issueNumber), item]));
  }

  function nodeFor(item, graph) {
    const number = Number(item.issueNumber);
    const node = document.createElement('article');
    node.className = 'manager-dependency-node ' + (item.statusId || 'rejected');
    node.dataset.issueNumber = String(number);
    const title = document.createElement('div'); title.className = 'manager-dependency-node-title';
    const numberLabel = document.createElement('span'); numberLabel.className = 'manager-dependency-node-number'; numberLabel.textContent = '#' + number;
    const link = item.url ? document.createElement('a') : document.createElement('span');
    if (item.url) { link.href = item.url; link.target = '_blank'; link.rel = 'noreferrer'; }
    link.textContent = item.title; title.append(numberLabel, link);
    const state = document.createElement('span'); state.className = 'manager-dependency-node-state'; state.textContent = item.status || 'Open issue';
    const relations = document.createElement('div'); relations.className = 'manager-dependency-node-relations';
    const blockers = graph.dependencies?.[number] || [];
    const unlocks = graph.unlocks?.[number] || [];
    if (blockers.length) { const row = document.createElement('div'); row.innerHTML = '<strong>Blocked by:</strong> ' + blockers.map((n) => '#' + n).join(', '); relations.append(row); }
    if (unlocks.length) { const row = document.createElement('div'); row.innerHTML = '<strong>Unlocks:</strong> ' + unlocks.map((n) => '#' + n).join(', '); relations.append(row); }
    node.append(title, state); if (relations.childElementCount) node.append(relations); return node;
  }

  function levelColumn(level, numbers, items, graph, unresolved = false) {
    const section = document.createElement('section'); section.className = 'manager-dependency-level';
    const head = document.createElement('div'); head.className = 'manager-dependency-level-head';
    const copy = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = unresolved ? 'Unresolved / cycle' : levelTitle(level);
    const subtitle = document.createElement('span'); subtitle.textContent = unresolved ? 'Cannot be assigned a safe dependency level' : levelSubtitle(level);
    copy.append(name, subtitle);
    const count = document.createElement('span'); count.className = 'manager-dependency-level-count'; count.textContent = String(numbers.length);
    head.append(copy, count);
    const nodes = document.createElement('div'); nodes.className = 'manager-dependency-level-nodes';
    for (const number of numbers) {
      const item = items.get(Number(number)); if (item) nodes.append(nodeFor(item, graph));
    }
    section.append(head, nodes); return section;
  }

  function levelRow(className, title, description, count) {
    const row = document.createElement('div'); row.className = 'manager-level-row ' + className;
    const dot = document.createElement('span'); dot.className = 'manager-level-dot';
    const copy = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = title;
    const small = document.createElement('small'); small.textContent = description;
    copy.append(strong, small);
    const value = document.createElement('b'); value.textContent = String(count || 0);
    row.append(dot, copy, value); return row;
  }

  function levelsPanel(graph) {
    const panel = document.createElement('aside'); panel.className = 'manager-levels-panel'; panel.setAttribute('aria-label', 'Dependency levels');
    const title = document.createElement('h3'); title.textContent = 'Levels';
    const intro = document.createElement('p'); intro.className = 'manager-levels-panel-intro'; intro.textContent = 'Derived only from native GitHub blocked-by relationships.';
    const counts = graph?.counts || {};
    panel.append(
      title,
      intro,
      levelRow('ready', 'Ready now', 'No unresolved open blockers', counts.readyNow),
      levelRow('one', 'Waiting on 1 level', 'Deepest blocker is ready now', counts.waitingOnOneLevel),
      levelRow('two', 'Waiting on 2 levels', 'Two dependency levels deep', counts.waitingOnTwoLevels),
      levelRow('deep', 'Waiting on 3+ levels', 'Three or more levels deep', counts.waitingOnThreePlusLevels),
      levelRow('unresolved', 'Unresolved / cycle', 'No safe topological level', counts.unresolved),
    );
    const source = document.createElement('div'); source.className = 'manager-level-source';
    source.textContent = 'Exact levels remain visible as separate columns in the map. Processing labels only affect card status; they do not create dependency edges.';
    panel.append(source); return panel;
  }

  function drawMapEdges(plan) {
    const graph = plan?.graph;
    const canvas = document.querySelector('.manager-dependency-map-canvas');
    const svg = canvas?.querySelector('.manager-dependency-map-edges');
    if (!graph || !canvas || !svg) return;
    svg.textContent = '';
    const width = Math.max(canvas.scrollWidth, canvas.clientWidth);
    const height = Math.max(canvas.scrollHeight, canvas.clientHeight);
    svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height)); svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    const namespace = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(namespace, 'defs');
    const marker = document.createElementNS(namespace, 'marker'); marker.setAttribute('id', 'manager-dependency-arrow'); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '8'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5'); marker.setAttribute('orient', 'auto-start-reverse');
    const arrow = document.createElementNS(namespace, 'path'); arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('fill', '#53647b'); marker.append(arrow); defs.append(marker); svg.append(defs);
    const canvasRect = canvas.getBoundingClientRect();
    for (const [targetText, blockers] of Object.entries(graph.dependencies || {})) {
      const targetNumber = Number(targetText);
      const target = canvas.querySelector('[data-issue-number="' + targetNumber + '"]');
      if (!target) continue;
      const targetRect = target.getBoundingClientRect();
      for (const blocker of blockers || []) {
        const source = canvas.querySelector('[data-issue-number="' + Number(blocker) + '"]');
        if (!source) continue;
        const sourceRect = source.getBoundingClientRect();
        const startX = sourceRect.right - canvasRect.left;
        const startY = sourceRect.top - canvasRect.top + sourceRect.height / 2;
        const endX = targetRect.left - canvasRect.left;
        const endY = targetRect.top - canvasRect.top + targetRect.height / 2;
        const bend = Math.max(34, Math.abs(endX - startX) * .45);
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('class', 'manager-dependency-map-edge');
        path.setAttribute('marker-end', 'url(#manager-dependency-arrow)');
        path.setAttribute('d', 'M ' + startX + ' ' + startY + ' C ' + (startX + bend) + ' ' + startY + ', ' + (endX - bend) + ' ' + endY + ', ' + endX + ' ' + endY);
        svg.append(path);
      }
    }
  }

  function scheduleEdges(plan) {
    if (edgeFrame !== null) cancelAnimationFrame(edgeFrame);
    edgeFrame = requestAnimationFrame(() => { edgeFrame = null; drawMapEdges(plan); });
  }

  function renderMapBody(plan, shell, scrollState) {
    const graph = plan.graph;
    const layout = document.createElement('div'); layout.className = 'manager-dependency-map-layout';
    const main = document.createElement('div'); main.className = 'manager-dependency-map-main';
    if (!graph) {
      const message = document.createElement('div'); message.className = 'manager-dependency-map-message attention'; message.innerHTML = '<strong>Dependency map data is unavailable.</strong>The server did not return the all-open dependency graph.'; main.append(message);
      layout.append(main, levelsPanel(null)); shell.append(layout); return;
    }
    if (graph.available === false) {
      const missing = (graph.unavailableIssueNumbers || []).map((number) => '#' + number).join(', ');
      const message = document.createElement('div'); message.className = 'manager-dependency-map-message attention';
      const strong = document.createElement('strong'); strong.textContent = 'Native GitHub dependency data is unavailable.';
      const copy = document.createElement('span'); copy.textContent = missing ? ' Relationship data is missing for ' + missing + '. Paseo will not invent dependency levels.' : ' Paseo will not invent dependency levels.';
      message.append(strong, copy); main.append(message);
      layout.append(main, levelsPanel(graph)); shell.append(layout); return;
    }

    const scroll = document.createElement('div'); scroll.className = 'manager-dependency-map-scroll';
    const canvas = document.createElement('div'); canvas.className = 'manager-dependency-map-canvas';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('manager-dependency-map-edges'); svg.setAttribute('aria-hidden', 'true');
    const levels = document.createElement('div'); levels.className = 'manager-dependency-map-levels';
    const items = itemByNumber(plan);
    for (const entry of graph.levels || []) levels.append(levelColumn(Number(entry.level), entry.issueNumbers || [], items, graph));
    if ((graph.unresolvedIssueNumbers || []).length) levels.append(levelColumn(null, graph.unresolvedIssueNumbers, items, graph, true));
    canvas.append(svg, levels); scroll.append(canvas); main.append(scroll);
    layout.append(main, levelsPanel(graph)); shell.append(layout);
    scroll.scrollLeft = scrollState.left; scroll.scrollTop = scrollState.top;
    if (mapResizeObserver) mapResizeObserver.disconnect();
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver(() => scheduleEdges(plan));
      mapResizeObserver.observe(canvas);
    }
    scheduleEdges(plan);
    if ((graph.unresolvedIssueNumbers || []).length) {
      const unresolved = document.createElement('div'); unresolved.className = 'manager-issue-flow-unresolved';
      const cycles = (graph.cycleIssueNumbers || []).length ? ' Cycle members: ' + graph.cycleIssueNumbers.map((number) => '#' + number).join(', ') + '.' : '';
      unresolved.textContent = 'Some open issues cannot be assigned a safe dependency level.' + cycles;
      shell.append(unresolved);
    }
  }

  function renderFlow(plan, repositoryId = currentRepositoryId()) {
    latestPlan = plan;
    latestPlanFingerprint = issuePlanFingerprint(plan);
    latestPlanRepositoryId = repositoryId;
    const shell = document.getElementById('manager-issue-flow-shell'); if (!shell) return;
    const previousScroll = shell.querySelector('.manager-dependency-map-scroll');
    const scrollState = { left: previousScroll?.scrollLeft || 0, top: previousScroll?.scrollTop || 0 };
    if (mapResizeObserver) { mapResizeObserver.disconnect(); mapResizeObserver = null; }
    shell.textContent = '';
    if (!plan || plan.available === false) {
      const empty = document.createElement('div'); empty.className = 'manager-dependency-map-message attention'; empty.textContent = 'Dependency map unavailable: ' + (plan?.error || 'Unknown error'); shell.append(empty); return;
    }
    const toolbar = document.createElement('div'); toolbar.className = 'manager-issue-flow-toolbar';
    const copy = document.createElement('div'); copy.innerHTML = '<strong>Dependency map</strong><p>Every open issue is placed by real native GitHub dependency depth. Automatic-processing state is shown on each card but does not define the graph.</p>';
    const limit = document.createElement('span'); limit.className = 'manager-issue-flow-limit';
    toolbar.append(copy, limit); shell.append(toolbar);
    updateFlowLimit();
    renderMapBody(plan, shell, scrollState);
  }

  window.renderManagerIssueDependencyMap = function renderManagerIssueDependencyMap(plan, repositoryId = currentRepositoryId()) {
    const fingerprint = issuePlanFingerprint(plan);
    if (repositoryId === latestPlanRepositoryId && fingerprint === latestPlanFingerprint) {
      latestPlan = plan;
      updateFlowLimit();
      return false;
    }
    renderFlow(plan, repositoryId);
    return true;
  };

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
      if (String(url || '').includes('/issues-plan') && body?.issuePlan) {
        window.renderManagerIssueDependencyMap(body.issuePlan, currentRepositoryId());
      }
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
