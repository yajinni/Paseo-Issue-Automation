import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SETUP_CATALOG_FEEDBACK_SCRIPT,
  setupCatalogFeedback,
} from '../src/setup-catalog-feedback-script.mjs';

function setupData(providers, errors = []) {
  return {
    requirements: { paseoReachable: true },
    setupCheckedAt: '2026-08-04T18:37:20.000Z',
    setupOptions: {
      catalog: {
        skipped: false,
        providers,
        errors,
      },
    },
  };
}

test('detected Paseo harnesses produce a green named summary despite disabled provider diagnostics', () => {
  const feedback = setupCatalogFeedback(setupData([
    {
      id: 'opencode',
      label: 'OpenCode',
      models: [{ id: 'big-pickle' }, { id: 'other-model' }],
    },
  ], [
    'claude: provider is unavailable and disabled.',
    'codex: provider is unavailable and disabled.',
  ]));

  assert.equal(feedback.hasHarnesses, true);
  assert.equal(feedback.className, 'muted good-text');
  assert.match(feedback.text, /Found Paseo harness: OpenCode \(opencode\)\./);
  assert.match(feedback.text, /2 models available\./);
  assert.doesNotMatch(feedback.text, /claude|codex|unavailable|disabled/i);
});

test('zero detected harnesses produce only the concise red setup error', () => {
  const feedback = setupCatalogFeedback(setupData([], [
    'provider ls returned a long diagnostic that should not be shown here',
  ]));

  assert.equal(feedback.hasHarnesses, false);
  assert.equal(feedback.className, 'muted bad-text');
  assert.match(feedback.text, /^No Paseo provider or harness found\./);
  assert.doesNotMatch(feedback.text, /long diagnostic|provider ls returned/i);
  assert.equal(feedback.toast, 'No Paseo provider or harness found.');
});

test('catalog feedback script normalizes both inline status and refresh toasts', () => {
  assert.match(SETUP_CATALOG_FEEDBACK_SCRIPT, /MutationObserver/);
  assert.match(SETUP_CATALOG_FEEDBACK_SCRIPT, /Harnesses loaded, but some provider diagnostics need attention/);
  assert.match(SETUP_CATALOG_FEEDBACK_SCRIPT, /Paseo did not report any usable harnesses/);
  assert.match(SETUP_CATALOG_FEEDBACK_SCRIPT, /setupCatalogFeedback/);
});
