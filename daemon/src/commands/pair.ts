import { randomBytes } from 'node:crypto';
import { loadConfig, saveConfig } from '../config.js';

export async function pairCommand(options: { label?: string }): Promise<void> {
  const config = await loadConfig();

  const key = 'ck_' + randomBytes(32).toString('base64url');
  const label = options.label ?? `device-${new Date().toISOString().slice(0, 10)}`;

  config.bearer_keys.push({ key, label, created: new Date().toISOString() });
  await saveConfig(config);

  console.log('\nNew device key generated:');
  console.log(`  Label : ${label}`);
  console.log(`  Key   : ${key}`);
  console.log('\nBake this key into Config.mc (BEARER_KEY) and rebuild the watch app.');
}
