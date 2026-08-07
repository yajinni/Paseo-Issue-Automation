import { loadSetupSessionStore } from './setup-wizard/store.mjs';

function repositoryName(session = {}) {
  const selected = String(session.pages?.repository?.selections?.repository || '').trim();
  if (selected) return selected;
  const owner = String(session.repository?.owner || '').trim();
  const name = String(session.repository?.name || '').trim();
  return owner && name ? `${owner}/${name}` : null;
}

function matchingSession(repository, options = {}) {
  if (!options.rootDir) return null;
  let store;
  try { store = loadSetupSessionStore(options); }
  catch { return null; }
  const sessions = [store.activeSession, ...(store.completedSessions || []).slice().reverse()].filter(Boolean);
  return sessions.find((session) => repositoryName(session) === repository) || null;
}

export function managerReviewProfileStatus(repository, config = {}, options = {}) {
  const required = config.review?.workflow === 'quick-web-chatgpt';
  if (!required) return {
    required: false,
    known: true,
    ready: null,
    repositoryMatches: null,
    conversationUrlConfigured: null,
    checkedAt: null,
    summary: 'ChatGPT Profile is not required by the selected review workflow.',
    blockers: [],
    setupPath: '/setup/review',
    passwordStored: false,
  };

  const nameWithOwner = String(repository || '').trim();
  const session = matchingSession(nameWithOwner, options);
  if (!session) return {
    required: true,
    known: false,
    ready: false,
    repositoryMatches: false,
    conversationUrlConfigured: false,
    checkedAt: null,
    summary: 'No saved ChatGPT Profile verification was found for this repository. Open Review setup to verify it.',
    blockers: [],
    setupPath: '/setup/review',
    passwordStored: false,
  };

  const page = session.pages?.review || {};
  const selection = page.selections || {};
  const check = page.lastCheck || null;
  const workflowMatches = selection.workflow === 'quick-web-chatgpt';
  const conversationUrlConfigured = Boolean(String(selection.conversationUrl || '').trim());
  const ready = workflowMatches && conversationUrlConfigured && check?.ok === true;
  return {
    required: true,
    known: true,
    ready,
    repositoryMatches: true,
    conversationUrlConfigured,
    checkedAt: check?.checkedAt || page.updatedAt || null,
    summary: ready
      ? (check?.summary || 'The saved ChatGPT Profile verification passed for this repository.')
      : (check?.summary || 'ChatGPT Profile needs to be verified for this repository.'),
    blockers: Array.isArray(check?.blockers) ? check.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      recoveryAction: blocker.recoveryAction || null,
    })) : [],
    setupPath: '/setup/review',
    passwordStored: false,
  };
}
