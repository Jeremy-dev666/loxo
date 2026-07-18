'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useAuthStore } from '@/store/auth';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  confirmWorkflowDraft,
  fetchSessionState,
  generateWorkflowDraft,
  sendSessionMessage,
  stopSession,
  WHITEBOARD_COLUMNS,
  type SessionState,
  type WhiteboardColumn,
  type WhiteboardNote,
  type WorkflowDraft,
  type WorkshopMember,
} from '@/lib/workshop';

const COLUMN_META: Record<WhiteboardColumn, { label: string; square: string }> = {
  ideas: { label: 'Ideas', square: 'bg-pixel-steel' },
  questions: { label: 'Questions', square: 'bg-pixel-yellow' },
  actions: { label: 'Actions', square: 'bg-pixel-green' },
  risks: { label: 'Risks', square: 'bg-pixel-red' },
};

type RightTab = 'board' | 'draft' | 'log';

function sessionIdFromStorage(): string {
  if (typeof window === 'undefined') return 'default';
  const existing = window.localStorage.getItem('workshop-session-id');
  if (existing) return existing;
  const fresh = `ws-${crypto.randomUUID()}`;
  window.localStorage.setItem('workshop-session-id', fresh);
  return fresh;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function AvatarBox({ name, dashed = false }: { name: string; dashed?: boolean }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center border text-[13px] ${
        dashed ? 'border-dashed border-[#C9C9C9] text-[#9B9B9B]' : 'border-pixel-line text-[#111]'
      }`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9B9B9B]">
      {children}
    </p>
  );
}

function DraftCard({
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
  const [mode, setMode] = useState<'confirm' | 'regenerate' | null>(null);
  const [teamName, setTeamName] = useState('');
  const [feedback, setFeedback] = useState('');
  const agentSteps = draft.workflow.nodes.filter((n) => n.type === 'agent');
  const statusSquare =
    draft.status === 'confirmed'
      ? 'bg-pixel-green'
      : draft.status === 'superseded'
        ? 'bg-[#C9C9C9]'
        : 'bg-pixel-yellow';

  return (
    <div className="border border-pixel-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#111]">
          Workflow draft v{draft.revision}
        </span>
        <span className={`h-2 w-2 shrink-0 ${statusSquare}`} />
        <span className="text-[12px] text-[#9B9B9B]">
          {draft.status} · {draft.generator === 'fallback' ? 'deterministic' : `via ${draft.generator}`} ·{' '}
          {draft.noteCount} notes
        </span>
      </div>
      <p className="mt-2 text-[15px] font-semibold text-[#111]">{draft.workflow.name}</p>
      <p className="mt-1 text-sm leading-relaxed text-[#6B6B6B]">
        {agentSteps.map((node, i) => (
          <span key={node.id}>
            {i > 0 && <span className="text-[#C9C9C9]"> → </span>}
            {node.label} ({node.kind ?? 'worker'}
            {!node.agentId ? ' · unbound' : ''})
          </span>
        ))}
      </p>
      {draft.warnings.length > 0 && (
        <p className="mt-2 text-[12px] text-[#9B9B9B]">{draft.warnings[0]}</p>
      )}
      {draft.feedback && (
        <p className="mt-2 text-[12px] italic text-[#9B9B9B]">Feedback applied: {draft.feedback}</p>
      )}

      {draft.status === 'confirmed' && draft.teamId && (
        <Link
          href={`/teams/${draft.teamId}`}
          className="mt-3 inline-block bg-pixel-black px-4 py-2 text-[13px] font-semibold text-white no-underline hover:bg-[#333]"
        >
          Open team →
        </Link>
      )}

      {draft.status === 'proposed' && (
        <div className="mt-4">
          {mode === 'confirm' && (
            <div className="flex gap-2">
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder={draft.workflow.name}
                className="min-w-0 flex-1 border border-pixel-line px-3 py-2 text-[13px] text-[#111] outline-none placeholder:text-[#C9C9C9] focus:border-[#111]"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onConfirm(draft.id, teamName.trim() || undefined)}
                className="bg-pixel-black px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#333] disabled:opacity-40"
              >
                Save team
              </button>
            </div>
          )}
          {mode === 'regenerate' && (
            <div className="flex gap-2">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should change?"
                className="min-w-0 flex-1 border border-pixel-line px-3 py-2 text-[13px] text-[#111] outline-none placeholder:text-[#C9C9C9] focus:border-[#111]"
              />
              <button
                type="button"
                disabled={busy || !feedback.trim()}
                onClick={() => onRegenerate(feedback.trim(), draft.id)}
                className="bg-pixel-black px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#333] disabled:opacity-40"
              >
                Regenerate
              </button>
            </div>
          )}
          {mode === null && (
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('confirm')}
                className="bg-pixel-black px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#333] disabled:opacity-40"
              >
                Confirm as team
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('regenerate')}
                className="text-[13px] text-[#111] underline underline-offset-4 hover:text-[#6B6B6B] disabled:opacity-40"
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

function BoardPanel({ notes }: { notes: WhiteboardNote[] }) {
  const grouped = useMemo(() => {
    const map = new Map<WhiteboardColumn, WhiteboardNote[]>();
    for (const column of WHITEBOARD_COLUMNS) map.set(column, []);
    for (const note of notes) (map.get(note.column) ?? map.get('ideas'))!.push(note);
    return map;
  }, [notes]);

  if (notes.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-[#9B9B9B]">
        Notes land here as the table talks.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {WHITEBOARD_COLUMNS.map((column) => {
        const columnNotes = grouped.get(column)!;
        if (columnNotes.length === 0) return null;
        const meta = COLUMN_META[column];
        return (
          <div key={column}>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6B6B6B]">
              <span className={`h-2 w-2 shrink-0 ${meta.square}`} />
              {meta.label} · {columnNotes.length}
            </p>
            <ul className="mt-2 divide-y divide-[#F0F0F0]">
              {columnNotes.map((note) => (
                <li key={note.id} className="py-2 text-sm leading-snug text-[#111]">
                  {note.text} <span className="text-[#9B9B9B]">— {note.authorName}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function WorkshopPageInner() {
  const [sessionId, setSessionId] = useState('default');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [members, setMembers] = useState<WorkshopMember[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('board');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const membersSyncedRef = useRef(false);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    setSessionId(sessionIdFromStorage());
  }, []);

  // Waits for auth rehydration; a hard load of this route mounts before the
  // persisted token is available.
  useEffect(() => {
    if (!token) return;
    fetchAgents().then(setAgents).catch(() => setAgents([]));
  }, [token]);

  const refresh = useCallback(() => {
    if (!sessionId || sessionId === 'default') return;
    fetchSessionState(sessionId)
      .then((next) => {
        setState(next);
        // Adopt the server roster once per session; after that the bench is
        // edited locally and the next message carries the change back.
        if (!membersSyncedRef.current && next.members.length > 0) {
          setMembers(next.members);
          membersSyncedRef.current = true;
        }
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
  }, [state?.messages.length, state?.speakingAgents.length]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.agentId)), [members]);
  const bench = agents.filter((agent) => !memberIds.has(agent.id));
  const speaking = new Set(state?.speakingAgents ?? []);
  const drafts = state?.workflowDrafts ?? [];
  const latestDraft = drafts.length > 0 ? drafts[drafts.length - 1] : undefined;
  const hasProposedDraft = drafts.some((d) => d.status === 'proposed');
  const notes = state?.notes ?? [];
  const firstMessageAt = state?.messages[0]?.sentAt;

  const addMember = (agent: Agent) => {
    setMembers((prev) => [
      ...prev,
      { agentId: agent.id, name: agent.name, role: agent.tags[0], description: agent.description },
    ]);
  };

  const removeMember = (agentId: string) => {
    setMembers((prev) => prev.filter((m) => m.agentId !== agentId));
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    if (members.length === 0) {
      setError('Add at least one member from the bench first.');
      return;
    }
    setError('');
    setInput('');
    try {
      const next = await sendSessionMessage(sessionId, {
        title: 'Workshop',
        userMessage: { content },
        members,
        messages: state?.messages,
        notes: state?.notes,
      });
      setState(next);
      membersSyncedRef.current = true;
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
    const fresh = `ws-${crypto.randomUUID()}`;
    window.localStorage.setItem('workshop-session-id', fresh);
    setSessionId(fresh);
    setState(null);
    setMembers([]);
    membersSyncedRef.current = false;
    setRightTab('board');
  };

  const generateDraft = async (feedback?: string, previousDraftId?: string) => {
    setError('');
    setDraftBusy(true);
    try {
      const res = await generateWorkflowDraft(sessionId, {
        title: state?.title || 'Workshop',
        members,
        notes: state?.notes,
        feedback,
        previousDraftId,
      });
      setState(res.state);
      setRightTab('draft');
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

  const draftsById = useMemo(() => new Map(drafts.map((d) => [d.id, d])), [drafts]);

  const tabs: Array<{ key: RightTab; label: string; dot?: boolean }> = [
    { key: 'board', label: 'Board' },
    { key: 'draft', label: 'Draft', dot: hasProposedDraft },
    { key: 'log', label: 'Log' },
  ];

  return (
    <div className="flex h-[calc(100vh-130px)] min-h-[540px] flex-col border border-pixel-line bg-white text-[#111]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-pixel-line px-6 py-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Workshop</h1>
          <p className="mt-0.5 text-[13px] text-[#9B9B9B]">
            Session {sessionId.slice(0, 7)} · round {state?.round ?? 0} ·{' '}
            {state?.active ? <span className="text-pixel-green">live</span> : <span>idle</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {state?.active && (
            <button
              onClick={stop}
              className="border border-pixel-line px-4 py-2 text-[13px] text-pixel-red hover:border-pixel-red"
            >
              Stop topic
            </button>
          )}
          <button
            onClick={newSession}
            className="border border-pixel-line px-4 py-2 text-[13px] text-[#111] hover:border-[#111]"
          >
            New session
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Members / bench */}
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-pixel-line">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <SideLabel>Members</SideLabel>
            <ul className="space-y-3">
              {members.map((member) => (
                <li key={member.agentId}>
                  <button
                    type="button"
                    onClick={() => removeMember(member.agentId)}
                    title="Move to the bench"
                    className="group flex w-full items-center gap-3 text-left"
                  >
                    <AvatarBox name={member.name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{member.name}</span>
                    {speaking.has(member.name) ? (
                      <span className="shrink-0 text-[12px] text-pixel-yellow">typing…</span>
                    ) : (
                      <>
                        <span className="shrink-0 text-[12px] text-pixel-green group-hover:hidden">on</span>
                        <span className="hidden shrink-0 text-[12px] text-[#9B9B9B] group-hover:inline">−</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
              {members.length === 0 && (
                <li className="text-[13px] text-[#9B9B9B]">No one at the table yet.</li>
              )}
            </ul>

            <div className="mt-7">
              <SideLabel>Bench</SideLabel>
              <ul className="space-y-3">
                {bench.map((agent) => (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => addMember(agent)}
                      title="Bring to the table"
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <AvatarBox name={agent.name} dashed />
                      <span className="min-w-0 flex-1 truncate text-sm text-[#6B6B6B]">{agent.name}</span>
                      <span className="shrink-0 text-[15px] leading-none text-[#9B9B9B]">+</span>
                    </button>
                  </li>
                ))}
                {bench.length === 0 && agents.length === 0 && (
                  <li className="text-[13px] text-[#9B9B9B]">
                    No agents yet —{' '}
                    <Link href="/upload" className="text-[#111] underline underline-offset-2">
                      hire one
                    </Link>
                    .
                  </li>
                )}
                {bench.length === 0 && agents.length > 0 && (
                  <li className="text-[13px] text-[#9B9B9B]">Everyone is at the table.</li>
                )}
              </ul>
            </div>
          </div>
          <div className="border-t border-pixel-line px-4 py-3 text-[12px] leading-relaxed text-[#9B9B9B]">
            {notes.length} notes · {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}
            <br />
            {firstMessageAt ? `Started ${clock(firstMessageAt)}` : 'Not started'}
          </div>
        </aside>

        {/* Transcript */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {(state?.messages ?? []).map((message) => {
              const draft =
                message.draftId && draftCardMessageIds.has(message.id)
                  ? draftsById.get(message.draftId)
                  : undefined;
              const isUser = message.senderId === 'user';
              return (
                <div key={message.id}>
                  <p className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        isUser ? 'border-b-2 border-pixel-yellow pb-0.5' : ''
                      }`}
                    >
                      {isUser ? 'You' : message.senderName}
                    </span>
                    <span className="font-pixel text-[11px] text-[#9B9B9B]">{clock(message.sentAt)}</span>
                  </p>
                  {draft ? (
                    <div className="mt-2">
                      <DraftCard
                        draft={draft}
                        busy={draftBusy}
                        onConfirm={confirmDraft}
                        onRegenerate={(feedback, previousDraftId) =>
                          void generateDraft(feedback, previousDraftId)
                        }
                      />
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-[#111]">
                      {message.content}
                    </p>
                  )}
                </div>
              );
            })}

            {(state?.speakingAgents ?? []).map((name) => (
              <div key={`speaking-${name}`}>
                <p className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-pixel-yellow">{name}</span>
                  <span className="font-pixel text-[11px] text-[#9B9B9B]">now</span>
                </p>
                <p className="mt-1 text-[15px] italic text-[#9B9B9B]">drafting reply…</p>
              </div>
            ))}

            {(state?.messages ?? []).length === 0 && (
              <p className="text-sm text-[#9B9B9B]">
                Bring agents to the table and send a topic to start the discussion.
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-pixel-line px-6 py-4">
            <form onSubmit={send} className="flex gap-3">
              <input
                className="min-w-0 flex-1 border border-pixel-line bg-[#FAFAFA] px-4 py-2.5 text-sm text-[#111] outline-none placeholder:text-[#9B9B9B] focus:border-[#111] focus:bg-white"
                placeholder="Say something to the table…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="bg-pixel-black px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#333]">
                Send
              </button>
            </form>
            {error && <p className="mt-2 text-[12px] text-pixel-red">{error}</p>}
          </div>
        </section>

        {/* Board / Draft / Log */}
        <aside className="flex w-[312px] shrink-0 flex-col border-l border-pixel-line">
          <div className="flex gap-6 border-b border-pixel-line px-5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setRightTab(tab.key)}
                className={`flex items-center gap-1.5 border-b-2 py-3 text-sm ${
                  rightTab === tab.key
                    ? 'border-pixel-black font-semibold text-[#111]'
                    : 'border-transparent text-[#9B9B9B] hover:text-[#111]'
                }`}
              >
                {tab.label}
                {tab.dot && <span className="h-1.5 w-1.5 bg-pixel-yellow" />}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {rightTab === 'board' && <BoardPanel notes={notes} />}
            {rightTab === 'draft' &&
              (latestDraft ? (
                <DraftCard
                  draft={latestDraft}
                  busy={draftBusy}
                  onConfirm={confirmDraft}
                  onRegenerate={(feedback, previousDraftId) =>
                    void generateDraft(feedback, previousDraftId)
                  }
                />
              ) : (
                <p className="py-6 text-center text-[13px] text-[#9B9B9B]">
                  No draft yet — generate one from the board.
                </p>
              ))}
            {rightTab === 'log' && (
              <ul className="space-y-2">
                {(state?.runLogs ?? [])
                  .slice()
                  .reverse()
                  .map((log) => (
                    <li key={log.id} className="flex gap-2 text-[12px] leading-snug">
                      <span
                        className={
                          log.status === 'error'
                            ? 'shrink-0 text-pixel-red'
                            : log.status === 'running'
                              ? 'shrink-0 text-pixel-yellow'
                              : 'shrink-0 text-pixel-green'
                        }
                      >
                        {log.status}
                      </span>
                      <span className="text-[#6B6B6B]">{log.message}</span>
                    </li>
                  ))}
                {(state?.runLogs ?? []).length === 0 && (
                  <li className="py-6 text-center text-[13px] text-[#9B9B9B]">Nothing logged yet.</li>
                )}
              </ul>
            )}
          </div>
          <div className="border-t border-pixel-line p-4">
            <button
              type="button"
              disabled={draftBusy || notes.length === 0}
              onClick={() => void generateDraft()}
              title={notes.length === 0 ? 'The board is empty' : 'Turn the board into a workflow draft'}
              className="w-full border border-pixel-black py-2.5 text-sm font-semibold text-[#111] hover:bg-pixel-black hover:text-white disabled:border-pixel-line disabled:text-[#9B9B9B] disabled:hover:bg-transparent"
            >
              {draftBusy ? 'Generating…' : 'Generate workflow →'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function WorkshopPage() {
  return (
    <RequireAuth>
      <WorkshopPageInner />
    </RequireAuth>
  );
}
