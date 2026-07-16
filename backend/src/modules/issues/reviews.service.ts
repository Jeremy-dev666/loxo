import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  agents,
  issueReviews,
  issues,
  type Issue,
  type IssueReview,
  type ReviewDecision,
} from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { addMemo } from '../memory/memos.service';
import { addAgentComment, addHumanComment } from './comments.service';
import { moveIssue } from './issues.service';

export interface CreateReviewInput {
  decision: ReviewDecision;
  body: string;
  /** Exactly one principal; humans must be the account owner. */
  reviewer: { userId: string } | { agentId: string };
  /** Review run that produced this verdict, for agent reviewers. */
  runId?: string | null;
}

const DECISION_LABEL: Record<ReviewDecision, string> = {
  approved: '[APPROVED]',
  changes_requested: '[CHANGES REQUESTED]',
};

async function findOwnedIssue(userId: string, issueId: string): Promise<Issue> {
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.userId, userId)))
    .limit(1);
  if (!issue) throw notFound('Issue not found');
  return issue;
}

/**
 * One review verdict: record it, put the feedback on the timeline, distill
 * it into memory, then move the issue. Order matters — the comment and memo
 * must exist before the transition, because moving to in_progress re-wakes
 * the assignee and the next run reads both.
 */
export async function createReview(
  userId: string,
  issueId: string,
  input: CreateReviewInput
): Promise<IssueReview> {
  const issue = await findOwnedIssue(userId, issueId);
  if (issue.status !== 'in_review') {
    throw badRequest('not_in_review', 'Only issues in review can be reviewed');
  }
  const body = input.body.trim();
  if (!body) throw badRequest('invalid_input', 'A review must carry a comment');

  let reviewerAgentId: string | null = null;
  let reviewerUserId: string | null = null;
  if ('agentId' in input.reviewer) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, input.reviewer.agentId), eq(agents.userId, userId)))
      .limit(1);
    if (!agent) throw badRequest('invalid_reviewer', 'Agent does not exist');
    reviewerAgentId = agent.id;
  } else {
    if (input.reviewer.userId !== userId) {
      throw badRequest('invalid_reviewer', 'Only the account owner can review');
    }
    reviewerUserId = userId;
  }

  const [review] = await db
    .insert(issueReviews)
    .values({
      userId,
      issueId,
      reviewerType: reviewerAgentId ? 'agent' : 'human',
      reviewerAgentId,
      reviewerUserId,
      runId: input.runId ?? null,
      decision: input.decision,
      body,
    })
    .returning();

  const commentBody = `${DECISION_LABEL[input.decision]} ${body}`;
  if (reviewerAgentId) {
    await addAgentComment(userId, issueId, reviewerAgentId, commentBody);
  } else {
    await addHumanComment(userId, issueId, commentBody);
  }

  if (input.decision === 'changes_requested') {
    const memoContent = `Review feedback on issue #${issue.issueNumber} (${issue.title}): ${body}`;
    if (issue.assigneeAgentId) {
      await addMemo({
        userId,
        scope: 'agent',
        subjectId: issue.assigneeAgentId,
        source: 'review',
        content: memoContent,
      });
    }
    await addMemo({
      userId,
      scope: 'project',
      subjectId: issue.projectId,
      source: 'review',
      content: memoContent,
    });
  }

  // in_review -> done | in_progress are both legal transitions; moving to
  // in_progress re-wakes the assignee through the existing move hook.
  await moveIssue(userId, issueId, {
    status: input.decision === 'approved' ? 'done' : 'in_progress',
  });

  return review!;
}

export async function listReviews(userId: string, issueId: string): Promise<IssueReview[]> {
  await findOwnedIssue(userId, issueId);
  return db
    .select()
    .from(issueReviews)
    .where(eq(issueReviews.issueId, issueId))
    .orderBy(asc(issueReviews.createdAt));
}
