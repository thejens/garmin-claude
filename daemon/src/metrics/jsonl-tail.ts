import { openSync, readSync, fstatSync, statSync, existsSync, closeSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SampleEmitter } from './source.js';
import { Deriver } from './derive.js';

const ACTIVE_FILE_MAX_AGE_MS = 4 * 60 * 60 * 1000;  // 4 hours
const RESCAN_EVERY_N_TICKS   = 20;                    // rescan dirs every 10 s at 2 Hz

// On startup we read the last WARMUP_BYTES of each file to warm up the sliding
// windows (tokens/sec = 10 s, tools/min = 60 s). Without this, existing
// sessions started before the daemon would show 0/0 until new events arrive.
// 64 KB comfortably covers several Claude Code turns including tool calls.
const WARMUP_BYTES = 64 * 1024;

// Reads new bytes from a file since the last call, returning complete lines.
class FileTailer {
  private readonly fd: number;
  private position: number;
  private remainder = '';

  constructor(path: string, seekToEnd: boolean) {
    this.fd = openSync(path, 'r');
    if (seekToEnd) {
      // Seek back WARMUP_BYTES so recent activity warms up the sliding windows.
      // The first readNewLines() call may start mid-line; the remainder buffer
      // discards that partial line automatically.
      const size = statSync(path).size;
      this.position = Math.max(0, size - WARMUP_BYTES);
    } else {
      this.position = 0;
    }
  }

  readNewLines(): string[] {
    const size = fstatSync(this.fd).size;
    if (size < this.position) this.position = 0;   // truncated (shouldn't happen)
    if (size === this.position) return [];

    const buf = Buffer.alloc(size - this.position);
    readSync(this.fd, buf, 0, buf.length, this.position);
    this.position = size;

    const text = this.remainder + buf.toString('utf8');
    const parts = text.split('\n');
    this.remainder = parts.pop() ?? '';
    return parts.filter((l) => l.trim().length > 0);
  }

  close(): void {
    try { closeSync(this.fd); } catch { /* best-effort */ }
  }
}

export class JsonlTailSource {
  private tailers  = new Map<string, FileTailer>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private deriver  = new Deriver();
  private tick     = 0;

  async start(emit: SampleEmitter, sessionId: string, projectDirs: string[]): Promise<void> {
    // Open all recently-active JSONL files, seeking to end (no history replay)
    for (const dir of projectDirs) {
      await this.scanDir(dir, true);
    }

    const dirs = projectDirs;
    this.interval = setInterval(async () => {
      this.tick++;

      // Periodic rescan to pick up new session files
      if (this.tick % RESCAN_EVERY_N_TICKS === 0) {
        for (const dir of dirs) await this.scanDir(dir, false);
      }

      // Read new lines from every known tailer
      for (const tailer of this.tailers.values()) {
        try {
          for (const line of tailer.readNewLines()) {
            this.deriver.processEvent(line);
          }
        } catch { /* file may have been removed; will be cleaned up on rescan */ }
      }

      // Consume pending lap flag and emit
      const lap = this.deriver.pendingLap ? 'new' as const : undefined;
      if (lap) this.deriver.pendingLap = false;
      emit(this.deriver.getSnapshot(sessionId, lap));
    }, 500);
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    for (const t of this.tailers.values()) t.close();
    this.tailers.clear();
  }

  private async scanDir(dir: string, seekToEnd: boolean): Promise<void> {
    if (!existsSync(dir)) return;
    const cutoff = Date.now() - ACTIVE_FILE_MAX_AGE_MS;

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.scanDir(fullPath, seekToEnd);
        } else if (entry.name.endsWith('.jsonl') && !this.tailers.has(fullPath)) {
          const info = await stat(fullPath);
          if (info.mtimeMs >= cutoff) {
            try {
              this.tailers.set(fullPath, new FileTailer(fullPath, seekToEnd));
            } catch { /* unreadable — skip */ }
          }
        }
      }
    } catch { /* dir may have disappeared */ }
  }
}
