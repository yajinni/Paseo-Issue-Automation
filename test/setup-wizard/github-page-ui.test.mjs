import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithGitHubPage,
  GITHUB_PAGE_SCRIPT,
} from '../../src/setup-wizard/github-page-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('GitHub page exposes account, repository, base branch, search, and recovery controls', () => {
  const html = enhanceSetupWizardWithGitHubPage(setupWizardHtml({ requestedPage: 'repository' }));
  assert.match(html, /data-setup-github-page/);
  assert.match(html, /\/api\/setup\/github\/status/);
  assert.match(html, /\/api\/setup\/github\/save/);
  assert.match(html, /\/api\/setup\/github\/recheck/);
  assert.match(html, /\/api\/setup\/github\/account/);
  assert.match(html, /Add account/);
  assert.match(html, /Reauthenticate/);
  assert.match(html, /Set up Git credentials/);
  assert.match(html, /Filter repositories/);
  assert.match(html, /Repository/);
  assert.match(html, /Base branch/);
  assert.match(html, /recommended/);
  assert.match(html, /Refresh repositories/);
});

test('GitHub page explains unavailable repositories and intercepts Recheck only on its own route', () => {
  assert.match(GITHUB_PAGE_SCRIPT, /unavailable/);
  assert.match(GITHUB_PAGE_SCRIPT, /required read, write, issues, and label permissions|read, branch-push, pull-request, issue, and label capabilities/);
  assert.match(GITHUB_PAGE_SCRIPT, /if \(!onPage\(\)\) return/);
  assert.match(GITHUB_PAGE_SCRIPT, /stopImmediatePropagation/);
});
