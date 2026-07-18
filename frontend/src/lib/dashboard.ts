import { apiFetch } from './api';
import type { RunStatus, RunTrigger } from './runs';

export interface DashboardRunRow {
  id: string;
  agentId: string | null;
  agentName: string;
  issueId: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  reason: string;
  error: string | null;
  costUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  issues: { open: number; byStatus: Partial<Record<string, number>> };
  runs: { active: number; queued: number; running: number };
  agents: { total: number; busy: number };
  today: {
    runs: number;
    failedRuns: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  };
  activeRuns: DashboardRunRow[];
  recentRuns: DashboardRunRow[];
}

export type ActivityKind = 'run_finished' | 'issue_created' | 'issue_closed' | 'comment' | 'review';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  issueId: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  actorType: 'agent' | 'human';
  actorName: string | null;
  detail: string | null;
}

export function fetchDashboardSummary() {
  return apiFetch<{ summary: DashboardSummary }>('/api/dashboard/summary');
}

export function fetchDashboardActivity(limit = 30) {
  return apiFetch<{ events: ActivityEvent[] }>(`/api/dashboard/activity?limit=${limit}`);
}
