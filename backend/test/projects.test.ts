import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { createExecution, getExecution } from '../src/modules/workflows/execution-store';
import { normalizeDsl } from '../src/modules/teams/workflow-dsl';
import { projectRoot } from '../src/modules/projects/projects.service';
import { storage } from '../src/storage/layout';

const app = createApp();
let token = '';
let userId = '';
let teamId = '';
let agentId = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'projects@example.com',
    username: 'projectsuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  const team = await request(app)
    .post('/api/teams')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Bound team' });
  teamId = team.body.team.id;

  const agent = await request(app)
    .post('/api/agents')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Bound agent', runtime: 'api' });
  agentId = agent.body.agent.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('projects', () => {
  let projectId = '';

  it('creates a project with bindings and disk metadata', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(auth())
      .send({
        name: 'Research hub',
        description: 'All research work',
        teamIds: [teamId],
        agentIds: [agentId],
      });
    expect(res.status).toBe(201);
    projectId = res.body.project.id;
    expect(res.body.project.teamIds).toEqual([teamId]);
    expect(res.body.project.agentIds).toEqual([agentId]);

    const metaFile = path.join(storage.projectWorkspace(userId, projectId), '.swarmdev-project.json');
    expect(fs.existsSync(metaFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(metaFile, 'utf8')).name).toBe('Research hub');
  });

  it('rejects bindings to teams or agents the user does not own', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'Bad bindings', teamIds: [crypto.randomUUID()] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_binding');
  });

  it('orders the list by recency and lets touch reorder it', async () => {
    const second = await request(app)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'Second project' });
    expect(second.status).toBe(201);

    let list = await request(app).get('/api/projects').set(auth());
    expect(list.body.projects[0].name).toBe('Second project');

    const touched = await request(app).post(`/api/projects/${projectId}/open`).set(auth());
    expect(touched.status).toBe(200);

    list = await request(app).get('/api/projects').set(auth());
    expect(list.body.projects[0].id).toBe(projectId);
    // Touch lands at least 1s past the previous maximum.
    const [first, next] = list.body.projects;
    expect(new Date(first.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(next.updatedAt).getTime() + 1000
    );
  });

  it('updates fields and replaces bindings', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set(auth())
      .send({ description: 'Updated intro', agentIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.project.description).toBe('Updated intro');
    expect(res.body.project.agentIds).toEqual([]);
    expect(res.body.project.teamIds).toEqual([teamId]); // untouched when omitted
  });

  it('hides foreign projects', async () => {
    const stranger = await request(app).post('/auth/register').send({
      email: 'stranger-projects@example.com',
      username: 'strangerprojects',
      password: 'a-strong-password',
    });
    const res = await request(app)
      .get(`/api/projects/${projectId}`)
      .set({ Authorization: `Bearer ${stranger.body.token}` });
    expect(res.status).toBe(404);
  });

  it('validates project ownership on workflow execute', async () => {
    const stranger = await request(app).post('/auth/login').send({
      email: 'stranger-projects@example.com',
      password: 'a-strong-password',
    });
    const strangerTeam = await request(app)
      .post('/api/teams')
      .set({ Authorization: `Bearer ${stranger.body.token}` })
      .send({ name: 'Stranger team' });

    const res = await request(app)
      .post('/api/workflows/execute')
      .set({ Authorization: `Bearer ${stranger.body.token}` })
      .send({ teamId: strangerTeam.body.team.id, task: 'x', projectId });
    expect(res.status).toBe(404);
  });

  it('deletes the project, its disk root, and cascades executions', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'Disposable' });
    const disposableId = res.body.project.id;
    const root = projectRoot(userId, disposableId);
    expect(fs.existsSync(root)).toBe(true);

    const workflow = normalizeDsl(
      {
        nodes: [
          { id: 'start', type: 'start', label: 'Task' },
          { id: 'a', type: 'agent', label: 'A', kind: 'worker' },
          { id: 'end', type: 'end', label: 'Done' },
        ],
        edges: [
          { from: 'start', to: 'a' },
          { from: 'a', to: 'end' },
        ],
      },
      new Set()
    );
    const execution = await createExecution({
      userId,
      teamId,
      projectId: disposableId,
      task: 'cascade check',
      mode: 'dag',
      dryRun: true,
      workflow,
      nodeIds: workflow.nodes.map((n) => n.id),
    });

    const del = await request(app).delete(`/api/projects/${disposableId}`).set(auth());
    expect(del.status).toBe(200);
    expect(fs.existsSync(root)).toBe(false);
    expect(await getExecution(userId, execution.id)).toBeNull();
  });
});
