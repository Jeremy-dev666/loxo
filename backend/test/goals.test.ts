import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';

const app = createApp();
let token = '';
let otherToken = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'goals@example.com',
    username: 'goalsuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  const other = await request(app).post('/auth/register').send({
    email: 'goals-other@example.com',
    username: 'goalsother',
    password: 'a-strong-password',
  });
  otherToken = other.body.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });
const otherAuth = () => ({ Authorization: `Bearer ${otherToken}` });

async function create(title: string, parentGoalId?: string) {
  const res = await request(app)
    .post('/api/goals')
    .set(auth())
    .send({ title, ...(parentGoalId ? { parentGoalId } : {}) });
  expect(res.status).toBe(201);
  return res.body.goal as { id: string; parentGoalId: string | null; status: string };
}

describe('goals', () => {
  it('creates and lists goals with default active status', async () => {
    const goal = await create('Grow retention');
    expect(goal.status).toBe('active');
    expect(goal.parentGoalId).toBeNull();

    const list = await request(app).get('/api/goals').set(auth());
    expect(list.status).toBe(200);
    expect(list.body.goals.some((g: { id: string }) => g.id === goal.id)).toBe(true);
  });

  it('attaches a child to an existing parent', async () => {
    const parent = await create('Ship v1');
    const child = await create('Ship onboarding', parent.id);
    expect(child.parentGoalId).toBe(parent.id);
  });

  it('rejects a parent that does not exist', async () => {
    const res = await request(app)
      .post('/api/goals')
      .set(auth())
      .send({ title: 'Orphan', parentGoalId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_parent');
  });

  it("rejects another user's goal as parent", async () => {
    const foreign = await request(app)
      .post('/api/goals')
      .set(otherAuth())
      .send({ title: 'Foreign goal' });
    const res = await request(app)
      .post('/api/goals')
      .set(auth())
      .send({ title: 'Mine', parentGoalId: foreign.body.goal.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_parent');
  });

  it('rejects self-parenting', async () => {
    const goal = await create('Self');
    const res = await request(app)
      .patch(`/api/goals/${goal.id}`)
      .set(auth())
      .send({ parentGoalId: goal.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('goal_cycle');
  });

  it('rejects a cycle across the chain (grandparent -> grandchild)', async () => {
    const a = await create('A');
    const b = await create('B', a.id);
    const c = await create('C', b.id);
    // A -> B -> C exists; re-parenting A under C would close the loop.
    const res = await request(app)
      .patch(`/api/goals/${a.id}`)
      .set(auth())
      .send({ parentGoalId: c.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('goal_cycle');
  });

  it('archives via status patch and filters by status', async () => {
    const goal = await create('To archive');
    const patched = await request(app)
      .patch(`/api/goals/${goal.id}`)
      .set(auth())
      .send({ status: 'archived' });
    expect(patched.status).toBe(200);
    expect(patched.body.goal.status).toBe('archived');

    const archived = await request(app).get('/api/goals?status=archived').set(auth());
    expect(archived.body.goals.every((g: { status: string }) => g.status === 'archived')).toBe(
      true
    );
    expect(archived.body.goals.some((g: { id: string }) => g.id === goal.id)).toBe(true);
  });

  it('detaches children instead of deleting them when the parent goes away', async () => {
    const parent = await create('Doomed parent');
    const child = await create('Surviving child', parent.id);

    const del = await request(app).delete(`/api/goals/${parent.id}`).set(auth());
    expect(del.status).toBe(200);

    const fetched = await request(app).get(`/api/goals/${child.id}`).set(auth());
    expect(fetched.status).toBe(200);
    expect(fetched.body.goal.parentGoalId).toBeNull();
  });

  it("hides other users' goals", async () => {
    const foreign = await request(app)
      .post('/api/goals')
      .set(otherAuth())
      .send({ title: 'Private goal' });
    const res = await request(app).get(`/api/goals/${foreign.body.goal.id}`).set(auth());
    expect(res.status).toBe(404);
  });
});
