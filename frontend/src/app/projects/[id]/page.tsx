'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { FilePreviewModal, FilesPanel } from '@/components/projects/FilesPanel';
import {
  DeliverablesPanel,
  TaskBoard,
  type TrackedExecution,
} from '@/components/projects/WorkflowTaskBoard';
import { useWorkflowEvents } from '@/hooks/useWorkflowEvents';
import {
  fetchDeliverables,
  fetchProject,
  openProject,
  reviewDeliverable,
  updateProject,
  type Deliverable,
  type ProjectView,
} from '@/lib/projects';
import { fetchTeams, type TeamView } from '@/lib/teams';
import {
  cancelExecution,
  executeWorkflow,
  fetchExecution,
  fetchExecutionEvents,
  fetchExecutions,
  TERMINAL_EXECUTION_STATUSES,
  type ExecutionDetail,
  type WorkflowEventDelta,
} from '@/lib/workflows';

/** Appended to every submitted task; agents run unattended. */
const SAFETY_NOTICE = [
  '',
  '--- Workspace safety boundary ---',
  "Work only inside this project's shared workspace directory.",
  'Do not read or modify parent directories, absolute paths outside the workspace, or system locations.',
  'Do not run destructive or system-level operations (bulk deletion, formatting, permission changes).',
].join('\n');

const POLL_CONNECTED_MS = 5000;
const POLL_DISCONNECTED_MS = 1500;
const MAX_FEED_ITEMS = 200;

interface FeedItem {
  key: string;
  type: string;
  message: string;
  at: string;
}

function toTracked(detail: ExecutionDetail): TrackedExecution {
  const labels = new Map(detail.workflow.nodes.map((n) => [n.id, n.label]));
  const nodeStates: TrackedExecution['nodeStates'] = {};
  for (const state of detail.nodeStates) {
    nodeStates[state.nodeId] = {
      label: labels.get(state.nodeId) ?? state.nodeId,
      status: state.status,
      runCount: state.runCount,
      error: state.error,
    };
  }
  return {
    id: detail.id,
    status: detail.status,
    task: detail.task,
    workflow: detail.workflow,
    nodeStates,
    finalOutput: detail.finalOutput,
    error: detail.error,
  };
}

