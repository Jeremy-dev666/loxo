import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { getOrCreateInboxProject } from '../src/modules/projects/projects.service';

const app = createApp();
let token = '';
let userId = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'inbox@example.com',
    username: 'inboxuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('inbox project', () => {
  it('creates the inbox exactly once under concurrent first use', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateInboxProject(userId))
    );
    const ids = new Set(results.map((p) => p.id));
    expect(ids.size).toBe(1);
    expect(results[0]!.kind).toBe('inbox');
    expect(results[0]!.name).toBe('Inbox');
  });

  it('returns the same inbox on later calls', async () => {
    const first = await getOrCreateInboxProject(userId);
    const second = await getOrCreateInboxProject(userId);
    expect(second.id).toBe(first.id);
  });

  it('keeps inboxes separate per user', async () => {
    const other = await request(app).post('/auth/register').send({
      email: 'inbox-other@example.com',
      username: 'inboxother',
      password: 'a-strong-password',
    });
    const mine = await getOrCreateInboxProject(userId);
    const theirs = await getOrCreateInboxProject(other.body.user.id);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.userId).toBe(other.body.user.id);
  });

  it('refuses to delete the inbox', async () => {
    const inbox = await getOrCreateInboxProject(userId);
    const res = await request(app).delete(`/api/projects/${inbox.id}`).set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('inbox_protected');
  });

  it('still deletes normal projects', async () => {
    const created = await request(app)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'Disposable' });
    const res = await request(app)
      .delete(`/api/projects/${created.body.project.id}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
