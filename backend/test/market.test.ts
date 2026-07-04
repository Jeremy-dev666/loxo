import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { storage } from '../src/storage/layout';

const app = createApp();
let sellerToken = '';
let buyerToken = '';
let sellerId = '';
let agentId = '';
let listingId = '';

const asSeller = () => ({ Authorization: `Bearer ${sellerToken}` });
const asBuyer = () => ({ Authorization: `Bearer ${buyerToken}` });

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');

  const seller = await request(app).post('/auth/register').send({
    email: 'seller@example.com',
    username: 'selleruser',
    password: 'a-strong-password',
  });
  sellerToken = seller.body.token;
  sellerId = seller.body.user.id;

  const buyer = await request(app).post('/auth/register').send({
    email: 'buyer@example.com',
    username: 'buyeruser',
    password: 'a-strong-password',
  });
  buyerToken = buyer.body.token;

  const agent = await request(app)
    .post('/api/agents')
    .set(asSeller())
    .send({ name: 'Docs Writer', runtime: 'claude-code', description: 'Writes docs' });
  agentId = agent.body.agent.id;

  // Workspace with a publishable file, a sensitive path, and an embedded secret.
  const workspace = storage.agentPaths(sellerId, agentId).workspace;
  fs.writeFileSync(path.join(workspace, 'SKILL.md'), '# Docs skill\nWrite clear docs.');
  fs.writeFileSync(path.join(workspace, '.env'), 'ANTHROPIC_API_KEY=sk-ant-secret');
  fs.writeFileSync(
    path.join(workspace, 'notes.md'),
    'my key is sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCD ok'
  );
});

describe('publish', () => {
  it('publishes an agent workspace with sanitization', async () => {
    const res = await request(app)
      .post('/api/market/publish')
      .set(asSeller())
      .send({ agentId, tags: ['docs', 'writing', 'docs'] });

    expect(res.status).toBe(201);
    expect(res.body.alreadyPublished).toBe(false);
    expect(res.body.sanitization).toBeTruthy();
    listingId = res.body.listing.id;
    expect(res.body.listing.runtime).toBe('claude-code');
    expect(res.body.listing.tags).toEqual(['docs', 'writing']);

    const sourceDir = storage.marketplaceSource(listingId, '1.0.0');
    expect(fs.existsSync(path.join(sourceDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, '.env'))).toBe(false);
    const notes = fs.readFileSync(path.join(sourceDir, 'notes.md'), 'utf8');
    expect(notes).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz');
    expect(notes).toContain('[REDACTED_BY_MARKETPLACE]');

    // Source workspace is untouched.
    const workspace = storage.agentPaths(sellerId, agentId).workspace;
    expect(fs.existsSync(path.join(workspace, '.env'))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'notes.md'), 'utf8')).toContain('sk-ant-abcdef');
  });

  it('returns the existing listing on duplicate publish', async () => {
    const res = await request(app).post('/api/market/publish').set(asSeller()).send({ agentId });
    expect(res.status).toBe(200);
    expect(res.body.alreadyPublished).toBe(true);
    expect(res.body.listing.id).toBe(listingId);
  });

  it('rejects publishing an empty workspace', async () => {
    const empty = await request(app)
      .post('/api/agents')
      .set(asSeller())
      .send({ name: 'Empty', runtime: 'api' });
    const res = await request(app)
      .post('/api/market/publish')
      .set(asSeller())
      .send({ agentId: empty.body.agent.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('empty_workspace');
  });
});

