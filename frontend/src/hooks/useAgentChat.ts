'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { wsUrl } from '@/lib/runtime';
import { useAuthStore } from '@/store/auth';
import type { ChatMessage } from '@/lib/chat';

const RECONNECT_DELAY_MS = 3000;
const PING_INTERVAL_MS = 25_000;

export interface LiveMessage extends Omit<ChatMessage, 'createdAt'> {
  createdAt: string;
  pending?: boolean;
}

interface UseAgentChatOptions {
  agentId: string;
  conversationId: string | null;
  onConversationCreated?: (conversationId: string) => void;
  /** Fires when a turn settles (reply or error); titles and previews may have changed. */
  onTurnComplete?: () => void;
}

interface UseAgentChatResult {
  connected: boolean;
  busy: boolean;
  liveMessages: LiveMessage[];
  streamText: string;
  error: string | null;
  sendMessage: (content: string) => void;
  stopTurn: () => void;
  resetLive: () => void;
}

/**
 * Chat over the shared /ws socket. REST supplies history; this hook only
 * tracks messages produced during the current connection plus the streaming
 * buffer for the in-flight turn.
 */
export function useAgentChat({
  agentId,
  conversationId,
  onConversationCreated,
  onTurnComplete,
}: UseAgentChatOptions): UseAgentChatResult {
  const token = useAuthStore((s) => s.token);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([]);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const activeConversationRef = useRef<string | null>(conversationId);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetLive = useCallback(() => {
    setLiveMessages([]);
    setStreamText('');
    setError(null);
  }, []);

  useEffect(() => {
    activeConversationRef.current = conversationId;
    resetLive();
  }, [conversationId, resetLive]);

  useEffect(() => {
    if (!token || !agentId) return;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl(new URLSearchParams({ token })));
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        setError(null);
        ws.send(
          JSON.stringify({
            type: 'chat.open',
            payload: {
              agentId,
              conversationId: activeConversationRef.current ?? undefined,
            },
          })
        );
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        let frame: { type: string; payload?: Record<string, unknown> };
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          return;
        }
        const payload = frame.payload ?? {};

        switch (frame.type) {
          case 'chat.ready': {
            const id = payload.conversationId as string;
            if (id && id !== activeConversationRef.current) {
              activeConversationRef.current = id;
              onConversationCreated?.(id);
            }
            break;
          }
          case 'chat.delta':
            if (payload.conversationId === activeConversationRef.current) {
              setStreamText((current) => current + String(payload.text ?? ''));
            }
            break;
          case 'chat.reply':
            if (payload.conversationId === activeConversationRef.current) {
              setStreamText('');
              setBusy(false);
              setLiveMessages((current) => [
                ...current,
                {
                  id: String(payload.messageId),
                  role: payload.role as LiveMessage['role'],
                  content: String(payload.content ?? ''),
                  meta: payload.meta as LiveMessage['meta'],
                  createdAt: new Date().toISOString(),
                },
              ]);
              onTurnComplete?.();
            }
            break;
          case 'chat.error':
            setBusy(false);
            setStreamText('');
            setError(String(payload.message ?? 'Chat failed'));
            onTurnComplete?.();
            break;
          default:
            break;
        }
      };

      ws.onclose = (event) => {
        if (disposed) return;
        setConnected(false);
        setBusy(false);
        if (pingRef.current) clearInterval(pingRef.current);
        if (event.code !== 1000 && event.code !== 1001) {
          reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close(1000);
      wsRef.current = null;
      setConnected(false);
    };
  }, [token, agentId, onConversationCreated, onTurnComplete]);

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    const conversation = activeConversationRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !conversation || !content.trim()) return;

    setLiveMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ]);
    setBusy(true);
    setError(null);
    ws.send(
      JSON.stringify({
        type: 'chat.message',
        payload: { conversationId: conversation, content: content.trim() },
      })
    );
  }, []);

  const stopTurn = useCallback(() => {
    const ws = wsRef.current;
    const conversation = activeConversationRef.current;
    if (ws?.readyState === WebSocket.OPEN && conversation) {
      ws.send(JSON.stringify({ type: 'chat.stop', payload: { conversationId: conversation } }));
    }
  }, []);

  return { connected, busy, liveMessages, streamText, error, sendMessage, stopTurn, resetLive };
}
