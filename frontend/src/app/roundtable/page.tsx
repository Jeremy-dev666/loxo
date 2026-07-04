'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  fetchSessionState,
  sendSessionMessage,
  stopSession,
  updateNote,
  type RoundtableMember,
  type SessionState,
  type WhiteboardNote,
} from '@/lib/roundtable';

const COLUMN_STYLES: Record<string, { label: string; chip: string; note: string }> = {
  ideas: { label: 'Ideas', chip: 'bg-sky-500/20 text-sky-300', note: 'border-sky-700 bg-sky-950/60' },
  questions: { label: 'Questions', chip: 'bg-amber-500/20 text-amber-300', note: 'border-amber-700 bg-amber-950/60' },
  actions: { label: 'Actions', chip: 'bg-emerald-500/20 text-emerald-300', note: 'border-emerald-700 bg-emerald-950/60' },
  risks: { label: 'Risks', chip: 'bg-red-500/20 text-red-300', note: 'border-red-700 bg-red-950/60' },
};

function sessionIdFromStorage(): string {
  if (typeof window === 'undefined') return 'default';
  const existing = window.localStorage.getItem('roundtable-session-id');
  if (existing) return existing;
  const fresh = `rt-${crypto.randomUUID()}`;
  window.localStorage.setItem('roundtable-session-id', fresh);
  return fresh;
}

