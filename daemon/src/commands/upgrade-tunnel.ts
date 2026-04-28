import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, saveConfig } from '../config.js';

const DEFAULT_NAME = 'claude-code-tracker';
const LOCAL_PORT   = 7842;

export async function upgradeTunnelCommand(options: {
  name?:   string;
  domain?: string;
}): Promise<void> {
  const name = options.name ?? DEFAULT_NAME;

  // ── 1. Login check ────────────────────────────────────────────────────────
  const loginCheck = spawnSync('cloudflared', ['tunnel', 'list'], {
    encoding: 'utf-8',
    stdio:    ['ignore', 'pipe', 'pipe'],
  });

  if (loginCheck.status !== 0) {
    console.log(`
Not authenticated with Cloudflare.

Run this in your terminal (it will open a browser):

  cloudflared tunnel login

Then re-run this command.
`);
    process.exit(1);
  }
  console.log('✓ Cloudflare authenticated');

  // ── 2. Find or create the named tunnel ────────────────────────────────────
  let uuid = findTunnelUuid(name, loginCheck.stdout);

  if (uuid) {
    console.log(`✓ Tunnel '${name}' already exists (${uuid})`);
  } else {
    console.log(`Creating tunnel '${name}'...`);
    const r = spawnSync('cloudflared', ['tunnel', 'create', name], {
      encoding: 'utf-8',
      stdio:    ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      throw new Error(`cloudflared tunnel create failed:\n${r.stderr}\n${r.stdout}`);
    }
    uuid = extractUuid((r.stdout ?? '') + (r.stderr ?? '')) ?? null;
    if (!uuid) {
      throw new Error(`Could not parse UUID from output:\n${r.stdout}\n${r.stderr}`);
    }
    console.log(`✓ Created tunnel '${name}' (${uuid})`);
  }

  // ── 3. Optional DNS routing ────────────────────────────────────────────────
  if (options.domain) {
    console.log(`Routing DNS: ${name} → ${options.domain} ...`);
    const r = spawnSync(
      'cloudflared',
      ['tunnel', 'route', 'dns', name, options.domain],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) {
      throw new Error(
        `DNS routing failed. Make sure ${options.domain} is on Cloudflare DNS (zone must be active).`,
      );
    }
    console.log(`✓ DNS routed`);
  }

  // ── 4. Write ~/.cloudflared/config.yml ────────────────────────────────────
  const cfDir    = join(homedir(), '.cloudflared');
  const credsFile = join(cfDir, `${uuid}.json`);
  const configPath = join(cfDir, 'config.yml');

  mkdirSync(cfDir, { recursive: true });

  // Ingress rules differ: hostname rule requires a catch-all; no-hostname does not.
  const ingressLines = options.domain
    ? [
        `  - hostname: ${options.domain}`,
        `    service: http://127.0.0.1:${LOCAL_PORT}`,
        `  - service: http_status:404`,   // required catch-all when hostname is set
      ]
    : [`  - service: http://127.0.0.1:${LOCAL_PORT}`];

  const yml = [
    `tunnel: ${uuid}`,
    `credentials-file: ${credsFile}`,
    `ingress:`,
    ...ingressLines,
    '',
  ].join('\n');

  writeFileSync(configPath, yml, 'utf-8');
  console.log(`✓ Wrote ${configPath}`);

  // ── 5. Update daemon config ────────────────────────────────────────────────
  const tunnelUrl = options.domain
    ? `https://${options.domain}`
    : `https://${uuid}.cfargotunnel.com`;

  const config = await loadConfig();
  config.tunnel.mode             = 'named';
  config.tunnel.name             = name;
  config.tunnel.last_known_url   = tunnelUrl;
  config.tunnel.url_observed_at  = new Date().toISOString();
  await saveConfig(config);

  console.log(`
✓ Named tunnel configured

  URL    : ${tunnelUrl}
  Tunnel : ${name} (${uuid})
  Config : ${configPath}

Next steps:
  1. Restart the daemon:
       npx claude-code-tracker stop && npx claude-code-tracker start

  2. The tunnel URL is now stable — rebuild the watch app once:
       npx claude-code-tracker print-build-config   # shows new URL
       make watch-build DEVICE=<your-device>
       (or run the setup skill to do it automatically)
`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Look for the tunnel name in `cloudflared tunnel list` text output and return
// the UUID on the same line, or null if not found.
function findTunnelUuid(name: string, listOutput: string): string | null {
  for (const line of listOutput.split('\n')) {
    if (!line.includes(name)) continue;
    const uuid = extractUuid(line);
    if (uuid) return uuid;
  }
  return null;
}


function extractUuid(text: string): string | undefined {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}
