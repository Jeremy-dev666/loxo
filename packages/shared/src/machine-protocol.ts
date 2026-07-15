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

/** One remote turn dispatched to a daemon. Server paths never cross the wire. */
export interface MachineTurnStart {
  turnId: string;
  runtime: MachineRuntime;
  prompt: string;
  model?: string | null;
  sessionRef?: string | null;
  /** Absolute working directory on the machine; daemon default when absent. */
  workdir?: string | null;
  timeoutMs: number;
  credentials?: { apiKey?: string; baseUrl?: string | null };
  /** Machine-level env vars injected into the runtime process (proxy, tokens). */
  env?: Record<string, string>;
}

export interface MachineTurnFailure {
  kind: 'timeout' | 'aborted' | 'cli_failed' | 'bad_output';
  message: string;
}

export type MachineTurnResult =
  | { turnId: string; ok: true; text: string; sessionRef?: string; durationMs: number }
  | { turnId: string; ok: false; error: MachineTurnFailure };

/** Frames sent by the daemon over /ws/machine. */
export type MachineClientFrame =
  | { type: 'ping' }
  | { type: 'machine.runtimes'; payload: { runtimes: RuntimeProbe[] } }
  | { type: 'machine.turn.delta'; payload: { turnId: string; text: string } }
  | { type: 'machine.turn.result'; payload: MachineTurnResult };

/** Frames sent by the server to the daemon. */
export type MachineServerFrame =
  | { type: 'pong' }
  | { type: 'machine.error'; payload: { code: string; message: string } }
  | { type: 'machine.turn.start'; payload: MachineTurnStart }
  | { type: 'machine.turn.cancel'; payload: { turnId: string } };

export interface PairStartResponse {
  deviceCode: string;
  userCode: string;
  expiresInS: number;
  intervalS: number;
}

export type PairPollResponse =
  | { status: 'pending' }
  | { status: 'approved'; machineId: string; machineToken: string };
