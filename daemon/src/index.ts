import { loadConfig } from './config';
import { runDaemon } from './connection';
import { pair } from './pair';

const USAGE = `swarmdev-daemon — run SwarmDev agents on this machine

Usage:
  swarmdev-daemon pair --server <url>   Pair this machine with a SwarmDev server
  swarmdev-daemon run                   Connect and serve (default)
`;

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'run';

  if (command === 'pair') {
    const server = argValue(args, '--server');
    if (!server) {
      console.error('Missing --server <url>');
      console.error(USAGE);
      process.exit(1);
    }
    await pair(server);
    return;
  }

  if (command === 'run') {
    const config = loadConfig();
    if (!config) {
      console.error('Not paired yet. Run: swarmdev-daemon pair --server <url>');
      process.exit(1);
    }
    runDaemon(config);
    return;
  }

  console.log(USAGE);
  process.exit(command === '--help' || command === '-h' ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
