import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from '../server.js';
import { loadConfig, saveConfig, getConfigDir, getPidPath, resolveJsonlPaths } from '../config.js';
import { RingBuffer } from '../ringbuffer.js';
import { generateMockSample } from '../mock-source.js';
import { JsonlTailSource } from '../metrics/jsonl-tail.js';
import { TunnelManager } from '../tunnel.js';

export async function startCommand(options: { mock?: boolean } = {}): Promise<void> {
  const config = await loadConfig();
  const { bind, port } = config.server;

  if (config.bearer_keys.length === 0) {
    console.warn("Warning: no bearer keys configured. Run 'pair' first.");
  }

  const sessionId = 'sess_' + randomBytes(8).toString('hex');
  const buffer    = new RingBuffer();
  let   source: JsonlTailSource | null = null;

  if (options.mock) {
    // Mock mode: sinusoidal fake data — useful for watch-app UI testing
    let emitLap = false;
    setInterval(() => {
      buffer.push(generateMockSample(sessionId, emitLap ? 'new' : undefined));
      emitLap = false;
      if (Math.random() < 0.033) emitLap = true;
    }, 500);
    console.log('  Source : mock (fake sinusoidal data)');
  } else {
    // Real mode: tail Claude Code JSONL files
    const projectDirs = resolveJsonlPaths(config);
    source = new JsonlTailSource();
    await source.start((sample) => buffer.push(sample), sessionId, projectDirs);
    const fromEnv = process.env['CLAUDE_PROJECTS_DIRS'] ? ' (CLAUDE_PROJECTS_DIRS)' : '';
    console.log(`  Source : JSONL tail — ${projectDirs.join(', ')}${fromEnv}`);
  }

  const app    = createServer(config, buffer, sessionId);
  const tunnel = new TunnelManager();

  tunnel.on('error',        (err)      => console.error(`  Tunnel : ${err.message}`));
  tunnel.on('reconnecting', (delayMs)  => console.log(`  Tunnel : reconnecting in ${delayMs / 1000}s...`));
  tunnel.on('url',          async (url) => {
    console.log(`  Tunnel : ${url}`);
    config.tunnel.last_known_url  = url;
    config.tunnel.url_observed_at = new Date().toISOString();
    await saveConfig(config);
  });

  const server = app.listen(port, bind, async () => {
    await mkdir(getConfigDir(), { recursive: true });
    await writeFile(getPidPath(), String(process.pid), 'utf-8');
    console.log('claude-code-tracker daemon started');
    console.log(`  Local  : http://${bind}:${port}`);
    console.log(`  Session: ${sessionId}`);

    if (config.tunnel.mode === 'named' && config.tunnel.name && config.tunnel.last_known_url) {
      // Named tunnel: URL is stable, no need to parse cloudflared output
      console.log(`  Tunnel : ${config.tunnel.last_known_url} (named — stable URL)`);
      tunnel.startNamed(config.tunnel.name, config.tunnel.last_known_url);
    } else {
      tunnel.startQuick(port);
    }
  });

  async function shutdown(signal: string) {
    console.log(`\nReceived ${signal}, shutting down...`);
    await source?.stop();
    await tunnel.stop();
    server.close(async () => {
      await rm(getPidPath(), { force: true });
      process.exit(0);
    });
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
