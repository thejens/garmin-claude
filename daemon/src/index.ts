#!/usr/bin/env node
import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { pairCommand } from './commands/pair.js';
import { printBuildConfigCommand } from './commands/print-build-config.js';
import { upgradeTunnelCommand } from './commands/upgrade-tunnel.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('claude-code-tracker')
  .description('Garmin activity tracker daemon for Claude Code sessions')
  .version('0.1.0');

program
  .command('start')
  .description('Start the HTTP server and tunnel')
  .option('--mock', 'Use fake sinusoidal data instead of JSONL tailing (for UI testing)')
  .action((opts) => startCommand({ mock: !!opts.mock }));

program
  .command('stop')
  .description('Stop the running daemon')
  .action(stopCommand);

program
  .command('status')
  .description('Show daemon and tunnel status')
  .action(statusCommand);

program
  .command('pair')
  .description('Generate a new device bearer key')
  .option('-l, --label <label>', 'Human-readable label for this device')
  .action((opts) => pairCommand({ label: opts.label as string | undefined }));

program
  .command('print-build-config')
  .description('Print JSON build config for the watch app (consumed by setup skill)')
  .action(printBuildConfigCommand);

program
  .command('upgrade-tunnel')
  .description('Migrate from quick tunnel to a named tunnel with a stable URL')
  .option('-n, --name <name>', 'Tunnel name', 'claude-code-tracker')
  .option('-d, --domain <domain>', 'Custom hostname (optional; uses <uuid>.cfargotunnel.com if omitted)')
  .action((opts) => upgradeTunnelCommand({ name: opts.name as string, domain: opts.domain as string | undefined }));

program
  .command('doctor')
  .description('Run diagnostics and print a status table')
  .action(doctorCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
