import { afterEach, describe, expect, it } from 'vitest';
import {
  RunnerError,
  type MachineClientFrame,
  type MachineTurnStart,
  type TurnRequest,
} from '@swarmdev/shared';
import { cancelTurn, setTurnRunnerForTests, startTurn } from '../src/turns';
import { defaultWorkspaceRoot } from '../src/workdir';

afterEach(() => setTurnRunnerForTests(null));

const noopLog = (): void => {};

function makeStart(overrides: Partial<MachineTurnStart> = {}): MachineTurnStart {
  return {
    turnId: '11111111-1111-4111-8111-111111111111',
    runtime: 'claude-code',
    prompt: 'do something',
    timeoutMs: 5_000,
    ...overrides,
  };
}

function collectFrames(): { frames: MachineClientFrame[]; send: (f: MachineClientFrame) => void } {
  const frames: MachineClientFrame[] = [];
  return { frames, send: (f) => frames.push(f) };
}

describe('startTurn', () => {
  it('streams deltas and reports a successful result', async () => {
    setTurnRunnerForTests(async (request) => {
      request.onChunk?.('partial ');
      request.onChunk?.('output');
      return { text: 'partial output', sessionRef: 'sess-9', durationMs: 42 };
    });
    const { frames, send } = collectFrames();
    await startTurn(makeStart(), send, noopLog);

    expect(frames).toEqual([
      {
        type: 'machine.turn.delta',
        payload: { turnId: '11111111-1111-4111-8111-111111111111', text: 'partial ' },
      },
      {
        type: 'machine.turn.delta',
        payload: { turnId: '11111111-1111-4111-8111-111111111111', text: 'output' },
      },
      {
        type: 'machine.turn.result',
        payload: {
          turnId: '11111111-1111-4111-8111-111111111111',
          ok: true,
          text: 'partial output',
          sessionRef: 'sess-9',
          durationMs: 42,
        },
      },
    ]);
  });

  it('runs in the daemon workspace by default and passes turn parameters through', async () => {
    let seen: TurnRequest | undefined;
    setTurnRunnerForTests(async (request) => {
      seen = request;
      return { text: 'ok', durationMs: 1 };
    });
    const { send } = collectFrames();
    await startTurn(
      makeStart({ model: 'opus', sessionRef: 'sess-1', credentials: { apiKey: 'sk-test-123456789012' } }),
      send,
      noopLog
    );
    expect(seen!.workspace).toBe(defaultWorkspaceRoot());
    expect(seen!.model).toBe('opus');
    expect(seen!.sessionRef).toBe('sess-1');
    expect(seen!.credentials?.apiKey).toBe('sk-test-123456789012');
  });

  it('maps RunnerError kinds onto the wire failure', async () => {
    setTurnRunnerForTests(async () => {
      throw new RunnerError('boom', 'timeout');
    });
    const { frames, send } = collectFrames();
    await startTurn(makeStart(), send, noopLog);
    expect(frames).toEqual([
      {
        type: 'machine.turn.result',
        payload: {
          turnId: '11111111-1111-4111-8111-111111111111',
          ok: false,
          error: { kind: 'timeout', message: 'boom' },
        },
      },
    ]);
  });

  it('rejects a workdir outside the allowlist without running anything', async () => {
    let ran = false;
    setTurnRunnerForTests(async () => {
      ran = true;
      return { text: 'never', durationMs: 0 };
    });
    const { frames, send } = collectFrames();
    await startTurn(makeStart({ workdir: 'C:/Windows/System32' }), send, noopLog, []);
    expect(ran).toBe(false);
    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    if (frame.type !== 'machine.turn.result' || frame.payload.ok) throw new Error('unexpected');
    expect(frame.payload.error.kind).toBe('cli_failed');
    expect(frame.payload.error.message).toContain('not allowed');
  });

  it('cancelTurn aborts the in-flight runner signal', async () => {
    setTurnRunnerForTests(
      (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener('abort', () =>
            reject(new RunnerError('Turn was cancelled', 'aborted'))
          );
        })
    );
    const { frames, send } = collectFrames();
    const running = startTurn(makeStart(), send, noopLog);
    await new Promise((r) => setTimeout(r, 20));
    cancelTurn('11111111-1111-4111-8111-111111111111');
    await running;

    const frame = frames[0]!;
    if (frame.type !== 'machine.turn.result' || frame.payload.ok) throw new Error('unexpected');
    expect(frame.payload.error.kind).toBe('aborted');
  });
});
