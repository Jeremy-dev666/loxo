import type { WebSocket } from 'ws';
import { executorEvents, type WorkflowEventDelta } from '../modules/workflows/executor';

/**
 * Workflow frames over the shared /ws socket:
 *   client → workflow.subscribe   {projectId?}
 *   client → workflow.unsubscribe {}
 *   server → workflow.subscribed | workflow.event
 *
 * Events are always filtered by owner; a subscription scoped to a project
 * additionally drops deltas from other projects.
 */
export interface WorkflowFrame {
  type: string;
  payload?: Record<string, unknown>;
}

interface WorkflowSubscription {
  userId: string;
  projectId?: string;
}

const subscribers = new Map<WebSocket, WorkflowSubscription>();

function send(ws: WebSocket, type: string, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

export function handleWorkflowFrame(ws: WebSocket, userId: string, frame: WorkflowFrame): void {
  const payload = frame.payload ?? {};
  switch (frame.type) {
    case 'workflow.subscribe': {
      const projectId =
        typeof payload.projectId === 'string' && payload.projectId.trim()
          ? payload.projectId
          : undefined;
      if (!subscribers.has(ws)) {
        ws.once('close', () => subscribers.delete(ws));
      }
      subscribers.set(ws, { userId, projectId });
      send(ws, 'workflow.subscribed', { projectId: projectId ?? null });
      return;
    }
    case 'workflow.unsubscribe':
      subscribers.delete(ws);
      return;
    default:
      send(ws, 'workflow.error', { code: 'unknown_type', message: `Unknown frame: ${frame.type}` });
  }
}

function broadcast(delta: WorkflowEventDelta): void {
  for (const [ws, subscription] of subscribers) {
    if (subscription.userId !== delta.userId) continue;
    if (subscription.projectId && delta.projectId && subscription.projectId !== delta.projectId) {
      continue;
    }
    send(ws, 'workflow.event', delta);
  }
}

let attached = false;

/** Idempotent; the gateway calls this once at startup. */
export function attachWorkflowBroadcast(): void {
  if (attached) return;
  attached = true;
  executorEvents.on('workflowEvent', broadcast);
}

export function subscriberCountForTests(): number {
  return subscribers.size;
}
