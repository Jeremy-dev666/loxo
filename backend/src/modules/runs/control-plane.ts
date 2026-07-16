import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  agents,
  issues,
  runs,
  type Agent,
  type Issue,
  type IssueStatus,
  type ReviewDecision,
  type Run,
} from '../../db/schema';
import { badRequest, unauthorized } from '../../http/errors';
import { addAgentComment, listComments } from '../issues/comments.service';
import { moveIssue } from '../issues/issues.service';
import { isTransitionAllowed } from '../issues/issue-transitions';
import {
  countAgentRejections,
  createReview,
  REVIEW_CYCLE_CAP,
} from '../issues/reviews.service';
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

/**
 * Tool contexts live for a whole run while the issue moves underneath them
 * (often via these very tools); reads always go back to the database.
 */
async function freshIssue(ctx: RunToolContext): Promise<Issue> {
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, ctx.issue.id), eq(issues.userId, ctx.run.userId)))
    .limit(1);
  if (!issue) throw unauthorized('Issue no longer exists');
  return issue;
}

/**
 * Moves toward `target`, stepping through in_progress when that is the one
 * legal bridge (an agent finishing straight from todo is normal, not an
 * error). Still-illegal moves reject through the transition table.
 */
async function advanceTo(ctx: RunToolContext, target: IssueStatus): Promise<Issue> {
  let issue = await freshIssue(ctx);
  if (issue.status === target) return issue;
  if (
    !isTransitionAllowed(issue.status, target) &&
    isTransitionAllowed(issue.status, 'in_progress') &&
    isTransitionAllowed('in_progress', target)
  ) {
    issue = await moveIssue(ctx.run.userId, issue.id, { status: 'in_progress' });
  }
  return moveIssue(ctx.run.userId, issue.id, { status: target });
}

export interface IssueSnapshot {
  issueNumber: number;
  title: string;
  description: string;
  status: IssueStatus;
  comments: Array<{ author: string; body: string; createdAt: string }>;
}

export async function getIssueSnapshot(ctx: RunToolContext): Promise<IssueSnapshot> {
  const issue = await freshIssue(ctx);
  const comments = await listComments(ctx.run.userId, issue.id);
  return {
    issueNumber: issue.issueNumber,
    title: issue.title,
    description: issue.description,
    status: issue.status,
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
  return advanceTo(ctx, 'blocked');
}

/** Posts the result and hands the issue to review. */
export async function submitResult(ctx: RunToolContext, summary: string): Promise<Issue> {
  if (!summary.trim()) throw badRequest('invalid_input', 'Result summary is required');
  await addAgentComment(ctx.run.userId, ctx.issue.id, ctx.agent.id, summary);
  return advanceTo(ctx, 'in_review');
}

export interface ReviewVerdictOutcome {
  status: IssueStatus;
  halted: boolean;
  note: string;
}

/**
 * Reviewer verdict from a review run. Asymmetric authority: an agent
 * rejection reopens work (until the automated-cycle fuse blows), but an
 * agent approval only records a recommendation — closing stays human.
 */
export async function submitReviewVerdict(
  ctx: RunToolContext,
  decision: ReviewDecision,
  feedback: string
): Promise<ReviewVerdictOutcome> {
  if (ctx.run.trigger !== 'review') {
    throw badRequest('not_a_review_run', 'Only review runs can submit review verdicts');
  }

  if (decision === 'approved') {
    await createReview(
      ctx.run.userId,
      ctx.issue.id,
      {
        decision,
        body: feedback,
        reviewer: { agentId: ctx.agent.id },
        runId: ctx.run.id,
      },
      { applyTransition: false }
    );
    return {
      status: 'in_review',
      halted: false,
      note: 'Approval recorded as a recommendation; final sign-off stays with a human.',
    };
  }

  const priorRejections = await countAgentRejections(ctx.issue.id);
  const halted = priorRejections >= REVIEW_CYCLE_CAP;
  await createReview(
    ctx.run.userId,
    ctx.issue.id,
    {
      decision,
      body: feedback,
      reviewer: { agentId: ctx.agent.id },
      runId: ctx.run.id,
    },
    { applyTransition: !halted }
  );
  if (halted) {
    await addAgentComment(
      ctx.run.userId,
      ctx.issue.id,
      ctx.agent.id,
      `[REVIEW HALTED] ${REVIEW_CYCLE_CAP} automated review cycles reached; a human reviewer needs to take over.`
    );
    return {
      status: 'in_review',
      halted: true,
      note: 'Automated review cycles exhausted; the issue stays in review for a human.',
    };
  }
  const issue = await freshIssue(ctx);
  return { status: issue.status, halted: false, note: 'Changes requested; the assignee has been re-woken.' };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('invalid_input', `"${key}" must be a non-empty string`);
  }
  return value;
}

const STATUS_VALUES: IssueStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
];

export interface ControlPlaneToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * In-process flavor of the control-plane tools for the api lane; same
 * implementations the MCP endpoint wraps, minus the token round-trip since
 * the executor already holds the run context. Review runs get the reviewer
 * set (read, comment, verdict); worker runs get the worker set.
 */
export function buildControlPlaneToolDefs(ctx: RunToolContext): ControlPlaneToolDef[] {
  const shared: ControlPlaneToolDef[] = [
    {
      name: 'get_issue',
      description:
        'Read the issue this run was woken for: title, description, status, and timeline.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => JSON.stringify(await getIssueSnapshot(ctx)),
    },
    {
      name: 'comment_on_issue',
      description: 'Post a progress note to the issue timeline as yourself.',
      parameters: {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body'],
      },
      execute: async (args) => {
        await commentOnIssue(ctx, requireString(args, 'body'));
        return 'Comment posted';
      },
    },
  ];

  if (ctx.run.trigger === 'review') {
    return [
      ...shared,
      {
        name: 'submit_review',
        description:
          'Deliver your review verdict. approved records a recommendation (a human closes the issue); changes_requested reopens work with your feedback.',
        parameters: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['approved', 'changes_requested'] },
            feedback: { type: 'string' },
          },
          required: ['decision', 'feedback'],
        },
        execute: async (args) => {
          const decision = requireString(args, 'decision') as ReviewDecision;
          if (decision !== 'approved' && decision !== 'changes_requested') {
            throw badRequest('invalid_input', `Unknown decision "${decision}"`);
          }
          const outcome = await submitReviewVerdict(ctx, decision, requireString(args, 'feedback'));
          return JSON.stringify(outcome);
        },
      },
    ];
  }

  return [
    ...shared,
    {
      name: 'update_issue_status',
      description:
        'Move the issue to a new status. Transitions follow the board rules; illegal moves are rejected.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: STATUS_VALUES } },
        required: ['status'],
      },
      execute: async (args) => {
        const status = requireString(args, 'status') as IssueStatus;
        if (!STATUS_VALUES.includes(status)) {
          throw badRequest('invalid_input', `Unknown status "${status}"`);
        }
        const issue = await updateIssueStatus(ctx, status);
        return JSON.stringify({ status: issue.status });
      },
    },
    {
      name: 'ask_blocker',
      description:
        'You are stuck and need a human decision. Posts the question to the timeline and marks the issue blocked.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
      },
      execute: async (args) => {
        const issue = await askBlocker(ctx, requireString(args, 'question'));
        return JSON.stringify({ status: issue.status });
      },
    },
    {
      name: 'submit_result',
      description:
        'You finished the work. Posts your result summary to the timeline and hands the issue to review.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      execute: async (args) => {
        const issue = await submitResult(ctx, requireString(args, 'summary'));
        return JSON.stringify({ status: issue.status });
      },
    },
  ];
}
