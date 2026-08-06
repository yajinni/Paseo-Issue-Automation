import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, loadIntegration, statePaths } from './state.mjs';

export const CONTROLLER_MODES = Object.freeze({
  embedded: 'embedded-repository',
  external: 'external-manager',
});

function modeFile(root) {
  return path.join(statePaths(root).root, 'controller-mode.json');
}

export function loadControllerMode(root) {
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
