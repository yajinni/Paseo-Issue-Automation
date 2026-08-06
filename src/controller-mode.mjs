import { existsSync, readFileSync } from 'node:fs';
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

function completedMigrationMode(root) {
  const file = path.join(stateRoot(root), 'external-migration.json');
  if (!existsSync(file)) return null;
  try {
    const migration = JSON.parse(readFileSync(file, 'utf8'));
    // external-migration.json is written only by the one-way embedded-to-external
    // migration workflow, including records created before targetMode was stored.
    return migration?.state === 'completed' ? CONTROLLER_MODES.external : null;
  } catch {
    return null;
  }
}

export function loadControllerMode(root) {
  try {
    const migratedMode = completedMigrationMode(root);
    if (migratedMode) return migratedMode;

    const file = modeFile(root);
    if (existsSync(file)) {
      try {
        const stored = JSON.parse(readFileSync(file, 'utf8'));
        if (Object.values(CONTROLLER_MODES).includes(stored?.mode)) return stored.mode;
      } catch {}
    }
    const integration = loadIntegration(root);
    return integration.paseoJson?.serviceAddedByPackage === true
      ? CONTROLLER_MODES.embedded
      : null;
  } catch {
    // Setup classification can run with injected runners before repository-local
    // state is readable. Preserve the established embedded allowlist until an
    // explicit external mode can be loaded.
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

export function usesExternalController(root) {
  return loadControllerMode(root) === CONTROLLER_MODES.external;
}
