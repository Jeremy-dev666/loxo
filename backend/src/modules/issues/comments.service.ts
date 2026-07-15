import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { agents, issueComments, issues, type IssueComment } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';

async function assertOwnedIssue(userId: string, issueId: string): Promise<void> {
  const [row] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Issue not found');
}

export async function addHumanComment(
  userId: string,
  issueId: string,
  body: string
): Promise<IssueComment> {
  await assertOwnedIssue(userId, issueId);
  const [comment] = await db
    .insert(issueComments)
    .values({ issueId, authorType: 'human', authorUserId: userId, body })
    .returning();
  return comment!;
}

/**
 * Agent-authored timeline entry. No HTTP route yet; the runner and the
 * future control-plane tools call this directly.
 */
export async function addAgentComment(
  userId: string,
  issueId: string,
  agentId: string,
  body: string
): Promise<IssueComment> {
  await assertOwnedIssue(userId, issueId);
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);
  if (!agent) throw badRequest('invalid_author', 'Agent does not exist');

  const [comment] = await db
    .insert(issueComments)
    .values({ issueId, authorType: 'agent', authorAgentId: agentId, body })
    .returning();
  return comment!;
}

export async function listComments(userId: string, issueId: string): Promise<IssueComment[]> {
  await assertOwnedIssue(userId, issueId);
  return db
    .select()
    .from(issueComments)
    .where(eq(issueComments.issueId, issueId))
    .orderBy(asc(issueComments.createdAt));
}
