export const HARNESS_PAGE_SCRIPT = String.raw`
(function harnessSetupPage() {
  let state = null;
  let loading = false;
  const content = () => document.getElementById('page-content');
  const onHarnessPage = () => location.pathname.replace(/\/$/, '') === '/setup/harness';

  function escape(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function option(value, label, selected) {
    return '<option value="' + escape(value) + '"' + (selected ? ' selected' : '') + '>' + escape(label) + '</option>';
  }

  function selectedProvider() {
    const id = document.getElementById('harness-provider')?.value || state?.selection?.harness || '';
    return state?.catalog?.providers?.find((provider) => provider.id === id) || null;
  }

  function modelSelect(id, label, current, provider) {
    const models = provider?.models || [];
    const choices = [option('', models.length ? 'Choose a model' : 'No Paseo model required', !current)];
    for (const model of models) choices.push(option(model.value, model.label, model.value === current));
    return '<div class="field"><label for="' + id + '">' + escape(label) + '</label><select id="' + id + '">' + choices.join('') + '</select></div>';
  }

  function thinkingSelect(id, label, modelValue, current, provider) {
    const model = provider?.models?.find((item) => item.value === modelValue);
    const levels = model?.thinkingOptionIds || [];
    const choices = [option('', 'None', !current)];
    for (const level of levels) choices.push(option(level, level, level === current));
    return '<div class="field"><label for="' + id + '">' + escape(label) + '</label><select id="' + id + '"' + (levels.length ? '' : ' disabled') + '>' + choices.join('') + '</select></div>';
  }

  function render() {
    if (!onHarnessPage() || !state || !content()) return;
    const selection = state.selection || {};
    const providers = state.catalog?.providers || [];
    const provider = providers.find((item) => item.id === selection.harness) || null;
    const providerOptions = [option('', providers.length ? 'Choose a coding harness' : 'No ready harnesses found', !selection.harness)];
    for (const item of providers) providerOptions.push(option(item.id, item.label, item.id === selection.harness));
    const noModels = provider?.noModels === true;
    const catalogErrors = state.catalog?.errors || [];

    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="setup-card"><h3>Provider / Coding Harness</h3><p>Only harnesses that Paseo reports as enabled and available are selectable. The same harness is used for coding and review.</p>'
      + '<div class="field"><label for="harness-provider">Coding harness</label><select id="harness-provider">' + providerOptions.join('') + '</select></div>'
      + (provider?.warning ? '<div class="notice">' + escape(provider.warning) + '</div>' : '')
      + (noModels ? '<label class="choice"><input id="harness-no-model-ack" type="checkbox"' + (selection.noModelAcknowledged ? ' checked' : '') + '> I understand this harness does not expose selectable models through Paseo and manages its model outside this setup page.</label>' : '')
      + '</section>'
      + '<section class="setup-card"><h3>Coding model</h3><p>Choose the model and thinking level used for issue implementation.</p>'
      + modelSelect('harness-coding-model', 'Coding model', selection.codingModel, provider)
      + thinkingSelect('harness-coding-thinking', 'Thinking level', selection.codingModel, selection.codingThinking, provider)
      + '</section>'
      + '<section class="setup-card"><h3>Review model</h3><p>Choose review independently. Quick review provides focused feedback before the configured final review path; full review uses a fresh review session over the complete pull request.</p>'
      + modelSelect('harness-review-model', 'Review model', selection.reviewModel, provider)
      + thinkingSelect('harness-review-thinking', 'Thinking level', selection.reviewModel, selection.reviewThinking, provider)
      + '</section>'
      + '<section class="setup-card"><h3>Catalog status</h3><p>' + (state.catalog?.complete ? 'Paseo provider and model discovery completed.' : 'Discovery completed with warnings. Existing valid selections are preserved when possible.') + '</p>'
      + (catalogErrors.length ? '<div class="notice">' + catalogErrors.map(escape).join('<br>') + '</div>' : '')
      + '<div class="inline-actions"><button class="action primary" id="harness-save" type="button">Save selections</button><button class="action" id="harness-refresh" type="button">Refresh catalog</button></div></section>'
      + '</div>';

    document.getElementById('harness-provider')?.addEventListener('change', async (event) => {
      await save({ harness: event.target.value });
    });
    document.getElementById('harness-coding-model')?.addEventListener('change', () => rerenderThinking('coding'));
    document.getElementById('harness-review-model')?.addEventListener('change', () => rerenderThinking('review'));
    document.getElementById('harness-save')?.addEventListener('click', () => save(readForm()));
    document.getElementById('harness-refresh')?.addEventListener('click', () => refresh(true));

    if (typeof technical !== 'undefined') {
      technical = state.technicalDetails || {};
      const details = document.getElementById('technical-details');
      if (details) details.textContent = JSON.stringify(technical, null, 2);
    }
  }

  function rerenderThinking(kind) {
    const provider = selectedProvider();
    const modelSelectElement = document.getElementById(kind === 'coding' ? 'harness-coding-model' : 'harness-review-model');
    const thinking = document.getElementById(kind === 'coding' ? 'harness-coding-thinking' : 'harness-review-thinking');
    const model = provider?.models?.find((item) => item.value === modelSelectElement?.value);
    if (!thinking) return;
    const levels = model?.thinkingOptionIds || [];
    thinking.innerHTML = option('', 'None', true) + levels.map((level) => option(level, level, false)).join('');
    thinking.disabled = !levels.length;
  }

  function readForm() {
    return {
      harness: document.getElementById('harness-provider')?.value || '',
      codingModel: document.getElementById('harness-coding-model')?.value || '',
      codingThinking: document.getElementById('harness-coding-thinking')?.value || '',
      reviewModel: document.getElementById('harness-review-model')?.value || '',
      reviewThinking: document.getElementById('harness-review-thinking')?.value || '',
      noModelAcknowledged: document.getElementById('harness-no-model-ack')?.checked === true,
    };
  }

  async function syncShell() {
    if (typeof api === 'function') {
      const latest = await api('/api/setup/session');
      if (typeof store !== 'undefined') store = latest;
      if (typeof render === 'function') render();
    }
  }

  async function save(values) {
    if (loading) return;
    loading = true;
    try {
      state = await api('/api/setup/harness/save', { method: 'POST', body: JSON.stringify(values) });
      await syncShell();
      render();
    } catch (error) {
      if (typeof showError === 'function') showError(error);
    } finally {
      loading = false;
    }
  }

  async function refresh(force = false) {
    if (!onHarnessPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    try {
      state = await api(force ? '/api/setup/harness/recheck' : '/api/setup/harness/status', {
        method: force ? 'POST' : 'GET',
        body: force ? '{}' : undefined,
      });
      if (force) await syncShell();
      render();
    } catch (error) {
      if (typeof showError === 'function') showError(error);
    } finally {
      loading = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (!onHarnessPage()) return;
    const root = content();
    if (root && !root.querySelector('#harness-provider')) refresh(false);
  });
  const title = document.getElementById('page-title');
  if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content();
  if (root) observer.observe(root, { childList: true });

  document.getElementById('recheck')?.addEventListener('click', (event) => {
    if (!onHarnessPage()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    refresh(true);
  }, true);

  addEventListener('popstate', () => { if (onHarnessPage()) refresh(false); });
  if (onHarnessPage()) refresh(false);
})();
`;

export function enhanceSetupWizardWithHarnessPage(html) {
  const script = `<script data-setup-harness-page>${HARNESS_PAGE_SCRIPT}</script>`;
  return String(html).includes('</body>')
    ? String(html).replace('</body>', `${script}</body>`)
    : `${html}${script}`;
}
