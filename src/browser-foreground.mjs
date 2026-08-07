import { spawnSync } from 'node:child_process';

async function chromiumBrowserProcessId(page) {
  const context = page?.context?.();
  if (!context?.newCDPSession) return null;
  let session = null;
  try {
    session = await context.newCDPSession(page);
    const info = await session.send('SystemInfo.getProcessInfo');
    const browser = Array.isArray(info?.processInfo)
      ? info.processInfo.find((item) => item?.type === 'browser')
      : null;
    const processId = Number(browser?.id);
    return Number.isInteger(processId) && processId > 0 ? processId : null;
  } catch {
    return null;
  } finally {
    await session?.detach?.().catch(() => {});
  }
}

export async function bringBrowserToForeground(page, {
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  let tabFocused = false;
  let windowFocusRequested = false;
  let osActivated = null;

  try {
    await page?.bringToFront?.();
    tabFocused = true;
  } catch {}

  try {
    await page?.evaluate?.(() => window.focus());
    windowFocusRequested = true;
  } catch {}

  if (platform === 'win32') {
    const processId = await chromiumBrowserProcessId(page);
    if (processId) {
      try {
        const script = `$shell = New-Object -ComObject WScript.Shell; if ($shell.AppActivate(${processId})) { exit 0 } else { exit 1 }`;
        const result = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          script,
        ], {
          encoding: 'utf8',
          timeout: 5_000,
          windowsHide: true,
        });
        osActivated = !result?.error && result?.status === 0;
      } catch {
        osActivated = false;
      }
    }
  }

  return { tabFocused, windowFocusRequested, osActivated };
}
