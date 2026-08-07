import { run as defaultRun } from '../process.mjs';
import { discoverPaseoCatalog } from '../setup-discovery.mjs';
import { createPaseoConnectionContext, redactSensitive } from './paseo-connection.mjs';
import {
  loadSetupSessionStore,
  recordSetupPageCheck,
  saveSetupPage,
} from './store.mjs';

function activeSession(options) {
  const store = loadSetupSessionStore(options);
  if (!store.activeSession) throw new Error('No active setup session exists.');
  return store.activeSession;
}

function paseoHost(session) {
  return String(session.pages?.paseo?.selections?.host || '').trim() || null;
}

async function credentialForHost(credentialStore, host) {
  if (!credentialStore || !host) return null;
  try { return await credentialStore.read(host); }
  catch { return null; }
}

function providerModel(provider, value) {
  const target = String(value || '').trim();
  if (!target) return null;
  return (provider?.models || []).find((model) => model.value === target || `${provider.id}/${model.id}` === target) || null;
}

function normalizeThinking(model, value) {
  const requested = String(value || '').trim();
  const options = Array.isArray(model?.thinkingOptionIds) ? model.thinkingOptionIds.map(String) : [];
  if (!options.length) return '';
  if (requested && options.includes(requested)) return requested;
  const preferred = model?.defaultThinkingOptionId == null ? '' : String(model.defaultThinkingOptionId);
  return options.includes(preferred) ? preferred : '';
}

function selectionFromPage(session) {
  const selections = session.pages?.harness?.selections || {};
  return {
    harness: String(selections.harness || '').trim(),
    codingModel: String(selections.codingModel || '').trim(),
    codingThinking: String(selections.codingThinking || '').trim(),
    reviewModel: String(selections.reviewModel || '').trim(),
    reviewThinking: String(selections.reviewThinking || '').trim(),
    noModelAcknowledged: selections.noModelAcknowledged === true,
  };
}

function checkSelection(catalog, selection) {
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  const provider = providers.find((item) => item.id === selection.harness);
  const blockers = [];

  if (!provider) {
    blockers.push({
      code: 'paseo-harness-required',
      message: selection.harness
        ? 'The selected coding harness is no longer available from Paseo.'
        : 'Choose an available coding harness.',
      recoveryAction: 'Refresh the catalog and choose an available harness.',
    });
    return { ok: false, provider: null, blockers };
  }

  const models = Array.isArray(provider.models) ? provider.models : [];
  if (!models.length) {
    if (!selection.noModelAcknowledged) {
      blockers.push({
        code: 'paseo-harness-no-models-acknowledgement-required',
        message: 'Paseo reported no selectable models for this harness.',
        recoveryAction: 'Acknowledge that this harness manages models outside Paseo before continuing.',
      });
    }
    return { ok: blockers.length === 0, provider, blockers };
  }

  const coding = providerModel(provider, selection.codingModel);
  const review = providerModel(provider, selection.reviewModel);
  if (!coding) blockers.push({
    code: 'paseo-coding-model-required',
    message: 'Choose an available coding model for the selected harness.',
    recoveryAction: 'Select a coding model from the refreshed catalog.',
  });
  if (!review) blockers.push({
    code: 'paseo-review-model-required',
    message: 'Choose an available review model for the selected harness.',
    recoveryAction: 'Select a review model from the refreshed catalog.',
  });
  if (coding && selection.codingThinking && !coding.thinkingOptionIds?.map(String).includes(selection.codingThinking)) {
    blockers.push({
      code: 'paseo-coding-thinking-invalid',
      message: 'The selected coding thinking level is no longer available.',
      recoveryAction: 'Choose a current thinking level or None.',
    });
  }
  if (review && selection.reviewThinking && !review.thinkingOptionIds?.map(String).includes(selection.reviewThinking)) {
    blockers.push({
      code: 'paseo-review-thinking-invalid',
      message: 'The selected review thinking level is no longer available.',
      recoveryAction: 'Choose a current thinking level or None.',
    });
  }
  return { ok: blockers.length === 0, provider, blockers };
}

function preservedSelection(catalog, prior) {
  const provider = (catalog.providers || []).find((item) => item.id === prior.harness);
  if (!provider) return {
    harness: '', codingModel: '', codingThinking: '', reviewModel: '', reviewThinking: '', noModelAcknowledged: false,
  };
  if (!(provider.models || []).length) return {
    harness: provider.id,
    codingModel: '',
    codingThinking: '',
    reviewModel: '',
    reviewThinking: '',
    noModelAcknowledged: prior.noModelAcknowledged === true,
  };
  const coding = providerModel(provider, prior.codingModel);
  const review = providerModel(provider, prior.reviewModel);
  return {
    harness: provider.id,
    codingModel: coding?.value || '',
    codingThinking: normalizeThinking(coding, prior.codingThinking),
    reviewModel: review?.value || '',
    reviewThinking: normalizeThinking(review, prior.reviewThinking),
    noModelAcknowledged: false,
  };
}

