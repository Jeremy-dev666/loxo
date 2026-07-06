'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  confirmWorkflowDraft,
  fetchSessionState,
  generateWorkflowDraft,
  sendSessionMessage,
  stopSession,
  updateNote,
  type RoundtableMember,
  type SessionState,
  type WhiteboardNote,
  type WorkflowDraft,
} from '@/lib/roundtable';

const COLUMN_STYLES: Record<string, { label: string; chip: string; note: string }> = {
  ideas: { label: 'Ideas', chip: 'bg-pixel-blue/20 text-pixel-blue', note: 'border-pixel-blue bg-pixel-blue/10' },
  questions: { label: 'Questions', chip: 'bg-pixel-yellow/30 text-pixel-yellow', note: 'border-pixel-yellow bg-pixel-yellow/15' },
  actions: { label: 'Actions', chip: 'bg-pixel-green/20 text-pixel-green', note: 'border-pixel-green bg-pixel-green/10' },
  risks: { label: 'Risks', chip: 'bg-pixel-red/20 text-pixel-red', note: 'border-pixel-red bg-pixel-red/10' },
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
  onGenerateWorkflow,
  generating,
}: {
  sessionId: string;
  notes: WhiteboardNote[];
  onNoteMoved: (note: WhiteboardNote) => void;
  onGenerateWorkflow: () => void;
  generating: boolean;
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
    <div className="border border-pixel-black bg-pixel-white shadow-pixel">
      <div className="flex items-center gap-3 border-b border-pixel-black px-4 py-2 text-xs">
        <span className="font-medium text-pixel-black/70">Whiteboard</span>
        {Object.entries(COLUMN_STYLES).map(([key, style]) => (
          <span key={key} className={`px-1.5 py-0.5 ${style.chip}`}>
            {style.label}
          </span>
        ))}
        <span className="ml-auto text-pixel-black/50">{notes.length} notes · drag to arrange</span>
        <button
          type="button"
          onClick={onGenerateWorkflow}
          disabled={generating || notes.length === 0}
          title={notes.length === 0 ? 'Add whiteboard notes first' : 'Turn the whiteboard into a workflow draft'}
          className="border border-pixel-black bg-pixel-blue px-2 py-1 font-pixel text-[11px] text-pixel-white shadow-pixel-sm disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate workflow'}
        </button>
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
                className={`absolute w-[220px] cursor-grab select-none border p-2 text-xs shadow ${style.note} ${
                  dragging?.id === note.id ? 'z-10 cursor-grabbing opacity-90' : ''
                }`}
                style={{ left: pos.x, top: pos.y }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`px-1 py-0.5 text-[10px] ${style.chip}`}>{style.label}</span>
                  <span className="truncate text-[10px] text-pixel-black/50">{note.authorName}</span>
                </div>
                <p className="whitespace-pre-line text-pixel-black">{note.text}</p>
              </div>
            );
          })}
          {notes.length === 0 && (
            <p className="absolute left-6 top-6 text-sm text-pixel-black/50">
              Notes appear here automatically as agents discuss.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const DRAFT_STATUS_STYLES: Record<WorkflowDraft['status'], { label: string; chip: string }> = {
  proposed: { label: 'Proposed', chip: 'bg-pixel-yellow/30 text-pixel-yellow' },
  superseded: { label: 'Superseded', chip: 'bg-pixel-gray/25 text-pixel-gray' },
  confirmed: { label: 'Confirmed', chip: 'bg-pixel-green/25 text-pixel-green' },
};

function WorkflowDraftCard({
  draft,
  busy,
  onConfirm,
  onRegenerate,
}: {
  draft: WorkflowDraft;
  busy: boolean;
  onConfirm: (draftId: string, name?: string) => void;
  onRegenerate: (feedback: string, previousDraftId: string) => void;
}) {
  const [showActions, setShowActions] = useState<'confirm' | 'regenerate' | null>(null);
  const [teamName, setTeamName] = useState('');
  const [feedback, setFeedback] = useState('');
  const agentSteps = draft.workflow.nodes.filter((n) => n.type === 'agent');
  const status = DRAFT_STATUS_STYLES[draft.status];

  return (
    <div className="inline-block w-full max-w-[92%] border border-pixel-black bg-pixel-cream p-3 text-left shadow-pixel-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-pixel font-bold text-pixel-black">
          Workflow draft v{draft.revision}
        </span>
        <span className={`px-1.5 py-0.5 ${status.chip}`}>{status.label}</span>
        <span className="text-pixel-black/50">
          {draft.generator === 'fallback' ? 'deterministic draft' : `via ${draft.generator}`} ·{' '}
          {draft.noteCount} notes
        </span>
      </div>
      <p className="font-pixel text-sm font-bold text-pixel-black">{draft.workflow.name}</p>
      {draft.workflow.description && (
        <p className="mt-0.5 text-xs text-pixel-black/60">{draft.workflow.description}</p>
      )}
      <ol className="mt-2 space-y-1 text-xs">
        {agentSteps.map((node, index) => (
          <li key={node.id} className="flex items-center gap-2">
            <span className="font-pixel text-pixel-black/40">{index + 1}.</span>
            <span className="text-pixel-black">{node.label}</span>
            <span className="text-pixel-black/50">({node.kind ?? 'worker'})</span>
            {!node.agentId && <span className="text-pixel-red">unbound</span>}
          </li>
        ))}
      </ol>
      {draft.warnings.length > 0 && (
        <p className="mt-2 text-xs text-pixel-yellow">{draft.warnings[0]}</p>
      )}
      {draft.feedback && (
        <p className="mt-2 text-xs italic text-pixel-black/50">Feedback applied: {draft.feedback}</p>
      )}

      {draft.status === 'confirmed' && draft.teamId && (
        <Link
          href={`/teams/${draft.teamId}`}
          className="mt-3 inline-block border border-pixel-black bg-pixel-green px-3 py-1 font-pixel text-xs text-pixel-white no-underline shadow-pixel-sm"
        >
          Open team →
        </Link>
      )}

      {draft.status === 'proposed' && (
        <div className="mt-3 space-y-2">
          {showActions === 'confirm' && (
            <div className="flex gap-2">
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder={draft.workflow.name}
                className="flex-1 border border-pixel-black bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-black outline-none focus:border-pixel-blue"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onConfirm(draft.id, teamName.trim() || undefined)}
                className="border border-pixel-black bg-pixel-green px-3 py-1 font-pixel text-xs text-pixel-white shadow-pixel-sm disabled:opacity-50"
              >
                Save team
              </button>
            </div>
          )}
          {showActions === 'regenerate' && (
            <div className="flex gap-2">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should change?"
                className="flex-1 border border-pixel-black bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-black outline-none focus:border-pixel-blue"
              />
              <button
                type="button"
                disabled={busy || !feedback.trim()}
                onClick={() => onRegenerate(feedback.trim(), draft.id)}
                className="border border-pixel-black bg-pixel-blue px-3 py-1 font-pixel text-xs text-pixel-white shadow-pixel-sm disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>
          )}
          {showActions === null && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowActions('confirm')}
                className="border border-pixel-black bg-pixel-green px-3 py-1 font-pixel text-xs text-pixel-white shadow-pixel-sm disabled:opacity-50"
              >
                Confirm as team
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowActions('regenerate')}
                className="border border-pixel-black bg-pixel-white px-3 py-1 font-pixel text-xs text-pixel-black shadow-pixel-sm hover:bg-pixel-yellow/40 disabled:opacity-50"
              >
                Regenerate with feedback
              </button>
            </div>
          )}
        </div>
      )}
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

  const [draftBusy, setDraftBusy] = useState(false);

  const generateDraft = async (feedback?: string, previousDraftId?: string) => {
    setError('');
    setDraftBusy(true);
    try {
      const res = await generateWorkflowDraft(sessionId, {
        title: state?.title || 'Roundtable',
        members,
        notes: state?.notes,
        feedback,
        previousDraftId,
      });
      setState(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a workflow draft');
    } finally {
      setDraftBusy(false);
    }
  };

  const confirmDraft = async (draftId: string, name?: string) => {
    setError('');
    setDraftBusy(true);
    try {
      const res = await confirmWorkflowDraft(sessionId, draftId, name ? { name } : {});
      setState(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the team');
    } finally {
      setDraftBusy(false);
    }
  };

  // A draft can be referenced by several system messages (created, confirmed);
  // only the first one renders the interactive card.
  const draftCardMessageIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const message of state?.messages ?? []) {
      if (message.draftId && !seen.has(message.draftId)) seen.set(message.draftId, message.id);
    }
    return new Set(seen.values());
  }, [state?.messages]);

  const draftsById = useMemo(
    () => new Map((state?.workflowDrafts ?? []).map((d) => [d.id, d])),
    [state?.workflowDrafts]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Roundtable</h1>
          {state?.active && (
            <span className="border border-pixel-black bg-pixel-green px-2 py-0.5 font-pixel text-xs text-pixel-white">
              live · round {state.round}
            </span>
          )}
        </div>
        <div className="flex gap-2 text-sm">
          {state?.active && (
            <button
              onClick={stop}
              className="border border-pixel-red px-3 py-1.5 text-pixel-red hover:bg-pixel-red/10"
            >
              Stop topic
            </button>
          )}
          <button
            onClick={newSession}
            className="border border-pixel-black bg-pixel-white font-pixel text-pixel-black shadow-pixel-sm px-3 py-1.5 text-pixel-black/70 hover:bg-pixel-yellow/40"
          >
            New session
          </button>
        </div>
      </div>

      <section className="border border-pixel-black bg-pixel-white shadow-pixel p-3">
        <p className="mb-2 text-xs text-pixel-black/60">
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
                  ? 'rounded-full bg-pixel-red px-3 py-1 text-xs font-medium text-pixel-white'
                  : 'rounded-full border border-pixel-black px-3 py-1 text-xs text-pixel-black/70 hover:bg-pixel-yellow/40'
              }
            >
              {agent.name}
              {state?.speakingAgents.includes(agent.name) ? ' · typing…' : ''}
            </button>
          ))}
          {agents.length === 0 && <span className="text-xs text-pixel-black/50">No agents yet.</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="flex h-[520px] flex-col border border-pixel-black bg-pixel-white shadow-pixel">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {(state?.messages ?? []).map((message) => {
              const draft =
                message.draftId && draftCardMessageIds.has(message.id)
                  ? draftsById.get(message.draftId)
                  : undefined;
              if (draft) {
                return (
                  <div key={message.id}>
                    <p className="text-xs text-pixel-black/50">{message.senderName}</p>
                    <WorkflowDraftCard
                      draft={draft}
                      busy={draftBusy}
                      onConfirm={confirmDraft}
                      onRegenerate={(feedback, previousDraftId) =>
                        void generateDraft(feedback, previousDraftId)
                      }
                    />
                  </div>
                );
              }
              return (
                <div key={message.id} className={message.senderId === 'user' ? 'text-right' : ''}>
                  <p className="text-xs text-pixel-black/50">{message.senderName}</p>
                  <div
                    className={
                      message.senderId === 'user'
                        ? 'inline-block max-w-[85%] border border-pixel-black bg-pixel-blue px-3 py-2 font-pixel text-sm text-pixel-white shadow-pixel-sm'
                        : 'inline-block max-w-[85%] border border-pixel-black bg-pixel-white px-3 py-2 font-pixel text-sm text-pixel-black shadow-pixel-sm'
                    }
                  >
                    <p className="whitespace-pre-wrap text-left">{message.content}</p>
                  </div>
                </div>
              );
            })}
            {(state?.messages ?? []).length === 0 && (
              <p className="text-sm text-pixel-black/50">
                Invite agents and send a topic to start the discussion.
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-pixel-black p-3">
            <input
              className="flex-1 border border-pixel-black bg-pixel-white font-pixel text-pixel-black px-3 py-2 text-sm outline-none focus:border-pixel-blue"
              placeholder="Say something to the table…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="border border-pixel-black bg-pixel-red px-4 py-2 font-pixel text-sm font-bold text-pixel-white shadow-pixel-sm hover:bg-pixel-orange">
              Send
            </button>
          </form>
          {error && <p className="px-3 pb-2 text-xs text-pixel-red">{error}</p>}
        </section>

        <div className="space-y-4">
          <Whiteboard
            sessionId={sessionId}
            notes={state?.notes ?? []}
            onNoteMoved={onNoteMoved}
            onGenerateWorkflow={() => void generateDraft()}
            generating={draftBusy}
          />

          <section className="border border-pixel-black bg-pixel-white shadow-pixel">
            <p className="border-b border-pixel-black px-4 py-2 text-xs font-medium text-pixel-black/70">
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
                          ? 'text-pixel-red'
                          : log.status === 'running'
                            ? 'text-pixel-yellow'
                            : 'text-pixel-green'
                      }
                    >
                      {log.status}
                    </span>
                    <span className="text-pixel-black/60">{log.message}</span>
                  </p>
                ))}
              {(state?.runLogs ?? []).length === 0 && (
                <p className="text-pixel-black/50">No activity yet.</p>
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
