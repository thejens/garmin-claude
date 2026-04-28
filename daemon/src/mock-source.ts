import type { Sample } from './types.js';
import { joulesPerToken } from './models.js';

// Mutable walk state — module-level so it persists across calls
let cumTokens = 0;
let linesAdded = 0;
let lastTokensSec = 5.0;

// Simulates a Claude Code session with a random-walk tokens/sec signal.
// Used as the metric source before JSONL tailing is wired up.
export function generateMockSample(
  sessionId: string,
  lap?: 'new',
): Omit<Sample, 'cursor'> {
  // Random walk in [0, 30] tok/s
  lastTokensSec = Math.max(0, Math.min(30, lastTokensSec + (Math.random() - 0.45) * 4));
  const tokensThisSample = Math.round(lastTokensSec * 0.5); // 2 Hz cadence
  cumTokens += tokensThisSample;
  if (Math.random() < 0.05) linesAdded += Math.floor(Math.random() * 8) + 1;

  const modelId = 2; // claude-sonnet-4.x
  const tps = Math.round(lastTokensSec * 10) / 10;
  return {
    t: Date.now(),
    tokens_per_sec: tps,
    tools_per_min: Math.round(Math.random() * 5 * 10) / 10,
    cum_tokens: cumTokens,
    lines_added: linesAdded,
    lines_removed: Math.round(linesAdded * 0.3),
    current_file_hash: 0x12345678,
    model_id: modelId,
    watts_estimate: Math.round(tps * joulesPerToken(modelId) * 10) / 10,
    session_id: sessionId,
    ...(lap ? { lap } : {}),
  };
}
