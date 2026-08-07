export const ISSUES_PAGE_SCRIPT = String.raw`
(function issuesSetupPage() {
  let state = null;
  let loading = false;
  const content = () => document.getElementById('page-content');
  const onPage = () => location.pathname.replace(/\/$/, '').split('/').at(-1) === 'issues';
  function escape(value) { return String(value == null ? '' : value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
  function cardClass(missing) { return 'setup-card' + (missing ? ' required-missing' : ''); }
  function labelRows() {
    const labels = state?.preview?.labels || state?.lifecycleLabels || [];
    if (!labels.length) return '<div class="notice">Paseo will ensure the managed lifecycle labels exist after final confirmation.</div>';
    return '<div class="issues-label-list">' + labels.map((label) => {
      const detail = label.status === 'reused'
        ? 'Already exists · will be reused.'
        : 'Will be ensured after final confirmation.';
      return '<div class="issues-label-row"><strong>' + escape(label.name) + '</strong><div class="check-detail">' + escape(detail) + '</div></div>';
    }).join('') + '</div>';
  }
  function templatePreview(template) {
    const source = String(template?.content || '');
    if (!source) return '<div class="notice">Bundled template preview is unavailable.</div>';
    return '<pre class="issues-template-preview">' + escape(source) + '</pre>';
  }
  function render() {
    if (!onPage() || !state || !content()) return;
    const s = state.selection || {};
    const preview = state.preview || {};
    const template = preview.template || {};
    const blockerCodes = (state.check?.blockers || []).map((item) => String(item.code || ''));
    const settingsMissing = blockerCodes.some((code) => /selection-mode|max-active|retries|excluded-label/.test(code));
    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="' + cardClass(settingsMissing) + '"><h3>Issue selection</h3><p>Choose which open issues Paseo may consider. Invalid issues are still rejected by the installed issue contract.</p>'
      + '<label class="choice"><input type="radio" name="issue-mode" value="recommended-labels" ' + (s.mode === 'recommended-labels' ? 'checked' : '') + '> Recommended labels <span class="muted">(default)</span></label>'
      + '<label class="choice"><input type="radio" name="issue-mode" value="all-open" ' + (s.mode === 'all-open' ? 'checked' : '') + '> All open issues</label>'
      + '<div class="notice">' + escape(state.explanations?.ordering || '') + '</div><div class="notice">' + escape(state.explanations?.dependencies || '') + '</div></section>'
      + '<section class="' + cardClass(settingsMissing) + '"><h3>Advanced options</h3>'
      + '<div class="field"><label for="issues-max-active">Maximum simultaneous issues</label><input id="issues-max-active" type="number" min="1" max="20" value="' + escape(s.maxActive ?? 1) + '"></div>'
      + '<div class="field"><label for="issues-retries">Temporary failure retries</label><input id="issues-retries" type="number" min="0" max="20" value="' + escape(s.temporaryFailureRetries ?? 3) + '"></div>'
      + '<div class="field"><label for="issues-excluded">Excluded labels</label><input id="issues-excluded" type="text" value="' + escape((s.excludedLabels || []).join(', ')) + '" placeholder="comma-separated label names"></div>'
      + '<p class="muted">Issue settings save automatically when changed.</p></section>'
      + '<section class="setup-card"><h3>Managed lifecycle labels</h3><p>Paseo will ensure these lifecycle labels exist after final confirmation. Existing matching labels are reused.</p>' + labelRows() + '</section>'
      + '<section class="setup-card"><h3>Automation issue template</h3><p>' + escape(state.explanations?.template || 'This is the template that issues need to follow to be automatically processed.') + '</p>'
      + '<p>Template path: <code>' + escape(template.path || '.github/ISSUE_TEMPLATE/automated-coding-task.md') + '</code></p>'
      + templatePreview(template) + '</section></div>';
    document.querySelectorAll('input[name="issue-mode"]').forEach((input) => input.addEventListener('change', save));
    document.getElementById('issues-max-active')?.addEventListener('change', save);
    document.getElementById('issues-retries')?.addEventListener('change', save);
    document.getElementById('issues-excluded')?.addEventListener('change', save);
    if (typeof technical !== 'undefined') technical = state.technicalDetails || {};
    const details = document.getElementById('technical-details'); if (details) details.textContent = JSON.stringify(state.technicalDetails || {}, null, 2);
    const shellStatus = document.getElementById('status'); const check = state.check;
    if (shellStatus && check) { shellStatus.className = 'status ' + (check.ok ? 'ok' : 'blocked'); shellStatus.innerHTML = '<div class="status-title">' + escape(check.ok ? 'Requirements passed' : 'Needs attention') + '</div><div class="status-copy">' + escape(check.summary || '') + '</div>'; }
  }
  async function syncShell() { const latest = await api('/api/setup/session'); if (typeof store !== 'undefined') store = latest; if (typeof render === 'function') render(); }
  async function save() {
    if (loading) return; loading = true;
    try {
      const mode = document.querySelector('input[name="issue-mode"]:checked')?.value || 'recommended-labels';
      const excludedLabels = String(document.getElementById('issues-excluded')?.value || '').split(',').map((value) => value.trim()).filter(Boolean);
      state = await api('/api/setup/issues/save', { method: 'POST', body: JSON.stringify({ mode, maxActive: Number(document.getElementById('issues-max-active')?.value || 1), temporaryFailureRetries: Number(document.getElementById('issues-retries')?.value || 0), excludedLabels }) });
      await syncShell(); render();
    } catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  async function refresh(force = false) {
    if (!onPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    try { state = await api(force ? '/api/setup/issues/recheck' : '/api/setup/issues/status', { method: force ? 'POST' : 'GET', body: force ? '{}' : undefined }); if (force) await syncShell(); render(); }
    catch (error) { if (typeof showError === 'function') showError(error); }
    finally { loading = false; }
  }
  const observer = new MutationObserver(() => { if (onPage() && content() && !content().querySelector('input[name="issue-mode"]')) refresh(false); });
  const title = document.getElementById('page-title'); if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content(); if (root) observer.observe(root, { childList: true });
  document.getElementById('recheck')?.addEventListener('click', (event) => { if (!onPage()) return; event.preventDefault(); event.stopImmediatePropagation(); refresh(true); }, true);
  addEventListener('popstate', () => { if (onPage()) refresh(false); });
  if (onPage()) refresh(false);
})();
`;

const ISSUES_PAGE_STYLE = String.raw`
<style data-setup-issues-page-style>
.issues-label-list{display:grid}.issues-label-row{padding:9px 0 9px 32px;border-bottom:1px solid #253042}.issues-label-row:last-child{border-bottom:0}.issues-label-row strong{display:block}
.issues-template-preview{margin:12px 0 0;max-height:460px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #2d394b;border-radius:10px;background:#0f1620;padding:14px;color:#c9d5e5;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
</style>`;

export function enhanceSetupWizardWithIssuesPage(html) {
  const script = `<script data-setup-issues-page>${ISSUES_PAGE_SCRIPT}</script>`;
  let output = String(html);
  output = output.includes('</head>') ? output.replace('</head>', `${ISSUES_PAGE_STYLE}</head>`) : `${ISSUES_PAGE_STYLE}${output}`;
  return output.includes('</body>') ? output.replace('</body>', `${script}</body>`) : `${output}${script}`;
}
