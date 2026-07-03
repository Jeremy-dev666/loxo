import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import {
  addArtifacts,
  appendEvent,
  createExecution,
  getExecution,
  listEvents,
  listExecutions,
  markInterruptedExecutions,
  updateExecution,
  updateNodeState,
} from '../src/modules/workflows/execution-store';
import { normalizeDsl } from '../src/modules/teams/workflow-dsl';

const app = createApp();
let token = '';
let userId = '';
let teamId = '';

const workflow = normalizeDsl(
  {
    name: 'Store test flow',
    nodes: [
      { id: 'start', type: 'start', label: 'Task' },
      { id: 'work', type: 'agent', label: 'Work', kind: 'worker' },
      { id: 'end', type: 'end', label: 'Done' },
    ],
    edges: [
      { from: 'start', to: 'work' },
      { from: 'work', to: 'end' },
    ],
  },
  new Set()
);

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'wfstore@example.com',
    username: 'wfstore',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;
  const team = await request(app)
    .post('/api/teams')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Store test team' });
  teamId = team.body.team.id;
});

function newExecution(overrides: { task?: string; projectId?: string } = {}) {
  return createExecution({
    userId,
    teamId,
    projectId: overrides.projectId ?? null,
    task: overrides.task ?? 'Write a report',
    mode: 'dag',
    dryRun: true,
    workflow,
    nodeIds: workflow.nodes.map((n) => n.id),
  });
}

describe('workflow execution store', () => {
  it('creates an execution with pending node states and a DSL snapshot', async () => {
    const execution = await newExecution();
    expect(execution.status).toBe('queued');
    expect(execution.nodeStates).toHaveLength(3);
    expect(execution.nodeStates.every((n) => n.status === 'pending')).toBe(true);

    const fetched = await getExecution(userId, execution.id);
    expect(fetched?.workflow.nodes).toHaveLength(3);
    expect(fetched?.task).toBe('Write a report');
  });

  it('round-trips node state updates', async () => {
    const execution = await newExecution();
    const updated = await updateNodeState(execution.id, 'work', {
      status: 'running',
      runCount: 1,
      startedAt: new Date(),
    });
    expect(updated?.status).toBe('running');

    const done = await updateNodeState(execution.id, 'work', {
      status: 'succeeded',
      output: 'report drafted',
      finishedAt: new Date(),
    });
    expect(done?.output).toBe('report drafted');
    expect(done?.runCount).toBe(1);
  });

  it('appends ordered events and pages by seq', async () => {
    const execution = await newExecution();
    for (let seq = 1; seq <= 4; seq += 1) {
      await appendEvent(execution.id, {
        seq,
        type: seq === 1 ? 'execution_started' : 'node_started',
        nodeId: seq === 1 ? null : 'work',
        message: `event ${seq}`,
      });
    }
    const all = await listEvents(execution.id);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4]);

    const tail = await listEvents(execution.id, { afterSeq: 2 });
    expect(tail.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('stores artifacts against nodes', async () => {
    const execution = await newExecution();
    await addArtifacts(execution.id, [
      {
        nodeId: 'work',
        runCount: 1,
        kind: 'workspace-file',
        label: 'created',
        path: 'report.md',
        size: 128,
      },
      {
        nodeId: 'work',
        runCount: 1,
        kind: 'node-output',
        label: 'output',
        path: 'nodes/work-run-1.md',
        size: 256,
      },
    ]);
    const fetched = await getExecution(userId, execution.id);
    expect(fetched?.artifacts).toHaveLength(2);
    expect(fetched?.artifacts.map((a) => a.kind).sort()).toEqual([
      'node-output',
      'workspace-file',
    ]);
  });

  it('filters listings by project and hides other users', async () => {
    const project = await request(app)
      .post('/api/projects')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Store filter project' });
    const projectId = project.body.project.id;
    await newExecution({ projectId, task: 'Project scoped' });
    const scoped = await listExecutions(userId, { projectId });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.task).toBe('Project scoped');

    const stranger = await listExecutions(crypto.randomUUID());
    expect(stranger).toHaveLength(0);
  });

  it('marks queued and running executions as interrupted on recovery', async () => {
    const running = await newExecution({ task: 'Interrupted run' });
    await updateExecution(running.id, { status: 'running', startedAt: new Date() });
    await updateNodeState(running.id, 'work', { status: 'running', runCount: 1 });

    const finished = await newExecution({ task: 'Finished run' });
    await updateExecution(finished.id, { status: 'succeeded', finishedAt: new Date() });

    const count = await markInterruptedExecutions();
    expect(count).toBeGreaterThanOrEqual(1);

    const recovered = await getExecution(userId, running.id);
    expect(recovered?.status).toBe('interrupted');
    expect(recovered?.finishedAt).not.toBeNull();
    expect(recovered?.nodeStates.find((n) => n.nodeId === 'work')?.status).toBe('failed');

    const untouched = await getExecution(userId, finished.id);
    expect(untouched?.status).toBe('succeeded');
  });
});
