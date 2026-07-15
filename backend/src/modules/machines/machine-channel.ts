import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { MACHINE_RUNTIMES, type MachineTurnResult } from '@swarmdev/shared';
import { db } from '../../db/client';
import { machines } from '../../db/schema';
import { handleTurnDelta, handleTurnResult } from './machine-turns';

const runtimesFrameSchema = z.object({
  runtimes: z
    .array(
      z.object({
        runtime: z.enum(MACHINE_RUNTIMES),
        available: z.boolean(),
        version: z.string().max(200).nullable(),
        error: z.string().max(400).optional(),
      })
    )
    .max(MACHINE_RUNTIMES.length),
});

const turnDeltaSchema = z.object({
  turnId: z.string().uuid(),
  text: z.string(),
});

const turnResultSchema = z.union([
  z.object({
    turnId: z.string().uuid(),
    ok: z.literal(true),
    text: z.string(),
    sessionRef: z.string().max(200).optional(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    turnId: z.string().uuid(),
    ok: z.literal(false),
    error: z.object({
      kind: z.enum(['timeout', 'aborted', 'cli_failed', 'bad_output']),
      message: z.string().max(800),
    }),
  }),
]);

function sendError(ws: WebSocket, code: string, message: string): void {
  ws.send(JSON.stringify({ type: 'machine.error', payload: { code, message } }));
}

export async function handleMachineFrame(
  ws: WebSocket,
  machineId: string,
  frame: { type: string; payload?: Record<string, unknown> }
): Promise<void> {
  if (frame.type === 'machine.runtimes') {
    const parsed = runtimesFrameSchema.safeParse(frame.payload ?? {});
    if (!parsed.success) {
      sendError(ws, 'invalid_payload', parsed.error.issues[0]?.message ?? 'Invalid payload');
      return;
    }
    await db
      .update(machines)
      .set({ runtimes: parsed.data.runtimes, updatedAt: new Date() })
      .where(eq(machines.id, machineId));
    return;
  }
  if (frame.type === 'machine.turn.delta') {
    const parsed = turnDeltaSchema.safeParse(frame.payload ?? {});
    if (parsed.success) handleTurnDelta(parsed.data.turnId, parsed.data.text);
    return;
  }
  if (frame.type === 'machine.turn.result') {
    const parsed = turnResultSchema.safeParse(frame.payload ?? {});
    if (!parsed.success) {
      sendError(ws, 'invalid_payload', parsed.error.issues[0]?.message ?? 'Invalid payload');
      return;
    }
    handleTurnResult(parsed.data as MachineTurnResult);
    return;
  }
  sendError(ws, 'unknown_frame', `Unsupported frame type: ${frame.type}`);
}
