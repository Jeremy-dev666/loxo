import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  conversations,
  messages,
  type Conversation,
  type Message,
  type MessageMeta,
} from '../../db/schema';
import { notFound } from '../../http/errors';
import { getAgent } from '../agents/agents.service';

const PREVIEW_MAX_CHARS = 160;

export async function createConversation(
  userId: string,
  agentId: string,
  title?: string
): Promise<Conversation> {
  await getAgent(userId, agentId);
  const [conversation] = await db
    .insert(conversations)
    .values({ userId, agentId, title: title?.trim() || 'New conversation' })
    .returning();
  return conversation!;
}

/**
 * Conversation to use when the client opens a chat without picking one.
 * Reuses the newest message-less conversation for the agent so page reloads
 * and repeated new-chat clicks don't pile up empty records.
 */
export async function openConversation(userId: string, agentId: string): Promise<Conversation> {
  await getAgent(userId, agentId);
  const [empty] = await db
    .select({ conversation: conversations })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.agentId, agentId), isNull(messages.id)))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (empty) return empty.conversation;
  return createConversation(userId, agentId);
}

export async function getConversation(
  userId: string,
  conversationId: string
): Promise<Conversation> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!conversation) throw notFound('Conversation not found');
  return conversation;
}

export async function listConversations(userId: string, agentId?: string): Promise<Conversation[]> {
  const conditions = [eq(conversations.userId, userId)];
  if (agentId) conditions.push(eq(conversations.agentId, agentId));
  return db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt));
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string
): Promise<Conversation> {
  await getConversation(userId, conversationId);
  const [updated] = await db
    .update(conversations)
    .set({ title: title.trim(), updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning();
  return updated!;
}

/** Messages are removed by FK cascade. */
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  await getConversation(userId, conversationId);
  await db.delete(conversations).where(eq(conversations.id, conversationId));
}

export async function listMessages(userId: string, conversationId: string): Promise<Message[]> {
  await getConversation(userId, conversationId);
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  meta: MessageMeta = {}
): Promise<Message> {
  const [message] = await db
    .insert(messages)
    .values({ conversationId, role, content, meta })
    .returning();
  await db
    .update(conversations)
    .set({
      lastMessagePreview: content.replace(/\s+/g, ' ').slice(0, PREVIEW_MAX_CHARS),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
  return message!;
}

export async function setRunnerSessionRef(
  conversationId: string,
  ref: string | null
): Promise<void> {
  await db
    .update(conversations)
    .set({ runnerSessionRef: ref })
    .where(eq(conversations.id, conversationId));
}

/** Called when an agent's provider or model changes; forces fresh CLI sessions. */
export async function clearRunnerSessionsForAgent(agentId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ runnerSessionRef: null })
    .where(eq(conversations.agentId, agentId));
}
