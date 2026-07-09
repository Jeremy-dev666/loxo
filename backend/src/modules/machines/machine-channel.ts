import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { MACHINE_RUNTIMES } from '@swarmdev/shared';
import { db } from '../../db/client';
import { machines } from '../../db/schema';

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
  sendError(ws, 'unknown_frame', `Unsupported frame type: ${frame.type}`);
}