function BindingsDialog({
  project,
  teams,
  onClose,
  onSaved,
}: {
  project: ProjectView;
  teams: TeamView[];
  onClose: () => void;
  onSaved: (project: ProjectView) => void;
}) {
  const [teamIds, setTeamIds] = useState<string[]>(project.teamIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateProject(project.id, { teamIds }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bindings');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pixel-black/70 p-4">
      <div className="w-full max-w-md border border-pixel-black bg-pixel-white shadow-pixel p-5">
        <h2 className="text-lg font-semibold">Bound teams</h2>
        <p className="mt-1 text-xs text-pixel-black/50">
          Teams that can run workflows inside this project.
        </p>
        <div className="mt-4 space-y-2">
          {teams.map((team) => (
            <label key={team.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={teamIds.includes(team.id)}
                onChange={(e) =>
                  setTeamIds(
                    e.target.checked
                      ? [...teamIds, team.id]
                      : teamIds.filter((id) => id !== team.id)
                  )
                }
              />
              {team.name}
            </label>
          ))}
          {teams.length === 0 && <p className="text-xs text-pixel-black/50">Create a team first.</p>}
        </div>
        {error && <p className="mt-2 text-xs text-pixel-red">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border border-pixel-black bg-pixel-white font-pixel text-pixel-black shadow-pixel-sm px-4 py-2 text-sm text-pixel-black/70"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-pixel-red px-4 py-2 text-sm font-medium text-pixel-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectWorkspaceInner({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [activeTeamId, setActiveTeamId] = useState('');
  const [task, setTask] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [execution, setExecution] = useState<TrackedExecution | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [reviewing, setReviewing] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'board' | 'deliverables'>('board');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [showBindings, setShowBindings] = useState(false);
  const [filesRefresh, setFilesRefresh] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const executionRef = useRef<TrackedExecution | null>(null);
  executionRef.current = execution;
  const seenEventsRef = useRef<Set<string>>(new Set());

  const boundTeams = useMemo(
    () => teams.filter((team) => project?.teamIds.includes(team.id)),
    [teams, project]
  );

  const appendFeed = useCallback((items: FeedItem[]) => {
    setFeed((current) => {
      const fresh = items.filter((item) => !seenEventsRef.current.has(item.key));
      for (const item of fresh) seenEventsRef.current.add(item.key);
      if (fresh.length === 0) return current;
      return [...current, ...fresh].slice(-MAX_FEED_ITEMS);
    });
  }, []);

  const refreshDeliverables = useCallback(() => {
    fetchDeliverables(projectId).then(setDeliverables).catch(() => {});
  }, [projectId]);

  const adoptExecution = useCallback(
    async (executionId: string, { hydrateFeed }: { hydrateFeed: boolean }) => {
      try {
        const detail = await fetchExecution(executionId);
        setExecution(toTracked(detail));
        if (hydrateFeed) {
          const events = await fetchExecutionEvents(executionId);
          appendFeed(
            events.map((e) => ({
              key: `${executionId}:${e.seq}`,
              type: e.type,
              message: e.message,
              at: e.createdAt,
            }))
          );
        }
      } catch {
        // Execution may have been deleted; ignore.
      }
    },
    [appendFeed]
  );

  // Initial load: touch recency, load project/teams/deliverables/latest run.
  useEffect(() => {
    openProject(projectId).then(setProject).catch(() => {});
    fetchTeams().then(setTeams).catch(() => setTeams([]));
    refreshDeliverables();
    fetchExecutions({ projectId })
      .then((executions) => {
        if (executions[0]) void adoptExecution(executions[0].id, { hydrateFeed: true });
      })
      .catch(() => {});
  }, [projectId, refreshDeliverables, adoptExecution]);

  useEffect(() => {
    if (!activeTeamId && boundTeams[0]) setActiveTeamId(boundTeams[0].id);
    if (activeTeamId && !boundTeams.some((t) => t.id === activeTeamId)) {
      setActiveTeamId(boundTeams[0]?.id ?? '');
    }
  }, [boundTeams, activeTeamId]);

  const onDelta = useCallback(
    (delta: WorkflowEventDelta) => {
      if (delta.projectId !== projectId) return;
      const tracked = executionRef.current;
      if (!tracked || tracked.id !== delta.executionId) {
        void adoptExecution(delta.executionId, { hydrateFeed: false });
      } else {
        setExecution((current) => {
          if (!current || current.id !== delta.executionId) return current;
          const nodeStates = { ...current.nodeStates };
          for (const node of delta.nodeStates) {
            nodeStates[node.nodeId] = {
              label: node.label,
              status: node.status,
              runCount: node.runCount,
              error: node.error ?? null,
            };
          }
          return {
            ...current,
            status: delta.status,
            nodeStates,
            finalOutput: delta.finalOutput ?? current.finalOutput,
            error: delta.error ?? current.error,
          };
        });
      }
      appendFeed([
        {
          key: `${delta.executionId}:${delta.event.seq}`,
          type: delta.event.type,
          message: delta.event.message,
          at: new Date().toISOString(),
        },
      ]);
      if (delta.event.type === 'deliverable_created') refreshDeliverables();
      if (delta.event.type === 'execution_completed' || delta.event.type === 'execution_failed') {
        setFilesRefresh((n) => n + 1);
      }
    },
    [projectId, adoptExecution, appendFeed, refreshDeliverables]
  );

  const { connected } = useWorkflowEvents({ projectId, onEvent: onDelta });

  // Polling fallback: REST keeps the board honest when the socket is down.
  const running = execution ? !TERMINAL_EXECUTION_STATUSES.includes(execution.status) : false;
  useEffect(() => {
    if (!running || !execution) return;
    const interval = setInterval(
      () => {
        if (connected) return; // WS drives updates while healthy
        fetchExecution(execution.id)
          .then((detail) => {
            setExecution(toTracked(detail));
            if (TERMINAL_EXECUTION_STATUSES.includes(detail.status)) {
              refreshDeliverables();
              setFilesRefresh((n) => n + 1);
            }
          })
          .catch(() => {});
      },
      connected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS
    );
    return () => clearInterval(interval);
  }, [running, connected, execution?.id, refreshDeliverables]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const trimmed = task.trim();
    if (!trimmed || submitting) return;
    if (!activeTeamId) {
      setNotice('Bind a team to this project before submitting a task.');
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const detail = await executeWorkflow({
        teamId: activeTeamId,
        task: trimmed + SAFETY_NOTICE,
        projectId,
      });
      setTask('');
      setExecution(toTracked(detail));
      const teamName = boundTeams.find((t) => t.id === activeTeamId)?.name ?? 'team';
      appendFeed([
        {
          key: `local-${detail.id}`,
          type: 'submitted',
          message: `Task submitted to ${teamName} (execution ${detail.id.slice(0, 8)})`,
          at: new Date().toISOString(),
        },
      ]);
      setTab('board');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to start the workflow');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!execution) return;
    try {
      const detail = await cancelExecution(execution.id);
      setExecution(toTracked(detail));
    } catch {
      // Already terminal.
    }
  };

  const review = async (deliverableId: string, status: 'accepted' | 'revision') => {
    setReviewing((current) => new Set(current).add(deliverableId));
    try {
      const updated = await reviewDeliverable(projectId, deliverableId, status);
      setDeliverables((current) =>
        current.map((d) => (d.id === updated.id ? updated : d))
      );
    } catch {
      // Keep state; the user can retry.
    } finally {
      setReviewing((current) => {
        const next = new Set(current);
        next.delete(deliverableId);
        return next;
      });
    }
  };

  const pendingCount = deliverables.filter((d) => d.status === 'pending').length;

  if (!project) {
    return <p className="text-sm text-pixel-black/50">Loading project…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-pixel-black/50">
            {project.description || 'No description yet'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <select
            value={activeTeamId}
            onChange={(e) => setActiveTeamId(e.target.value)}
            className="border border-pixel-black bg-pixel-white font-pixel text-pixel-black px-2 py-1.5 text-sm outline-none focus:border-pixel-blue"
          >
            {boundTeams.length === 0 && <option value="">No team bound</option>}
            {boundTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowBindings(true)}
            className="border border-pixel-black bg-pixel-white font-pixel text-pixel-black shadow-pixel-sm px-3 py-1.5 text-sm text-pixel-black/70 hover:bg-pixel-yellow/40"
          >
            Manage bindings
          </button>
          <span
            className={`border px-2 py-1 text-xs ${
              connected ? 'border-emerald-400/40 text-pixel-green' : 'border-pixel-black text-pixel-black/50'
            }`}
            title={connected ? 'Live updates connected' : 'Live updates offline; polling instead'}
          >
            {connected ? 'live' : 'polling'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_300px]">
        <div className="h-[70vh] overflow-hidden border border-pixel-black bg-pixel-white shadow-pixel">
          <FilesPanel
            projectId={projectId}
            projectName={project.name}
            refreshToken={filesRefresh}
            onPreview={setPreviewPath}
            onFileRemoved={(path) => {
              if (previewPath === path) setPreviewPath(null);
            }}
          />
        </div>

        <div className="flex h-[70vh] flex-col border border-pixel-black bg-pixel-white shadow-pixel">
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
            {feed.length === 0 && (
              <p className="text-xs text-pixel-black/50">
                Activity from workflow runs will appear here.
              </p>
            )}
            {feed.map((item) => (
              <p key={item.key} className="text-xs">
                <span
                  className={
                    item.type.includes('failed')
                      ? 'text-pixel-red'
                      : item.type === 'execution_completed'
                        ? 'text-pixel-green'
                        : 'text-pixel-black/60'
                  }
                >
                  {item.message}
                </span>
              </p>
            ))}
          </div>
          <div className="border-t border-pixel-black p-3">
            {notice && <p className="mb-2 text-xs text-pixel-black">{notice}</p>}
            <textarea
              rows={3}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe the task for the team. Agents work inside this project's workspace only."
              className="w-full resize-none border border-pixel-black bg-pixel-white font-pixel text-pixel-black px-3 py-2 text-sm outline-none focus:border-pixel-blue"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-pixel-black/40">
                Agents are sandboxed to this workspace; destructive operations are out of bounds.
              </p>
              <div className="flex gap-2">
                {running && (
                  <button
                    onClick={cancel}
                    className="border border-red-400/50 px-3 py-1.5 text-sm text-pixel-red"
                  >
                    Cancel run
                  </button>
                )}
                <button
                  onClick={submit}
                  disabled={submitting || !task.trim() || running}
                  className="border border-pixel-black bg-pixel-red px-4 py-1.5 font-pixel text-sm font-bold text-pixel-white shadow-pixel-sm hover:bg-pixel-orange disabled:opacity-50"
                >
                  {running ? 'Running…' : submitting ? 'Submitting…' : 'Submit task'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex h-[70vh] flex-col overflow-hidden border border-pixel-black bg-pixel-white shadow-pixel">
          <div className="flex border-b border-pixel-black text-xs">
            <button
              onClick={() => setTab('board')}
              className={`flex-1 px-3 py-2 ${tab === 'board' ? 'text-pixel-black' : 'text-pixel-black/50 hover:text-pixel-black'}`}
            >
              Task board
            </button>
            <button
              onClick={() => setTab('deliverables')}
              className={`flex-1 px-3 py-2 ${tab === 'deliverables' ? 'text-pixel-black' : 'text-pixel-black/50 hover:text-pixel-black'}`}
            >
              Deliverables{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'board' ? (
              <TaskBoard execution={execution} />
            ) : (
              <DeliverablesPanel
                deliverables={deliverables}
                reviewing={reviewing}
                onReview={review}
                onOpenFile={(path) => setPreviewPath(path)}
              />
            )}
          </div>
        </div>
      </div>

      {previewPath && (
        <FilePreviewModal
          projectId={projectId}
          path={previewPath}
          onClose={() => setPreviewPath(null)}
        />
      )}
      {showBindings && (
        <BindingsDialog
          project={project}
          teams={teams}
          onClose={() => setShowBindings(false)}
          onSaved={(updated) => {
            setProject(updated);
            setShowBindings(false);
          }}
        />
      )}
    </div>
  );
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <ProjectWorkspaceInner projectId={String(params.id)} />
    </RequireAuth>
  );
}
