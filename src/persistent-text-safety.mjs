const AGENT_COMMAND = /\bpaseo\s+(run|send)\b/i;
const FAILURE_MARKER = /\sfailed:\s/gi;
const MAX_FAILURE_DETAIL = 2_000;

function conciseFailureDetail(value) {
  let detail = String(value || '').trim();
  if (!detail) return '';
  const nested = AGENT_COMMAND.exec(detail);
  if (nested) return sanitizeDurableText(detail);
  if (detail.length > MAX_FAILURE_DETAIL) detail = `${detail.slice(0, MAX_FAILURE_DETAIL)}…`;
  return detail;
}

export function sanitizeDurableText(value) {
  const text = String(value ?? '');
  const command = AGENT_COMMAND.exec(text);
  if (!command) return text;

  let markerIndex = -1;
  let markerLength = 0;
  FAILURE_MARKER.lastIndex = 0;
  for (let match = FAILURE_MARKER.exec(text); match; match = FAILURE_MARKER.exec(text)) {
    markerIndex = match.index;
    markerLength = match[0].length;
  }
  FAILURE_MARKER.lastIndex = 0;

  const subcommand = command[1].toLowerCase();
  const detail = markerIndex >= 0
    ? conciseFailureDetail(text.slice(markerIndex + markerLength))
    : '';
  return detail
    ? `Paseo ${subcommand} failed: ${detail}`
    : `Paseo ${subcommand} failure details redacted.`;
}

function sanitizeTextFields(value, fields) {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  for (const field of fields) {
    if (typeof next[field] === 'string') next[field] = sanitizeDurableText(next[field]);
  }
  return next;
}

const RUN_FIELDS = Object.freeze([
  'reason',
  'restartPreviousReason',
  'failureReason',
  'lastError',
]);
const NESTED_FIELDS = Object.freeze([
  'details',
  'detail',
  'message',
  'reason',
  'summary',
]);

export function sanitizeRunStateForPersistence(state) {
  if (!state || typeof state !== 'object') return state;
  const next = sanitizeTextFields(state, RUN_FIELDS);
  if (Array.isArray(state.activity)) {
    next.activity = state.activity.map((item) => sanitizeTextFields(item, NESTED_FIELDS));
  }
  if (Array.isArray(state.events)) {
    next.events = state.events.map((item) => sanitizeTextFields(item, NESTED_FIELDS));
  }
  return next;
}

export function safeCommandErrorArgs(command, args = []) {
  if (String(command).toLowerCase() !== 'paseo') return [...args];
  const subcommand = String(args[0] || '').toLowerCase();
  if (!['run', 'send'].includes(subcommand)) return [...args];
  return subcommand ? [subcommand] : [];
}

export function safeCommandErrorLabel(command, args = []) {
  const name = String(command || '').trim();
  if (name.toLowerCase() !== 'paseo') return [name, ...args].filter(Boolean).join(' ');
  const subcommand = String(args[0] || '').trim();
  if (['run', 'send'].includes(subcommand.toLowerCase())) return `paseo ${subcommand.toLowerCase()}`;
  return [name, ...args].filter(Boolean).join(' ');
}
