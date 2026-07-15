import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  RunnerError,
  runTurn,
  type MachineClientFrame,
  type MachineTurnStart,
} from '@swarmdev/shared';
import { resolveAllowedWorkdir } from './workdir';

const active = new Map<string, AbortController>();

type TurnRunner = typeof runTurn;
let turnRunner: TurnRunner = runTurn;

/** Test seam: script turn outcomes without spawning real CLI processes. */
export function setTurnRunnerForTests(runner: TurnRunner | null): void {
  turnRunner = runner ?? runTurn;
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function activeTurnCount(): number {
  return active.size;
}

export async function startTurn(
  payload: MachineTurnStart,
  send: (frame: MachineClientFrame) => void,
  log: (message: string) => void,
  allowedWorkdirs: string[] = []
): Promise<void> {
  const resolved = resolveAllowedWorkdir(payload.workdir, allowedWorkdirs);
  if (!resolved) {
    send({
      type: 'machine.turn.result',
      payload: {
        turnId: payload.turnId,
        ok: false,
        error: {
          kind: 'cli_failed',
          message: `Working directory is not allowed on this machine: ${payload.workdir}. Allow it with: swarmdev-daemon allow <dir>`,
        },
      },
    });
    log(`Turn ${payload.turnId} rejected (workdir outside allowlist: ${payload.workdir})`);
    return;
  }

  const controller = new AbortController();
  active.set(payload.turnId, controller);
  const workspace = ensureDir(resolved);
  const stateDir = ensureDir(join(homedir(), '.swarmdev', 'state'));
  log(`Turn ${payload.turnId} started (runtime=${payload.runtime}, workdir=${workspace})`);

  try {
    const result = await turnRunner({
      runtime: payload.runtime,
      workspace,
      stateDir,
      prompt: payload.prompt,
      model: payload.model,
      credentials: payload.credentials,
      sessionRef: payload.sessionRef,
      timeoutMs: payload.timeoutMs,
      extraEnv: payload.env,
      signal: controller.signal,
      onChunk: (text) =>
        send({ type: 'machine.turn.delta', payload: { turnId: payload.turnId, text } }),
    });
    send({
      type: 'machine.turn.result',
      payload: {
        turnId: payload.turnId,
        ok: true,
        text: result.text,
        sessionRef: result.sessionRef,
        durationMs: result.durationMs,
      },
    });
    log(`Turn ${payload.turnId} finished in ${result.durationMs}ms`);
  } catch (error) {
    // api_failed cannot originate from a CLI run; collapse to cli_failed for the wire.
    const kind =
      error instanceof RunnerError && error.kind !== 'api_failed' ? error.kind : 'cli_failed';
    const message = error instanceof Error ? error.message : 'Turn failed';
    send({
      type: 'machine.turn.result',
      payload: { turnId: payload.turnId, ok: false, error: { kind, message } },
    });
    log(`Turn ${payload.turnId} failed (${kind}): ${message}`);
  } finally {
    active.delete(payload.turnId);
  }
}

export function cancelTurn(turnId: string): void {
  active.get(turnId)?.abort();
}
