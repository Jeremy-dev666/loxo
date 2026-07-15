import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import type { IssueStatus } from '../src/db/schema';
import { ALLOWED_TRANSITIONS } from '../src/modules/issues/issue-transitions';

const app = createApp();
let token = '';
let otherToken = '';
let agentId = '';
let userId = '';
let projectId = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'issues@example.com',
    username: 'issuesuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  const other = await request(app).post('/auth/register').send({
    email: 'issues-other@example.com',
    username: 'issuesother',
    password: 'a-strong-password',
  });
  otherToken = other.body.token;

  const agent = await request(app)
    .post('/api/agents')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Issue worker', runtime: 'api' });
  agentId = agent.body.agent.id;

  const project = await request(app)
    .post('/api/projects')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Issue home' });
  projectId = project.body.project.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });
const otherAuth = () => ({ Authorization: `Bearer ${otherToken}` });

async function create(body: Record<string, unknown>) {
  const res = await request(app).post('/api/issues').set(auth()).send(body);
  expect(res.status).toBe(201);
  return res.body.issue;
}

async function move(id: string, status: string, boardOrder?: number) {
  return request(app)
    .post(`/api/issues/${id}/move`)
    .set(auth())
    .send({ status, ...(boardOrder !== undefined ? { boardOrder } : {}) });
}

describe('issue creation', () => {
  it('creates in a chosen project with backlog status and a number', async () => {
    const issue = await create({ title: 'First issue', projectId });
    expect(issue.status).toBe('backlog');
    expect(issue.projectId).toBe(projectId);
    expect(issue.issueNumber).toBeGreaterThan(0);
  });

  it('falls back to the inbox when no project is given', async () => {
    const issue = await create({ title: 'Quick capture' });
    const projectRes = await request(app)
      .get(`/api/projects/${issue.projectId}`)
      .set(auth());
    expect(projectRes.body.project.kind).toBe('inbox');
  });

  it('rejects a foreign project', async () => {
    const foreign = await request(app)
      .post('/api/projects')
      .set(otherAuth())
      .send({ name: 'Not yours' });
    const res = await request(app)
      .post('/api/issues')
      .set(auth())
      .send({ title: 'Nope', projectId: foreign.body.project.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_project');
  });

  it('draws unique consecutive numbers under concurrent creation', async () => {
    const before = await request(app).get('/api/issues').set(auth());
    const startCount = before.body.issues.length;

    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app).post('/api/issues').set(auth()).send({ title: `Concurrent ${i}` })
      )
    );
    const numbers = created.map((r) => r.body.issue.issueNumber as number);
    expect(new Set(numbers).size).toBe(10);

    const after = await request(app).get('/api/issues').set(auth());
    expect(after.body.issues.length).toBe(startCount + 10);
  });

  it('numbers users independently', async () => {
    const foreign = await request(app)
      .post('/api/issues')
      .set(otherAuth())
      .send({ title: 'Their first' });
    expect(foreign.status).toBe(201);
    expect(foreign.body.issue.issueNumber).toBe(1);
  });
});