describe('listing and download', () => {
  it('lists public listings for other users, official entry included and first', async () => {
    const res = await request(app).get('/api/market').set(asBuyer());
    expect(res.status).toBe(200);
    const names = res.body.listings.map((l: { name: string }) => l.name);
    expect(names).toContain('Docs Writer');
    expect(res.body.listings[0].isOfficial).toBe(true);
    const mine = res.body.listings.find((l: { id: string }) => l.id === listingId);
    expect(mine.hasFiles).toBe(true);
    expect(mine.ownerUsername).toBe('selleruser');
  });

  it('exposes version metadata with checksum', async () => {
    const res = await request(app).get(`/api/market/${listingId}/versions`).set(asBuyer());
    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0].version).toBe('1.0.0');
    expect(res.body.versions[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('clones the listing into the buyer account on download', async () => {
    const res = await request(app).post(`/api/market/${listingId}/download`).set(asBuyer());
    expect(res.status).toBe(201);
    const cloned = res.body.agent;
    expect(cloned.name).toBe('Docs Writer');
    expect(cloned.runtime).toBe('claude-code');
    expect(cloned.sourceListingId).toBe(listingId);

    const clonedWorkspace = storage.agentPaths(cloned.userId, cloned.id).workspace;
    expect(fs.existsSync(path.join(clonedWorkspace, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(clonedWorkspace, '.env'))).toBe(false);

    const detail = await request(app).get(`/api/market/${listingId}`).set(asBuyer());
    expect(detail.body.listing.downloadCount).toBe(1);
  });

  it('blocks downloading private listings of other users', async () => {
    const privAgent = await request(app)
      .post('/api/agents')
      .set(asSeller())
      .send({ name: 'Private Agent', runtime: 'api' });
    const ws = storage.agentPaths(sellerId, privAgent.body.agent.id).workspace;
    fs.writeFileSync(path.join(ws, 'README.md'), 'private');

    const pub = await request(app)
      .post('/api/market/publish')
      .set(asSeller())
      .send({ agentId: privAgent.body.agent.id, visibility: 'private' });
    const privListingId = pub.body.listing.id;

    const denied = await request(app).post(`/api/market/${privListingId}/download`).set(asBuyer());
    expect(denied.status).toBe(403);

    const allowed = await request(app).post(`/api/market/${privListingId}/download`).set(asSeller());
    expect(allowed.status).toBe(201);
  });
});

describe('official agent adoption', () => {
  it('adopts the fallback official template with a chosen runtime', async () => {
    const res = await request(app)
      .post('/api/market/official/adopt')
      .set(asBuyer())
      .send({ name: 'My Starter', runtime: 'opencode' });
    expect(res.status).toBe(201);
    expect(res.body.agent.name).toBe('My Starter');
    expect(res.body.agent.runtime).toBe('opencode');

    const ws = storage.agentPaths(res.body.agent.userId, res.body.agent.id).workspace;
    expect(fs.existsSync(path.join(ws, 'SOUL.md'))).toBe(true);
  });

  it('requires a name', async () => {
    const res = await request(app)
      .post('/api/market/official/adopt')
      .set(asBuyer())
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('unpublish', () => {
  it('rejects unpublish by non-owners', async () => {
    const res = await request(app).delete(`/api/market/${listingId}`).set(asBuyer());
    expect(res.status).toBe(403);
  });

  it('removes the listing row and files on unpublish', async () => {
    const res = await request(app).delete(`/api/market/publish/${agentId}`).set(asSeller());
    expect(res.status).toBe(200);

    const detail = await request(app).get(`/api/market/${listingId}`).set(asSeller());
    expect(detail.status).toBe(404);
    expect(fs.existsSync(storage.marketplaceListingRoot(listingId))).toBe(false);
  });

  it('keeps downloaded clones working after unpublish', async () => {
    const list = await request(app).get('/api/agents').set(asBuyer());
    const clone = list.body.agents.find((a: { name: string }) => a.name === 'Docs Writer');
    expect(clone).toBeTruthy();
    expect(clone.sourceListingId).toBeNull();
  });

  it('retracts the listing when the source agent is deleted', async () => {
    const agent = await request(app)
      .post('/api/agents')
      .set(asSeller())
      .send({ name: 'Ephemeral', runtime: 'api' });
    const ws = storage.agentPaths(sellerId, agent.body.agent.id).workspace;
    fs.writeFileSync(path.join(ws, 'README.md'), 'temp');
    const pub = await request(app)
      .post('/api/market/publish')
      .set(asSeller())
      .send({ agentId: agent.body.agent.id });

    await request(app).delete(`/api/agents/${agent.body.agent.id}`).set(asSeller());

    const detail = await request(app).get(`/api/market/${pub.body.listing.id}`).set(asSeller());
    expect(detail.status).toBe(404);
  });
});
