import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function modules(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...modules(target));
    else if (entry.isFile() && target.endsWith('.mjs')) result.push(target);
  }
  return result;
}

const files = [...modules('src'), ...modules('bin')].sort();
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status || 1);
}
console.log(`Syntax checked ${files.length} module(s).`);
