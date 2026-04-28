import type { Config } from './types.js';

export function validateBearer(authHeader: string | undefined, config: Config): boolean {
  if (!authHeader) return false;
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) return false;
  const token = match[1]!;
  return config.bearer_keys.some((k) => k.key === token);
}
