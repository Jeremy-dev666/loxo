import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { deliverables, type Deliverable, type DeliverableStatus } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';

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
  status: DeliverableStatus
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
  return row;
}
