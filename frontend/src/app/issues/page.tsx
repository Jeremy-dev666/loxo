'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { IssueCard } from '@/components/issues/IssueCard';
import { ApiError } from '@/lib/api';
import {
  CLIENT_TRANSITIONS,
  STATUS_META,
  fetchBoard,
  moveIssue,
  type Board,
  type Issue,
  type IssueStatus,
} from '@/lib/issues';
import { fetchProjects, type ProjectView } from '@/lib/projects';

/** Columns rendered on the board; blocked cards ride inside In Progress. */
const BOARD_COLUMNS: IssueStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

const EMPTY_BOARD: Board = {
  backlog: [],
  todo: [],
  in_progress: [],
  in_review: [],
  blocked: [],
  done: [],
  cancelled: [],
};

/** Cards a column displays: In Progress interleaves its blocked issues. */
function columnCards(board: Board, status: IssueStatus): Issue[] {
  if (status !== 'in_progress') return board[status];
  return [...board.in_progress, ...board.blocked].sort((a, b) => a.boardOrder - b.boardOrder);
}

/** Midpoint ordering: land between the new neighbours without renumbering. */
function orderAt(cards: Issue[], index: number, draggedId: string): number {
  const rest = cards.filter((c) => c.id !== draggedId);
  const prev = rest[index - 1]?.boardOrder;
  const next = rest[index]?.boardOrder;
  if (prev === undefined && next === undefined) return 1;
  if (prev === undefined) return next! / 2;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

function BoardPage() {
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [dragSource, setDragSource] = useState<IssueStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { board: next } = await fetchBoard(projectFilter || undefined);
    setBoard(next);
  }, [projectFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchBoard(projectFilter || undefined), fetchProjects()])
      .then(([boardRes, projectsRes]) => {
        if (cancelled) return;
        setBoard(boardRes.board);
        setProjects(projectsRes);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectFilter]);

  const legalTargets = useMemo(() => {
    if (!dragSource) return null;
    return new Set<IssueStatus>([dragSource, ...CLIENT_TRANSITIONS[dragSource]]);
  }, [dragSource]);

  const applyMove = useCallback(
    async (issue: Issue, status: IssueStatus, boardOrder?: number) => {
      setError('');
      try {
        await moveIssue(issue.id, { status, ...(boardOrder !== undefined ? { boardOrder } : {}) });
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === 'invalid_transition'
            ? `#${issue.issueNumber}: ${STATUS_META[issue.status].label} -> ${STATUS_META[status].label} is not allowed`
            : err instanceof Error
              ? err.message
              : 'Move failed'
        );
      }
      await refresh();
    },
    [refresh]
  );

  const onDragEnd = useCallback(
    (result: DropResult) => {
      setDragSource(null);
      const { source, destination, draggableId } = result;
      if (!destination) return;
      const from = source.droppableId as IssueStatus;
      const to = destination.droppableId as IssueStatus;
      const cards = columnCards(board, from);
      const dragged = cards.find((c) => c.id === draggableId);
      if (!dragged) return;
      if (from === to && source.index === destination.index) return;

      const targetOrder = orderAt(columnCards(board, to), destination.index, draggableId);
      // Same-column drop for a blocked card means "unblock" (blocked cards
      // live inside In Progress); everything else is a plain move.
      const targetStatus = to === 'in_progress' && dragged.status === 'blocked' ? 'in_progress' : to;
      if (dragged.status === targetStatus && from === to) {
        void applyMove(dragged, dragged.status, targetOrder);
        return;
      }
      void applyMove(dragged, targetStatus, targetOrder);
    },
    [board, applyMove]
  );

  const toggleBlocked = useCallback(
    (issue: Issue) => {
      void applyMove(issue, issue.status === 'blocked' ? 'in_progress' : 'blocked');
    },
    [applyMove]
  );

  const renderColumn = (status: IssueStatus, cards: Issue[], options?: { rail?: boolean }) => {
    const meta = STATUS_META[status];
    const dimmed = legalTargets !== null && !legalTargets.has(status);
    return (
      <div
        key={status}
        className={`flex min-h-0 flex-col transition-opacity duration-150 ${
          options?.rail ? 'w-56 shrink-0' : 'w-64 shrink-0'
        } ${dimmed ? 'opacity-35' : ''}`}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className={`h-2 w-2 ${meta.swatch}`} aria-hidden />
          <span className="font-pixel text-xs uppercase tracking-wide text-pixel-black">
            {meta.label}
          </span>
          <span className="font-pixel text-xs text-pixel-gray">{cards.length}</span>
        </div>
        <Droppable droppableId={status} isDropDisabled={dimmed}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`flex min-h-[120px] flex-1 flex-col gap-2 border p-2 ${
                snapshot.isDraggingOver
                  ? 'border-pixel-black bg-pixel-cream'
                  : 'border-pixel-line bg-pixel-cream/40'
              }`}
            >
              {cards.map((issue, index) => (
                <Draggable
                  key={issue.id}
                  draggableId={issue.id}
                  index={index}
                  isDragDisabled={issue.status === 'done' || issue.status === 'cancelled'}
                >
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                    >
                      <IssueCard
                        issue={issue}
                        dragging={dragSnapshot.isDragging}
                        onToggleBlocked={
                          issue.status === 'in_progress' || issue.status === 'blocked'
                            ? toggleBlocked
                            : undefined
                        }
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              {cards.length === 0 && (
                <p className="m-auto font-pixel text-xs text-pixel-gray">No issues</p>
              )}
            </div>
          )}
        </Droppable>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-pixel text-xl text-pixel-black">Issues</h1>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="border border-pixel-line bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-black focus:border-pixel-black focus:outline-none"
        >
          <option value="">All projects</option>
          {projects
            .filter((p) => p.kind === 'inbox')
            .map((p) => (
              <option key={p.id} value={p.id}>
                Inbox (unfiled)
              </option>
            ))}
          <option disabled>────────</option>
          {projects
            .filter((p) => p.kind !== 'inbox')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        {error && (
          <span className="border border-pixel-red bg-pixel-white px-2 py-1 font-pixel text-xs text-pixel-red">
            {error}
          </span>
        )}
      </div>

      {loading ? (
        <p className="font-pixel text-sm text-pixel-gray">Loading board...</p>
      ) : (
        <DragDropContext
          onDragStart={(start) => setDragSource(start.source.droppableId as IssueStatus)}
          onDragEnd={onDragEnd}
        >
          <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
            {renderColumn('backlog', board.backlog, { rail: true })}
            <span className="w-px shrink-0 self-stretch bg-pixel-line" aria-hidden />
            {BOARD_COLUMNS.map((status) => renderColumn(status, columnCards(board, status)))}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}

export default function IssuesPage() {
  return (
    <RequireAuth>
      <BoardPage />
    </RequireAuth>
  );
}
