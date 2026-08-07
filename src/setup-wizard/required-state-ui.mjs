export const REQUIRED_STATE_SCRIPT = String.raw`
(function setupRequiredState() {
  function applyRequiredState() {
    const root = document.getElementById('page-content');
    if (!root) return;
    root.querySelectorAll('.setup-card').forEach((card) => {
      const ignoreChecklistFailures = card.hasAttribute('data-ignore-required-checks');
      card.classList.toggle('required-check-failed', !ignoreChecklistFailures && Boolean(card.querySelector('.check-row.bad')));
    });
  }

  function start() {
    const root = document.getElementById('page-content');
    if (!root) return;
    applyRequiredState();
    new MutationObserver(applyRequiredState).observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
`;

const REQUIRED_STATE_STYLE = String.raw`
<style data-setup-required-state-style>
.setup-card.required-missing,.setup-card.required-check-failed{border-color:#b74b4b!important;box-shadow:0 0 0 1px #b74b4b55}
</style>`;

export function enhanceSetupWizardWithRequiredState(html) {
  const script = `<script data-setup-required-state>${REQUIRED_STATE_SCRIPT}</script>`;
  const payload = `${REQUIRED_STATE_STYLE}${script}`;
  return String(html).includes('</head>')
    ? String(html).replace('</head>', `${payload}</head>`)
    : `${payload}${html}`;
}