function publicCatalog(catalog) {
  return {
    providers: (catalog?.providers || []).map((provider) => ({
      id: String(provider.id),
      label: String(provider.label || provider.id),
      status: String(provider.status || 'available'),
      defaultMode: provider.defaultMode || null,
      modes: Array.isArray(provider.modes) ? provider.modes : [],
      models: (provider.models || []).map((model) => ({
        id: String(model.id),
        label: String(model.label || model.id),
        description: String(model.description || ''),
        value: String(model.value || `${provider.id}/${model.id}`),
        thinkingOptionIds: Array.isArray(model.thinkingOptionIds) ? model.thinkingOptionIds.map(String) : [],
        defaultThinkingOptionId: model.defaultThinkingOptionId == null ? null : String(model.defaultThinkingOptionId),
      })),
      noModels: !(provider.models || []).length && !provider.error?.includes('Could not list models'),
      warning: provider.error || null,
    })),
    errors: Array.isArray(catalog?.errors) ? catalog.errors.map(String) : [],
    complete: catalog?.complete === true,
    elapsedMs: Number(catalog?.elapsedMs || 0),
  };
}

async function loadCatalog({ credentialStore, catalogLoader, ...options } = {}) {
  const session = activeSession(options);
  const host = paseoHost(session);
  if (!host) throw new Error('Connect and verify Paseo before choosing a coding harness.');
  const stored = await credentialForHost(credentialStore, host);
  const contextFactory = options.contextFactory || createPaseoConnectionContext;
  const context = contextFactory({
    host,
    password: stored?.password || null,
    cwd: options.cwd,
    env: options.env,
    run: options.run,
    runJson: options.runJson,
  });
  const loader = catalogLoader || ((root, discoveryOptions) => discoverPaseoCatalog(root, discoveryOptions));
  const runner = (command, args, runnerOptions = {}) => {
    if (command === 'paseo') return context.command(args, runnerOptions);
    return (options.run || defaultRun)(command, args, runnerOptions);
  };
  const catalog = await loader(options.cwd || options.rootDir, {
    runner,
    commandTimeoutMs: options.commandTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
  });
  return { session, host, catalog: publicCatalog(redactSensitive(catalog)) };
}

function response(catalog, session) {
  const selection = selectionFromPage(session);
  const validation = checkSelection(catalog, selection);
  return {
    catalog,
    selection,
    check: session.pages?.harness?.lastCheck || {
      ok: validation.ok,
      summary: validation.ok ? 'Coding harness and model selections are ready.' : validation.blockers[0]?.message || 'Choose a coding harness.',
      blockers: validation.blockers,
    },
    reviewExplanation: {
      quick: 'Quick review uses the selected review model for focused feedback before manual or Web ChatGPT review.',
      full: 'Full review uses a fresh review session to inspect the complete pull request before merge eligibility is decided.',
    },
    technicalDetails: {
      providerCount: catalog.providers.length,
      catalogComplete: catalog.complete,
      catalogErrors: catalog.errors,
      elapsedMs: catalog.elapsedMs,
    },
  };
}

export async function getHarnessSetupPageStatus(options = {}) {
  const { session, catalog } = await loadCatalog(options);
  const prior = selectionFromPage(session);
  const preserved = preservedSelection(catalog, prior);
  let currentSession = session;
  if (JSON.stringify(prior) !== JSON.stringify(preserved)) {
    currentSession = saveSetupPage('harness', { selections: preserved }, options);
  }
  return response(catalog, currentSession);
}

export async function saveHarnessSetupPage(input = {}, options = {}) {
  const { catalog } = await loadCatalog(options);
  const prior = selectionFromPage(activeSession(options));
  const requestedHarness = String(input.harness ?? prior.harness).trim();
  const provider = catalog.providers.find((item) => item.id === requestedHarness);
  const harnessChanged = requestedHarness !== prior.harness;
  const candidate = {
    harness: provider?.id || requestedHarness,
    codingModel: harnessChanged ? '' : String(input.codingModel ?? prior.codingModel).trim(),
    codingThinking: harnessChanged ? '' : String(input.codingThinking ?? prior.codingThinking).trim(),
    reviewModel: harnessChanged ? '' : String(input.reviewModel ?? prior.reviewModel).trim(),
    reviewThinking: harnessChanged ? '' : String(input.reviewThinking ?? prior.reviewThinking).trim(),
    noModelAcknowledged: harnessChanged ? false : (input.noModelAcknowledged ?? prior.noModelAcknowledged) === true,
  };
  if (!harnessChanged) {
    candidate.codingModel = String(input.codingModel ?? candidate.codingModel).trim();
    candidate.reviewModel = String(input.reviewModel ?? candidate.reviewModel).trim();
    const coding = providerModel(provider, candidate.codingModel);
    const review = providerModel(provider, candidate.reviewModel);
    candidate.codingThinking = normalizeThinking(coding, input.codingThinking ?? candidate.codingThinking);
    candidate.reviewThinking = normalizeThinking(review, input.reviewThinking ?? candidate.reviewThinking);
  }
  let session = saveSetupPage('harness', { selections: candidate }, options);
  const validation = checkSelection(catalog, selectionFromPage(session));
  session = recordSetupPageCheck('harness', {
    ok: validation.ok,
    summary: validation.ok ? 'Coding harness and model selections are ready.' : validation.blockers[0]?.message || 'Harness setup needs attention.',
    blockers: validation.blockers,
  }, options);
  return response(catalog, session);
}

export async function recheckHarnessSetupPage(options = {}) {
  const { catalog } = await loadCatalog(options);
  const prior = selectionFromPage(activeSession(options));
  const preserved = preservedSelection(catalog, prior);
  let session = saveSetupPage('harness', { selections: preserved }, options);
  const validation = checkSelection(catalog, preserved);
  session = recordSetupPageCheck('harness', {
    ok: validation.ok,
    summary: validation.ok ? 'Coding harness and model selections are ready.' : validation.blockers[0]?.message || 'Harness setup needs attention.',
    blockers: validation.blockers,
  }, options);
  return response(catalog, session);
}
