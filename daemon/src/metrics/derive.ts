import { createHash } from 'node:crypto';
import type { Sample } from '../types.js';
import { joulesPerToken } from '../models.js';

// Claude Code JSONL assistant event shape (subset)
interface AssistantUsage {
  output_tokens?: number;
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, string>;
}
interface AssistantMessage {
  model?: string;
  usage?: AssistantUsage;
  content?: Array<{ type: string } | ToolUseBlock>;
}

const TOKEN_WINDOW_MS = 10_000;  // rolling window for tok/s
const TOOL_WINDOW_MS  = 60_000;  // rolling window for tools/min

function modelToId(model: string): number {
  if (/opus/i.test(model))   return 1;
  if (/sonnet/i.test(model)) return 2;
  if (/haiku/i.test(model))  return 3;
  return 0;
}

function hashPath(path: string): number {
  return createHash('sha256').update(path, 'utf8').digest().readUInt32BE(0);
}

function countLines(s: string): number {
  return s ? s.split('\n').length : 0;
}

// Stateful metric deriver — call processEvent() for each JSONL line,
// then getSnapshot() to read derived metrics at any point.
export class Deriver {
  private tokenWindow: { t: number; count: number }[] = [];
  private toolWindow:  number[] = [];

  cumTokens    = 0;
  linesAdded   = 0;
  linesRemoved = 0;
  fileHash     = 0;
  modelId      = 0;
  pendingLap   = false;  // set true on user turn; consumed by caller on next snapshot

  processEvent(line: string): void {
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    const type = ev['type'] as string | undefined;

    // New user turn → next sample should carry lap: "new"
    if (type === 'user') {
      this.pendingLap = true;
      return;
    }

    if (type !== 'assistant') return;

    const msg = ev['message'] as AssistantMessage | undefined;
    if (!msg) return;

    // Model
    if (msg.model) this.modelId = modelToId(msg.model);

    // Tokens
    const out = msg.usage?.output_tokens ?? 0;
    if (out > 0) {
      this.cumTokens += out;
      this.tokenWindow.push({ t: Date.now(), count: out });
    }

    // Tool uses in content array
    if (!Array.isArray(msg.content)) return;
    const now = Date.now();
    for (const block of msg.content) {
      if (!block || (block as { type: string }).type !== 'tool_use') continue;
      const tu = block as ToolUseBlock;
      this.toolWindow.push(now);

      const inp = tu.input ?? {};
      const fp  = inp['file_path'];

      if (tu.name === 'Write' && fp) {
        this.fileHash     = hashPath(fp);
        this.linesAdded  += countLines(inp['content'] ?? '');
      } else if (tu.name === 'Edit' && fp) {
        this.fileHash     = hashPath(fp);
        this.linesAdded  += countLines(inp['new_string'] ?? '');
        this.linesRemoved += countLines(inp['old_string'] ?? '');
      } else if (fp) {
        // Read, Bash with file_path — just track "current file"
        this.fileHash = hashPath(fp);
      }
    }
  }

  getSnapshot(sessionId: string, lap?: 'new'): Omit<Sample, 'cursor'> {
    const now = Date.now();

    this.tokenWindow = this.tokenWindow.filter((e) => now - e.t < TOKEN_WINDOW_MS);
    this.toolWindow  = this.toolWindow.filter((t) => now - t < TOOL_WINDOW_MS);

    const totalTokens = this.tokenWindow.reduce((s, e) => s + e.count, 0);
    const spanSec = this.tokenWindow.length > 1
      ? (now - this.tokenWindow[0]!.t) / 1000
      : TOKEN_WINDOW_MS / 1000;
    const tokensPerSec = totalTokens / spanSec;

    const toolsPerMin = (this.toolWindow.length / (TOOL_WINDOW_MS / 1000)) * 60;

    return {
      t: now,
      tokens_per_sec:  Math.round(tokensPerSec * 10) / 10,
      tools_per_min:   Math.round(toolsPerMin  * 10) / 10,
      cum_tokens:      this.cumTokens,
      lines_added:     this.linesAdded,
      lines_removed:   this.linesRemoved,
      current_file_hash: this.fileHash,
      model_id:        this.modelId,
      watts_estimate:  Math.round(tokensPerSec * joulesPerToken(this.modelId) * 10) / 10,
      session_id:      sessionId,
      ...(lap ? { lap } : {}),
    };
  }
}
