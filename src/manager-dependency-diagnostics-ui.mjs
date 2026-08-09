import { injectIntoBody, injectIntoHead } from './ui-html.mjs';

export const MANAGER_DEPENDENCY_DIAGNOSTICS_STYLE = String.raw`
.manager-dependency-map-tools{display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap}.manager-dependency-map-tools button{padding:5px 8px;border:1px solid #3b4b61;background:#182332;color:#c9d5e5;border-radius:7px;font-size:10px}.manager-dependency-map-tools button:hover{background:#202d3e}.manager-dependency-map-tools button:focus-visible{outline:2px solid #8ab8ff;outline-offset:2px}.manager-dependency-map-tools button[aria-pressed="true"]{border-color:#7d5fb1;color:#e1ceff;background:#211a2e}
.manager-dependency-health{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.15fr) minmax(0,1.35fr);gap:10px;padding:12px;border-top:1px solid #253042;background:#0e151f}
.manager-dependency-health-card{min-width:0;border:1px solid #2d394b;border-radius:9px;padding:11px;background:#111a25}.manager-dependency-health-card h4{margin:0 0 8px;color:#dce8fb;font-size:11px}.manager-dependency-health-card p{margin:0;color:#7f91a8;font-size:9px;line-height:1.4}
.manager-dependency-health-facts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 9px}.manager-dependency-health-facts span{color:#7f91a8;font-size:9px}.manager-dependency-health-facts strong{color:#dce8fb;font-size:10px;text-align:right}.manager-dependency-health-facts strong.warn{color:#efc879}.manager-dependency-health-facts strong.bad{color:#f18b97}
.manager-longest-chain{display:flex;gap:5px;align-items:center;flex-wrap:wrap}.manager-longest-chain a,.manager-longest-chain span.issue{display:inline-flex;border:1px solid #3b4b61;border-radius:6px;padding:4px 6px;color:#dbeafe;background:#0e151f;text-decoration:none;font-size:9px}.manager-longest-chain a:hover{text-decoration:underline}.manager-longest-chain .arrow{color:#607188;font-size:9px}.manager-longest-chain-note{margin-top:7px!important}
.manager-dependency-problems{display:grid;gap:6px}.manager-dependency-problem{border-left:3px solid #54667d;padding:4px 0 4px 8px;color:#91a2b8;font-size:9px;line-height:1.4}.manager-dependency-problem.warn{border-left-color:#c78d39;color:#d8c59d}.manager-dependency-problem.bad{border-left-color:#cf5564;color:#e9a2aa}.manager-dependency-problem b{color:#dce8fb}.manager-dependency-healthy{color:#9ddbb1!important}
.manager-dependency-map-scroll.is-fit-view{overflow:auto}.manager-dependency-fit-sizer{position:relative;overflow:hidden;min-width:0}.manager-dependency-fit-sizer>.manager-dependency-map-canvas{transform-origin:top left}
@media(max-width:1050px){.manager-dependency-health{grid-template-columns:1fr 1fr}.manager-dependency-health-card:last-child{grid-column:1/-1}.manager-dependency-map-tools{margin-left:0}}
@media(max-width:700px){.manager-dependency-health{grid-template-columns:1fr}.manager-dependency-health-card:last-child{grid-column:auto}.manager-dependency-map-tools{margin-top:8px;width:100%}}
`;

