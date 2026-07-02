import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { storage } from '../src/storage/layout';

const app = createApp();
let token = '';
let userId = '';
let agentA = '';
let agentB = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'teams@example.com',
    username: 'teamsuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  for (const [name, target] of [
    ['Researcher', 'a'],
    ['Writer', 'b'],
  ] as const) {
    const res = await request(app)
      .post('/api/agents')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name, runtime: 'api' });
    if (target === 'a') agentA = res.body.agent.id;
    else agentB = res.body.agent.id;
  }
});

const auth = () => ({ Authorization: `Bearer ${token}` });

const workflowWith = (agentIds: { research?: string; write?: string }) => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Task' },
    { id: 'research', type: 'agent', label: 'Research', kind: 'worker', agentId: agentIds.research },
    { id: 'gate', type: 'condition', label: 'Good enough?', expression: 'quality acceptable' },
    { id: 'write', type: 'agent', label: 'Write', kind: 'worker', agentId: agentIds.write },
    { id: 'end', type: 'end', label: 'Done' },
  ],
  edges: [
    { from: 'start', to: 'research' },
    { from: 'research', to: 'gate' },
    { from: 'gate', to: 'write', branch: 'yes' },
    { from: 'gate', to: 'research', branch: 'no' },
    { from: 'write', to: 'end' },
  ],
});

describe('teams', () => {
  let teamId = '';

  it('creates a team and persists the manifest file', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set(auth())
      .send({ name: 'Research Duo', workflow: workflowWith({ research: agentA, write: agentB }) });
    expect(res.status).toBe(201);
    teamId = res.body.team.id;

    const manifest = path.join(storage.teamDir(userId, teamId), 'team.json');
    expect(fs.existsSync(manifest)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    expect(parsed.execution.mode).toBe('state-machine'); // gate->research back-edge
  });

  it('round-trips the workflow through GET', async () => {
    const res = await request(app).get(`/api/teams/${teamId}`).set(auth());
    expect(res.status).toBe(200);
    const nodes = res.body.team.workflow.nodes;
    expect(nodes).toHaveLength(5);
    expect(nodes.find((n: { id: string }) => n.id === 'research').agentId).toBe(agentA);
  });

  it('syncs team_members from the manifest', async () => {
    const { rows } = await pool.query('SELECT agent_id FROM team_members WHERE team_id = $1', [teamId]);
    expect(rows.map((r: { agent_id: string }) => r.agent_id).sort()).toEqual([agentA, agentB].sort());
  });

  it('rejects saving a structurally broken workflow unless draft', async () => {
    const broken = {
      nodes: [
        { id: 'start', type: 'start', label: 'S' },
        { id: 'start-2', type: 'start', label: 'S2' },
        { id: 'a', type: 'agent', label: 'A' },
        { id: 'end', type: 'end', label: 'E' },
      ],
      edges: [
        { from: 'start', to: 'a' },
        { from: 'a', to: 'end' },
      ],
    };
    const strict = await request(app)
      .put(`/api/teams/${teamId}/workflow`)
      .set(auth())
      .send(broken);
    expect(strict.status).toBe(400);
    expect(strict.body.code).toBe('invalid_workflow');

    const draft = await request(app)
      .put(`/api/teams/${teamId}/workflow?draft=1`)
      .set(auth())
      .send(broken);
    expect(draft.status).toBe(200);

    // Restore a valid workflow for the following tests.
    const restore = await request(app)
      .put(`/api/teams/${teamId}/workflow`)
      .set(auth())
      .send(workflowWith({ research: agentA, write: agentB }));
    expect(restore.status).toBe(200);
  });

  it('strips a deleted agent from the manifest', async () => {
    const del = await request(app).delete(`/api/agents/${agentB}`).set(auth());
    expect(del.status).toBe(200);

    const res = await request(app).get(`/api/teams/${teamId}`).set(auth());
    const write = res.body.team.workflow.nodes.find((n: { id: string }) => n.id === 'write');
    expect(write.agentId).toBeUndefined();
    expect(
      res.body.team.warnings.some((w: { code: string }) => w.code === 'unbound_agent')
    ).toBe(true);
  });

  it('generate-dsl falls back deterministically without a provider', async () => {
    const res = await request(app)
      .post('/api/teams/generate-dsl')
      .set(auth())
      .send({ prompt: 'research a topic then summarize it' });
    expect(res.status).toBe(200);
    expect(res.body.generator).toBe('fallback');
    expect(res.body.workflow.nodes.length).toBeGreaterThanOrEqual(3);
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });

  it('deletes the team, its members, and the manifest dir', async () => {
    const dir = storage.teamDir(userId, teamId);
    const res = await request(app).delete(`/api/teams/${teamId}`).set(auth());
    expect(res.status).toBe(200);
    expect(fs.existsSync(dir)).toBe(false);
    const { rows } = await pool.query('SELECT 1 FROM team_members WHERE team_id = $1', [teamId]);
    expect(rows).toHaveLength(0);
  });
});
