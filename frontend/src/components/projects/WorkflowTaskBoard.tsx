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
  pending: { label: 'Waiting', className: 'text-pixel-black/50 border-pixel-black' },
  ready: { label: 'Ready', className: 'text-pixel-black border-pixel-yellow' },
  running: { label: 'Running', className: 'text-pixel-black border-pixel-yellow animate-pulse' },
  succeeded: { label: 'Done', className: 'text-pixel-green border-pixel-green' },
  failed: { label: 'Failed', className: 'text-pixel-red border-pixel-red' },
  skipped: { label: 'Skipped', className: 'text-pixel-black/40 border-pixel-black' },
};

const EXECUTION_BADGES: Record<ExecutionStatus, string> = {
  queued: 'text-pixel-black/60 border-pixel-gray',
  running: 'text-pixel-black border-pixel-yellow',
  succeeded: 'text-pixel-green border-pixel-green',
  failed: 'text-pixel-red border-pixel-red',
  cancelled: 'text-pixel-black/60 border-pixel-gray',
  interrupted: 'text-orange-400 border-orange-400/50',
};

export function TaskBoard({ execution }: { execution: TrackedExecution | null }) {
  if (!execution) {
    return (
      <p className="p-3 text-xs text-pixel-black/50">
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
        <span className="text-xs text-pixel-black/60">Progress {percent}%</span>
        <span
          className={`border px-2 py-0.5 text-xs ${EXECUTION_BADGES[execution.status]}`}
        >
          {execution.status}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden bg-pixel-cream">
        <div className="h-full bg-pixel-yellow transition-all" style={{ width: `${percent}%` }} />
      </div>

      <div className="space-y-2">
        {agentNodes.map((node) => {
          const state = execution.nodeStates[node.id];
          const badge = NODE_BADGES[state?.status ?? 'pending'];
          return (
            <div key={node.id} className="border border-pixel-black bg-pixel-white p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{state?.label ?? node.label}</span>
                <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-pixel-black/50">
                {node.kind ?? 'worker'}
                {node.role ? ` · ${node.role}` : ''}
                {state && state.runCount > 1 ? ` · run ${state.runCount}` : ''}
              </p>
              {state?.error && <p className="mt-1 text-[11px] text-pixel-red">{state.error}</p>}
            </div>
          );
        })}
      </div>

      {execution.error && <p className="text-xs text-pixel-red">{execution.error}</p>}
      {execution.status === 'succeeded' && execution.finalOutput && (
        <div className="border border-pixel-green bg-pixel-white p-2">
          <p className="mb-1 text-[11px] font-medium text-pixel-green">Final output</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-pixel-black/70">
            {execution.finalOutput}
          </p>
        </div>
      )}
    </div>
  );
}

const DELIVERABLE_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending review', className: 'text-pixel-black border-pixel-yellow' },
  accepted: { label: 'Accepted', className: 'text-pixel-green border-pixel-green' },
  revision: { label: 'Needs revision', className: 'text-pixel-red border-pixel-red' },
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
      <p className="p-3 text-xs text-pixel-black/50">
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
          <div key={deliverable.id} className="border border-pixel-black bg-pixel-white p-2">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => onOpenFile(deliverable.filePath)}
                className="truncate text-left text-sm hover:text-pixel-blue"
                title={deliverable.filePath}
              >
                {deliverable.filePath.split('/').pop()}
              </button>
              <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-pixel-black/50">{deliverable.filePath}</p>
            {deliverable.status === 'pending' && (
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => onReview(deliverable.id, 'accepted')}
                  className="border border-pixel-green px-2 py-0.5 text-[11px] text-pixel-green disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  disabled={busy}
                  onClick={() => onReview(deliverable.id, 'revision')}
                  className="border border-pixel-red px-2 py-0.5 text-[11px] text-pixel-red disabled:opacity-50"
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
