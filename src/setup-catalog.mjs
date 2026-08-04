import { run } from './process.mjs';
import {
  discoverBranches,
  parseJsonOutput,
  probePaseo,
} from './setup-discovery.mjs';

const DEFAULT_PROVIDER_LIST_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL_COMMAND_TIMEOUT_MS = 8_000;
const DEFAULT_MODEL_TOTAL_TIMEOUT_MS = 24_000;

function commandMessage(result, fallback) {
  if (result?.timedOut) return `${fallback || 'Command'} timed out after ${result.timeoutMs}ms.`;
  return String(result?.stderr || result?.stdout || result?.error?.message || fallback || '').trim();
}

function runJsonCommand(runner, command, args, options = {}) {
  const result = runner(command, args, { ...options, allowFailure: true });
  const output = result?.stdout || result?.stderr || '';
  return { result, data: parseJsonOutput(output) };
}

function providerRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.entries)) return data.entries;
  if (Array.isArray(data?.providers)) return data.providers;
  if (Array.isArray(data?.result?.data)) return data.result.data;
  if (Array.isArray(data?.result?.entries)) return data.result.entries;
  return [];
}

function modelRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.entries)) return data.entries;
  if (Array.isArray(data?.result?.data)) return data.result.data;
  if (Array.isArray(data?.result?.models)) return data.result.models;
  return [];
}

function structuredError(data) {
  const value = data?.error || data?.message || data?.result?.error || data?.result?.message;
  return value == null ? '' : String(value).trim();
}

function normalizedEnabled(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return !['false', 'disabled', 'no', '0'].includes(text);
}

function statusPriority(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (['ready', 'available', 'connected', 'enabled'].includes(status)) return 0;
  if (['loading', 'starting', 'initializing', 'pending'].includes(status)) return 1;
  if (!status || status === 'unknown') return 2;
  return 3;
}

function providerId(row) {
  return String(row?.provider || row?.id || '').trim();
}

function providerSummary(row) {
  const id = providerId(row) || 'unknown';
  const status = String(row?.status || 'unknown');
  const enabled = normalizedEnabled(row?.enabled) ? 'enabled' : 'disabled';
  return `${id}: ${status}, ${enabled}`;
}

function providerRecord(row, models, error = null) {
  const id = providerId(row);
  return {
    id,
    label: String(row?.label || id),
    status: String(row?.status || 'unknown'),
    enabled: normalizedEnabled(row?.enabled),
    defaultMode: row?.defaultMode || row?.defaultModeId || null,
    modes: row?.modes || [],
    models,
    error,
  };
}

