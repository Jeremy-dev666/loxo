import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { getOrCreateDefaultProject } from '../src/modules/projects/projects.service';

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

describe('default project', () => {
  it('creates the default project exactly once under concurrent first use', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateDefaultProject(userId))
    );
    const ids = new Set(results.map((p) => p.id));
    expect(ids.size).toBe(1);
    expect(results[0]!.kind).toBe('default');
    expect(results[0]!.name).toBe('Default Project');
  });

  it('returns the same default project on later calls', async () => {
    const first = await getOrCreateDefaultProject(userId);
    const second = await getOrCreateDefaultProject(userId);
    expect(second.id).toBe(first.id);
  });

  it('keeps default projects separate per user', async () => {
    const other = await request(app).post('/auth/register').send({
      email: 'inbox-other@example.com',
      username: 'inboxother',
      password: 'a-strong-password',
    });
    const mine = await getOrCreateDefaultProject(userId);
    const theirs = await getOrCreateDefaultProject(other.body.user.id);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.userId).toBe(other.body.user.id);
  });

  it('refuses to delete the default project', async () => {
    const inbox = await getOrCreateDefaultProject(userId);
    const res = await request(app).delete(`/api/projects/${inbox.id}`).set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('default_project_protected');
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
