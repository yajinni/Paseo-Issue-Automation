export const SIMPLIFIED_SETUP_FLOW_SCRIPT = String.raw`
(function simplifiedSetupFlow() {
  let syncing = false;
  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const buttons = [...document.querySelectorAll('.progress .step')];
      buttons.forEach((button, index) => {
        const number = button.querySelector('span');
        if (number && number.textContent !== String(index + 1)) number.textContent = String(index + 1);
      });
      const activeIndex = buttons.findIndex((button) => button.getAttribute('aria-current') === 'page');
      const label = document.getElementById('step-label');
      if (label && activeIndex >= 0) {
        const value = 'Step ' + (activeIndex + 1) + ' of ' + buttons.length;
        if (label.textContent !== value) label.textContent = value;
      }
    } finally {
      syncing = false;
    }
  }
  const progress = document.querySelector('.progress');
  if (progress) new MutationObserver(sync).observe(progress, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  const label = document.getElementById('step-label');
  if (label) new MutationObserver(sync).observe(label, { childList: true, subtree: true });
  addEventListener('popstate', sync);
  sync();
})();
`;

export function enhanceSetupWizardWithSimplifiedFlow(html) {
  const script = `<script data-setup-simplified-flow>${SIMPLIFIED_SETUP_FLOW_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
