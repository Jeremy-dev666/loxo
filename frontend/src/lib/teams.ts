import { apiFetch } from './api';

export type NodeKind =
  | 'worker'
  | 'orchestrator'
  | 'router'
  | 'aggregator'
  | 'judge'
  | 'evaluator'
  | 'optimizer';

export const NODE_KINDS: NodeKind[] = [
  'worker',
  'orchestrator',
  'router',
  'aggregator',
  'judge',
  'evaluator',
  'optimizer',
];

export interface DslNode {
  id: string;
  type: 'start' | 'agent' | 'condition' | 'end';
  label: string;
  agentId?: string;
  kind?: NodeKind;
  role?: string;
  expression?: string;
  position?: { x: number; y: number };
}

export interface DslEdge {
  id: string;
  from: string;
  to: string;
  branch?: 'yes' | 'no';
  label?: string;
}

export interface WorkflowDsl {
  version: '1';
  name: string;
  description: string;
  entryNodeId: string;
  nodes: DslNode[];
  edges: DslEdge[];
  execution: {
    mode: 'dag' | 'state-machine';
    maxConcurrency: number;
    timeoutSec: number;
    maxIterations?: number;
  };
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
}

export interface TeamView {
  id: string;
  name: string;
  description: string;
  workflow: WorkflowDsl;
  warnings: ValidationIssue[];
  updatedAt: string;
}

export const fetchTeams = () => apiFetch<{ teams: TeamView[] }>('/api/teams').then((r) => r.teams);

export const fetchTeam = (id: string) =>
  apiFetch<{ team: TeamView }>(`/api/teams/${id}`).then((r) => r.team);

export const createTeam = (input: { name: string; description?: string }) =>
  apiFetch<{ team: TeamView }>('/api/teams', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.team);

export const deleteTeam = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/teams/${id}`, { method: 'DELETE' });

export const saveWorkflow = (id: string, workflow: unknown, draft = false) =>
  apiFetch<{ team: TeamView }>(`/api/teams/${id}/workflow${draft ? '?draft=1' : ''}`, {
    method: 'PUT',
    body: JSON.stringify(workflow),
  }).then((r) => r.team);

export const generateDsl = (prompt: string) =>
  apiFetch<{ workflow: WorkflowDsl; generator: string; warnings: string[] }>(
    '/api/teams/generate-dsl',
    { method: 'POST', body: JSON.stringify({ prompt }) }
  );