function Whiteboard({
  sessionId,
  notes,
  onNoteMoved,
}: {
  sessionId: string;
  notes: WhiteboardNote[];
  onNoteMoved: (note: WhiteboardNote) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  const startDrag = (event: React.PointerEvent, note: WhiteboardNote) => {
    const pos = positions[note.id] ?? { x: note.x, y: note.y };
    setDragging({ id: note.id, dx: event.clientX - pos.x, dy: event.clientY - pos.y });
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    setPositions((prev) => ({
      ...prev,
      [dragging.id]: { x: event.clientX - dragging.dx, y: event.clientY - dragging.dy },
    }));
  };

  const endDrag = async () => {
    if (!dragging) return;
    const id = dragging.id;
    const pos = positions[id];
    setDragging(null);
    if (!pos) return;
    try {
      const updated = await updateNote(sessionId, id, { x: Math.round(pos.x), y: Math.round(pos.y) });
      onNoteMoved(updated.note);
    } catch {
      // Poll refresh will restore the server position.
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-panel">
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-2 text-xs">
        <span className="font-medium text-slate-300">Whiteboard</span>
        {Object.entries(COLUMN_STYLES).map(([key, style]) => (
          <span key={key} className={`rounded px-1.5 py-0.5 ${style.chip}`}>
            {style.label}
          </span>
        ))}
        <span className="ml-auto text-slate-500">{notes.length} notes · drag to arrange</span>
      </div>
      <div
        ref={boardRef}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        className="relative h-[420px] overflow-auto"
      >
        <div className="relative" style={{ width: 1800, height: 1320 }}>
          {notes.map((note) => {
            const pos = positions[note.id] ?? { x: note.x, y: note.y };
            const style = COLUMN_STYLES[note.column] ?? COLUMN_STYLES.ideas!;
            return (
              <div
                key={note.id}
                onPointerDown={(e) => startDrag(e, note)}
                className={`absolute w-[220px] cursor-grab select-none rounded border p-2 text-xs shadow ${style.note} ${
                  dragging?.id === note.id ? 'z-10 cursor-grabbing opacity-90' : ''
                }`}
                style={{ left: pos.x, top: pos.y }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`rounded px-1 py-0.5 text-[10px] ${style.chip}`}>{style.label}</span>
                  <span className="truncate text-[10px] text-slate-500">{note.authorName}</span>
                </div>
                <p className="whitespace-pre-line text-slate-200">{note.text}</p>
              </div>
            );
          })}
          {notes.length === 0 && (
            <p className="absolute left-6 top-6 text-sm text-slate-500">
              Notes appear here automatically as agents discuss.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundtablePageInner() {
  const [sessionId, setSessionId] = useState('default');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [members, setMembers] = useState<RoundtableMember[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId(sessionIdFromStorage());
    fetchAgents().then(setAgents).catch(() => setAgents([]));
  }, []);

  const refresh = useCallback(() => {
    if (!sessionId || sessionId === 'default') return;
    fetchSessionState(sessionId)
      .then((next) => {
        setState(next);
        if (next.members.length > 0) setMembers(next.members);
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state?.messages.length]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.agentId)), [members]);

  const toggleMember = (agent: Agent) => {
    setMembers((prev) =>
      prev.some((m) => m.agentId === agent.id)
        ? prev.filter((m) => m.agentId !== agent.id)
        : [
            ...prev,
            {
              agentId: agent.id,
              name: agent.name,
              role: agent.tags[0],
              description: agent.description,
            },
          ]
    );
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (members.length === 0) {
      setError('Invite at least one agent first.');
      return;
    }
    setError('');
    setDraft('');
    try {
      const next = await sendSessionMessage(sessionId, {
        title: 'Roundtable',
        userMessage: { content },
        members,
        messages: state?.messages,
        notes: state?.notes,
      });
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const stop = async () => {
    try {
      setState(await stopSession(sessionId));
    } catch {
      // Poll refresh reflects the outcome.
    }
  };

  const newSession = () => {
    const fresh = `rt-${crypto.randomUUID()}`;
    window.localStorage.setItem('roundtable-session-id', fresh);
    setSessionId(fresh);
    setState(null);
    setMembers([]);
  };

  const onNoteMoved = (note: WhiteboardNote) => {
    setState((prev) =>
      prev ? { ...prev, notes: prev.notes.map((n) => (n.id === note.id ? note : n)) } : prev
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Roundtable</h1>
          {state?.active && (
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
              live · round {state.round}
            </span>
          )}
        </div>
        <div className="flex gap-2 text-sm">
          {state?.active && (
            <button
              onClick={stop}
              className="rounded border border-red-800 px-3 py-1.5 text-red-400 hover:border-red-600"
            >
              Stop topic
            </button>
          )}
          <button
            onClick={newSession}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500"
          >
            New session
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-slate-800 bg-panel p-3">
        <p className="mb-2 text-xs text-slate-400">
          Members ({members.length}) — click to invite or remove. Say “stop this topic” to end a
          discussion.
        </p>
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => toggleMember(agent)}
              className={
                memberIds.has(agent.id)
                  ? 'rounded-full bg-accent px-3 py-1 text-xs font-medium text-slate-900'
                  : 'rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500'
              }
            >
              {agent.name}
              {state?.speakingAgents.includes(agent.name) ? ' · typing…' : ''}
            </button>
          ))}
          {agents.length === 0 && <span className="text-xs text-slate-500">No agents yet.</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="flex h-[520px] flex-col rounded-lg border border-slate-800 bg-panel">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {(state?.messages ?? []).map((message) => (
              <div key={message.id} className={message.senderId === 'user' ? 'text-right' : ''}>
                <p className="text-xs text-slate-500">{message.senderName}</p>
                <div
                  className={
                    message.senderId === 'user'
                      ? 'inline-block max-w-[85%] rounded-lg bg-accent/20 px-3 py-2 text-sm text-slate-100'
                      : 'inline-block max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200'
                  }
                >
                  <p className="whitespace-pre-wrap text-left">{message.content}</p>
                </div>
              </div>
            ))}
            {(state?.messages ?? []).length === 0 && (
              <p className="text-sm text-slate-500">
                Invite agents and send a topic to start the discussion.
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-slate-800 p-3">
            <input
              className="flex-1 rounded border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="Say something to the table…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 hover:opacity-90">
              Send
            </button>
          </form>
          {error && <p className="px-3 pb-2 text-xs text-red-400">{error}</p>}
        </section>

        <div className="space-y-4">
          <Whiteboard sessionId={sessionId} notes={state?.notes ?? []} onNoteMoved={onNoteMoved} />

          <section className="rounded-lg border border-slate-800 bg-panel">
            <p className="border-b border-slate-800 px-4 py-2 text-xs font-medium text-slate-300">
              Run log
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto p-3 text-xs">
              {(state?.runLogs ?? [])
                .slice()
                .reverse()
                .map((log) => (
                  <p key={log.id} className="flex gap-2">
                    <span
                      className={
                        log.status === 'error'
                          ? 'text-red-400'
                          : log.status === 'running'
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                      }
                    >
                      {log.status}
                    </span>
                    <span className="text-slate-400">{log.message}</span>
                  </p>
                ))}
              {(state?.runLogs ?? []).length === 0 && (
                <p className="text-slate-500">No activity yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function RoundtablePage() {
  return (
    <RequireAuth>
      <RoundtablePageInner />
    </RequireAuth>
  );
}
