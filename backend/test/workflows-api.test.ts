import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { setAgentNodeRunnerForTests } from '../src/modules/workflows/executor';

const app = createApp();
let token = '';
let otherToken = '';
let teamId = '';
let agentA = '';
let agentB = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'wfapi@example.com',
    username: 'wfapi',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  const other = await request(app).post('/auth/register').send({
    email: 'wfapi2@example.com',
    username: 'wfapi2',
    password: 'a-strong-password',
  });
  otherToken = other.body.token;

  for (const name of ['Alpha', 'Beta']) {
    const res = await request(app)
      .post('/api/agents')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name, runtime: 'api' });
    if (name === 'Alpha') agentA = res.body.agent.id;
    else agentB = res.body.agent.id;
  }

  const team = await request(app)
    .post('/api/teams')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      name: 'API flow team',
      workflow: {
        nodes: [
          { id: 'start', type: 'start', label: 'Task' },
          { id: 'research', type: 'agent', label: 'Research', kind: 'worker', agentId: agentA },
          { id: 'write', type: 'agent', label: 'Write', kind: 'worker', agentId: agentB },
          { id: 'end', type: 'end', label: 'Done' },
        ],
        edges: [
          { from: 'start', to: 'research' },
          { from: 'research', to: 'write' },
          { from: 'write', to: 'end' },
        ],
      },
    });
  teamId = team.body.team.id;
});

afterEach(() => {
  setAgentNodeRunnerForTests(null);
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function pollUntilTerminal(executionId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/workflows/executions/${executionId}`).set(auth());
    expect(res.status).toBe(200);
    if (!['queued', 'running'].includes(res.body.execution.status)) return res.body.execution;
    if (Date.now() > deadline) throw new Error('Execution did not finish');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('workflow API', () => {
  it('executes a team workflow end to end', async () => {
    setAgentNodeRunnerForTests(async (req) => ({
      output: `${req.node.label} finished`,
      artifacts: [],
    }));

    const res = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId, task: 'Cover the topic' });
    expect(res.status).toBe(202);
    expect(res.body.execution.status).toBe('queued');
    expect(res.body.execution.nodeStates).toHaveLength(4);

    const finished = await pollUntilTerminal(res.body.execution.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.finalOutput).toContain('Write finished');
    expect(finished.workflow.nodes).toHaveLength(4);
  });

  it('pages execution events by afterSeq', async () => {
    setAgentNodeRunnerForTests(async (req) => ({ output: `${req.node.label} ok`, artifacts: [] }));
    const res = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId, task: 'Events run' });
    const executionId = res.body.execution.id;
    await pollUntilTerminal(executionId);

    const all = await request(app)
      .get(`/api/workflows/executions/${executionId}/events`)
      .set(auth());
    expect(all.status).toBe(200);
    expect(all.body.events.length).toBeGreaterThan(4);
    expect(all.body.events[0].type).toBe('execution_started');
    expect(all.body.events.at(-1).type).toBe('execution_completed');

    const midSeq = all.body.events[3].seq;
    const tail = await request(app)
      .get(`/api/workflows/executions/${executionId}/events?afterSeq=${midSeq}`)
      .set(auth());
    expect(tail.body.events[0].seq).toBe(midSeq + 1);
  });

  it('lists executions filtered by team and hides other users', async () => {
    const list = await request(app).get(`/api/workflows/executions?teamId=${teamId}`).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.executions.length).toBeGreaterThan(0);
    expect(
      list.body.executions.every((e: { teamId: string }) => e.teamId === teamId)
    ).toBe(true);

    const foreign = await request(app)
      .get('/api/workflows/executions')
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(foreign.body.executions).toHaveLength(0);

    const denied = await request(app)
      .get(`/api/workflows/executions/${list.body.executions[0].id}`)
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(denied.status).toBe(404);
  });

  it('cancels a running execution over the API', async () => {
    setAgentNodeRunnerForTests(
      (req) =>
        new Promise((_resolve, reject) => {
          req.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        })
    );

    const res = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId, task: 'Cancel me' });
    const executionId = res.body.execution.id;

    // Wait until a node is actually running before cancelling.
    const deadline = Date.now() + 5000;
    for (;;) {
      const detail = await request(app)
        .get(`/api/workflows/executions/${executionId}`)
        .set(auth());
      if (
        detail.body.execution.nodeStates.some(
          (n: { status: string }) => n.status === 'running'
        )
      ) {
        break;
      }
      if (Date.now() > deadline) throw new Error('No node started');
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    const cancel = await request(app)
      .post(`/api/workflows/executions/${executionId}/cancel`)
      .set(auth());
    expect(cancel.status).toBe(200);
    expect(cancel.body.execution.status).toBe('cancelled');

    const foreignCancel = await request(app)
      .post(`/api/workflows/executions/${executionId}/cancel`)
      .set({ Authorization: `Bearer ${otherToken}` });
    expect(foreignCancel.status).toBe(404);
  });

  it('rejects invalid requests', async () => {
    const missingTask = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId });
    expect(missingTask.status).toBe(400);

    const unknownTeam = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId: crypto.randomUUID(), task: 'x' });
    expect(unknownTeam.status).toBe(404);

    const emptyTeam = await request(app)
      .post('/api/teams')
      .set(auth())
      .send({ name: 'No agents yet' });
    const invalid = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId: emptyTeam.body.team.id, task: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('invalid_workflow');
  });

  it('runs a dry run without agent bindings mattering', async () => {
    const res = await request(app)
      .post('/api/workflows/execute')
      .set(auth())
      .send({ teamId, task: 'Simulate only', dryRun: true });
    expect(res.status).toBe(202);
    const finished = await pollUntilTerminal(res.body.execution.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.dryRun).toBe(true);
  });
});
