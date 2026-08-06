import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, loadIntegration, statePaths } from './state.mjs';

export const CONTROLLER_MODES = Object.freeze({
  embedded: 'embedded-repository',
  external: 'external-manager',
});

function stateRoot(root) {
  return statePaths(root).root;
}

function modeFile(root) {
  return path.join(stateRoot(root), 'controller-mode.json');
}

function storedMode(root) {
  const file = modeFile(root);
  if (!existsSync(file)) return null;
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    return Object.values(CONTROLLER_MODES).includes(stored?.mode) ? stored.mode : null;
  } catch {
    return null;
  }
}

function completedRemoval(root) {
  const file = path.join(stateRoot(root), 'external-maintenance.json');
  if (!existsSync(file)) return false;
  try {
    const maintenance = JSON.parse(readFileSync(file, 'utf8'));
    return maintenance?.removal?.state === 'completed';
  } catch {
    return false;
  }
}

function completedMigrationMode(root) {
  const file = path.join(stateRoot(root), 'external-migration.json');
  if (!existsSync(file)) return null;
  try {
    const migration = JSON.parse(readFileSync(file, 'utf8'));
    return migration?.state === 'completed' ? CONTROLLER_MODES.external : null;
  } catch {
    return null;
  }
}

export function loadControllerMode(root) {
  try {
    // A newly saved explicit mode is authoritative. This lets a repository be
    // reinstalled after a completed removal without deleting its audit record.
    const explicit = storedMode(root);
    if (explicit) return explicit;

    // Completed removal is authoritative over older migration and ownership
    // records when no newer explicit mode has been saved.
    if (completedRemoval(root)) return null;

    const migratedMode = completedMigrationMode(root);
    if (migratedMode) return migratedMode;

    const integration = loadIntegration(root);
    return integration.paseoJson?.serviceAddedByPackage === true
      ? CONTROLLER_MODES.embedded
      : null;
  } catch {
    return null;
  }
}

export function saveControllerMode(root, mode) {
  if (!Object.values(CONTROLLER_MODES).includes(mode)) {
    throw new Error(`Unknown controller installation mode: ${mode}`);
  }
  const value = { version: 1, mode, updatedAt: new Date().toISOString() };
  atomicWrite(modeFile(root), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export function clearControllerMode(root) {
  const file = modeFile(root);
  rmSync(file, { force: true });
  return { cleared: true, file };
}

export function usesExternalController(root) {
  return loadControllerMode(root) === CONTROLLER_MODES.external;
}
