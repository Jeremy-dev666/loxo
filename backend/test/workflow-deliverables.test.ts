import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import {
  listDeliverables,
  registerDeliverable,
  reviewDeliverable,
} from '../src/modules/workflows/deliverables.service';
import { getExecution, listEvents } from '../src/modules/workflows/execution-store';
import {
  executorEvents,
  setAgentNodeRunnerForTests,
  startExecution,
  type WorkflowEventDelta,
} from '../src/modules/workflows/executor';
import { normalizeDsl } from '../src/modules/teams/workflow-dsl';
import {
  attachWorkflowBroadcast,
  handleWorkflowFrame,
  subscriberCountForTests,
} from '../src/ws/workflow-channel';
import type { WebSocket } from 'ws';

const app = createApp();
let userId = '';
let teamId = '';
let agentId = '';
const projectId = crypto.randomUUID();

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'wfdeliver@example.com',
    username: 'wfdeliver',
    password: 'a-strong-password',
  });
  userId = reg.body.user.id;
  const team = await request(app)
    .post('/api/teams')
    .set({ Authorization: `Bearer ${reg.body.token}` })
    .send({ name: 'Deliverables team' });
  teamId = team.body.team.id;
  const agent = await request(app)
    .post('/api/agents')
    .set({ Authorization: `Bearer ${reg.body.token}` })
    .send({ name: 'Maker', runtime: 'api' });
  agentId = agent.body.agent.id;
});

afterEach(() => {
  setAgentNodeRunnerForTests(null);
});

