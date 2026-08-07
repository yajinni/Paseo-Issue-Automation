export const ISSUE_TEMPLATE_VERSION = 2;
export const ISSUE_TEMPLATE_MARKER_PREFIX = 'paseo-issue-template:v';

export const REQUIRED_ISSUE_SECTIONS = Object.freeze([
  'Objective',
  'Required behavior',
  'Acceptance criteria',
  'Validation and checks',
  'Stop conditions',
]);

export function issueTemplateMarker(version = ISSUE_TEMPLATE_VERSION) {
  return `<!-- ${ISSUE_TEMPLATE_MARKER_PREFIX}${Number(version)} -->`;
}

export function detectIssueTemplateVersion(body) {
  const text = String(body || '');
  const match = text.match(/<!--\s*paseo-issue-template:v(\d+)\s*-->/i);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isInteger(version) && version > 0 ? version : null;
}

export function sectionContent(body, heading) {
  const text = String(body || '');
  const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  const target = headings.findIndex((match) => match[1].trim().toLowerCase() === heading.toLowerCase());
  if (target < 0) return '';
  const start = headings[target].index + headings[target][0].length;
  const end = headings[target + 1]?.index ?? text.length;
  return text.slice(start, end).trim();
}

function stripPlaceholders(content) {
  return String(content || '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*-\s*\[\s*[ xX]?\s*\]\s*$/gm, '')
    .replace(/^\s*[-*]\s*$/gm, '')
    .trim();
}

function isPlaceholderOnly(content) {
  const normalized = stripPlaceholders(content);
  if (!normalized) return true;
  return /^(?:none|n\/a|todo|tbd|placeholder|add (?:details?|criteria|checks?|content)(?: here)?[.!]?)$/i.test(normalized);
}

export function validateIssueBody(body) {
  const text = String(body || '');
  const templateVersion = detectIssueTemplateVersion(text);
  const missingFields = [];
  const invalidFields = [];

  for (const heading of REQUIRED_ISSUE_SECTIONS) {
    const content = sectionContent(text, heading);
    if (!content) {
      missingFields.push({ field: heading, code: 'missing-section', message: `${heading} is required.` });
      continue;
    }
    if (isPlaceholderOnly(content)) {
      invalidFields.push({ field: heading, code: 'empty-section', message: `${heading} must contain meaningful content.` });
    }
  }

  if (templateVersion !== null && templateVersion > ISSUE_TEMPLATE_VERSION) {
    invalidFields.push({
      field: 'templateVersion',
      code: 'unsupported-template-version',
      message: `Issue template version ${templateVersion} is newer than supported version ${ISSUE_TEMPLATE_VERSION}.`,
    });
  }

  const missing = [...missingFields, ...invalidFields]
    .filter((entry) => entry.field !== 'templateVersion')
    .map((entry) => entry.field);
  const ok = missingFields.length === 0 && invalidFields.length === 0;
  return {
    ok,
    templateVersion,
    legacyCompatible: templateVersion === null,
    missing,
    missingFields,
    invalidFields,
    reason: ok
      ? null
      : [...missingFields, ...invalidFields].map((entry) => entry.message).join(' '),
  };
}