export const MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT = String.raw`
(function managerDependencyDiagnostics() {
  let latestPlan = null;
  let fitView = false;
  let fitFrame = null;

  function numberList(values) {
    return [...new Set((values || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  }

  function cyclePath(values) {
    const path = (values || []).map(Number).filter(Number.isInteger);
    if (!path.length) return [];
    return path.at(-1) === path[0] ? path : [...path, path[0]];
  }

  function lexicographicallyEarlier(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index];
    }
    return left.length < right.length;
  }

  function longestResolvedChain(graph) {
    if (!graph) return [];
    const dependencies = graph.dependencies || {};
    const unresolved = new Set(numberList(graph.unresolvedIssueNumbers));
    const memo = new Map();
    function chainTo(number, visiting = new Set()) {
      number = Number(number);
      if (!Number.isInteger(number) || unresolved.has(number) || visiting.has(number)) return [];
      if (memo.has(number)) return memo.get(number);
      const nextVisiting = new Set(visiting); nextVisiting.add(number);
      let best = [];
      for (const blocker of numberList(dependencies[number])) {
        const candidate = chainTo(blocker, nextVisiting);
        if (candidate.length > best.length || (candidate.length === best.length && lexicographicallyEarlier(candidate, best))) best = candidate;
      }
      const result = [...best, number]; memo.set(number, result); return result;
    }
    let best = [];
    for (const number of numberList(graph.issueNumbers)) {
      const candidate = chainTo(number);
      if (candidate.length > best.length || (candidate.length === best.length && lexicographicallyEarlier(candidate, best))) best = candidate;
    }
    return best;
  }

  function externalRelationCount(graph) {
    return Object.values(graph?.externalDependencies || {}).reduce((sum, values) => sum + numberList(values).length, 0);
  }

  function graphIncomplete(graph) {
    return graph?.available === false || externalRelationCount(graph) > 0;
  }

  function issueMap(plan) {
    return new Map((plan?.items || []).map((item) => [Number(item.issueNumber), item]));
  }

  function healthFacts(graph) {
    const unavailable = numberList(graph?.unavailableIssueNumbers).length;
    const missing = externalRelationCount(graph);
    const cycles = (graph?.cycles || []).length;
    const unresolved = numberList(graph?.unresolvedIssueNumbers).length;
    return { unavailable, missing, cycles, unresolved, problems: unavailable + missing + cycles + unresolved };
  }

  function healthCard(graph) {
    const card = document.createElement('section'); card.className = 'manager-dependency-health-card';
    const title = document.createElement('h4'); title.textContent = 'Dependency health'; card.append(title);
    const facts = healthFacts(graph);
    const grid = document.createElement('div'); grid.className = 'manager-dependency-health-facts';
    const rows = [
      ['Open-issue dependency edges', Number(graph?.relationshipCount || 0), ''],
      ['Missing relationship data', facts.unavailable, facts.unavailable ? 'bad' : ''],
      ['Open blockers missing from catalog', facts.missing, facts.missing ? 'warn' : ''],
      ['Dependency cycles', facts.cycles, facts.cycles ? 'bad' : ''],
      ['Unresolved issues', facts.unresolved, facts.unresolved ? 'warn' : ''],
    ];
    for (const row of rows) {
      const label = document.createElement('span'); label.textContent = row[0];
      const value = document.createElement('strong'); value.className = row[2]; value.textContent = String(row[1]);
      grid.append(label, value);
    }
    card.append(grid);
    if (!facts.problems) {
      const note = document.createElement('p'); note.className = 'manager-dependency-healthy'; note.style.marginTop = '8px'; note.textContent = 'No graph integrity problems detected.'; card.append(note);
    }
    return card;
  }

  function chainCard(plan) {
    const graph = plan?.graph;
    const card = document.createElement('section'); card.className = 'manager-dependency-health-card';
    const title = document.createElement('h4'); title.textContent = 'Longest dependency chain'; card.append(title);
    if (graphIncomplete(graph)) {
      const unavailable = document.createElement('p');
      unavailable.textContent = 'Unavailable while native dependency data is incomplete. Paseo will not present a partial chain as authoritative.';
      card.append(unavailable); return card;
    }
    const chain = longestResolvedChain(graph);
    const row = document.createElement('div'); row.className = 'manager-longest-chain';
    const items = issueMap(plan);
    if (!chain.length) {
      const empty = document.createElement('p'); empty.textContent = 'No resolved open-issue chain is available.'; card.append(empty); return card;
    }
    chain.forEach((number, index) => {
      const item = items.get(number);
      const chip = item?.url ? document.createElement('a') : document.createElement('span');
      if (!item?.url) chip.className = 'issue';
      if (item?.url) { chip.href = item.url; chip.target = '_blank'; chip.rel = 'noreferrer'; }
      chip.textContent = '#' + number;
      chip.title = item?.title || 'Issue #' + number;
      row.append(chip);
      if (index < chain.length - 1) { const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→'; row.append(arrow); }
    });
    card.append(row);
    const note = document.createElement('p'); note.className = 'manager-longest-chain-note';
    note.textContent = chain.length + ' issue' + (chain.length === 1 ? '' : 's') + ' deep. This is dependency depth only, not a duration-based critical path.';
    if ((graph?.unresolvedIssueNumbers || []).length) note.textContent += ' Unresolved issues are excluded from this resolved-chain view.';
    card.append(note);
    return card;
  }

  function problemCard(graph) {
    const card = document.createElement('section'); card.className = 'manager-dependency-health-card';
    const title = document.createElement('h4'); title.textContent = 'Dependency problems'; card.append(title);
    const list = document.createElement('div'); list.className = 'manager-dependency-problems';
    const unavailable = numberList(graph?.unavailableIssueNumbers);
    const externalEntries = Object.entries(graph?.externalDependencies || {}).filter(([, values]) => numberList(values).length);
    const cycles = graph?.cycles || [];
    if (unavailable.length) {
      const problem = document.createElement('div'); problem.className = 'manager-dependency-problem bad'; problem.innerHTML = '<b>Missing native relationship data:</b> ' + unavailable.map((number) => '#' + number).join(', '); list.append(problem);
    }
    for (const [issueNumber, blockers] of externalEntries.slice(0, 5)) {
      const problem = document.createElement('div'); problem.className = 'manager-dependency-problem warn'; problem.innerHTML = '<b>#' + issueNumber + ' references open blocker(s) missing from the open-issue catalog:</b> ' + numberList(blockers).map((number) => '#' + number).join(', '); list.append(problem);
    }
    for (const cycle of cycles.slice(0, 5)) {
      const path = cyclePath(cycle);
      const problem = document.createElement('div'); problem.className = 'manager-dependency-problem bad';
      problem.innerHTML = '<b>Cycle:</b> ' + path.map((number) => '#' + number).join(' → '); list.append(problem);
    }
    const unresolved = numberList(graph?.unresolvedIssueNumbers);
    if (unresolved.length && !cycles.length && !unavailable.length && !externalEntries.length) {
      const problem = document.createElement('div'); problem.className = 'manager-dependency-problem warn'; problem.innerHTML = '<b>Unresolved:</b> ' + unresolved.map((number) => '#' + number).join(', '); list.append(problem);
    }
    if (!list.childElementCount) {
      const empty = document.createElement('p'); empty.className = 'manager-dependency-healthy'; empty.textContent = 'No dependency problems need attention.'; list.append(empty);
    }
    card.append(list); return card;
  }

  function renderDiagnostics(plan) {
    latestPlan = plan || latestPlan;
    const shell = document.getElementById('manager-issue-flow-shell');
    if (!shell || !latestPlan?.graph) return;
    shell.querySelector('.manager-dependency-health')?.remove();
    const section = document.createElement('div'); section.className = 'manager-dependency-health'; section.setAttribute('aria-label', 'Dependency diagnostics'); section.setAttribute('aria-live', 'polite');
    section.append(healthCard(latestPlan.graph), chainCard(latestPlan), problemCard(latestPlan.graph));
    shell.append(section);
    installMapTools();
    applyFitView();
  }

  function currentMap() {
    const scroll = document.querySelector('.manager-dependency-map-scroll');
    const canvas = scroll?.querySelector('.manager-dependency-map-canvas');
    return { scroll, canvas };
  }

  function fitScale(scroll, canvas) {
    if (!scroll || !canvas) return 1;
    const naturalWidth = Math.max(canvas.scrollWidth, canvas.offsetWidth, 1);
    const availableWidth = Math.max(scroll.clientWidth - 12, 1);
    return Math.max(.18, Math.min(1, availableWidth / naturalWidth));
  }

  function unwrapFitCanvas(scroll, canvas) {
    const sizer = canvas?.parentElement?.classList.contains('manager-dependency-fit-sizer') ? canvas.parentElement : null;
    if (canvas) { canvas.style.transform = ''; canvas.style.transformOrigin = ''; }
    if (sizer?.parentElement) {
      const parent = sizer.parentElement;
      parent.insertBefore(canvas, sizer);
      sizer.remove();
    }
    scroll?.classList.remove('is-fit-view');
  }

  function applyFitNow() {
    if (!fitView) return;
    const { scroll, canvas } = currentMap();
    if (!scroll || !canvas) return;
    const scale = fitScale(scroll, canvas);
    const naturalWidth = Math.max(canvas.scrollWidth, canvas.offsetWidth, 1);
    const naturalHeight = Math.max(canvas.scrollHeight, canvas.offsetHeight, 1);
    let sizer = canvas.parentElement?.classList.contains('manager-dependency-fit-sizer') ? canvas.parentElement : null;
    if (!sizer) {
      sizer = document.createElement('div'); sizer.className = 'manager-dependency-fit-sizer';
      canvas.before(sizer); sizer.append(canvas);
    }
    sizer.style.width = Math.ceil(naturalWidth * scale) + 'px';
    sizer.style.height = Math.ceil(naturalHeight * scale) + 'px';
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = 'scale(' + scale + ')';
    scroll.classList.add('is-fit-view');
    scroll.scrollLeft = 0; scroll.scrollTop = 0;
  }

  function applyFitView() {
    if (fitFrame !== null) { cancelAnimationFrame(fitFrame); fitFrame = null; }
    const { scroll, canvas } = currentMap();
    if (!fitView) {
      if (scroll && canvas) unwrapFitCanvas(scroll, canvas);
    } else {
      // PR 2 schedules SVG edge geometry before this enhancer runs. Defer scaling by one
      // animation frame so edges are measured in the same unscaled coordinate system as nodes,
      // then transform the complete canvas (nodes + SVG) together.
      fitFrame = requestAnimationFrame(() => { fitFrame = null; applyFitNow(); });
    }
    const fitButton = document.getElementById('manager-dependency-fit');
    if (fitButton) fitButton.setAttribute('aria-pressed', fitView ? 'true' : 'false');
  }

  function installMapTools() {
    const toolbar = document.querySelector('#manager-issue-flow-shell .manager-issue-flow-toolbar');
    if (!toolbar || toolbar.querySelector('.manager-dependency-map-tools')) return;
    const tools = document.createElement('div'); tools.className = 'manager-dependency-map-tools';
    const fit = document.createElement('button'); fit.type = 'button'; fit.id = 'manager-dependency-fit'; fit.textContent = 'Fit map'; fit.setAttribute('aria-pressed', fitView ? 'true' : 'false');
    fit.addEventListener('click', () => { fitView = !fitView; applyFitView(); });
    const reset = document.createElement('button'); reset.type = 'button'; reset.id = 'manager-dependency-reset'; reset.textContent = 'Reset view';
    reset.addEventListener('click', () => {
      fitView = false; applyFitView();
      const { scroll } = currentMap(); if (scroll) { scroll.scrollLeft = 0; scroll.scrollTop = 0; }
    });
    tools.append(fit, reset); toolbar.append(tools);
  }

  function statusListener() {
    if (latestPlan) renderDiagnostics(latestPlan);
  }
  if (typeof window.addManagerStatusListener === 'function') window.addManagerStatusListener(statusListener);

  const previousJsonRequest = window.jsonRequest;
  if (typeof previousJsonRequest === 'function') {
    window.jsonRequest = async function dependencyDiagnosticsJsonRequest(url, options) {
      const body = await previousJsonRequest(url, options);
      if (String(url || '').includes('/issues-plan') && body?.issuePlan) renderDiagnostics(body.issuePlan);
      return body;
    };
  }

  window.addEventListener('resize', () => { if (fitView) applyFitView(); });
})();
`;

export function enhanceManagerWithDependencyDiagnostics(html) {
  const styled = injectIntoHead(html, `<style data-manager-dependency-diagnostics-style>${MANAGER_DEPENDENCY_DIAGNOSTICS_STYLE}</style>`);
  return injectIntoBody(styled, `<script data-manager-dependency-diagnostics>${MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT}</script>`);
}
