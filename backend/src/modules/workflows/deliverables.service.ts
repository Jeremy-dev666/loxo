import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  deliverables,
  workflowExecutions,
  type Deliverable,
  type DeliverableStatus,
} from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { addMemo } from '../memory/memos.service';

export interface RegisterDeliverableInput {
  userId: string;
  projectId: string;
  executionId: string;
  nodeId: string;
  agentId?: string | null;
  filePath: string;
}

/**
 * Registers a workflow output for review. A newer version of the same file
 * supersedes the previous pending entry; reviewed entries keep their verdict.
 */
export async function registerDeliverable(input: RegisterDeliverableInput): Promise<Deliverable> {
  await db
    .update(deliverables)
    .set({ status: 'superseded' })
    .where(
      and(
        eq(deliverables.projectId, input.projectId),
        eq(deliverables.filePath, input.filePath),
        eq(deliverables.status, 'pending')
      )
    );

  const [row] = await db
    .insert(deliverables)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      executionId: input.executionId,
      nodeId: input.nodeId,
      agentId: input.agentId ?? null,
      filePath: input.filePath,
    })
    .returning();
  return row!;
}

export async function listDeliverables(userId: string, projectId: string): Promise<Deliverable[]> {
  return db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.userId, userId), eq(deliverables.projectId, projectId)))
    .orderBy(desc(deliverables.createdAt));
}

export async function reviewDeliverable(
  userId: string,
  deliverableId: string,
  status: DeliverableStatus,
  note?: string
): Promise<Deliverable> {
  if (status !== 'accepted' && status !== 'revision') {
    throw badRequest('invalid_status', 'Deliverables can only be accepted or sent back for revision');
  }
  const [row] = await db
    .update(deliverables)
    .set({ status, reviewedAt: new Date() })
    .where(and(eq(deliverables.id, deliverableId), eq(deliverables.userId, userId)))
    .returning();
  if (!row) throw notFound('Deliverable not found');

  await writeReviewMemos(row, status, note).catch((error) => {
    console.error(`Review memo for deliverable ${row.id} failed:`, error);
  });
  return row;
}

/** The reviewer's verdict is a training signal; it lands in agent and team memory. */
async function writeReviewMemos(
  row: Deliverable,
  status: DeliverableStatus,
  note?: string
): Promise<void> {
  const verdict = status === 'accepted' ? 'accepted' : 'sent back for revision';
  const file = row.filePath.split('/').pop() ?? row.filePath;
  const reason = note?.trim() ? `: ${note.trim()}` : '';
  const content = `Deliverable "${file}" was ${verdict}${reason}`;

  if (row.agentId) {
    await addMemo({
      userId: row.userId,
      scope: 'agent',
      subjectId: row.agentId,
      source: 'review',
      content,
      executionId: row.executionId,
    });
  }
  const [execution] = await db
    .select({ teamId: workflowExecutions.teamId })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, row.executionId))
    .limit(1);
  if (execution) {
    await addMemo({
      userId: row.userId,
      scope: 'team',
      subjectId: execution.teamId,
      source: 'review',
      content,
      executionId: row.executionId,
    });
  }
}
