import { apiFetch } from './api';

export interface Conversation {
  id: string;
  agentId: string;
  title: string;
  lastMessagePreview: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: { error?: boolean; durationMs?: number };
  createdAt: string;
}

export const fetchConversations = (agentId: string) =>
  apiFetch<{ conversations: Conversation[] }>(`/api/conversations?agentId=${agentId}`).then(
    (r) => r.conversations
  );

export const createConversation = (agentId: string) =>
  apiFetch<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  }).then((r) => r.conversation);

export const renameConversation = (id: string, title: string) =>
  apiFetch<{ conversation: Conversation }>(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  }).then((r) => r.conversation);

export const deleteConversation = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' });

export const fetchMessages = (id: string) =>
  apiFetch<{ messages: ChatMessage[] }>(`/api/conversations/${id}/messages`).then(
    (r) => r.messages
  );

export const exportUrl = (id: string) => `/api/conversations/${id}/export`;
