# Manager UI review implementation plan

This plan tracks the focused follow-up work from the manager UI review.

1. **Configuration composition cleanup**
   - stop creating setup-link cards that a later enhancer removes
   - keep the six setup-aligned configuration tabs as the sole navigation surface
   - add composition contract coverage

2. **Work Queue interaction and accessibility**
   - make the details drawer a real modal dialog with focus containment and focus restoration
   - replace native recovery/abandon browser dialogs with the shared manager confirmation modal
   - keep recover-first branch semantics unchanged

3. **Manager runtime composition hardening**
   - remove the remaining no-op setup-card cleanup path
   - replace chained `window.renderStatus` monkey-patching with a shared status subscription hook
   - add composed manager regression coverage for initialization order and final configuration DOM

Each item is intended to ship as a small pull request with focused validation before moving to the next item.
