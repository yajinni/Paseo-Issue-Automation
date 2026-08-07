import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithWorkspacePage,
  WORKSPACE_PAGE_SCRIPT,
} from '../../src/setup-wizard/workspace-page-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('checkout/workspace UI explains bounded discovery, managed clone, and readiness verification', () => {
  const html = enhanceSetupWizardWithWorkspacePage(setupWizardHtml({ requestedPage: 'checkout' }));
  assert.match(html, /data-setup-workspace-page/);
  assert.match(html, /\/api\/setup\/workspace\/status/);
  assert.match(html, /\/api\/setup\/workspace\/prepare/);
  assert.match(html, /\/api\/setup\/workspace\/recheck/);
  assert.match(html, /Dirty user clones are shown but never altered/);
  assert.match(html, /manager-owned clone directory/);
  assert.match(html, /Clone and prepare workspace/);
  assert.match(html, /Permanent Paseo workspace/);
  assert.match(html, /Isolated worktree probe/);
  assert.match(html, /No paid model prompt/);
  assert.match(html, /Temporary worktree, branch, and directory cleanup verified/);
});

test('workspace page module activates only for checkout/workspace routes and owns Recheck there', () => {
  assert.match(WORKSPACE_PAGE_SCRIPT, /\['checkout', 'workspace'\]/);
  assert.match(WORKSPACE_PAGE_SCRIPT, /if \(!onPage\(\)\) return/);
  assert.match(WORKSPACE_PAGE_SCRIPT, /stopImmediatePropagation/);
  assert.match(WORKSPACE_PAGE_SCRIPT, /refresh\(true\)/);
});
