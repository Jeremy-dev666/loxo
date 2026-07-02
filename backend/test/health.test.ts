import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app';

describe('GET /health', () => {
  it('reports ok with a timestamp', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'not_found', message: 'Route not found' });
  });
});
