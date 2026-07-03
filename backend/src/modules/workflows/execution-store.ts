import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  workflowArtifacts,
  workflowEvents,
  workflowExecutions,
  workflowNodeStates,
  type WorkflowArtifact,
  type WorkflowEvent,
  type WorkflowExecution,
  type WorkflowExecutionStatus,
  type WorkflowNodeState,
  type WorkflowNodeStatus,
} from '../../db/schema';
import type { WorkflowDsl } from '../teams/workflow-dsl';

/**
 * Postgres is the source of truth for executions; the executor keeps its
 * working set in memory and writes through here. Reads never depend on the
 * in-memory state, so history survives restarts.
 */

export interface ExecutionDetail extends WorkflowExecution {
  nodeStates: WorkflowNodeState[];
  artifacts: WorkflowArtifact[];
}

export interface CreateExecutionInput {
  userId: string;
  teamId: string;
  projectId?: string | null;
  task: string;
  mode: 'dag' | 'state-machine';
  dryRun: boolean;
  workflow: WorkflowDsl;
  nodeIds: string[];
}

export async function createExecution(input: CreateExecutionInput): Promise<ExecutionDetail> {
  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      userId: input.userId,
      teamId: input.teamId,
      projectId: input.projectId ?? null,
      task: input.task,
      mode: input.mode,
      dryRun: input.dryRun,
      workflow: input.workflow,
    })
    .returning();

  const nodeStates =
    input.nodeIds.length > 0
      ? await db
          .insert(workflowNodeStates)
          .values(input.nodeIds.map((nodeId) => ({ executionId: execution!.id, nodeId })))
          .returning()
      : [];

  return { ...execution!, nodeStates, artifacts: [] };
}

export interface ExecutionPatch {
  status?: WorkflowExecutionStatus;
  finalOutput?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export async function updateExecution(
  executionId: string,
  patch: ExecutionPatch
): Promise<WorkflowExecution | null> {
  const [row] = await db
    .update(workflowExecutions)
    .set(patch)
    .where(eq(workflowExecutions.id, executionId))
    .returning();
  return row ?? null;
}

export interface NodeStatePatch {
  status?: WorkflowNodeStatus;
  runCount?: number;
  output?: string;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export async function updateNodeState(
  executionId: string,
  nodeId: string,
  patch: NodeStatePatch
): Promise<WorkflowNodeState | null> {
  const [row] = await db
    .update(workflowNodeStates)
    .set(patch)
    .where(
      and(eq(workflowNodeStates.executionId, executionId), eq(workflowNodeStates.nodeId, nodeId))
    )
    .returning();
  return row ?? null;
}

export interface AppendEventInput {
  seq: number;
  type: string;
  nodeId?: string | null;
  message?: string;
  payload?: Record<string, unknown>;
}

export async function appendEvent(
  executionId: string,
  input: AppendEventInput
): Promise<WorkflowEvent> {
  const [row] = await db
    .insert(workflowEvents)
    .values({
      executionId,
      seq: input.seq,
      type: input.type,
      nodeId: input.nodeId ?? null,
      message: input.message ?? '',
      payload: input.payload ?? {},
    })
    .returning();
  return row!;
}

export async function listEvents(
  executionId: string,
  options: { afterSeq?: number; limit?: number } = {}
): Promise<WorkflowEvent[]> {
  const conditions = [eq(workflowEvents.executionId, executionId)];
  if (options.afterSeq !== undefined) conditions.push(gt(workflowEvents.seq, options.afterSeq));
  return db
    .select()
    .from(workflowEvents)
    .where(and(...conditions))
    .orderBy(asc(workflowEvents.seq))
    .limit(options.limit ?? 500);
}

export interface AddArtifactInput {
  nodeId: string;
  runCount: number;
  kind: 'workspace-file' | 'node-output';
  label: string;
  path: string;
  size: number;
}

export async function addArtifacts(
  executionId: string,
  inputs: AddArtifactInput[]
): Promise<WorkflowArtifact[]> {
  if (inputs.length === 0) return [];
  return db
    .insert(workflowArtifacts)
    .values(inputs.map((input) => ({ executionId, ...input })))
    .returning();
}

export async function getExecution(
  userId: string,
  executionId: string
): Promise<ExecutionDetail | null> {
  const [execution] = await db
    .select()
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.id, executionId), eq(workflowExecutions.userId, userId)))
    .limit(1);
  if (!execution) return null;

  const [nodeStates, artifacts] = await Promise.all([
    db
      .select()
      .from(workflowNodeStates)
      .where(eq(workflowNodeStates.executionId, executionId)),
    db
      .select()
      .from(workflowArtifacts)
      .where(eq(workflowArtifacts.executionId, executionId))
      .orderBy(asc(workflowArtifacts.createdAt)),
  ]);
  return { ...execution, nodeStates, artifacts };
}

export interface ListExecutionsFilter {
  teamId?: string;
  projectId?: string;
  limit?: number;
}

export async function listExecutions(
  userId: string,
  filter: ListExecutionsFilter = {}
): Promise<WorkflowExecution[]> {
  const conditions = [eq(workflowExecutions.userId, userId)];
  if (filter.teamId) conditions.push(eq(workflowExecutions.teamId, filter.teamId));
  if (filter.projectId) conditions.push(eq(workflowExecutions.projectId, filter.projectId));
  return db
    .select()
    .from(workflowExecutions)
    .where(and(...conditions))
    .orderBy(desc(workflowExecutions.createdAt))
    .limit(filter.limit ?? 50);
}

/**
 * Boot-time recovery: executions left queued/running by a previous process
 * cannot resume (runner processes are gone), so they are closed out as
 * interrupted and their in-flight nodes marked failed.
 */
export async function markInterruptedExecutions(): Promise<number> {
  const interrupted = await db
    .update(workflowExecutions)
    .set({
      status: 'interrupted',
      error: 'Execution was interrupted by a server restart',
      finishedAt: new Date(),
    })
    .where(inArray(workflowExecutions.status, ['queued', 'running']))
    .returning({ id: workflowExecutions.id });

  if (interrupted.length > 0) {
    await db
      .update(workflowNodeStates)
      .set({
        status: 'failed',
        error: 'Interrupted by a server restart',
        finishedAt: new Date(),
      })
      .where(
        and(
          inArray(
            workflowNodeStates.executionId,
            interrupted.map((row) => row.id)
          ),
          eq(workflowNodeStates.status, 'running')
        )
      );
  }
  return interrupted.length;
}
