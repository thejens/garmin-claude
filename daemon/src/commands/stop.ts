import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getPidPath } from '../config.js';

export async function stopCommand(): Promise<void> {
  const pidPath = getPidPath();

  if (!existsSync(pidPath)) {
    console.log('Daemon is not running (no PID file found).');
    return;
  }

  const pid = parseInt(await readFile(pidPath, 'utf-8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    await rm(pidPath, { force: true });
    console.log(`Stopped daemon (PID ${pid}).`);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ESRCH') {
      console.log('Daemon was not running (stale PID file removed).');
      await rm(pidPath, { force: true });
    } else {
      throw err;
    }
  }
}
