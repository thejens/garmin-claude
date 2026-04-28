import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Accept any HTTPS URL on trycloudflare.com — cloudflared has tweaked its log
// format across versions, so we match the URL itself rather than a specific prefix.
const QUICK_TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export interface TunnelEvents {
  url: (url: string) => void;
  reconnecting: (delayMs: number) => void;
  error: (err: Error) => void;
}

export declare interface TunnelManager {
  on<K extends keyof TunnelEvents>(event: K, listener: TunnelEvents[K]): this;
  emit<K extends keyof TunnelEvents>(event: K, ...args: Parameters<TunnelEvents[K]>): boolean;
}

export class TunnelManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private stopped = false;
  private restartDelayMs = 1_000; // doubles on each failure, capped at 30s

  startQuick(localPort: number): void {
    this.spawnQuick(localPort);
  }

  // Named tunnel — URL is stable and already known, so we emit it immediately.
  // cloudflared reads ingress config from ~/.cloudflared/config.yml by default.
  startNamed(name: string, knownUrl: string): void {
    this.emit('url', knownUrl);
    this.spawnNamed(name);
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (!this.proc) return Promise.resolve();
    return new Promise((resolve) => {
      this.proc!.once('exit', resolve);
      this.proc!.kill('SIGTERM');
      setTimeout(resolve, 5_000); // don't wait more than 5s
    });
  }

  private spawnNamed(name: string): void {
    let proc: ChildProcess;
    try {
      proc = spawn('cloudflared', ['tunnel', 'run', name], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      this.emit('error', new Error('cloudflared not found. Install with: brew install cloudflared'));
      return;
    }
    this.proc = proc;

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        this.emit('error', new Error('cloudflared not found. Install with: brew install cloudflared'));
        this.stopped = true;
      }
    });

    proc.on('exit', () => {
      if (!this.stopped) {
        this.emit('reconnecting', this.restartDelayMs);
        setTimeout(() => this.spawnNamed(name), this.restartDelayMs);
        this.restartDelayMs = Math.min(this.restartDelayMs * 2, 30_000);
      }
    });
  }

  private spawnQuick(localPort: number): void {
    const args = ['tunnel', '--url', `http://127.0.0.1:${localPort}`, '--no-autoupdate'];
    let proc: ChildProcess;

    try {
      proc = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      this.emit('error', new Error('cloudflared not found. Install with: brew install cloudflared'));
      return;
    }

    this.proc = proc;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(QUICK_TUNNEL_RE);
      if (match) {
        this.restartDelayMs = 1_000; // reset backoff on a successful connection
        this.emit('url', match[0]!);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        this.emit('error', new Error('cloudflared not found. Install with: brew install cloudflared'));
        this.stopped = true;
      }
    });

    proc.on('exit', () => {
      if (!this.stopped) {
        this.emit('reconnecting', this.restartDelayMs);
        setTimeout(() => this.spawnQuick(localPort), this.restartDelayMs);
        this.restartDelayMs = Math.min(this.restartDelayMs * 2, 30_000);
      }
    });
  }
}
