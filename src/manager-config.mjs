import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { managerHome } from './repository-registry.mjs';

export const DEFAULT_MANAGER_CONFIG = Object.freeze({
  version: 1,
  globalMaxActive: 2,
});

export function managerConfigFile(options = {}) {
  return path.join(options.rootDir || managerHome(options), 'manager.json');
}

export function validateManagerConfig(input = {}) {
  const globalMaxActive = Number(input.globalMaxActive ?? DEFAULT_MANAGER_CONFIG.globalMaxActive);
  if (!Number.isInteger(globalMaxActive) || globalMaxActive < 1 || globalMaxActive > 50) {
    throw new Error('globalMaxActive must be an integer from 1 through 50.');
  }
  return { version: 1, globalMaxActive };
}

export function loadManagerConfig(options = {}) {
  const file = managerConfigFile(options);
  if (!existsSync(file)) return validateManagerConfig(DEFAULT_MANAGER_CONFIG);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  return validateManagerConfig({ ...DEFAULT_MANAGER_CONFIG, ...stored });
}

export function saveManagerConfig(input, options = {}) {
  const config = validateManagerConfig(input);
  const file = managerConfigFile(options);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return config;
}
