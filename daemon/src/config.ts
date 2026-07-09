import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface DaemonConfig {
  serverUrl: string;
  machineToken: string;
  machineId: string;
  /** Extra roots agents may use as working directories; workspace root is always allowed. */
  allowedWorkdirs?: string[];
}

export const CONFIG_PATH =
  process.env.SWARMDEV_DAEMON_CONFIG ?? join(homedir(), '.swarmdev', 'daemon.json');

export function loadConfig(): DaemonConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<DaemonConfig>;
    if (!parsed.serverUrl || !parsed.machineToken || !parsed.machineId) return null;
    return parsed as DaemonConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: DaemonConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
