/** Wire contract between the SwarmDev server and machine daemons. */

export const MACHINE_RUNTIMES = [
  'claude-code',
  'codex',
  'opencode',
  'hermes',
  'openclaw',
] as const;

export type MachineRuntime = (typeof MACHINE_RUNTIMES)[number];

export interface RuntimeProbe {
  runtime: MachineRuntime;
  available: boolean;
  /** Redacted first line of `<cli> --version`; null when unavailable. */
  version: string | null;
  error?: string;
}

/** Frames sent by the daemon over /ws/machine. */
export type MachineClientFrame =
  | { type: 'ping' }
  | { type: 'machine.runtimes'; payload: { runtimes: RuntimeProbe[] } };

/** Frames sent by the server to the daemon. */
export type MachineServerFrame =
  | { type: 'pong' }
  | { type: 'machine.error'; payload: { code: string; message: string } };

export interface PairStartResponse {
  deviceCode: string;
  userCode: string;
  expiresInS: number;
  intervalS: number;
}

export type PairPollResponse =
  | { status: 'pending' }
  | { status: 'approved'; machineId: string; machineToken: string };
