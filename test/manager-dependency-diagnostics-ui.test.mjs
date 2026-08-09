import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithDependencyDiagnostics,
  MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT,
  MANAGER_DEPENDENCY_DIAGNOSTICS_STYLE,
} from '../src/manager-dependency-diagnostics-ui.mjs';

test('diagnostics show dependency depth rather than duration claims', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('Longest dependency chain'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('longestResolvedChain'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('not a duration-based critical path'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('Unresolved issues are excluded from this resolved-chain view.'));
});

test('longest chain fails closed when native graph data is incomplete', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('graphIncomplete'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('graph?.available === false || externalRelationCount(graph) > 0'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('Unavailable while native dependency data is incomplete.'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('will not present a partial chain as authoritative'));
});

test('longest resolved chain excludes all unresolved nodes, not only direct cycle members', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('new Set(numberList(graph.unresolvedIssueNumbers))'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('unresolved.has(number)'));
});

test('dependency health surfaces graph integrity conditions with precise edge terminology', () => {
  for (const text of [
    'Open-issue dependency edges',
    'Missing relationship data',
    'Open blockers missing from catalog',
    'Dependency cycles',
    'Unresolved issues',
    'Dependency problems',
  ]) assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes(text));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('unavailableIssueNumbers'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('externalDependencies'));
});

test('cycle diagnostics preserve the server-provided relationship order', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('function cyclePath(values)'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes("path.map((number) => '#' + number).join(' → ')"));
  assert.equal(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('numberList(cycle).map'), false);
});

test('fit and reset controls stay scoped to the existing dependency map', () => {
  for (const text of ['Fit map', 'Reset view', 'manager-dependency-map-scroll', 'manager-dependency-map-canvas']) {
    assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes(text));
  }
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('availableWidth / naturalWidth'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('Math.max(.18'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('scroll.scrollLeft = 0'));
});

test('fit transforms the complete canvas after edge measurement instead of independently scaling nodes', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('manager-dependency-fit-sizer'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes("canvas.style.transform = 'scale(' + scale + ')'"));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('requestAnimationFrame'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('edges are measured in the same unscaled coordinate system as nodes'));
  assert.equal(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('canvas.style.zoom'), false);
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_STYLE.includes('manager-dependency-fit-sizer'));
});

test('reset unwraps the fitted canvas without replacing an ancestor with its own child', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('parent.insertBefore(canvas, sizer)'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('sizer.remove()'));
  assert.equal(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('sizer.replaceWith(canvas)'), false);
});

test('status-driven base-map rerenders restore diagnostics and fit controls', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('window.addManagerStatusListener(statusListener)'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('if (latestPlan) renderDiagnostics(latestPlan)'));
});

test('fit state survives issue-plan rerenders and recalculates on resize', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('let fitView = false'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('renderDiagnostics(body.issuePlan)'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes("window.addEventListener('resize'"));
});

test('diagnostics reuse graph data and the existing issue-plan stream', () => {
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('graph.dependencies'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('relationshipCount'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('previousJsonRequest(url, options)'));
  assert.equal(MANAGER_DEPENDENCY_DIAGNOSTICS_SCRIPT.includes('fetch('), false);
});

test('enhancer appends responsive scoped assets without replacing manager markup', () => {
  const html = enhanceManagerWithDependencyDiagnostics('<html><head></head><body><main id="manager"></main></body></html>');
  assert.ok(html.includes('data-manager-dependency-diagnostics-style'));
  assert.ok(html.includes('data-manager-dependency-diagnostics'));
  assert.ok(html.includes('<main id="manager"></main>'));
  assert.ok(MANAGER_DEPENDENCY_DIAGNOSTICS_STYLE.includes('@media(max-width:700px)'));
});
