'use client';

import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '@/lib/runtime';
import { useAuthStore } from '@/store/auth';
import type { WorkflowEventDelta } from '@/lib/workflows';

const RECONNECT_DELAY_MS = 3000;
const PING_INTERVAL_MS = 25_000;

interface UseWorkflowEventsOptions {
  projectId: string;
  enabled?: boolean;
  onEvent?: (delta: WorkflowEventDelta) => void;
}

interface UseWorkflowEventsResult {
  connected: boolean;
  lastDelta: WorkflowEventDelta | null;
}

/**
 * Live workflow deltas for a project over the shared /ws socket. `connected`
 * doubles as the signal for callers to fall back to REST polling.
 */
export function useWorkflowEvents({
  projectId,
  enabled = true,
  onEvent,
}: UseWorkflowEventsOptions): UseWorkflowEventsResult {
  const token = useAuthStore((s) => s.token);
  const [connected, setConnected] = useState(false);
  const [lastDelta, setLastDelta] = useState<WorkflowEventDelta | null>(null);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!token || !projectId || !enabled) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(wsUrl(new URLSearchParams({ token })));

      ws.onopen = () => {
        if (disposed || !ws) return;
        setConnected(true);
        ws.send(JSON.stringify({ type: 'workflow.subscribe', payload: { projectId } }));
        ping = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        let frame: { type: string; payload?: unknown };
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (frame.type === 'workflow.event' && frame.payload) {
          const delta = frame.payload as WorkflowEventDelta;
          setLastDelta(delta);
          onEventRef.current?.(delta);
        }
      };

      ws.onclose = (event) => {
        if (disposed) return;
        setConnected(false);
        if (ping) clearInterval(ping);
        if (event.code !== 1000 && event.code !== 1001) {
          reconnect = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      if (ping) clearInterval(ping);
      ws?.close(1000);
      setConnected(false);
    };
  }, [token, projectId, enabled]);

  return { connected, lastDelta };
}
