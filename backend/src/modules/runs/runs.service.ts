import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { issues, runs, type Run, type RunStatus, type RunTrigger } from '../../db/schema';
import { notFound } from '../../http/errors';

/** Statuses that count as "this agent/issue already has work in flight". */
export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const satisfies readonly RunStatus[];

export interface CreateRunInput {
  agentId: string;
  agentName: string;
  issueId?: string | null;
  trigger: RunTrigger;
  reason?: string;
  model?: string | null;
}

export interface RunOutcome {
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>;
  output?: string;
  error?: string | null;
  sessionRef?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
}

export async function createQueuedRun(userId: string, input: CreateRunInput): Promise<Run> {
  const [run] = await db
    .insert(runs)
    .values({
      userId,
      agentId: input.agentId,
      agentName: input.agentName,
      issueId: input.issueId ?? null,
      trigger: input.trigger,
      reason: input.reason ?? '',
      model: input.model ?? null,
    })
    .returning();
  return run!;
}

export async function getRun(userId: string, runId: string): Promise<Run> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  if (!run) throw notFound('Run not found');
  return run;
}

export async function listRuns(
  userId: string,
  filter: { issueId?: string; agentId?: string; status?: RunStatus }
): Promise<Run[]> {
  const conditions = [eq(runs.userId, userId)];
  if (filter.issueId) conditions.push(eq(runs.issueId, filter.issueId));
  if (filter.agentId) conditions.push(eq(runs.agentId, filter.agentId));
  if (filter.status) conditions.push(eq(runs.status, filter.status));
  return db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(desc(runs.createdAt));
}

/**
 * Claims a queued run for execution. Returns undefined when the run was
 * already claimed, cancelled, or finished — callers treat that as "someone
 * else got here first" and walk away.
 */
export async function claimRun(runId: string): Promise<Run | undefined> {
  const [run] = await db
    .update(runs)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
    .returning();
  return run;
}

/** Finalizes a run; only queued/running rows can be finished. */
export async function finishRun(runId: string, outcome: RunOutcome): Promise<Run> {
  const [run] = await db
    .update(runs)
    .set({
      status: outcome.status,
      output: outcome.output ?? '',
      error: outcome.error ?? null,
      ...(outcome.sessionRef !== undefined ? { sessionRef: outcome.sessionRef } : {}),
      ...(outcome.model !== undefined ? { model: outcome.model } : {}),
      ...(outcome.tokensIn !== undefined ? { tokensIn: outcome.tokensIn } : {}),
      ...(outcome.tokensOut !== undefined ? { tokensOut: outcome.tokensOut } : {}),
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      finishedAt: new Date(),
    })
    .where(and(eq(runs.id, runId), inArray(runs.status, [...ACTIVE_RUN_STATUSES])))
    .returning();
  if (!run) throw notFound('Run is not active');
  return run;
}

/**
 * Takes the issue execution lock for a run. The conditional UPDATE is the
 * whole mutual-exclusion story: exactly one concurrent caller sees the null
 * column and wins; everyone else stays queued.
 */
export async function acquireIssueLock(issueId: string, runId: string): Promise<boolean> {
  const claimed = await db
    .update(issues)
    .set({ activeRunId: runId })
    .where(and(eq(issues.id, issueId), isNull(issues.activeRunId)))
    .returning({ id: issues.id });
  return claimed.length > 0;
}

/** Releases the lock only if this run still holds it. */
export async function releaseIssueLock(issueId: string, runId: string): Promise<void> {
  await db
    .update(issues)
    .set({ activeRunId: null })
    .where(and(eq(issues.id, issueId), eq(issues.activeRunId, runId)));
}

/** Oldest queued run waiting on an issue, if any; promotion order is FIFO. */
export async function nextQueuedRunForIssue(issueId: string): Promise<Run | undefined> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.issueId, issueId), eq(runs.status, 'queued')))
    .orderBy(asc(runs.createdAt))
    .limit(1);
  return run;
}

/** Oldest queued run waiting on an agent, across issues. */
export async function nextQueuedRunForAgent(agentId: string): Promise<Run | undefined> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.agentId, agentId), eq(runs.status, 'queued')))
    .orderBy(asc(runs.createdAt))
    .limit(1);
  return run;
}
