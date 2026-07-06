import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { getExecution } from '../src/modules/workflows/execution-store';
import { registerDeliverable } from '../src/modules/workflows/deliverables.service';
import {
  setAgentNodeRunnerForTests,
  startExecution,
  type AgentNodeRequest,
} from '../src/modules/workflows/executor';
import { normalizeDsl, type WorkflowDsl } from '../src/modules/teams/workflow-dsl';

const app = createApp();
let token = '';
let userId = '';
let teamId = '';
let projectId = '';
let agentId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

function workflow(): WorkflowDsl {
  return normalizeDsl(
    {
      name: 'Memo pipeline',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'work', type: 'agent', label: 'Work', kind: 'worker', agentId },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'work' },
        { from: 'work', to: 'end' },
      ],
    },
    new Set([agentId])
  );
}

async function waitForTerminal(executionId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await getExecution(userId, executionId);
    if (detail && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(detail.status)) {
      return detail;
    }
    if (Date.now() > deadline) throw new Error(`Execution ${executionId} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function memosFor(scope: string, subjectId: string) {
  const res = await request(app).get('/api/memos').query({ scope, subjectId }).set(auth());
  expect(res.status).toBe(200);
  return res.body.memos as Array<{ id: string; source: string; content: string }>;
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'memos@example.com',
    username: 'memosuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  const agent = await request(app)
    .post('/api/agents')
    .set(auth())
    .send({ name: 'Memo Worker', runtime: 'api', description: 'worker for memo tests' });
  agentId = agent.body.agent.id;

  const team = await request(app).post('/api/teams').set(auth()).send({ name: 'Memo team' });
  teamId = team.body.team.id;

  const project = await request(app).post('/api/projects').set(auth()).send({ name: 'Memo project' });
  projectId = project.body.project.id;
});

afterEach(() => {
  setAgentNodeRunnerForTests(null);
});

describe('memo domain', () => {
  it('writes a retro memo after a run and injects it into the next run', async () => {
    setAgentNodeRunnerForTests(async () => ({ output: 'done', artifacts: [] }));
    const first = await startExecution({ userId, teamId, task: 'First memo run', workflow: workflow() });
    await waitForTerminal(first.id);

    const teamMemos = await memosFor('team', teamId);
    expect(teamMemos.some((m) => m.source === 'retro' && m.content.includes('Run succeeded'))).toBe(true);

    const captured: AgentNodeRequest[] = [];
    setAgentNodeRunnerForTests(async (req) => {
      captured.push(req);
      return { output: 'done again', artifacts: [] };
    });
    const second = await startExecution({ userId, teamId, task: 'Second memo run', workflow: workflow() });
    await waitForTerminal(second.id);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.memos.some((line) => line.includes('Run succeeded'))).toBe(true);
    expect(captured[0]!.memos.some((line) => line.startsWith('[team]'))).toBe(true);
  });

  it('writes an agent-scoped memo when a step fails', async () => {
    setAgentNodeRunnerForTests(async () => {
      throw new Error('synthetic step crash');
    });
    const run = await startExecution({ userId, teamId, task: 'Failing memo run', workflow: workflow() });
    const detail = await waitForTerminal(run.id);
    expect(detail.status).toBe('failed');

    const agentMemos = await memosFor('agent', agentId);
    expect(
      agentMemos.some((m) => m.source === 'retro' && m.content.includes('synthetic step crash'))
    ).toBe(true);
  });

  it('turns a review verdict with a note into agent and team memos', async () => {
    setAgentNodeRunnerForTests(async () => ({ output: 'made a file', artifacts: [] }));
    const run = await startExecution({
      userId,
      teamId,
      projectId,
      task: 'Review memo run',
      workflow: workflow(),
    });
    await waitForTerminal(run.id);

    const deliverable = await registerDeliverable({
      userId,
      projectId,
      executionId: run.id,
      nodeId: 'work',
      agentId,
      filePath: 'reports/summary.md',
    });

    const review = await request(app)
      .patch(`/api/projects/${projectId}/deliverables/${deliverable.id}`)
      .set(auth())
      .send({ status: 'revision', note: 'Tone is too casual for the audience' });
    expect(review.status).toBe(200);

    const agentMemos = await memosFor('agent', agentId);
    const hit = agentMemos.find((m) => m.source === 'review');
    expect(hit).toBeDefined();
    expect(hit!.content).toContain('sent back for revision');
    expect(hit!.content).toContain('Tone is too casual');

    const teamMemos = await memosFor('team', teamId);
    expect(teamMemos.some((m) => m.source === 'review' && m.content.includes('summary.md'))).toBe(true);
  });

  it('lists and deletes memos through the routes', async () => {
    const badQuery = await request(app).get('/api/memos').query({ scope: 'nope' }).set(auth());
    expect(badQuery.status).toBe(400);

    const memosBefore = await memosFor('team', teamId);
    expect(memosBefore.length).toBeGreaterThan(0);

    const del = await request(app).delete(`/api/memos/${memosBefore[0]!.id}`).set(auth());
    expect(del.status).toBe(200);
    const memosAfter = await memosFor('team', teamId);
    expect(memosAfter.find((m) => m.id === memosBefore[0]!.id)).toBeUndefined();

    const missing = await request(app).delete(`/api/memos/${memosBefore[0]!.id}`).set(auth());
    expect(missing.status).toBe(404);
  });
});