async function runProjectWorkflow(task: string, files: string[]) {
  setAgentNodeRunnerForTests(async (req) => ({
    output: 'produced files',
    artifacts: files.map((file, i) => ({
      nodeId: req.node.id,
      runCount: req.runCount,
      kind: 'workspace-file' as const,
      label: 'created',
      path: file,
      size: 10 + i,
      absolutePath: path.join(req.paths.workspace, file),
    })),
  }));

  const workflow = normalizeDsl(
    {
      name: 'Deliverable flow',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'maker', type: 'agent', label: 'Maker', kind: 'worker', agentId },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'maker' },
        { from: 'maker', to: 'end' },
      ],
    },
    new Set([agentId])
  );

  const started = await startExecution({ userId, teamId, projectId, task, workflow });
  const deadline = Date.now() + 8000;
  for (;;) {
    const detail = await getExecution(userId, started.id);
    if (detail && detail.status !== 'queued' && detail.status !== 'running') return detail;
    if (Date.now() > deadline) throw new Error('Execution did not finish');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('deliverables service', () => {
  it('supersedes the previous pending entry for the same file', async () => {
    const executionId = (await runProjectWorkflow('seed run', [])).id;

    const first = await registerDeliverable({
      userId,
      projectId,
      executionId,
      nodeId: 'maker',
      filePath: 'docs/spec.md',
    });
    const second = await registerDeliverable({
      userId,
      projectId,
      executionId,
      nodeId: 'maker',
      filePath: 'docs/spec.md',
    });

    const rows = await listDeliverables(userId, projectId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.id)?.status).toBe('superseded');
    expect(byId.get(second.id)?.status).toBe('pending');
  });

  it('keeps reviewed entries when a new version arrives', async () => {
    const executionId = (await runProjectWorkflow('review run', [])).id;

    const reviewed = await registerDeliverable({
      userId,
      projectId,
      executionId,
      nodeId: 'maker',
      filePath: 'docs/final.md',
    });
    await reviewDeliverable(userId, reviewed.id, 'accepted');
    await registerDeliverable({
      userId,
      projectId,
      executionId,
      nodeId: 'maker',
      filePath: 'docs/final.md',
    });

    const rows = await listDeliverables(userId, projectId);
    expect(rows.find((r) => r.id === reviewed.id)?.status).toBe('accepted');
  });

  it('rejects invalid review verdicts and foreign deliverables', async () => {
    const executionId = (await runProjectWorkflow('perm run', [])).id;
    const row = await registerDeliverable({
      userId,
      projectId,
      executionId,
      nodeId: 'maker',
      filePath: 'docs/perm.md',
    });

    await expect(reviewDeliverable(userId, row.id, 'superseded')).rejects.toMatchObject({
      code: 'invalid_status',
    });
    await expect(reviewDeliverable(crypto.randomUUID(), row.id, 'accepted')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('workflow deliverable auto-registration', () => {
  it('registers agent workspace files and filters noise', async () => {
    const detail = await runProjectWorkflow('produce deliverables', [
      'report/analysis.md',
      'handoff/notes.md',
      'SOUL.md',
    ]);
    expect(detail.status).toBe('succeeded');

    const rows = await listDeliverables(userId, projectId);
    const paths = rows.filter((r) => r.executionId === detail.id).map((r) => r.filePath);
    expect(paths).toEqual(['report/analysis.md']);

    const events = await listEvents(detail.id);
    const created = events.filter((e) => e.type === 'deliverable_created');
    expect(created).toHaveLength(1);
    expect(created[0]?.payload.filePath).toBe('report/analysis.md');
  });
});

describe('workflow websocket channel', () => {
  interface FakeSocket {
    frames: Array<{ type: string; payload: unknown }>;
    closeHandlers: Array<() => void>;
  }

  function fakeSocket(): { ws: WebSocket; state: FakeSocket } {
    const state: FakeSocket = { frames: [], closeHandlers: [] };
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: (raw: string) => state.frames.push(JSON.parse(raw)),
      once: (event: string, handler: () => void) => {
        if (event === 'close') state.closeHandlers.push(handler);
      },
    } as unknown as WebSocket;
    return { ws, state };
  }

  function delta(overrides: Partial<WorkflowEventDelta>): WorkflowEventDelta {
    return {
      executionId: 'e1',
      userId,
      teamId,
      projectId: null,
      workflowName: 'Test',
      status: 'running',
      event: { seq: 1, type: 'node_started', message: 'x', payload: {} },
      nodeStates: [],
      ...overrides,
    };
  }

  it('routes events to the owner and honors project scoping', () => {
    attachWorkflowBroadcast();
    const mine = fakeSocket();
    const scoped = fakeSocket();
    const stranger = fakeSocket();

    handleWorkflowFrame(mine.ws, userId, { type: 'workflow.subscribe' });
    handleWorkflowFrame(scoped.ws, userId, {
      type: 'workflow.subscribe',
      payload: { projectId: 'p-1' },
    });
    handleWorkflowFrame(stranger.ws, 'someone-else', { type: 'workflow.subscribe' });

    executorEvents.emit('workflowEvent', delta({ projectId: 'p-2' }));

    const eventFrames = (state: FakeSocket) =>
      state.frames.filter((f) => f.type === 'workflow.event');
    expect(eventFrames(mine.state)).toHaveLength(1);
    expect(eventFrames(scoped.state)).toHaveLength(0); // other project
    expect(eventFrames(stranger.state)).toHaveLength(0); // other user

    executorEvents.emit('workflowEvent', delta({ projectId: 'p-1' }));
    expect(eventFrames(scoped.state)).toHaveLength(1);

    // Close cleanup unsubscribes the socket.
    const before = subscriberCountForTests();
    mine.state.closeHandlers.forEach((handler) => handler());
    expect(subscriberCountForTests()).toBe(before - 1);
    handleWorkflowFrame(scoped.ws, userId, { type: 'workflow.unsubscribe' });
    handleWorkflowFrame(stranger.ws, 'someone-else', { type: 'workflow.unsubscribe' });
  });

  it('truncates giant node outputs in the event delta', async () => {
    const received: WorkflowEventDelta[] = [];
    const listener = (d: WorkflowEventDelta) => received.push(d);
    executorEvents.on('workflowEvent', listener);

    setAgentNodeRunnerForTests(async () => ({
      output: 'x'.repeat(5000),
      artifacts: [],
    }));
    const workflow = normalizeDsl(
      {
        name: 'Big output',
        nodes: [
          { id: 'start', type: 'start', label: 'Task' },
          { id: 'big', type: 'agent', label: 'Big', kind: 'worker', agentId },
          { id: 'end', type: 'end', label: 'Done' },
        ],
        edges: [
          { from: 'start', to: 'big' },
          { from: 'big', to: 'end' },
        ],
      },
      new Set([agentId])
    );
    const started = await startExecution({ userId, teamId, task: 'big', workflow });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const detail = await getExecution(userId, started.id);
      if (detail && detail.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    executorEvents.off('workflowEvent', listener);

    const completed = received.find(
      (d) => d.event.type === 'node_completed' && d.event.nodeId === 'big'
    );
    expect(completed).toBeDefined();
    const output = completed!.event.payload.output as string;
    expect(output.length).toBeLessThan(2100);
    expect(output).toContain('[output truncated]');

    // The database keeps the full output.
    const detail = await getExecution(userId, started.id);
    expect(detail?.nodeStates.find((n) => n.nodeId === 'big')?.output).toHaveLength(5000);
  });
});
