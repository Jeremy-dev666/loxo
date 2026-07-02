import type { WebSocket } from 'ws';
import { runChatTurn, stopTurn } from '../modules/chat/chat.service';
import { createConversation, getConversation } from '../modules/chat/conversations.service';

/**
 * Chat frames over the shared /ws socket:
 *   client → chat.open   {agentId, conversationId?}
 *   client → chat.message{conversationId, content}
 *   client → chat.stop   {conversationId}
 *   server → chat.ready | chat.saved | chat.delta | chat.reply | chat.error
 */
export interface ChatFrame {
  type: string;
  payload?: Record<string, unknown>;
}

function send(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function handleChatFrame(
  ws: WebSocket,
  userId: string,
  frame: ChatFrame
): Promise<void> {
  const payload = frame.payload ?? {};

  try {
    switch (frame.type) {
      case 'chat.open': {
        const agentId = str(payload.agentId);
        if (!agentId) {
          send(ws, 'chat.error', { code: 'invalid_frame', message: 'agentId is required' });
          return;
        }
        const requested = str(payload.conversationId);
        const conversation = requested
          ? await getConversation(userId, requested)
          : await createConversation(userId, agentId);
        send(ws, 'chat.ready', { conversationId: conversation.id, agentId });
        return;
      }

      case 'chat.message': {
        const conversationId = str(payload.conversationId);
        const content = str(payload.content);
        if (!conversationId || !content) {
          send(ws, 'chat.error', {
            code: 'invalid_frame',
            message: 'conversationId and content are required',
          });
          return;
        }

        const outcome = await runChatTurn(userId, conversationId, content, {
          onChunk: (text) => send(ws, 'chat.delta', { conversationId, text }),
        });
        // chat.saved after the turn resolves the whole persistence path; the
        // client already renders the user message optimistically.
        send(ws, 'chat.saved', { conversationId, messageId: outcome.userMessage.id });
        send(ws, 'chat.reply', {
          conversationId,
          messageId: outcome.reply.id,
          role: outcome.reply.role,
          content: outcome.reply.content,
          meta: outcome.reply.meta,
        });
        return;
      }

      case 'chat.stop': {
        const conversationId = str(payload.conversationId);
        if (conversationId) stopTurn(conversationId);
        return;
      }

      default:
        send(ws, 'chat.error', { code: 'unknown_type', message: `Unknown frame: ${frame.type}` });
    }
  } catch (error) {
    const err = error as { code?: string; message?: string };
    send(ws, 'chat.error', {
      code: err.code ?? 'chat_failed',
      message: err.message ?? 'Chat operation failed',
      conversationId: str(payload.conversationId) ?? null,
    });
  }
}
