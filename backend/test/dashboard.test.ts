import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { claimRun, createQueuedRun, finishRun } from '../src/modules/runs/runs.service';

const app = createApp();
let token = '';
let userId = '';
let otherToken = '';
let agentId = '';
let todoIssueId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createIssue(title: string): Promise<{ id: string }> {
  const res = await request(app).post('/api/issues').set(auth()).send({ title });
  return res.body.issue;
}

async function moveIssue(issueId: string, status: string): Promise<void> {
  const res = await request(app).post(`/api/issues/${issueId}/move`).set(auth()).send({ status });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'dashboard@example.com',
    username: 'dashuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  const other = await request(app).post('/auth/register').send({
    email: 'dashboard-other@example.com',
    username: 'dashother',
    password: 'a-strong-password',
  });
  otherToken = other.body.token;

  const agent = await request(app)
    .post('/api/agents')
    .set(auth())
    .send({ name: 'Dash worker', runtime: 'api' });
  agentId = agent.body.agent.id;

  await createIssue('Backlog item');

  const todoIssue = await createIssue('Todo item');
  todoIssueId = todoIssue.id;
  await moveIssue(todoIssue.id, 'todo');
  await request(app)
    .post(`/api/issues/${todoIssue.id}/comments`)
    .set(auth())
    .send({ body: 'Kicking this off' });

  // Full review cycle: approved verdict lands the issue in done with closedAt set.
  const reviewIssue = await createIssue('Review flow');
  await moveIssue(reviewIssue.id, 'todo');
  await moveIssue(reviewIssue.id, 'in_progress');
  await moveIssue(reviewIssue.id, 'in_review');
  const review = await request(app)
    .post(`/api/issues/${reviewIssue.id}/reviews`)
    .set(auth())
    .send({ decision: 'approved', body: 'Ship it' });
  expect(review.status).toBe(201);

  const queued = await createQueuedRun(userId, {
    agentId,
    agentName: 'Dash worker',
    issueId: todoIssueId,
    trigger: 'assignment',
  });
  expect(queued.status).toBe('queued');

  const succeeded = await createQueuedRun(userId, {
    agentId,
    agentName: 'Dash worker',
    issueId: todoIssueId,
    trigger: 'manual',
  });
  await claimRun(succeeded.id);
  await finishRun(succeeded.id, {
    status: 'succeeded',
    output: 'done',
    tokensIn: 100,
    tokensOut: 200,
    costUsd: 0.5,
  });

  const failed = await createQueuedRun(userId, {
    agentId,
    agentName: 'Dash worker',
    issueId: null,
    trigger: 'chat',
  });
  await claimRun(failed.id);
  await finishRun(failed.id, { status: 'failed', error: 'runtime crashed', costUsd: 0.25 });
});

describe('GET /api/dashboard/summary', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(401);
  });

  it('aggregates issues, runs, agents, and today usage', async () => {
    const res = await request(app).get('/api/dashboard/summary').set(auth());
    expect(res.status).toBe(200);
    const { summary } = res.body;

    expect(summary.issues.byStatus).toMatchObject({ backlog: 1, todo: 1, done: 1 });
    expect(summary.issues.open).toBe(2);

    expect(summary.runs).toEqual({ active: 1, queued: 1, running: 0 });
    expect(summary.agents).toEqual({ total: 1, busy: 0 });

    expect(summary.today.runs).toBe(3);
    expect(summary.today.failedRuns).toBe(1);
    expect(summary.today.costUsd).toBeCloseTo(0.75);
    expect(summary.today.tokensIn).toBe(100);
    expect(summary.today.tokensOut).toBe(200);
  });

  it('lists active and recent runs with issue context', async () => {
    const res = await request(app).get('/api/dashboard/summary').set(auth());
    const { summary } = res.body;

    expect(summary.activeRuns).toHaveLength(1);
    expect(summary.activeRuns[0]).toMatchObject({
      status: 'queued',
      agentName: 'Dash worker',
      issueTitle: 'Todo item',
    });

    expect(summary.recentRuns).toHaveLength(2);
    const statuses = summary.recentRuns.map((run: { status: string }) => run.status).sort();
    expect(statuses).toEqual(['failed', 'succeeded']);
    const failedRun = summary.recentRuns.find((run: { status: string }) => run.status === 'failed');
    expect(failedRun.error).toBe('runtime crashed');
    expect(failedRun.issueTitle).toBeNull();
  });

  it('returns an empty summary for another user', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(200);
    const { summary } = res.body;
    expect(summary.issues.open).toBe(0);
    expect(summary.runs.active).toBe(0);
    expect(summary.agents.total).toBe(0);
    expect(summary.today).toEqual({ runs: 0, failedRuns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
    expect(summary.activeRuns).toEqual([]);
    expect(summary.recentRuns).toEqual([]);
  });
});

describe('GET /api/dashboard/activity', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/dashboard/activity');
    expect(res.status).toBe(401);
  });

  it('merges events across sources, newest first', async () => {
    const res = await request(app).get('/api/dashboard/activity').set(auth());
    expect(res.status).toBe(200);
    const events = res.body.events as Array<{
      kind: string;
      occurredAt: string;
      issueTitle: string | null;
      actorType: string;
      actorName: string | null;
      detail: string | null;
    }>;

    for (let i = 1; i < events.length; i += 1) {
      expect(new Date(events[i - 1]!.occurredAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i]!.occurredAt).getTime()
      );
    }

    const kinds = new Set(events.map((event) => event.kind));
    expect(kinds).toContain('run_finished');
    expect(kinds).toContain('issue_created');
    expect(kinds).toContain('issue_closed');
    expect(kinds).toContain('comment');
    expect(kinds).toContain('review');

    const runEvents = events.filter((event) => event.kind === 'run_finished');
    expect(runEvents).toHaveLength(2);
    expect(runEvents.every((event) => event.actorName === 'Dash worker')).toBe(true);

    const closed = events.find((event) => event.kind === 'issue_closed');
    expect(closed).toMatchObject({ issueTitle: 'Review flow', detail: 'done' });

    const reviewEvent = events.find((event) => event.kind === 'review');
    expect(reviewEvent).toMatchObject({ actorType: 'human', detail: 'approved' });

    expect(events.filter((event) => event.kind === 'issue_created')).toHaveLength(3);
  });

  it('honors the limit parameter and rejects invalid values', async () => {
    const limited = await request(app).get('/api/dashboard/activity?limit=3').set(auth());
    expect(limited.status).toBe(200);
    expect(limited.body.events).toHaveLength(3);

    const invalid = await request(app).get('/api/dashboard/activity?limit=0').set(auth());
    expect(invalid.status).toBe(400);
  });

  it('scopes the feed to the owning user', async () => {
    const res = await request(app)
      .get('/api/dashboard/activity')
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });
});
