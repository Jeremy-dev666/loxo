import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  agents,
  issueComments,
  issueReviews,
  issues,
  runs,
  type IssueStatus,
  type RunStatus,
} from '../../db/schema';
import { ACTIVE_RUN_STATUSES } from '../runs/runs.service';

const OPEN_ISSUE_STATUSES: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'];
const FINISHED_RUN_STATUSES: RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export interface DashboardRunRow {
  id: string;
  agentId: string | null;
  agentName: string;
  issueId: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  trigger: string;
  status: RunStatus;
  reason: string;
  error: string | null;
  costUsd: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface DashboardSummary {
  issues: { open: number; byStatus: Partial<Record<IssueStatus, number>> };
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
  occurredAt: Date;
  issueId: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  actorType: 'agent' | 'human';
  actorName: string | null;
  /** Kind-specific qualifier: run/issue status or review decision. */
  detail: string | null;
}

/** Local midnight; "today" follows the server clock. */
function startOfToday(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

const runRowSelection = {
  id: runs.id,
  agentId: runs.agentId,
  agentName: runs.agentName,
  issueId: runs.issueId,
  issueNumber: issues.issueNumber,
  issueTitle: issues.title,
  trigger: runs.trigger,
  status: runs.status,
  reason: runs.reason,
  error: runs.error,
  costUsd: runs.costUsd,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  createdAt: runs.createdAt,
};

export async function getDashboardSummary(userId: string): Promise<DashboardSummary> {
  const [issueRows, runRows, agentRows, todayRows, activeRuns, recentRuns] = await Promise.all([
    db
      .select({ status: issues.status, count: sql<number>`count(*)::int` })
      .from(issues)
      .where(eq(issues.userId, userId))
      .groupBy(issues.status),
    db
      .select({ status: runs.status, count: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.userId, userId), inArray(runs.status, [...ACTIVE_RUN_STATUSES])))
      .groupBy(runs.status),
    db
      .select({
        total: sql<number>`count(*)::int`,
        busy: sql<number>`count(*) filter (where ${agents.status} = 'busy')::int`,
      })
      .from(agents)
      .where(eq(agents.userId, userId)),
    db
      .select({
        runs: sql<number>`count(*)::int`,
        failedRuns: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
        costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)`,
        tokensIn: sql<number>`coalesce(sum(${runs.tokensIn}), 0)::int`,
        tokensOut: sql<number>`coalesce(sum(${runs.tokensOut}), 0)::int`,
      })
      .from(runs)
      .where(and(eq(runs.userId, userId), gte(runs.createdAt, startOfToday()))),
    db
      .select(runRowSelection)
      .from(runs)
      .leftJoin(issues, eq(runs.issueId, issues.id))
      .where(and(eq(runs.userId, userId), inArray(runs.status, [...ACTIVE_RUN_STATUSES])))
      .orderBy(desc(runs.createdAt))
      .limit(8),
    db
      .select(runRowSelection)
      .from(runs)
      .leftJoin(issues, eq(runs.issueId, issues.id))
      .where(and(eq(runs.userId, userId), inArray(runs.status, FINISHED_RUN_STATUSES)))
      .orderBy(desc(runs.finishedAt))
      .limit(8),
  ]);

  const byStatus: Partial<Record<IssueStatus, number>> = {};
  for (const row of issueRows) byStatus[row.status] = row.count;
  const open = OPEN_ISSUE_STATUSES.reduce((total, status) => total + (byStatus[status] ?? 0), 0);

  const runCounts: Record<string, number> = {};
  for (const row of runRows) runCounts[row.status] = row.count;
  const queued = runCounts['queued'] ?? 0;
  const running = runCounts['running'] ?? 0;

  const agentRow = agentRows[0] ?? { total: 0, busy: 0 };
  const todayRow = todayRows[0] ?? { runs: 0, failedRuns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };

  return {
    issues: { open, byStatus },
    runs: { active: queued + running, queued, running },
    agents: { total: agentRow.total, busy: agentRow.busy },
    today: {
      runs: todayRow.runs,
      failedRuns: todayRow.failedRuns,
      costUsd: Number(todayRow.costUsd),
      tokensIn: todayRow.tokensIn,
      tokensOut: todayRow.tokensOut,
    },
    activeRuns,
    recentRuns,
  };
}

/**
 * Feed assembled from per-source queries rather than a persisted event table.
 * Each source is fetched pre-limited, then merged and cut to the final size;
 * with per-user data volumes this stays cheap and needs no new writes.
 */
export async function listActivity(userId: string, limit: number): Promise<ActivityEvent[]> {
  const [finishedRuns, createdIssues, closedIssues, comments, reviews] = await Promise.all([
    db
      .select({
        id: runs.id,
        occurredAt: runs.finishedAt,
        issueId: runs.issueId,
        issueNumber: issues.issueNumber,
        issueTitle: issues.title,
        actorName: runs.agentName,
        detail: runs.status,
      })
      .from(runs)
      .leftJoin(issues, eq(runs.issueId, issues.id))
      .where(
        and(
          eq(runs.userId, userId),
          inArray(runs.status, FINISHED_RUN_STATUSES),
          isNotNull(runs.finishedAt)
        )
      )
      .orderBy(desc(runs.finishedAt))
      .limit(limit),
    db
      .select({
        id: issues.id,
        occurredAt: issues.createdAt,
        issueId: issues.id,
        issueNumber: issues.issueNumber,
        issueTitle: issues.title,
      })
      .from(issues)
      .where(eq(issues.userId, userId))
      .orderBy(desc(issues.createdAt))
      .limit(limit),
    db
      .select({
        id: issues.id,
        occurredAt: issues.closedAt,
        issueId: issues.id,
        issueNumber: issues.issueNumber,
        issueTitle: issues.title,
        detail: issues.status,
      })
      .from(issues)
      .where(and(eq(issues.userId, userId), isNotNull(issues.closedAt)))
      .orderBy(desc(issues.closedAt))
      .limit(limit),
    db
      .select({
        id: issueComments.id,
        occurredAt: issueComments.createdAt,
        issueId: issueComments.issueId,
        issueNumber: issues.issueNumber,
        issueTitle: issues.title,
        authorType: issueComments.authorType,
        agentName: agents.name,
      })
      .from(issueComments)
      .innerJoin(issues, eq(issueComments.issueId, issues.id))
      .leftJoin(agents, eq(issueComments.authorAgentId, agents.id))
      .where(eq(issues.userId, userId))
      .orderBy(desc(issueComments.createdAt))
      .limit(limit),
    db
      .select({
        id: issueReviews.id,
        occurredAt: issueReviews.createdAt,
        issueId: issueReviews.issueId,
        issueNumber: issues.issueNumber,
        issueTitle: issues.title,
        reviewerType: issueReviews.reviewerType,
        agentName: agents.name,
        detail: issueReviews.decision,
      })
      .from(issueReviews)
      .innerJoin(issues, eq(issueReviews.issueId, issues.id))
      .leftJoin(agents, eq(issueReviews.reviewerAgentId, agents.id))
      .where(eq(issueReviews.userId, userId))
      .orderBy(desc(issueReviews.createdAt))
      .limit(limit),
  ]);

  const events: ActivityEvent[] = [
    ...finishedRuns.map((row) => ({
      id: `run:${row.id}`,
      kind: 'run_finished' as const,
      occurredAt: row.occurredAt!,
      issueId: row.issueId,
      issueNumber: row.issueNumber,
      issueTitle: row.issueTitle,
      actorType: 'agent' as const,
      actorName: row.actorName,
      detail: row.detail,
    })),
    ...createdIssues.map((row) => ({
      id: `issue-created:${row.id}`,
      kind: 'issue_created' as const,
      occurredAt: row.occurredAt,
      issueId: row.issueId,
      issueNumber: row.issueNumber,
      issueTitle: row.issueTitle,
      actorType: 'human' as const,
      actorName: null,
      detail: null,
    })),
    ...closedIssues.map((row) => ({
      id: `issue-closed:${row.id}`,
      kind: 'issue_closed' as const,
      occurredAt: row.occurredAt!,
      issueId: row.issueId,
      issueNumber: row.issueNumber,
      issueTitle: row.issueTitle,
      actorType: 'human' as const,
      actorName: null,
      detail: row.detail,
    })),
    ...comments.map((row) => ({
      id: `comment:${row.id}`,
      kind: 'comment' as const,
      occurredAt: row.occurredAt,
      issueId: row.issueId,
      issueNumber: row.issueNumber,
      issueTitle: row.issueTitle,
      actorType: row.authorType,
      actorName: row.agentName,
      detail: null,
    })),
    ...reviews.map((row) => ({
      id: `review:${row.id}`,
      kind: 'review' as const,
      occurredAt: row.occurredAt,
      issueId: row.issueId,
      issueNumber: row.issueNumber,
      issueTitle: row.issueTitle,
      actorType: row.reviewerType,
      actorName: row.agentName,
      detail: row.detail,
    })),
  ];

  return events
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
}
