export const REPOSITORY_PASEO_SCRIPT = String.raw`
(function repositoryPaseoSetup() {
  let loading = false;
  let refreshTimer = null;
  const onPage = () => location.pathname.replace(/\/$/, '') === '/setup/repository';
  const content = () => document.getElementById('page-content');
  const escape = (value) => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  function row(label, ok, detail) {
    return '<div class="check-row ' + (ok ? 'ok' : 'bad') + '"><span class="check-dot">' + (ok ? '✓' : '!') + '</span><div><strong>'
      + escape(label) + '</strong><div class="check-detail">' + escape(detail || '') + '</div></div></div>';
  }

  function render(state) {
    if (!onPage() || !content()) return;
    const grid = content().querySelector('.paseo-grid');
    if (!grid) return;
    let card = document.getElementById('github-paseo-project-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'github-paseo-project-card';
      grid.append(card);
    }
    const ready = state?.ready === true;
    const projectReady = Boolean(state?.projectName);
    const workspaceReady = ready && Boolean(state?.workspaceId);
    card.className = 'setup-card' + (ready ? '' : ' required-missing');
    card.innerHTML = '<h3>Paseo project</h3>'
      + '<p>Setup handles this automatically. It makes sure Paseo has this repository as a project, then makes sure that project has the permanent <strong>' + escape(state?.permanentWorkspaceName || 'Issue Coding Automation') + '</strong> workspace.</p>'
      + '<div class="checklist">'
      + row('Paseo project', projectReady, projectReady ? ('Ready · ' + state.projectName) : 'Paseo will create the project automatically if it is missing.')
      + row(state?.permanentWorkspaceName || 'Issue Coding Automation', workspaceReady, workspaceReady ? 'Permanent workspace ready.' : 'Paseo will create the permanent workspace automatically if it is missing.')
      + '</div>'
      + (state?.blocker ? '<div class="notice">' + escape(state.blocker.message) + ' ' + escape(state.blocker.recoveryAction || '') + '</div>' : '');

    const summary = document.getElementById('page-summary');
    if (summary) summary.textContent = 'Choose the GitHub repository and base branch. Paseo project and permanent workspace setup happens automatically.';
  }

  async function refresh() {
    if (!onPage() || loading || !content()?.querySelector('#github-repository')) return;
    loading = true;
    try {
      const response = await fetch('/api/setup/github/paseo-status', { headers: { 'content-type': 'application/json' } });
      const body = await response.json();
      if (response.ok) render(body);
    } catch {
      // The main repository page owns request-error feedback.
    } finally {
      loading = false;
    }
  }

  function scheduleRefresh() {
    if (!onPage()) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 0);
  }

  const root = content();
  if (root) new MutationObserver(scheduleRefresh).observe(root, { childList: true, subtree: true });
  addEventListener('popstate', scheduleRefresh);
  scheduleRefresh();
})();
`;

export function enhanceSetupWizardWithRepositoryPaseo(html) {
  const script = `<script data-setup-repository-paseo>${REPOSITORY_PASEO_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
