import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { goals, type Goal, type GoalStatus } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';

async function findGoal(userId: string, goalId: string): Promise<Goal | undefined> {
  const [goal] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    .limit(1);
  return goal;
}

/**
 * Rejects a parent assignment that would close a loop. Walks the ancestor
 * chain from the candidate parent; hitting the child means the child is
 * already above the parent. Depth-capped so a corrupt chain cannot spin.
 */
async function assertNoCycle(userId: string, goalId: string, parentGoalId: string): Promise<void> {
  if (parentGoalId === goalId) {
    throw badRequest('goal_cycle', 'A goal cannot be its own parent');
  }
  let cursor: string | null = parentGoalId;
  for (let depth = 0; cursor && depth < 100; depth += 1) {
    if (cursor === goalId) {
      throw badRequest('goal_cycle', 'This parent would create a cycle');
    }
    const [row] = await db
      .select({ parentGoalId: goals.parentGoalId })
      .from(goals)
      .where(and(eq(goals.id, cursor), eq(goals.userId, userId)))
      .limit(1);
    cursor = row?.parentGoalId ?? null;
  }
}

async function assertValidParent(userId: string, parentGoalId: string): Promise<void> {
  const parent = await findGoal(userId, parentGoalId);
  if (!parent) throw badRequest('invalid_parent', 'Parent goal does not exist');
}

export async function createGoal(
  userId: string,
  input: { title: string; description?: string; parentGoalId?: string }
): Promise<Goal> {
  if (input.parentGoalId) await assertValidParent(userId, input.parentGoalId);
  const [goal] = await db
    .insert(goals)
    .values({
      userId,
      title: input.title,
      description: input.description ?? '',
      parentGoalId: input.parentGoalId ?? null,
    })
    .returning();
  return goal!;
}

export async function listGoals(userId: string, status?: GoalStatus): Promise<Goal[]> {
  const conditions = [eq(goals.userId, userId)];
  if (status) conditions.push(eq(goals.status, status));
  return db
    .select()
    .from(goals)
    .where(and(...conditions))
    .orderBy(desc(goals.updatedAt));
}

export async function getGoal(userId: string, goalId: string): Promise<Goal> {
  const goal = await findGoal(userId, goalId);
  if (!goal) throw notFound('Goal not found');
  return goal;
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: {
    title?: string;
    description?: string;
    status?: GoalStatus;
    parentGoalId?: string | null;
  }
): Promise<Goal> {
  const existing = await findGoal(userId, goalId);
  if (!existing) throw notFound('Goal not found');

  if (typeof input.parentGoalId === 'string') {
    await assertValidParent(userId, input.parentGoalId);
    await assertNoCycle(userId, goalId, input.parentGoalId);
  }

  const [updated] = await db
    .update(goals)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.parentGoalId !== undefined ? { parentGoalId: input.parentGoalId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    .returning();
  return updated!;
}

export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  const deleted = await db
    .delete(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    .returning({ id: goals.id });
  if (deleted.length === 0) throw notFound('Goal not found');
}
