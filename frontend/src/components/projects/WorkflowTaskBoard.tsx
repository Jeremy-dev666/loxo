'use client';

import type { Deliverable } from '@/lib/projects';
import type { ExecutionStatus, NodeStatus } from '@/lib/workflows';
import type { WorkflowDsl } from '@/lib/teams';

export interface TrackedNodeState {
  label: string;
  status: NodeStatus;
  runCount: number;
  error?: string | null;
}

export interface TrackedExecution {
  id: string;
  status: ExecutionStatus;
  task: string;
  workflow: WorkflowDsl;
  nodeStates: Record<string, TrackedNodeState>;
  finalOutput?: string | null;
  error?: string | null;
}

const NODE_BADGES: Record<NodeStatus, { label: string; className: string }> = {
  pending: { label: 'Waiting', className: 'text-slate-500 border-slate-700' },
  ready: { label: 'Ready', className: 'text-amber-200 border-amber-300/40' },
  running: { label: 'Running', className: 'text-amber-400 border-amber-400/60 animate-pulse' },
  succeeded: { label: 'Done', className: 'text-emerald-400 border-emerald-400/50' },
  failed: { label: 'Failed', className: 'text-red-400 border-red-400/60' },
  skipped: { label: 'Skipped', className: 'text-slate-600 border-slate-800' },
};

const EXECUTION_BADGES: Record<ExecutionStatus, string> = {
  queued: 'text-slate-400 border-slate-600',
  running: 'text-amber-400 border-amber-400/60',
  succeeded: 'text-emerald-400 border-emerald-400/50',
  failed: 'text-red-400 border-red-400/60',
  cancelled: 'text-slate-400 border-slate-600',
  interrupted: 'text-orange-400 border-orange-400/50',
};

export function TaskBoard({ execution }: { execution: TrackedExecution | null }) {
  if (!execution) {
    return (
      <p className="p-3 text-xs text-slate-500">
        No execution yet. Submit a task to see agents work here.
      </p>
    );
  }

  const agentNodes = execution.workflow.nodes.filter((n) => n.type === 'agent');
  const settled = agentNodes.filter((n) => {
    const status = execution.nodeStates[n.id]?.status;
    return status === 'succeeded' || status === 'skipped';
  }).length;
  const percent = agentNodes.length > 0 ? Math.round((settled / agentNodes.length) * 100) : 0;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Progress {percent}%</span>
        <span
          className={`rounded border px-2 py-0.5 text-xs ${EXECUTION_BADGES[execution.status]}`}
        >
          {execution.status}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>

      <div className="space-y-2">
        {agentNodes.map((node) => {
          const state = execution.nodeStates[node.id];
          const badge = NODE_BADGES[state?.status ?? 'pending'];
          return (
            <div key={node.id} className="rounded border border-slate-800 bg-surface p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{state?.label ?? node.label}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {node.kind ?? 'worker'}
                {node.role ? ` · ${node.role}` : ''}
                {state && state.runCount > 1 ? ` · run ${state.runCount}` : ''}
              </p>
              {state?.error && <p className="mt-1 text-[11px] text-red-400">{state.error}</p>}
            </div>
          );
        })}
      </div>

      {execution.error && <p className="text-xs text-red-400">{execution.error}</p>}
      {execution.status === 'succeeded' && execution.finalOutput && (
        <div className="rounded border border-emerald-400/30 bg-surface p-2">
          <p className="mb-1 text-[11px] font-medium text-emerald-400">Final output</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-300">
            {execution.finalOutput}
          </p>
        </div>
      )}
    </div>
  );
}

const DELIVERABLE_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending review', className: 'text-amber-300 border-amber-300/50' },
  accepted: { label: 'Accepted', className: 'text-emerald-400 border-emerald-400/50' },
  revision: { label: 'Needs revision', className: 'text-red-400 border-red-400/60' },
};

interface DeliverablesPanelProps {
  deliverables: Deliverable[];
  reviewing: Set<string>;
  onReview: (id: string, status: 'accepted' | 'revision') => void;
  onOpenFile: (path: string) => void;
}

export function DeliverablesPanel({
  deliverables,
  reviewing,
  onReview,
  onOpenFile,
}: DeliverablesPanelProps) {
  const visible = deliverables.filter((d) => d.status !== 'superseded');
  if (visible.length === 0) {
    return (
      <p className="p-3 text-xs text-slate-500">
        Files produced by project workflows will appear here for review.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-3">
      {visible.map((deliverable) => {
        const badge = DELIVERABLE_BADGES[deliverable.status] ?? DELIVERABLE_BADGES.pending!;
        const busy = reviewing.has(deliverable.id);
        return (
          <div key={deliverable.id} className="rounded border border-slate-800 bg-surface p-2">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => onOpenFile(deliverable.filePath)}
                className="truncate text-left text-sm hover:text-accent"
                title={deliverable.filePath}
              >
                {deliverable.filePath.split('/').pop()}
              </button>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{deliverable.filePath}</p>
            {deliverable.status === 'pending' && (
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => onReview(deliverable.id, 'accepted')}
                  className="rounded border border-emerald-400/50 px-2 py-0.5 text-[11px] text-emerald-400 disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  disabled={busy}
                  onClick={() => onReview(deliverable.id, 'revision')}
                  className="rounded border border-red-400/50 px-2 py-0.5 text-[11px] text-red-400 disabled:opacity-50"
                >
                  Request changes
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
