'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { PixelButton } from '@/components/ui/PixelButton';
import type { Agent } from '@/lib/agents';
import type { Goal } from '@/lib/goals';
import {
  CLIENT_TRANSITIONS,
  STATUS_META,
  addComment,
  deleteIssue,
  fetchComments,
  fetchIssue,
  moveIssue,
  updateIssue,
  type Issue,
  type IssueComment,
  type IssueStatus,
} from '@/lib/issues';

interface IssueDrawerProps {
  issueId: string;
  projectName?: string;
  agents: Agent[];
  goals: Goal[];
  onClose: () => void;
  /** Fired after any mutation so the board behind can refresh. */
  onChanged: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Encodes the dual-principal slot as a single select value. */
function principalValue(agentId: string | null, userId: string | null): string {
  if (agentId) return `agent:${agentId}`;
  if (userId) return `user:${userId}`;
  return '';
}

const SECTION = 'mt-5 border-t border-pixel-line pt-3';
const LABEL = 'w-20 shrink-0 font-pixel text-xs uppercase tracking-wide text-pixel-gray';
const SELECT =
  'min-w-0 flex-1 border border-pixel-line bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-black focus:border-pixel-black focus:outline-none';

export function IssueDrawer({
  issueId,
  projectName,
  agents,
  goals,
  onClose,
  onChanged,
}: IssueDrawerProps) {
  const me = useAuthStore((s) => s.user);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ issue: fetched }, { comments: timeline }] = await Promise.all([
      fetchIssue(issueId),
      fetchComments(issueId),
    ]);
    setIssue(fetched);
    setTitle(fetched.title);
    setDescription(fetched.description);
    setComments(timeline);
  }, [issueId]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      setError('');
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed');
      }
      await load().catch(() => undefined);
      onChanged();
    },
    [load, onChanged]
  );

  if (!issue) {
    return (
      <div className="fixed inset-0 z-[60]" onClick={onClose}>
        <div className="absolute inset-0 bg-pixel-black/30" />
      </div>
    );
  }

  const meta = STATUS_META[issue.status];
  const legalMoves = CLIENT_TRANSITIONS[issue.status].filter((s) => s !== 'cancelled');
  const canCancel = CLIENT_TRANSITIONS[issue.status].includes('cancelled');
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? 'agent';

  const saveTitle = () => {
    const next = title.trim();
    if (!next || next === issue.title) {
      setTitle(issue.title);
      return;
    }
    void mutate(() => updateIssue(issue.id, { title: next }));
  };

  const saveDescription = () => {
    if (description === issue.description) return;
    void mutate(() => updateIssue(issue.id, { description }));
  };

  const changeStatus = (status: IssueStatus) => {
    if (status !== issue.status) void mutate(() => moveIssue(issue.id, { status }));
  };

  const changePrincipal = (slot: 'assignee' | 'reviewer', value: string) => {
    const patch =
      value === ''
        ? null
        : value.startsWith('agent:')
          ? { agentId: value.slice(6) }
          : { userId: value.slice(5) };
    void mutate(() => updateIssue(issue.id, { [slot]: patch }));
  };

  const postComment = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    void mutate(() => addComment(issue.id, body));
  };

  const cancelIssue = () => {
    if (window.confirm(`Cancel #${issue.issueNumber}? This cannot be undone.`)) {
      void mutate(() => moveIssue(issue.id, { status: 'cancelled' }));
    }
  };

  const removeIssue = async () => {
    if (!window.confirm(`Delete #${issue.issueNumber} and its comments permanently?`)) return;
    setError('');
    try {
      await deleteIssue(issue.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-pixel-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full flex-col overflow-y-auto border-l border-pixel-black bg-pixel-white p-4 sm:w-[480px]">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-sm text-pixel-gray">#{issue.issueNumber}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="border border-pixel-line px-2 py-0.5 font-pixel text-xs text-pixel-black hover:border-pixel-black"
          >
            X
          </button>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="mt-2 w-full border border-transparent bg-transparent font-pixel text-lg text-pixel-black focus:border-pixel-line focus:outline-none"
        />

        <div className="mt-3 flex items-center gap-2">
          <span className={`h-2 w-2 ${meta.swatch}`} aria-hidden />
          <select
            value={issue.status}
            onChange={(e) => changeStatus(e.target.value as IssueStatus)}
            disabled={legalMoves.length === 0}
            className={SELECT}
          >
            <option value={issue.status}>{meta.label}</option>
            {legalMoves.map((s) => (
              <option key={s} value={s}>
                {`-> ${STATUS_META[s].label}`}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="mt-2 border border-pixel-red bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-red">
            {error}
          </p>
        )}

        <div className={SECTION}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className={LABEL}>Project</span>
              <span className="font-pixel text-xs text-pixel-black">{projectName ?? '-'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={LABEL}>Goal</span>
              <select
                value={issue.goalId ?? ''}
                onChange={(e) =>
                  void mutate(() => updateIssue(issue.id, { goalId: e.target.value || null }))
                }
                className={SELECT}
              >
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className={LABEL}>Assignee</span>
              <select
                value={principalValue(issue.assigneeAgentId, issue.assigneeUserId)}
                onChange={(e) => changePrincipal('assignee', e.target.value)}
                className={SELECT}
              >
                <option value="">None</option>
                {me && <option value={`user:${me.id}`}>Me ({me.username})</option>}
                {agents.map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.name} (agent)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className={LABEL}>Reviewer</span>
              <select
                value={principalValue(issue.reviewerAgentId, issue.reviewerUserId)}
                onChange={(e) => changePrincipal('reviewer', e.target.value)}
                className={SELECT}
              >
                <option value="">None</option>
                {me && <option value={`user:${me.id}`}>Me ({me.username})</option>}
                {agents.map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.name} (agent)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className={SECTION}>
          <p className="mb-1 font-pixel text-xs uppercase tracking-wide text-pixel-gray">
            Description
          </p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={4}
            placeholder="Add a description..."
            className="w-full border border-pixel-line bg-pixel-white p-2 font-pixel text-xs text-pixel-black focus:border-pixel-black focus:outline-none"
          />
        </div>

        <div className={SECTION}>
          <p className="mb-2 font-pixel text-xs uppercase tracking-wide text-pixel-gray">
            Activity
          </p>
          <div className="flex flex-col gap-3">
            {comments.map((c) => (
              <div key={c.id}>
                <div className="flex items-center gap-2">
                  {c.authorType === 'agent' ? (
                    <span className="h-2 w-2 bg-pixel-yellow" aria-hidden />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-pixel-black" aria-hidden />
                  )}
                  <span className="font-pixel text-xs text-pixel-black">
                    {c.authorType === 'agent' ? agentName(c.authorAgentId) : 'you'}
                  </span>
                  <span className="font-pixel text-[10px] text-pixel-gray">
                    {formatTime(c.createdAt)}
                  </span>
                </div>
                <p className="ml-4 mt-0.5 whitespace-pre-wrap break-words text-xs text-pixel-black">
                  {c.body}
                </p>
              </div>
            ))}
            {comments.length === 0 && (
              <p className="font-pixel text-xs text-pixel-gray">No activity yet</p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Write a comment..."
              className="min-w-0 flex-1 border border-pixel-line bg-pixel-white p-2 font-pixel text-xs text-pixel-black focus:border-pixel-black focus:outline-none"
            />
            <PixelButton size="sm" onClick={postComment} disabled={!draft.trim()}>
              Comment
            </PixelButton>
          </div>
        </div>

        <div className={`${SECTION} mb-2`}>
          <p className="mb-2 font-pixel text-xs uppercase tracking-wide text-pixel-red">Danger</p>
          <div className="flex gap-2">
            {canCancel && (
              <PixelButton size="sm" variant="secondary" onClick={cancelIssue}>
                Cancel issue
              </PixelButton>
            )}
            <PixelButton size="sm" variant="danger" onClick={() => void removeIssue()}>
              Delete
            </PixelButton>
          </div>
        </div>
      </aside>
    </div>
  );
}
