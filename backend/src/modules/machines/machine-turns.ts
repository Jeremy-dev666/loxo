import { randomUUID } from 'node:crypto';
import {
  RunnerError,
  type MachineTurnResult,
  type MachineTurnStart,
  type TurnResult,
} from '@swarmdev/shared';
import { getMachineSocket } from './machine-registry';

/**
 * In-flight remote turns. The daemon enforces the execution timeout itself;
 * the server guard only covers a daemon that dies mid-turn (socket close
 * fails the turn immediately, the guard is a last resort).
 */
const GUARD_GRACE_MS = 30_000;

interface PendingTurn {
  machineId: string;
  resolve: (result: TurnResult) => void;
  reject: (error: RunnerError) => void;
  onChunk?: (text: string) => void;
  guard: NodeJS.Timeout;
}

const pending = new Map<string, PendingTurn>();

export interface MachineTurnOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export function runMachineTurn(
  machineId: string,
  input: Omit<MachineTurnStart, 'turnId'>,
  options: MachineTurnOptions = {}
): Promise<TurnResult> {
  const socket = getMachineSocket(machineId);
  if (!socket) {
    return Promise.reject(
      new RunnerError('Machine is offline; start the daemon and try again', 'cli_failed')
    );
  }

  const turnId = randomUUID();
  return new Promise<TurnResult>((resolve, reject) => {
    const settle = (fn: () => void): void => {
      const entry = pending.get(turnId);
      if (!entry) return;
      clearTimeout(entry.guard);
      pending.delete(turnId);
      fn();
    };

    const guard = setTimeout(() => {
      settle(() => reject(new RunnerError('Machine stopped responding mid-turn', 'timeout')));
    }, input.timeoutMs + GUARD_GRACE_MS);

    pending.set(turnId, {
      machineId,
      resolve: (result) => settle(() => resolve(result)),
      reject: (error) => settle(() => reject(error)),
      onChunk: options.onChunk,
      guard,
    });

    options.signal?.addEventListener(
      'abort',
      () => {
        // The daemon kills the process and answers with an aborted result;
        // the frame just may never arrive if the socket is already gone.
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'machine.turn.cancel', payload: { turnId } }));
        } else {
          pending.get(turnId)?.reject(new RunnerError('Turn was cancelled', 'aborted'));
        }
      },
      { once: true }
    );

    socket.send(JSON.stringify({ type: 'machine.turn.start', payload: { turnId, ...input } }));
  });
}

export function handleTurnDelta(turnId: string, text: string): void {
  pending.get(turnId)?.onChunk?.(text);
}

export function handleTurnResult(result: MachineTurnResult): void {
  const entry = pending.get(result.turnId);
  if (!entry) return;
  if (result.ok) {
    entry.resolve({
      text: result.text,
      sessionRef: result.sessionRef,
      durationMs: result.durationMs,
    });
  } else {
    entry.reject(new RunnerError(result.error.message, result.error.kind));
  }
}

/** Called when a machine socket closes; every in-flight turn on it fails fast. */
export function failTurnsForMachine(machineId: string): void {
  for (const entry of [...pending.values()]) {
    if (entry.machineId === machineId) {
      entry.reject(new RunnerError('Machine disconnected mid-turn', 'cli_failed'));
    }
  }
}
