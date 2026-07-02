'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useAgentChat, type LiveMessage } from '@/hooks/useAgentChat';
import { fetchAgent, type Agent } from '@/lib/agents';
import {
  createConversation,
  deleteConversation,
  fetchConversations,
  fetchMessages,
  renameConversation,
  type ChatMessage,
  type Conversation,
} from '@/lib/chat';
import { API_BASE } from '@/lib/runtime';
import { useAuthStore } from '@/store/auth';

function MessageBubble({ message }: { message: LiveMessage | ChatMessage }) {
  const isUser = message.role === 'user';
  const isError = message.role === 'system' && message.meta?.error;
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[80%] rounded-lg bg-accent/20 px-4 py-2'
            : isError
              ? 'max-w-[80%] rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-red-300'
              : 'prose prose-invert prose-sm max-w-[80%] rounded-lg bg-panel px-4 py-2'
        }
      >
        {isUser || isError ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}

function ChatPageInner() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const token = useAuthStore((s) => s.token);

  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const reloadConversations = useCallback(() => {
    fetchConversations(agentId).then(setConversations).catch(() => {});
  }, [agentId]);

  useEffect(() => {
    fetchAgent(agentId).then(setAgent).catch(() => {});
    reloadConversations();
  }, [agentId, reloadConversations]);

  useEffect(() => {
    if (!activeId) {
      setHistory([]);
      return;
    }
    fetchMessages(activeId).then(setHistory).catch(() => setHistory([]));
  }, [activeId]);

  const onConversationCreated = useCallback(
    (id: string) => {
      setActiveId(id);
      reloadConversations();
    },
    [reloadConversations]
  );

  const { connected, busy, liveMessages, streamText, error, sendMessage, stopTurn } = useAgentChat({
    agentId,
    conversationId: activeId,
    onConversationCreated,
  });

  const allMessages = useMemo(() => {
    const liveIds = new Set(liveMessages.map((m) => m.id));
    return [...history.filter((m) => !liveIds.has(m.id)), ...liveMessages];
  }, [history, liveMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [allMessages.length, streamText]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    sendMessage(draft);
    setDraft('');
  };

  const newConversation = async () => {
    const conversation = await createConversation(agentId);
    reloadConversations();
    setActiveId(conversation.id);
  };

  const removeConversation = async (id: string) => {
    if (!confirm('Delete this conversation?')) return;
    await deleteConversation(id);
    if (id === activeId) setActiveId(null);
    reloadConversations();
  };

  const saveRename = async (id: string) => {
    if (renameDraft.trim()) {
      await renameConversation(id, renameDraft.trim());
      reloadConversations();
    }
    setRenamingId(null);
  };

  const exportConversation = async (id: string) => {
    const res = await fetch(`${API_BASE}/api/conversations/${id}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversation-${id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="flex w-64 shrink-0 flex-col rounded-lg border border-slate-800 bg-panel">
        <div className="flex items-center justify-between border-b border-slate-800 p-3">
          <span className="text-sm font-medium">Sessions</span>
          <button
            onClick={newConversation}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
          >
            New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={
                conversation.id === activeId
                  ? 'border-l-2 border-accent bg-surface/60 px-3 py-2'
                  : 'cursor-pointer px-3 py-2 hover:bg-surface/40'
              }
              onClick={() => setActiveId(conversation.id)}
            >
              {renamingId === conversation.id ? (
                <input
                  autoFocus
                  className="w-full rounded border border-slate-700 bg-surface px-1 py-0.5 text-xs"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => saveRename(conversation.id)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename(conversation.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <p className="truncate text-sm">{conversation.title}</p>
              )}
              <p className="truncate text-xs text-slate-500">{conversation.lastMessagePreview}</p>
              <div className="mt-1 flex gap-2 text-[10px] text-slate-500">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(conversation.id);
                    setRenameDraft(conversation.title);
                  }}
                  className="hover:text-slate-300"
                >
                  rename
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void exportConversation(conversation.id);
                  }}
                  className="hover:text-slate-300"
                >
                  export
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeConversation(conversation.id);
                  }}
                  className="hover:text-red-400"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="p-3 text-xs text-slate-500">No sessions yet. Send a message to start.</p>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-slate-800 bg-surface">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="font-medium">{agent?.name ?? '…'}</h1>
            {agent && (
              <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-300">
                {agent.runtime}
              </span>
            )}
            <span
              className={connected ? 'h-2 w-2 rounded-full bg-emerald-400' : 'h-2 w-2 rounded-full bg-slate-600'}
              title={connected ? 'Connected' : 'Disconnected'}
            />
          </div>
          <Link
            href={`/agents/${agentId}/settings`}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Settings
          </Link>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {allMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {streamText && (
            <div className="flex justify-start">
              <div className="prose prose-invert prose-sm max-w-[80%] rounded-lg bg-panel px-4 py-2 opacity-80">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
              </div>
            </div>
          )}
          {busy && !streamText && (
            <p className="animate-pulse text-xs text-slate-500">Agent is working…</p>
          )}
          {allMessages.length === 0 && !busy && (
            <p className="py-16 text-center text-sm text-slate-500">
              Send a message to start the conversation.
            </p>
          )}
        </div>

        {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}

        <form onSubmit={submit} className="flex gap-2 border-t border-slate-800 p-3">
          <textarea
            className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded border border-slate-700 bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder={agent?.runtime === 'api' ? 'API agents arrive in a later milestone' : 'Message the agent…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            disabled={agent?.runtime === 'api'}
          />
          {busy ? (
            <button
              type="button"
              onClick={stopTurn}
              className="rounded border border-red-900 px-4 text-sm text-red-400 hover:border-red-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!connected || !draft.trim() || agent?.runtime === 'api'}
              className="rounded bg-accent px-4 text-sm font-medium text-slate-900 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

export default function AgentChatPage() {
  return (
    <RequireAuth>
      <ChatPageInner />
    </RequireAuth>
  );
}
