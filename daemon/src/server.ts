import express from 'express';
import type { Config } from './types.js';
import type { RingBuffer } from './ringbuffer.js';
import { validateBearer } from './auth.js';

// All authenticated routes return 404 on bad auth — indistinguishable from a wrong path.
function deny(res: express.Response): void {
  res.status(404).json({ message: 'Not found' });
}

export function createServer(
  config: Config,
  buffer: RingBuffer,
  sessionId: string,
): express.Express {
  const app = express();
  app.use(express.json());

  // Unauthenticated — used by tunnel health checks
  app.get('/health', (_req, res) => {
    res.json({ ok: true, t: Date.now() });
  });

  // Primary watch endpoint
  app.get('/poll', (req, res) => {
    if (!validateBearer(req.headers.authorization, config)) return deny(res);

    const cursor = parseInt((req.query['cursor'] as string) ?? '0', 10) || 0;
    const max = Math.min(parseInt((req.query['max'] as string) ?? '200', 10) || 200, 200);

    const result = buffer.since(cursor, max);
    const latestCursor =
      result.samples.length > 0
        ? result.samples[result.samples.length - 1]!.cursor
        : cursor;

    res.json({
      cursor: latestCursor,
      samples: result.samples,
      ...(result.resync ? { resync: true, oldest_cursor: result.oldest_cursor } : {}),
      status: 'active',
      session_id: sessionId,
    });
  });

  // Watch may post its cursor to free old samples (optional — samples age out anyway)
  app.post('/ack', (req, res) => {
    if (!validateBearer(req.headers.authorization, config)) return deny(res);
    res.json({ ok: true });
  });

  return app;
}
