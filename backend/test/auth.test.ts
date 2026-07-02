import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';

const app = createApp();

const account = {
  email: 'dev@example.com',
  username: 'devuser',
  password: 'correct-horse-battery',
};

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
});

describe('auth', () => {
  it('registers a new user and returns a token', async () => {
    const res = await request(app).post('/auth/register').send(account);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: account.email, username: account.username });
    expect(res.body.token).toBeTruthy();
  });

  it('rejects duplicate email with a structured conflict', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...account, username: 'otheruser' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_taken');
  });

  it('rejects weak passwords', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'short@example.com', username: 'shortpw', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_input');
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: account.email, password: account.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: account.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ email: account.email, password: account.password });
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(account.email);
  });

  it('rejects /auth/me without a token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });
});
