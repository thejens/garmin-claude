import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './types.js';

const CONFIG_DIR = join(homedir(), '.config', 'claude-code-tracker');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const PID_PATH = join(CONFIG_DIR, 'daemon.pid');

export const DEFAULT_CONFIG: Config = {
  version: 1,
  bearer_keys: [],
  tunnel: { mode: 'quick', name: null, last_known_url: null, url_observed_at: null },
  metrics: { source: 'mock', jsonl_paths: null },
  server: { port: 7842, bind: '127.0.0.1' },
};

export function getConfigDir(): string { return CONFIG_DIR; }
export function getConfigPath(): string { return CONFIG_PATH; }
export function getPidPath(): string { return PID_PATH; }

export async function loadConfig(): Promise<Config> {
  if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_CONFIG);
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  return { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(raw) } as Config;
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// Resolve the list of Claude Code projects/ roots to tail for JSONL events.
//
// Resolution order:
//   1. CLAUDE_PROJECTS_DIRS env var — comma-separated absolute paths (explicit override)
//   2. config.metrics.jsonl_paths — persisted in config.json (user-configured)
//   3. Auto-discover: scan ~ for any .claude*/projects/ and ~/.config/claude*/projects/
//      This handles non-standard installs (e.g. separate personal + work Claude Code
//      configs in ~/.claude-personal/ and ~/.claude-work/) without any manual config.
//   4. Hardcoded standard fallbacks if nothing is found
export function resolveJsonlPaths(config: Config): string[] {
  // 1. Explicit env override
  const envRaw = process.env['CLAUDE_PROJECTS_DIRS'];
  if (envRaw) {
    return envRaw.split(',').map((p) => p.trim()).filter(Boolean);
  }

  // 2. Persisted config
  if (config.metrics.jsonl_paths && config.metrics.jsonl_paths.length > 0) {
    return config.metrics.jsonl_paths;
  }

  // 3. Auto-discover any ~/.claude*/projects/ and ~/.config/claude*/projects/
  const home = homedir();
  const discovered: string[] = [];

  const scanParent = (parent: string, prefix: string) => {
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
        const p = join(parent, entry.name, 'projects');
        if (existsSync(p)) discovered.push(p);
      }
    } catch { /* parent dir may not exist */ }
  };

  scanParent(home, '.claude');                    // ~/.claude, ~/.claude-personal, ~/.claude-work …
  scanParent(join(home, '.config'), 'claude');    // ~/.config/claude, ~/.config/claude-work …

  if (discovered.length > 0) return discovered;

  // 4. Hardcoded standard fallbacks (nothing found above)
  return [
    join(home, '.claude', 'projects'),
    join(home, '.config', 'claude', 'projects'),
  ];
}

// Returns an error string if permissions are too open, null if OK.
export function checkConfigPermissions(): string | null {
  if (!existsSync(CONFIG_PATH)) return null;
  const mode = statSync(CONFIG_PATH).mode & 0o777;
  if (mode & 0o077) {
    return `Config permissions too open (${mode.toString(8)}). Run: chmod 600 ${CONFIG_PATH}`;
  }
  return null;
}
