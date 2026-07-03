import { apiFetch } from './api';
import type { WorkflowDsl } from './teams';

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type NodeStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped';

export const TERMINAL_EXECUTION_STATUSES: ExecutionStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
];

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  runCount: number;
  output: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExecutionSummary {
  id: string;
  teamId: string;
  projectId: string | null;
  task: string;
  status: ExecutionStatus;
  mode: 'dag' | 'state-machine';
  dryRun: boolean;
  finalOutput: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExecutionDetail extends ExecutionSummary {
  workflow: WorkflowDsl;
  nodeStates: NodeState[];
}

export interface WorkflowEvent {
  seq: number;
  type: string;
  nodeId: string | null;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Node summary carried in websocket deltas (subset of NodeState). */
export interface DeltaNodeState {
  nodeId: string;
  type: string;
  label: string;
  status: NodeStatus;
  runCount: number;
  error?: string;
}

export interface WorkflowEventDelta {
  executionId: string;
  userId: string;
  teamId: string;
  projectId: string | null;
  workflowName: string;
  status: ExecutionStatus;
  event: {
    seq: number;
    type: string;
    nodeId?: string;
    message: string;
    payload: Record<string, unknown>;
  };
  nodeStates: DeltaNodeState[];
  finalOutput?: string;
  error?: string;
}

export const executeWorkflow = (input: {
  teamId: string;
  task: string;
  projectId?: string;
  dryRun?: boolean;
}) =>
  apiFetch<{ execution: ExecutionDetail }>('/api/workflows/execute', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.execution);

export const fetchExecutions = (filter: { teamId?: string; projectId?: string } = {}) => {
  const params = new URLSearchParams();
  if (filter.teamId) params.set('teamId', filter.teamId);
  if (filter.projectId) params.set('projectId', filter.projectId);
  const query = params.toString();
  return apiFetch<{ executions: ExecutionSummary[] }>(
    `/api/workflows/executions${query ? `?${query}` : ''}`
  ).then((r) => r.executions);
};

export const fetchExecution = (id: string) =>
  apiFetch<{ execution: ExecutionDetail }>(`/api/workflows/executions/${id}`).then(
    (r) => r.execution
  );

export const fetchExecutionEvents = (id: string, afterSeq?: number) =>
  apiFetch<{ events: WorkflowEvent[] }>(
    `/api/workflows/executions/${id}/events${afterSeq !== undefined ? `?afterSeq=${afterSeq}` : ''}`
  ).then((r) => r.events);

export const cancelExecution = (id: string) =>
  apiFetch<{ execution: ExecutionDetail }>(`/api/workflows/executions/${id}/cancel`, {
    method: 'POST',
  }).then((r) => r.execution);
