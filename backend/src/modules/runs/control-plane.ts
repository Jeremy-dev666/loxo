import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { agents, issues, runs, type Agent, type Issue, type IssueStatus, type Run } from '../../db/schema';
import { badRequest, unauthorized } from '../../http/errors';
import { addAgentComment, listComments } from '../issues/comments.service';
import { moveIssue } from '../issues/issues.service';
import { verifyRunToken } from './run-token';

/**
 * The tool surface a woken agent gets back into the platform. Every call is
 * authenticated by a per-run token; context is resolved fresh per call so a
 * finished or cancelled run loses access immediately.
 */

export interface RunToolContext {
  run: Run;
  agent: Agent;
  issue: Issue;
}

export async function resolveRunContext(token: string): Promise<RunToolContext> {
  const runId = verifyRunToken(token);
  if (!runId) throw unauthorized('Invalid run token');

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') throw unauthorized('Run is not active');
  if (!run.agentId || !run.issueId) throw unauthorized('Run has no control-plane scope');

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, run.agentId), eq(agents.userId, run.userId)))
    .limit(1);
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, run.issueId), eq(issues.userId, run.userId)))
    .limit(1);
  if (!agent || !issue) throw unauthorized('Run scope no longer exists');

  return { run, agent, issue };
}

export interface IssueSnapshot {
  issueNumber: number;
  title: string;
  description: string;
  status: IssueStatus;
  comments: Array<{ author: string; body: string; createdAt: string }>;
}

export async function getIssueSnapshot(ctx: RunToolContext): Promise<IssueSnapshot> {
  const comments = await listComments(ctx.run.userId, ctx.issue.id);
  return {
    issueNumber: ctx.issue.issueNumber,
    title: ctx.issue.title,
    description: ctx.issue.description,
    status: ctx.issue.status,
    comments: comments.map((c) => ({
      author: c.authorType,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export async function commentOnIssue(ctx: RunToolContext, body: string): Promise<void> {
  await addAgentComment(ctx.run.userId, ctx.issue.id, ctx.agent.id, body);
}

/** Status writes go through the same transition table as every other path. */
export async function updateIssueStatus(ctx: RunToolContext, status: IssueStatus): Promise<Issue> {
  return moveIssue(ctx.run.userId, ctx.issue.id, { status });
}

/** Flags the run's issue as blocked with the question on the timeline. */
export async function askBlocker(ctx: RunToolContext, question: string): Promise<Issue> {
  await addAgentComment(ctx.run.userId, ctx.issue.id, ctx.agent.id, `[BLOCKER] ${question}`);
  if (ctx.issue.status === 'blocked') return ctx.issue;
  return moveIssue(ctx.run.userId, ctx.issue.id, { status: 'blocked' });
}

/** Posts the result and hands the issue to review. */
export async function submitResult(ctx: RunToolContext, summary: string): Promise<Issue> {
  if (!summary.trim()) throw badRequest('invalid_input', 'Result summary is required');
  await addAgentComment(ctx.run.userId, ctx.issue.id, ctx.agent.id, summary);
  if (ctx.issue.status === 'in_review') return ctx.issue;
  return moveIssue(ctx.run.userId, ctx.issue.id, { status: 'in_review' });
}
