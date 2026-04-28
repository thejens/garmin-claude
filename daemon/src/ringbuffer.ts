import type { Sample } from './types.js';

export interface PollResult {
  samples: Sample[];
  resync?: boolean;
  oldest_cursor?: number;
}

export class RingBuffer {
  private buf: Sample[] = [];
  private nextCursor = 1;
  private readonly capacity: number;

  constructor(capacity = 600) {
    this.capacity = capacity;
  }

  push(sample: Omit<Sample, 'cursor'>): Sample {
    const s = { ...sample, cursor: this.nextCursor++ };
    if (this.buf.length >= this.capacity) this.buf.shift();
    this.buf.push(s);
    return s;
  }

  since(cursor: number, max = 200): PollResult {
    if (this.buf.length === 0) return { samples: [] };
    const oldest = this.buf[0]!.cursor;
    // Client is behind the oldest we have — tell it to start fresh
    if (cursor !== 0 && cursor < oldest) {
      return { samples: this.buf.slice(0, max), resync: true, oldest_cursor: oldest };
    }
    const samples = this.buf.filter((s) => s.cursor > cursor).slice(0, max);
    return { samples };
  }

  get size(): number { return this.buf.length; }
}
