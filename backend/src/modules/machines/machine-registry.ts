import type { WebSocket } from 'ws';

/** Live daemon sockets by machine id. Presence only; persistence stays in the DB. */
const sockets = new Map<string, WebSocket>();

export function registerMachineSocket(machineId: string, ws: WebSocket): void {
  // A reconnect replaces the previous socket; the stale one is closed defensively.
  const existing = sockets.get(machineId);
  if (existing && existing !== ws) {
    existing.terminate();
  }
  sockets.set(machineId, ws);
}

export function unregisterMachineSocket(machineId: string, ws: WebSocket): void {
  if (sockets.get(machineId) === ws) {
    sockets.delete(machineId);
  }
}

export function isMachineOnline(machineId: string): boolean {
  return sockets.has(machineId);
}

export function terminateMachineSocket(machineId: string): void {
  const ws = sockets.get(machineId);
  if (ws) {
    ws.terminate();
    sockets.delete(machineId);
  }
}
