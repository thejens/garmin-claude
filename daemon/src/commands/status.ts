import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getPidPath, getConfigPath, loadConfig, resolveJsonlPaths } from '../config.js';

export async function statusCommand(): Promise<void> {
  const pidPath = getPidPath();
  const configPath = getConfigPath();

  console.log('claude-code-tracker status');
  console.log('─'.repeat(40));

  // Daemon running?
  if (!existsSync(pidPath)) {
    console.log('  Daemon:  stopped (no PID file)');
  } else {
    const pid = parseInt(await readFile(pidPath, 'utf-8'), 10);
    try {
      process.kill(pid, 0); // signal 0 = existence check
      console.log(`  Daemon:  running (PID ${pid})`);
    } catch {
      console.log(`  Daemon:  stopped (stale PID ${pid})`);
    }
  }

  if (!existsSync(configPath)) {
    console.log('  Config:  not found');
    return;
  }

  const config = await loadConfig();
  const tunnelUrl = config.tunnel.last_known_url ?? 'none';
  console.log(`  Config:  ${configPath}`);
  console.log(`  Tunnel:  ${config.tunnel.mode} / ${tunnelUrl}`);
  console.log(`  Keys:    ${config.bearer_keys.length} device(s)`);
  for (const k of config.bearer_keys) {
    console.log(`    - ${k.label}  (${k.key.slice(0, 10)}...)  created ${k.created}`);
  }
  const paths = resolveJsonlPaths(config);
  const src = process.env['CLAUDE_PROJECTS_DIRS'] ? ' (from CLAUDE_PROJECTS_DIRS)' : '';
  console.log(`  JSONL:   ${paths.join(', ')}${src}`);
}
