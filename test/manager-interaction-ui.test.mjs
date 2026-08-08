import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithInteractionPolish,
  MANAGER_INTERACTION_SCRIPT,
  MANAGER_INTERACTION_STYLE,
} from '../src/manager-interaction-ui.mjs';

test('manager mutations show immediate busy state and a delayed shared progress overlay', () => {
  assert.match(MANAGER_INTERACTION_SCRIPT, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /setTimeout\(\(\) => \{/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /\}, 1000\)/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /Still working · .*s elapsed/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /if \(method === 'GET'\) return null/);
  assert.match(MANAGER_INTERACTION_STYLE, /manager-operation-overlay/);
});

test('manager actions report human-readable success and failure feedback', () => {
  assert.match(MANAGER_INTERACTION_SCRIPT, /resultSummary/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /toast\('success', 'Action complete'/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /toast\('error'/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /Action failed/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /Technical action result \(raw JSON\)/);
  assert.match(MANAGER_INTERACTION_STYLE, /manager-toast-region/);
});

test('styled confirmation modal replaces primary destructive native-confirm paths', () => {
  for (const id of [
    'install-external-controller',
    'migrate-embedded-controller',
    'finalize-existing-migration',
    'repair-external-controller',
    'remove-external-controller',
    'remove-button',
  ]) assert.match(MANAGER_INTERACTION_SCRIPT, new RegExp(id));
  assert.match(MANAGER_INTERACTION_SCRIPT, /restart-issue/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /abandon-issue/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /stopImmediatePropagation/);
  assert.doesNotMatch(MANAGER_INTERACTION_SCRIPT, /\bconfirm\s*\(/);
  assert.doesNotMatch(MANAGER_INTERACTION_SCRIPT, /\bprompt\s*\(/);
});

test('recover-first and fresh restart confirmations reflect the selected branch action', () => {
  assert.match(MANAGER_INTERACTION_SCRIPT, /payload\.branchAction === 'delete'/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /Recover issue #/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /using its existing branch, workspace, and coder/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /fresh attempt will be used only if recovery is unavailable or already exhausted/i);
  assert.match(MANAGER_INTERACTION_SCRIPT, /Start fresh/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /delete the recorded old branch/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /\['Restart', 'Recover', 'Abandon'\]/);
});

test('confirmation modal provides accessible focus management and reason input', () => {
  assert.match(MANAGER_INTERACTION_SCRIPT, /role="dialog"/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /aria-modal="true"/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /event\.key === 'Escape'/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /event\.key !== 'Tab'/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /lastFocus\?\.focus/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /field\.setAttribute\('aria-label', 'Reason'\)/);
  assert.match(MANAGER_INTERACTION_SCRIPT, /Reason required/);
});

test('interaction layer completes setup-theme status and action styling', () => {
  assert.match(MANAGER_INTERACTION_STYLE, /paseo-status-chip/);
  assert.match(MANAGER_INTERACTION_STYLE, /paseo-action/);
  assert.match(MANAGER_INTERACTION_STYLE, /var\(--paseo-primary\)/);
  assert.match(MANAGER_INTERACTION_STYLE, /#mode-banner:not\(\.error\)\{display:none\}/);
  assert.match(MANAGER_INTERACTION_STYLE, /@media\(max-width:560px\)/);
});

test('enhancer appends final interaction assets without replacing manager markup', () => {
  const html = enhanceManagerWithInteractionPolish('<html><head></head><body><main class="shell"></main></body></html>');
  assert.match(html, /data-manager-interaction-style/);
  assert.match(html, /data-manager-interaction/);
  assert.match(html, /<main class="shell"><\/main>/);
  assert.ok(html.indexOf('data-manager-interaction-style') < html.indexOf('</head>'));
  assert.ok(html.indexOf('data-manager-interaction') < html.indexOf('</body>'));
});
