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

  function cardClass(missing) {
    return 'setup-card' + (missing ? ' required-missing' : '');
  }

  function renderLoading() {
    const root = content();
    if (!root) return;
    root.className = '';
    root.innerHTML = '<div class="paseo-grid">'
      + '<section class="setup-card checking"><h3>Provider / Coding Harness</h3><p><span class="check-spinner" aria-hidden="true"></span> Checking available coding harnesses from Paseo…</p></section>'
      + '<section class="setup-card waiting"><h3>Coding model</h3><p>Waiting for the coding harness catalog before checking available coding models.</p></section>'
      + '<section class="setup-card waiting"><h3>Review model</h3><p>Waiting for the coding harness catalog before checking available review models.</p></section>'
      + '</div>';
  }

  function setShellControls() {
    const recheck = document.getElementById('recheck');
    if (recheck) recheck.hidden = onHarnessPage();
  }

  function setRefreshBusy(busy, label = 'Refreshing…') {
    for (const id of ['harness-refresh-provider', 'harness-refresh-coding', 'harness-refresh-review']) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = busy;
      if (busy) {
        button.dataset.idleText = button.textContent;
        button.textContent = label;
      } else if (button.dataset.idleText) {
        button.textContent = button.dataset.idleText;
        delete button.dataset.idleText;
      }
    }
  }

  function render() {
    setShellControls();
    if (!onHarnessPage() || !state || !content()) return;
    const selection = state.selection || {};
    const providers = state.catalog?.providers || [];
    const provider = providers.find((item) => item.id === selection.harness) || null;
    const providerOptions = [option('', providers.length ? 'Choose a coding harness' : 'No ready harnesses found', !selection.harness)];
    for (const item of providers) providerOptions.push(option(item.id, item.label, item.id === selection.harness));
    const noModels = provider?.noModels === true;
    const providerMissing = !provider;
    const codingMissing = Boolean(provider && !noModels && !selection.codingModel);
    const reviewMissing = Boolean(provider && !noModels && !selection.reviewModel);
    const acknowledgementMissing = Boolean(noModels && !selection.noModelAcknowledged);

    content().className = '';
    content().innerHTML = '<div class="paseo-grid">'
      + '<section class="' + cardClass(providerMissing || acknowledgementMissing) + '"><h3>Provider / Coding Harness</h3><p>Only harnesses that Paseo reports as enabled and available are selectable. The same harness is used for coding and review.</p>'
      + '<div class="inline-actions section-refresh"><button class="action" id="harness-refresh-provider" type="button">Refresh coding harnesses</button></div>'
      + '<div class="field"><label for="harness-provider">Coding harness</label><select id="harness-provider">' + providerOptions.join('') + '</select></div>'
      + (provider?.warning ? '<div class="notice">' + escape(provider.warning) + '</div>' : '')
      + (noModels ? '<label class="choice"><input id="harness-no-model-ack" type="checkbox"' + (selection.noModelAcknowledged ? ' checked' : '') + '> I understand this harness does not expose selectable models through Paseo and manages its model outside this setup page.</label>' : '')
      + '</section>'
      + '<section class="' + cardClass(codingMissing) + '"><h3>Coding model</h3><p>Choose the model and thinking level used for issue implementation.</p>'
      + '<div class="inline-actions section-refresh"><button class="action" id="harness-refresh-coding" type="button">Refresh coding models</button></div>'
      + modelSelect('harness-coding-model', 'Coding model', selection.codingModel, provider)
      + thinkingSelect('harness-coding-thinking', 'Thinking level', selection.codingModel, selection.codingThinking, provider)
      + '</section>'
      + '<section class="' + cardClass(reviewMissing) + '"><h3>Review model</h3><ul class="review-guidance">'
      + '<li>Select a light or same model as the coding model if you just want to do a quick check on the code before letting it move on to human PR review, another heavy external PR review workflow, or will use our web ChatGPT setup for review.</li>'
      + '<li>Pick your heavy PR review model if you wont be doing one of the above bullet options and want the PR review cycle to start immediately.</li>'
      + '</ul>'
      + '<div class="inline-actions section-refresh"><button class="action" id="harness-refresh-review" type="button">Refresh review models</button></div>'
      + modelSelect('harness-review-model', 'Review model', selection.reviewModel, provider)
      + thinkingSelect('harness-review-thinking', 'Thinking level', selection.reviewModel, selection.reviewThinking, provider)
      + '</section>'
      + '</div>';

    document.getElementById('harness-provider')?.addEventListener('change', async (event) => {
      await save({ harness: event.target.value });
    });
    document.getElementById('harness-coding-model')?.addEventListener('change', async () => {
      rerenderThinking('coding');
      await save(readForm());
    });
    document.getElementById('harness-coding-thinking')?.addEventListener('change', () => save(readForm()));
    document.getElementById('harness-review-model')?.addEventListener('change', async () => {
      rerenderThinking('review');
      await save(readForm());
    });
    document.getElementById('harness-review-thinking')?.addEventListener('change', () => save(readForm()));
    document.getElementById('harness-no-model-ack')?.addEventListener('change', () => save(readForm()));
    document.getElementById('harness-refresh-provider')?.addEventListener('click', () => refresh(true, 'Refreshing coding harnesses…'));
    document.getElementById('harness-refresh-coding')?.addEventListener('click', () => refresh(true, 'Refreshing coding models…'));
    document.getElementById('harness-refresh-review')?.addEventListener('click', () => refresh(true, 'Refreshing review models…'));

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

  async function refresh(force = false, busyLabel = 'Refreshing…') {
    if (!onHarnessPage() || loading) return;
    if (state && !force) { render(); return; }
    loading = true;
    if (!state) renderLoading();
    else setRefreshBusy(true, busyLabel);
    try {
      state = await api(force ? '/api/setup/harness/recheck' : '/api/setup/harness/status', {
        method: force ? 'POST' : 'GET',
        body: force ? '{}' : undefined,
      });
      await syncShell();
      render();
    } catch (error) {
      if (typeof showError === 'function') showError(error);
    } finally {
      loading = false;
      setRefreshBusy(false);
    }
  }

  const observer = new MutationObserver(() => {
    setShellControls();
    if (!onHarnessPage()) return;
    const root = content();
    if (root && !root.querySelector('#harness-provider') && !loading) refresh(false);
  });
  const title = document.getElementById('page-title');
  if (title) observer.observe(title, { childList: true, subtree: true });
  const root = content();
  if (root) observer.observe(root, { childList: true });

  addEventListener('popstate', () => {
    setShellControls();
    if (onHarnessPage()) refresh(false);
  });
  setShellControls();
  if (onHarnessPage()) refresh(false);
})();
`;

export function enhanceSetupWizardWithHarnessPage(html) {
  const style = `<style data-setup-harness-style>.required-missing{border-color:#b74b4b!important;box-shadow:0 0 0 1px #b74b4b55}.section-refresh{justify-content:flex-end;margin-bottom:8px}.review-guidance{margin:0 0 12px;padding-left:20px;color:#aab8c9;line-height:1.5}.review-guidance li+li{margin-top:7px}.setup-card.checking{border-color:#365f8b}.setup-card.waiting{opacity:.72}.check-spinner{display:inline-block;width:12px;height:12px;border:2px solid #61748e;border-top-color:#dbeafe;border-radius:50%;animation:harness-spin .8s linear infinite;vertical-align:-1px;margin-right:5px}@keyframes harness-spin{to{transform:rotate(360deg)}}</style>`;
  const script = `<script data-setup-harness-page>${HARNESS_PAGE_SCRIPT}</script>`;
  const enhanced = String(html).includes('</head>')
    ? String(html).replace('</head>', `${style}</head>`)
    : `${style}${html}`;
  return enhanced.includes('</body>')
    ? enhanced.replace('</body>', `${script}</body>`)
    : `${enhanced}${script}`;
}
