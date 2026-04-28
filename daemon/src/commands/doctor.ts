import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getPidPath, getConfigPath, loadConfig, checkConfigPermissions, resolveJsonlPaths } from '../config.js';

function check(label: string, ok: boolean, hint?: string): void {
  console.log(`  ${ok ? '✓' : '✗'}  ${label}`);
  if (!ok && hint) console.log(`       → ${hint}`);
}

export async function doctorCommand(): Promise<void> {
  console.log('claude-code-tracker doctor');
  console.log('─'.repeat(40));

  // 1. Config file present
  const configPath = getConfigPath();
  const configExists = existsSync(configPath);
  check('Config file present', configExists, `Run any command to create it at ${configPath}`);

  if (configExists) {
    const permErr = checkConfigPermissions();
    check('Config file permissions (0600)', permErr === null, permErr ?? undefined);

    const config = await loadConfig();
    check("At least one bearer key", config.bearer_keys.length > 0, "Run 'pair' to generate a key");
    check('Tunnel URL recorded', config.tunnel.last_known_url !== null, "Run 'start' to bring up the tunnel");
  }

  // 2. cloudflared on PATH
  let cloudflaredOk = false;
  try {
    execSync('cloudflared --version', { stdio: 'pipe' });
    cloudflaredOk = true;
  } catch { /* not installed */ }
  check('cloudflared on PATH', cloudflaredOk, 'Install: brew install cloudflared');

  // 3. Daemon running
  const pidPath = getPidPath();
  let daemonRunning = false;
  if (existsSync(pidPath)) {
    const pid = parseInt(await readFile(pidPath, 'utf-8'), 10);
    try { process.kill(pid, 0); daemonRunning = true; } catch { /* stale */ }
  }
  check('Daemon running', daemonRunning, "Run 'start' to start the daemon");

  // 4. JSONL source directories
  if (configExists) {
    const config = await loadConfig();
    const paths = resolveJsonlPaths(config);
    const fromEnv = !!process.env['CLAUDE_PROJECTS_DIRS'];
    for (const p of paths) {
      const exists = existsSync(p);
      check(
        `JSONL path exists: ${p}${fromEnv ? ' (CLAUDE_PROJECTS_DIRS)' : ''}`,
        exists,
        `Create the directory or set CLAUDE_PROJECTS_DIRS to the right path`,
      );
    }
  }

  // 5. Local health endpoint (only if daemon appears to be up)
  if (daemonRunning && configExists) {
    const config = await loadConfig();
    const { bind, port } = config.server;
    try {
      const res = await fetch(`http://${bind}:${port}/health`);
      check('Local server responds to /health', res.ok);
    } catch {
      check('Local server responds to /health', false, 'Daemon may still be starting — try again');
    }
  }
}
