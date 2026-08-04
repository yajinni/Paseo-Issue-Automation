export const ISSUES_MAP_LAYOUT_UI_SCRIPT = String.raw`
(function installIssuesMapLayout() {
  function textOf(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function cardByHeading(view, heading) {
    return Array.from(view?.querySelectorAll(':scope > .grid > article.card') || []).find(function(card) {
      return textOf(card.querySelector('h2')) === heading;
    }) || null;
  }

  function installStyles() {
    if (document.getElementById('issues-map-layout-style')) return;
    const style = document.createElement('style');
    style.id = 'issues-map-layout-style';
    style.textContent = [
      '#view-dependencies .issues-map-primary{display:grid;gap:14px}',
      '#view-dependencies #graph-health{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
      '#view-dependencies #graph-health>.component{background:linear-gradient(180deg,rgba(22,31,44,.98),rgba(17,24,35,.98));border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 8px 22px rgba(0,0,0,.12)}',
      '#view-dependencies #execution-waves{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}',
      '#view-dependencies #execution-waves>.wave{grid-template-columns:76px minmax(0,1fr);gap:10px;padding:14px;border:1px solid var(--border);border-radius:11px;background:var(--panel-3)}',
      '#view-dependencies #execution-waves>.wave:first-child{border-top:1px solid var(--border)}',
      '@media(max-width:1080px){#view-dependencies #graph-health{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(max-width:760px){#view-dependencies #graph-health,#view-dependencies #execution-waves{grid-template-columns:1fr}#view-dependencies #execution-waves>.wave{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(style);
  }

  function applyLayout() {
    const view = document.getElementById('view-dependencies');
    const originalGrid = view?.querySelector(':scope > .grid.two');
    if (!view || !originalGrid) return;

    const graphHealth = cardByHeading(view, 'Graph health');
    const executionWaves = cardByHeading(view, 'Execution waves');
    if (!graphHealth || !executionWaves) return;

    originalGrid.classList.remove('grid', 'two');
    originalGrid.classList.add('issues-map-primary');
    originalGrid.insertBefore(graphHealth, executionWaves);

    const healthGrid = graphHealth.querySelector('#graph-health');
    if (healthGrid) healthGrid.classList.remove('section-stack');
  }

  document.addEventListener('DOMContentLoaded', function() {
    installStyles();
    applyLayout();
  });
})();
`;