describe('status transitions', () => {
  it('walks the happy path backlog -> todo -> in_progress -> in_review -> done', async () => {
    const issue = await create({ title: 'Happy path', projectId });
    for (const status of ['todo', 'in_progress', 'in_review', 'done']) {
      const res = await move(issue.id, status);
      expect(res.status).toBe(200);
      expect(res.body.issue.status).toBe(status);
    }
    const done = await request(app).get(`/api/issues/${issue.id}`).set(auth());
    expect(done.body.issue.closedAt).not.toBeNull();
  });

  it('supports the blocked loop and the review rework path', async () => {
    const issue = await create({ title: 'Bumpy path', projectId });
    await move(issue.id, 'todo');
    await move(issue.id, 'in_progress');
    expect((await move(issue.id, 'blocked')).body.issue.status).toBe('blocked');
    expect((await move(issue.id, 'in_progress')).body.issue.status).toBe('in_progress');
    await move(issue.id, 'in_review');
    // rework: reviewer sends it back
    expect((await move(issue.id, 'in_progress')).body.issue.status).toBe('in_progress');
  });

  it('rejects every move not in the transition table', async () => {
    const statuses = Object.keys(ALLOWED_TRANSITIONS) as IssueStatus[];
    // Spot-check the full matrix through the API using a fresh issue driven
    // to each source status via legal paths.
    const pathTo: Record<IssueStatus, IssueStatus[]> = {
      backlog: [],
      todo: ['todo'],
      in_progress: ['todo', 'in_progress'],
      blocked: ['todo', 'in_progress', 'blocked'],
      in_review: ['todo', 'in_progress', 'in_review'],
      done: ['todo', 'in_progress', 'in_review', 'done'],
      cancelled: ['cancelled'],
    };
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to || ALLOWED_TRANSITIONS[from].includes(to)) continue;
        const issue = await create({ title: `matrix ${from} -> ${to}`, projectId });
        for (const step of pathTo[from]) await move(issue.id, step);
        const res = await move(issue.id, to);
        expect(res.status, `${from} -> ${to} must be rejected`).toBe(400);
        expect(res.body.code).toBe('invalid_transition');
      }
    }
  });

  it('treats a same-status move as a pure reorder', async () => {
    const issue = await create({ title: 'Reorder me', projectId });
    const res = await move(issue.id, 'backlog', 0.5);
    expect(res.status).toBe(200);
    expect(res.body.issue.boardOrder).toBe(0.5);
  });
});

describe('assignment', () => {
  it('assigns an owned agent and clears it again', async () => {
    const issue = await create({ title: 'For the agent', projectId });
    const assigned = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId } });
    expect(assigned.body.issue.assigneeAgentId).toBe(agentId);
    expect(assigned.body.issue.assigneeUserId).toBeNull();

    const cleared = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: null });
    expect(cleared.body.issue.assigneeAgentId).toBeNull();
  });

  it('assigns the owner as a human assignee', async () => {
    const issue = await create({ title: 'For me', projectId });
    const res = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { userId } });
    expect(res.body.issue.assigneeUserId).toBe(userId);
    expect(res.body.issue.assigneeAgentId).toBeNull();
  });

  it('rejects agent and user in the same slot', async () => {
    const issue = await create({ title: 'Greedy', projectId });
    const res = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId, userId } });
    expect(res.status).toBe(400);
  });

  it("rejects another user's agent", async () => {
    const foreignAgent = await request(app)
      .post('/api/agents')
      .set(otherAuth())
      .send({ name: 'Foreign worker', runtime: 'api' });
    const issue = await create({ title: 'Stolen labor', projectId });
    const res = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId: foreignAgent.body.agent.id } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_assignee');
  });

  it('sets a reviewer independently of the assignee', async () => {
    const issue = await create({ title: 'Reviewed', projectId });
    const res = await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId }, reviewer: { userId } });
    expect(res.body.issue.assigneeAgentId).toBe(agentId);
    expect(res.body.issue.reviewerUserId).toBe(userId);
  });
});

describe('board and isolation', () => {
  it('groups issues by status ordered by boardOrder', async () => {
    const a = await create({ title: 'Board A', projectId });
    const b = await create({ title: 'Board B', projectId });
    await move(a.id, 'backlog', 2);
    await move(b.id, 'backlog', 1);

    const res = await request(app).get(`/api/issues/board?projectId=${projectId}`).set(auth());
    expect(res.status).toBe(200);
    const backlog = res.body.board.backlog as { id: string }[];
    const posA = backlog.findIndex((i) => i.id === a.id);
    const posB = backlog.findIndex((i) => i.id === b.id);
    expect(posB).toBeLessThan(posA);
    expect(res.body.board.done).toBeInstanceOf(Array);
  });

  it("hides other users' issues everywhere", async () => {
    const mine = await create({ title: 'Mine only', projectId });
    const listed = await request(app).get('/api/issues').set(otherAuth());
    expect(listed.body.issues.some((i: { id: string }) => i.id === mine.id)).toBe(false);
    const fetched = await request(app).get(`/api/issues/${mine.id}`).set(otherAuth());
    expect(fetched.status).toBe(404);
    const moved = await request(app)
      .post(`/api/issues/${mine.id}/move`)
      .set(otherAuth())
      .send({ status: 'todo' });
    expect(moved.status).toBe(404);
  });
});
