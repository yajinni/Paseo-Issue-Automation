import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceSetupWizardWithShellFeedback,
  SETUP_SHELL_FEEDBACK_SCRIPT,
} from '../../src/setup-wizard/shell-feedback-ui.mjs';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('setup shell removes unchecked reminder copy and installs progress feedback before page scripts', () => {
  const html = enhanceSetupWizardWithShellFeedback(setupWizardHtml({ requestedPage: 'paseo' }));

  assert.match(html, /data-setup-shell-feedback-style/);
  assert.match(html, /data-setup-shell-feedback/);
  assert.doesNotMatch(html, /Not checked yet/);
  assert.doesNotMatch(html, /Use Recheck after completing this page\./);
  assert.ok(html.indexOf('data-setup-shell-feedback') < html.indexOf('</head>'));
});

test('setup actions longer than one second show an explicit operation overlay with waiting checks', () => {
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /setTimeout\(\(\) => \{/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /\}, 1000\)/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /setup-operation-overlay/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /aria-live="polite"/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Checks that have not returned yet are shown as waiting/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /index === 0 \? 'checking' : 'waiting'/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /s elapsed/);
});

test('setup operation feedback names the work for each long-running setup area', () => {
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Checking Paseo/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Provider\/Coding Harness/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Checking GitHub repository access/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Preparing repository workspace/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Checking issue-processing setup/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Checking review setup/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Running final readiness checks/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /Finishing setup/);
});

test('failed multi-check feedback does not invent successful checks', () => {
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /blockingStepIndex/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /index === failedIndex \? 'bad' : 'checked'/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /state === 'checked' \? 'Checked'/);
  assert.doesNotMatch(SETUP_SHELL_FEEDBACK_SCRIPT, /passed \? 'ok' : index === task\.meta\.steps\.length - 1 \? 'bad' : 'ok'/);
});

test('successful setup checks refresh shell completion so Continue updates without Recheck', () => {
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /refreshShellState/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /window\.reloadStore/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /window\.render/);
  assert.match(SETUP_SHELL_FEEDBACK_SCRIPT, /if \(response\.ok\) await refreshShellState\(path\)/);
});
