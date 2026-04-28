// Estimated server-side energy per output token (Joules).
// These are order-of-magnitude estimates based on published GPU TDP figures
// and model size — not measured values. Treat as "illustrative".
//
// At a given tokens/sec, watts = tokens_per_sec * joules_per_token.
// Example: Sonnet at 8 tok/s ≈ 8 * 3.0 = 24 W of server-side draw.
export const MODEL_JOULES_PER_TOKEN: Record<number, number> = {
  1: 12.0,  // claude-opus-4      — large model, less aggressively batched
  2:  3.0,  // claude-sonnet-4.x  — mid model
  3:  0.5,  // claude-haiku-4.x   — small, heavily batched
};

const DEFAULT_JOULES = 3.0; // fallback for unknown model IDs

export function joulesPerToken(modelId: number): number {
  return MODEL_JOULES_PER_TOKEN[modelId] ?? DEFAULT_JOULES;
}

// Model ID → display name, for docs/metrics.md
export const MODEL_NAMES: Record<number, string> = {
  1: 'claude-opus-4',
  2: 'claude-sonnet-4.x',
  3: 'claude-haiku-4.x',
};