function normalizeModels(provider, data) {
  return modelRows(data)
    .map((model) => {
      const modelId = String(model?.id || model?.model || '').trim();
      if (!modelId) return null;
      return {
        id: modelId,
        label: String(model?.model || model?.label || modelId),
        description: String(model?.description || ''),
        thinkingOptionIds: Array.isArray(model?.thinkingOptionIds)
          ? model.thinkingOptionIds.map(String)
          : [],
        defaultThinkingOptionId: model?.defaultThinkingOptionId == null
          ? null
          : String(model.defaultThinkingOptionId),
        value: `${provider}/${modelId}`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function discoverPaseoCatalog(root, {
  runner = run,
  providerListTimeoutMs = DEFAULT_PROVIDER_LIST_TIMEOUT_MS,
  modelCommandTimeoutMs = DEFAULT_MODEL_COMMAND_TIMEOUT_MS,
  modelTotalTimeoutMs = DEFAULT_MODEL_TOTAL_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const listed = runJsonCommand(runner, 'paseo', ['provider', 'ls', '--json'], {
    cwd: root,
    timeoutMs: providerListTimeoutMs,
  });

  if (!listed.result?.ok || !listed.data) {
    return {
      providers: [],
      errors: [commandMessage(listed.result, 'Could not list Paseo providers.')],
      diagnostics: [],
      reportedProviders: [],
      attemptedProviders: [],
      skipped: false,
      complete: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const rows = providerRows(listed.data).filter((row) => providerId(row));
  const reportedProviders = rows.map(providerSummary);
  const disabledRows = rows.filter((row) => !normalizedEnabled(row.enabled));
  const candidates = rows
    .filter((row) => normalizedEnabled(row.enabled))
    .sort((left, right) => {
      const statusDifference = statusPriority(left.status) - statusPriority(right.status);
      if (statusDifference !== 0) return statusDifference;
      return providerId(left).localeCompare(providerId(right));
    });

  const diagnostics = disabledRows.map((row) => `Ignored disabled provider: ${providerSummary(row)}.`);
  const providers = [];
  const errors = [];
  const attemptedProviders = [];

  if (!rows.length) {
    errors.push('Paseo provider ls returned no provider records.');
  } else if (!candidates.length) {
    errors.push(`Paseo reported no enabled providers. Reported states: ${reportedProviders.join(' | ')}`);
  }

  const modelStartedAt = Date.now();
  const remainingModelBudget = () => Math.max(0, modelTotalTimeoutMs - (Date.now() - modelStartedAt));

  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index];
    const id = providerId(row);
    const remaining = remainingModelBudget();
    if (remaining <= 0) {
      const unqueried = candidates.slice(index).map(providerId).join(', ');
      errors.push(`Model discovery reached its ${modelTotalTimeoutMs}ms safety limit before these enabled providers could be checked: ${unqueried}.`);
      break;
    }

    attemptedProviders.push(id);
    const modelsResult = runJsonCommand(
      runner,
      'paseo',
      ['provider', 'models', id, '--thinking', '--json'],
      {
        cwd: root,
        timeoutMs: Math.max(1, Math.min(modelCommandTimeoutMs, remaining)),
      },
    );

    const responseError = structuredError(modelsResult.data);
    if (!modelsResult.result?.ok || !modelsResult.data || responseError) {
      const detail = responseError || commandMessage(modelsResult.result, 'Could not list models.');
      const error = `${id}: ${detail}`;
      errors.push(error);
      providers.push(providerRecord(row, [], error));
      continue;
    }

    const models = normalizeModels(id, modelsResult.data);
    const error = models.length ? null : `${id}: Paseo reported no models.`;
    if (error) errors.push(error);
    providers.push(providerRecord(row, models, error));
  }

  providers.sort((left, right) => {
    const leftHasModels = left.models.length > 0;
    const rightHasModels = right.models.length > 0;
    if (leftHasModels !== rightHasModels) return leftHasModels ? -1 : 1;
    return left.label.localeCompare(right.label);
  });

  return {
    providers,
    errors,
    diagnostics,
    reportedProviders,
    attemptedProviders,
    skipped: false,
    complete: attemptedProviders.length === candidates.length && errors.length === 0,
    elapsedMs: Date.now() - startedAt,
  };
}

export function discoverSetupOptions(root, options = {}) {
  const paseo = options.paseoOverride || probePaseo(root, options);
  const branches = discoverBranches(root, options);
  let catalog;

  if (!options.includeCatalog) {
    catalog = {
      providers: [],
      errors: paseo.reachable ? [] : [paseo.message],
      diagnostics: [],
      reportedProviders: [],
      attemptedProviders: [],
      skipped: true,
      complete: false,
      elapsedMs: 0,
    };
  } else {
    catalog = paseo.reachable
      ? discoverPaseoCatalog(root, options)
      : {
          providers: [],
          errors: [paseo.message],
          diagnostics: [],
          reportedProviders: [],
          attemptedProviders: [],
          skipped: false,
          complete: false,
          elapsedMs: 0,
        };
  }

  return {
    generatedAt: new Date().toISOString(),
    paseo,
    branches,
    catalog,
  };
}
