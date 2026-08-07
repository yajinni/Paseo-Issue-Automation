export const SETUP_NAVIGATION_POLISH_SCRIPT = String.raw`
(function setupNavigationPolish() {
  const openedAtSetupRoot = location.pathname.replace(/\/+$/, '') === '/setup';
  let resumeApplied = false;

  function currentSession() {
    return typeof active === 'function' ? active() : store?.activeSession || null;
  }

  function firstPageNeedingAction() {
    const session = currentSession();
    if (!session) return PAGE_IDS[0];
    return PAGE_IDS.find((pageId) => session.pages?.[pageId]?.completed !== true) || PAGE_IDS.at(-1);
  }

  permitted = function setupPagePermitted(page) {
    const session = currentSession();
    if (!session) return page === PAGE_IDS[0];
    if (page === visiblePage) return true;
    if (session.pages?.[page]?.completed === true) return true;
    return page === firstPageNeedingAction();
  };

  nearestPermitted = function setupNearestPermitted(page) {
    if (openedAtSetupRoot && !resumeApplied) {
      resumeApplied = true;
      return firstPageNeedingAction();
    }
    if (PAGE_IDS.includes(page) && permitted(page)) return page;
    return firstPageNeedingAction();
  };

  function showAdjacentPage(page) {
    if (!PAGE_IDS.includes(page)) return;
    visiblePage = page;
    render();
    if (visiblePage === 'paseo' && typeof refreshPaseo === 'function') refreshPaseo();
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('#back,#continue');
    if (!button || button.disabled) return;

    const index = PAGE_IDS.indexOf(visiblePage);
    if (index < 0) return;

    if (button.id === 'continue' && index === PAGE_IDS.length - 1) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.id === 'back') {
      showAdjacentPage(PAGE_IDS[Math.max(0, index - 1)]);
      return;
    }
    showAdjacentPage(PAGE_IDS[Math.min(PAGE_IDS.length - 1, index + 1)]);
  }, true);
})();
`;

export function enhanceSetupWizardWithNavigationPolish(html) {
  const script = `<script data-setup-navigation-polish>${SETUP_NAVIGATION_POLISH_SCRIPT}</script>`;
  return String(html).includes('</body>') ? String(html).replace('</body>', `${script}</body>`) : `${html}${script}`;
}
