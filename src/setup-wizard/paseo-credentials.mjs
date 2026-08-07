import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveCommand } from '../process.mjs';

const SERVICE_NAME = 'paseo-issue-automation';
const memoryCredentials = new Map();

function daemonKey(host) {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized || /\s|[?&]password=/i.test(normalized)) throw new Error('A non-secret Paseo daemon host is required.');
  return normalized;
}

function secretToolRun(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    env: options.env || process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 10_000,
    windowsHide: true,
  });
  return {
    ok: !result.error && result.status === 0,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

export function createMemoryCredentialBackend({ credentials = memoryCredentials } = {}) {
  return {
    id: 'session-memory',
    persistent: false,
    async probe() { return { available: true, persistent: false, reason: 'Stored for this process only.' }; },
    async read(host) { return credentials.get(daemonKey(host)) || null; },
    async write(host, password) { credentials.set(daemonKey(host), String(password)); return true; },
    async delete(host) { return credentials.delete(daemonKey(host)); },
  };
}

export function createSecretToolCredentialBackend({
  executable = 'secret-tool',
  runner = secretToolRun,
  env = process.env,
} = {}) {
  const attributes = (host) => ['application', SERVICE_NAME, 'daemon', daemonKey(host)];
  return {
    id: 'linux-secret-service',
    persistent: true,
    async read(host) {
      const result = runner(executable, ['lookup', ...attributes(host)], { env });
      return result.ok && result.stdout ? result.stdout : null;
    },
    async write(host, password) {
      const value = String(password || '');
      if (!value) throw new Error('Paseo password is required.');
      const result = runner(executable, [
        'store', '--label=Paseo Issue Automation', ...attributes(host),
      ], { env, input: `${value}\n` });
      if (!result.ok) throw new Error('Secure credential store rejected the Paseo password.');
      return true;
    },
    async delete(host) {
      const result = runner(executable, ['clear', ...attributes(host)], { env });
      return result.ok;
    },
    async probe() {
      const probeHost = `probe-${randomUUID()}.invalid:6767`;
      const probePassword = `probe-${randomUUID()}`;
      try {
        await this.write(probeHost, probePassword);
        const readBack = await this.read(probeHost);
        if (readBack !== probePassword) return { available: false, persistent: true, reason: 'Secure-store read/write verification failed.' };
        return { available: true, persistent: true, reason: 'Linux Secret Service is available.' };
      } catch (error) {
        return { available: false, persistent: true, reason: String(error.message || error) };
      } finally {
        try { await this.delete(probeHost); } catch {}
      }
    },
  };
}

export function detectPersistentCredentialBackend({
  platform = process.platform,
  resolver = resolveCommand,
  secretToolRunner = secretToolRun,
  env = process.env,
} = {}) {
  if (platform === 'linux') {
    const resolution = resolver('secret-tool', { env });
    if (resolution.available) {
      return createSecretToolCredentialBackend({
        executable: resolution.path || 'secret-tool',
        runner: secretToolRunner,
        env,
      });
    }
    return null;
  }
  // macOS `security` and Windows `cmdkey` require secrets in command arguments for their common non-interactive forms.
  // Until a safer native adapter is implemented, these platforms intentionally remain session-only.
  return null;
}

export function createPaseoCredentialStore({
  persistentBackend = detectPersistentCredentialBackend(),
  sessionBackend = createMemoryCredentialBackend(),
} = {}) {
  let persistentStatus = null;

  async function status({ refresh = false } = {}) {
    if (!persistentStatus || refresh) {
      persistentStatus = persistentBackend
        ? await persistentBackend.probe()
        : { available: false, persistent: false, reason: 'No safe persistent credential backend is available; using session-only storage.' };
    }
    return {
      persistentAvailable: persistentStatus.available === true && persistentBackend?.persistent === true,
      persistentBackend: persistentStatus.available === true ? persistentBackend?.id || null : null,
      sessionAvailable: true,
      sessionBackend: sessionBackend.id,
      reason: persistentStatus.reason || null,
    };
  }

  async function write(host, password, { remember = true } = {}) {
    const key = daemonKey(host);
    const value = String(password || '');
    if (!value) throw new Error('Paseo password is required.');
    const current = await status();
    if (remember && current.persistentAvailable) {
      await persistentBackend.write(key, value);
      await sessionBackend.delete(key);
      return { stored: true, persistent: true, backend: persistentBackend.id };
    }
    await sessionBackend.write(key, value);
    return { stored: true, persistent: false, backend: sessionBackend.id };
  }

  async function read(host) {
    const key = daemonKey(host);
    const current = await status();
    if (current.persistentAvailable) {
      const stored = await persistentBackend.read(key);
      if (stored) return { password: stored, persistent: true, backend: persistentBackend.id };
    }
    const sessionPassword = await sessionBackend.read(key);
    return sessionPassword
      ? { password: sessionPassword, persistent: false, backend: sessionBackend.id }
      : null;
  }

  async function forget(host) {
    const key = daemonKey(host);
    const current = await status();
    if (current.persistentAvailable) await persistentBackend.delete(key);
    await sessionBackend.delete(key);
    return { forgotten: true };
  }

  return Object.freeze({ status, write, read, forget });
}

export function credentialStatusForApi(status) {
  return {
    persistentAvailable: status?.persistentAvailable === true,
    persistentBackend: status?.persistentBackend || null,
    sessionAvailable: status?.sessionAvailable !== false,
    sessionBackend: status?.sessionBackend || 'session-memory',
    reason: status?.reason || null,
  };
}
