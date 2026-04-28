import { loadConfig } from '../config.js';

export async function printBuildConfigCommand(): Promise<void> {
  const config = await loadConfig();
  const url = config.tunnel.last_known_url;

  if (!url) {
    console.error('No tunnel URL available. Start the daemon first (tunnel support in step 2).');
    process.exit(1);
  }
  if (config.bearer_keys.length === 0) {
    console.error("No bearer keys configured. Run 'pair' first.");
    process.exit(1);
  }

  // The skill reads this JSON and substitutes into Config.mc
  const output = {
    DAEMON_URL: url,
    BEARER_KEY: config.bearer_keys.at(-1)!.key,
    POLL_INTERVAL_MS: 2000,
    INCLUDE_PHYSIOLOGY: true,
    INCLUDE_CF_ACCESS: false,
    CF_ACCESS_CLIENT_ID: '',
    CF_ACCESS_CLIENT_SECRET: '',
  };

  console.log(JSON.stringify(output, null, 2));
}
