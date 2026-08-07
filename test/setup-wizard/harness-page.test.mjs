import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getHarnessSetupPageStatus,
  recheckHarnessSetupPage,
  saveHarnessSetupPage,
} from '../../src/setup-wizard/harness-page-service.mjs';
import {
  loadSetupSessionStore,
  saveSetupPage,
  startSetupSession,
} from '../../src/setup-wizard/store.mjs';

function temporaryManager(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'harness-page-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  startSetupSession({ rootDir });
  saveSetupPage('paseo', { selections: { host: '127.0.0.1:6767' } }, { rootDir });
  return rootDir;
}

function credentialStore(password = 'session-secret') {
  return {
    async read() { return { password, persistent: false, backend: 'test-memory' }; },
  };
}

function contextFactory({ host, password }) {
  return {
    host,
    authenticated: Boolean(password),
    command(args) {
      return { ok: true, stdout: JSON.stringify({ args }), stderr: '' };
    },
  };
}

function catalog(providers, extra = {}) {
  return {
    providers,
    errors: [],
    complete: true,
    elapsedMs: 5,
    ...extra,
  };
}

const alpha = {
  id: 'alpha',
  label: 'Alpha',
  status: 'available',
  models: [
    {
      id: 'fast',
      label: 'Fast',
      value: 'alpha/fast',
      thinkingOptionIds: ['low', 'high'],
      defaultThinkingOptionId: 'low',
    },
    {
      id: 'review',
      label: 'Review',
      value: 'alpha/review',
      thinkingOptionIds: [],
      defaultThinkingOptionId: null,
    },
  ],
};

const beta = {
  id: 'beta',
  label: 'Beta',
  status: 'available',
  models: [{ id: 'only', label: 'Only', value: 'beta/only', thinkingOptionIds: [] }],
};

test('harness page exposes ready providers and independent coding/review selections', async (t) => {
  const rootDir = temporaryManager(t);
  const loader = async () => catalog([alpha, beta]);

  let result = await getHarnessSetupPageStatus({
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    catalogLoader: loader,
  });
  assert.deepEqual(result.catalog.providers.map((provider) => provider.id), ['alpha', 'beta']);
  assert.equal(result.check.ok, false);

  result = await saveHarnessSetupPage({ harness: 'alpha' }, {
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    catalogLoader: loader,
  });
  assert.equal(result.check.ok, false);
  assert.equal(result.selection.harness, 'alpha');

  result = await saveHarnessSetupPage({
    codingModel: 'alpha/fast',
    codingThinking: 'high',
    reviewModel: 'alpha/review',
  }, {
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    catalogLoader: loader,
  });
  assert.equal(result.check.ok, true);
  assert.equal(result.selection.codingThinking, 'high');
  assert.equal(result.selection.reviewThinking, '');
  assert.match(result.reviewExplanation.quick, /light or same model/);
  assert.match(result.reviewExplanation.full, /heavy PR review model/);
});

test('loading harness status automatically validates saved selections without requiring Recheck', async (t) => {
  const rootDir = temporaryManager(t);
  saveSetupPage('harness', {
    selections: {
      harness: 'alpha',
      codingModel: 'alpha/fast',
      codingThinking: 'high',
      reviewModel: 'alpha/review',
      reviewThinking: '',
    },
  }, { rootDir });
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.harness.completed, false);

  const result = await getHarnessSetupPageStatus({
    rootDir,
    credentialStore: credentialStore(),
    contextFactory,
    catalogLoader: async () => catalog([alpha]),
  });

  assert.equal(result.check.ok, true);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.harness.completed, true);
});

test('changing harness clears only model selections that belong to the prior harness', async (t) => {
  const rootDir = temporaryManager(t);
  const loader = async () => catalog([alpha, beta]);
  const options = { rootDir, credentialStore: credentialStore(), contextFactory, catalogLoader: loader };
  await saveHarnessSetupPage({ harness: 'alpha' }, options);
  await saveHarnessSetupPage({ codingModel: 'alpha/fast', reviewModel: 'alpha/review' }, options);

  const changed = await saveHarnessSetupPage({ harness: 'beta' }, options);
  assert.deepEqual(changed.selection, {
    harness: 'beta',
    codingModel: '',
    codingThinking: '',
    reviewModel: '',
    reviewThinking: '',
    noModelAcknowledged: false,
  });
  assert.equal(changed.check.ok, false);
});

test('recheck preserves valid values and clears an unavailable harness instead of silently keeping it', async (t) => {
  const rootDir = temporaryManager(t);
  let current = catalog([alpha]);
  const loader = async () => current;
  const options = { rootDir, credentialStore: credentialStore(), contextFactory, catalogLoader: loader };
  await saveHarnessSetupPage({ harness: 'alpha' }, options);
  await saveHarnessSetupPage({ codingModel: 'alpha/fast', codingThinking: 'high', reviewModel: 'alpha/review' }, options);

  let result = await recheckHarnessSetupPage(options);
  assert.equal(result.selection.harness, 'alpha');
  assert.equal(result.selection.codingModel, 'alpha/fast');
  assert.equal(result.selection.codingThinking, 'high');

  current = catalog([beta]);
  result = await recheckHarnessSetupPage(options);
  assert.equal(result.selection.harness, '');
  assert.equal(result.check.ok, false);
  assert.equal(loadSetupSessionStore({ rootDir }).activeSession.pages.harness.completed, false);
});

test('legitimate no-model harness requires explicit acknowledgement', async (t) => {
  const rootDir = temporaryManager(t);
  const noModels = { id: 'managed-externally', label: 'Managed externally', status: 'available', models: [], error: 'managed-externally: Paseo reported no models.' };
  const loader = async () => catalog([noModels], { errors: ['managed-externally: Paseo reported no models.'], complete: false });
  const options = { rootDir, credentialStore: credentialStore(), contextFactory, catalogLoader: loader };

  let result = await saveHarnessSetupPage({ harness: 'managed-externally' }, options);
  assert.equal(result.catalog.providers[0].noModels, true);
  assert.equal(result.check.ok, false);
  assert.equal(result.check.blockers[0].code, 'paseo-harness-no-models-acknowledgement-required');

  result = await saveHarnessSetupPage({ noModelAcknowledged: true }, options);
  assert.equal(result.check.ok, true);
});

test('catalog timeout errors stay actionable and do not erase an otherwise valid saved selection', async (t) => {
  const rootDir = temporaryManager(t);
  let current = catalog([alpha]);
  const loader = async () => current;
  const options = { rootDir, credentialStore: credentialStore(), contextFactory, catalogLoader: loader };
  await saveHarnessSetupPage({ harness: 'alpha' }, options);
  await saveHarnessSetupPage({ codingModel: 'alpha/fast', reviewModel: 'alpha/review' }, options);

  current = catalog([alpha], { errors: ['Catalog refresh reached its 35000ms safety limit.'], complete: false, elapsedMs: 35000 });
  const result = await recheckHarnessSetupPage(options);
  assert.equal(result.selection.harness, 'alpha');
  assert.equal(result.selection.codingModel, 'alpha/fast');
  assert.deepEqual(result.technicalDetails.catalogErrors, ['Catalog refresh reached its 35000ms safety limit.']);
});
