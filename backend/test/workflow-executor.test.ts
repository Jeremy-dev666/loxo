import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { getExecution, listEvents } from '../src/modules/workflows/execution-store';
import {
  cancelExecution,
  parseBranchDirective,
  setAgentNodeRunnerForTests,
  startExecution,
  type AgentNodeRequest,
} from '../src/modules/workflows/executor';
import { normalizeDsl, type WorkflowDsl } from '../src/modules/teams/workflow-dsl';

const app = createApp();
let userId = '';
let teamId = '';

const AGENTS = new Set(['a1', 'a2', 'a3']);

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'wfexec@example.com',
    username: 'wfexec',
    password: 'a-strong-password',
  });
  userId = reg.body.user.id;
  const team = await request(app)
    .post('/api/teams')
    .set({ Authorization: `Bearer ${reg.body.token}` })
    .send({ name: 'Executor test team' });
  teamId = team.body.team.id;
});

afterEach(() => {
  setAgentNodeRunnerForTests(null);
});

function dsl(raw: unknown): WorkflowDsl {
  return normalizeDsl(raw, AGENTS);
}

async function waitForTerminal(executionId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await getExecution(userId, executionId);
    if (
      detail &&
      ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(detail.status)
    ) {
      return detail;
    }
    if (Date.now() > deadline) throw new Error(`Execution ${executionId} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function waitForEvent(executionId: string, type: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await listEvents(executionId);
    const hit = events.find((e) => e.type === type);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`Event ${type} did not appear`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('parseBranchDirective', () => {
  it('finds the last structured directive', () => {
    expect(parseBranchDirective('review done {"branch": "no"} then {"branch":"yes"}')).toBe('yes');
    expect(parseBranchDirective('{"branch":"no","reason":"missing tests"}')).toBe('no');
    expect(parseBranchDirective('no structured verdict here')).toBeNull();
  });
});

describe('workflow executor', () => {
  it('runs a sequential handoff and pipes upstream output downstream', async () => {
    const calls: AgentNodeRequest[] = [];
    setAgentNodeRunnerForTests(async (req) => {
      calls.push(req);
      return { output: `${req.node.label} output for run ${req.runCount}`, artifacts: [] };
    });

    const workflow = dsl({
      name: 'Sequential',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'research', type: 'agent', label: 'Research', kind: 'worker', agentId: 'a1' },
        { id: 'write', type: 'agent', label: 'Write', kind: 'worker', agentId: 'a2' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'research' },
        { from: 'research', to: 'write' },
        { from: 'write', to: 'end' },
      ],
    });

    const started = await startExecution({
      userId,
      teamId,
      task: 'Summarize the topic',
      workflow,
    });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('succeeded');
    expect(calls.map((c) => c.node.id)).toEqual(['research', 'write']);
    expect(calls[0]!.input).toContain('Summarize the topic');
    expect(calls[1]!.input).toContain('Research output for run 1');
    expect(detail.finalOutput).toContain('Write output for run 1');
    expect(detail.nodeStates.every((n) => n.status === 'succeeded')).toBe(true);

    const events = await listEvents(started.id);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('execution_started');
    expect(types[types.length - 1]).toBe('execution_completed');
    expect(types.filter((t) => t === 'node_completed')).toHaveLength(4);
  });

  it('makes a parallel join wait for every in-flight branch', async () => {
    const finished: string[] = [];
    setAgentNodeRunnerForTests(async (req) => {
      const delay = req.node.id === 'slow' ? 250 : 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      finished.push(req.node.id);
      return { output: `${req.node.label} findings`, artifacts: [] };
    });

    const workflow = dsl({
      name: 'Parallel',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'fast', type: 'agent', label: 'Fast', kind: 'worker', agentId: 'a1' },
        { id: 'slow', type: 'agent', label: 'Slow', kind: 'worker', agentId: 'a2' },
        { id: 'merge', type: 'agent', label: 'Merge', kind: 'aggregator', agentId: 'a3' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'fast' },
        { from: 'start', to: 'slow' },
        { from: 'fast', to: 'merge' },
        { from: 'slow', to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
      execution: { maxConcurrency: 2 },
    });

    const started = await startExecution({ userId, teamId, task: 'Fan out', workflow });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('succeeded');
    expect(finished.slice(0, 2).sort()).toEqual(['fast', 'slow']);
    expect(finished[2]).toBe('merge');

    const mergeInputCall = detail.nodeStates.find((n) => n.nodeId === 'merge');
    expect(mergeInputCall?.status).toBe('succeeded');
    expect(detail.finalOutput).toContain('Merge findings');
  });

  it('passes both branch outputs to the join input', async () => {
    let mergeInput = '';
    setAgentNodeRunnerForTests(async (req) => {
      if (req.node.id === 'merge') mergeInput = req.input;
      return { output: `${req.node.label} findings`, artifacts: [] };
    });

    const workflow = dsl({
      name: 'Parallel inputs',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'left', type: 'agent', label: 'Left', kind: 'worker', agentId: 'a1' },
        { id: 'right', type: 'agent', label: 'Right', kind: 'worker', agentId: 'a2' },
        { id: 'merge', type: 'agent', label: 'Merge', kind: 'aggregator', agentId: 'a3' },
      ],
      edges: [
        { from: 'start', to: 'left' },
        { from: 'start', to: 'right' },
        { from: 'left', to: 'merge' },
        { from: 'right', to: 'merge' },
      ],
      execution: { maxConcurrency: 2 },
    });

    const started = await startExecution({ userId, teamId, task: 'Fan out', workflow });
    await waitForTerminal(started.id);

    expect(mergeInput).toContain('Left findings');
    expect(mergeInput).toContain('Right findings');
  });

  it('takes the yes branch and skips the no path', async () => {
    setAgentNodeRunnerForTests(async (req) => ({
      output: req.node.id === 'review' ? 'Everything looks great, approved.' : 'work done',
      artifacts: [],
    }));

    const workflow = dsl({
      name: 'Branching',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'review', type: 'agent', label: 'Review', kind: 'judge', agentId: 'a1' },
        { id: 'gate', type: 'condition', label: 'Approved?', expression: 'approved' },
        { id: 'ship', type: 'agent', label: 'Ship', kind: 'worker', agentId: 'a2' },
        { id: 'rework', type: 'agent', label: 'Rework', kind: 'worker', agentId: 'a3' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'gate' },
        { from: 'gate', to: 'ship', branch: 'yes' },
        { from: 'gate', to: 'rework', branch: 'no' },
        { from: 'ship', to: 'end' },
        { from: 'rework', to: 'end' },
      ],
    });

    const started = await startExecution({ userId, teamId, task: 'Ship it', workflow });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('succeeded');
    const byId = new Map(detail.nodeStates.map((n) => [n.nodeId, n]));
    expect(byId.get('ship')?.status).toBe('succeeded');
    expect(byId.get('rework')?.status).toBe('skipped');

    const branchEvent = await waitForEvent(started.id, 'branch_selected');
    expect(branchEvent.payload.branch).toBe('yes');
    expect(branchEvent.payload.source).toBe('heuristic');
  });

  it('honors a structured judge directive over keyword noise', async () => {
    setAgentNodeRunnerForTests(async (req) => ({
      // "great" alone would read as yes; the directive must win.
      output:
        req.node.id === 'review'
          ? 'Great work overall. Verdict: {"branch":"no","reason":"missing tests"}'
          : 'done',
      artifacts: [],
    }));

    const workflow = dsl({
      name: 'Directive',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'review', type: 'agent', label: 'Review', kind: 'judge', agentId: 'a1' },
        { id: 'gate', type: 'condition', label: 'Approved?', expression: 'approved' },
        { id: 'ship', type: 'agent', label: 'Ship', kind: 'worker', agentId: 'a2' },
        { id: 'rework', type: 'agent', label: 'Rework', kind: 'worker', agentId: 'a3' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'gate' },
        { from: 'gate', to: 'ship', branch: 'yes' },
        { from: 'gate', to: 'rework', branch: 'no' },
        { from: 'ship', to: 'end' },
        { from: 'rework', to: 'end' },
      ],
    });

    const started = await startExecution({ userId, teamId, task: 'Ship it', workflow });
    const detail = await waitForTerminal(started.id);

    const byId = new Map(detail.nodeStates.map((n) => [n.nodeId, n]));
    expect(byId.get('rework')?.status).toBe('succeeded');
    expect(byId.get('ship')?.status).toBe('skipped');

    const branchEvent = await waitForEvent(started.id, 'branch_selected');
    expect(branchEvent.payload.branch).toBe('no');
    expect(branchEvent.payload.source).toBe('directive');
  });

  it('caps a feedback loop and forces the yes branch to finish', async () => {
    setAgentNodeRunnerForTests(async (req) => ({
      output:
        req.node.id === 'review'
          ? '{"branch":"no","reason":"still failing"}'
          : `draft v${req.runCount}`,
      artifacts: [],
    }));

    const workflow = dsl({
      name: 'Loop',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'draft', type: 'agent', label: 'Draft', kind: 'optimizer', agentId: 'a1' },
        { id: 'review', type: 'agent', label: 'Review', kind: 'evaluator', agentId: 'a2' },
        { id: 'gate', type: 'condition', label: 'Good enough?', expression: 'quality' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'draft' },
        { from: 'draft', to: 'review' },
        { from: 'review', to: 'gate' },
        { from: 'gate', to: 'end', branch: 'yes' },
        { from: 'gate', to: 'draft', branch: 'no' },
      ],
      execution: { maxIterations: 3 },
    });
    expect(workflow.execution.mode).toBe('state-machine');

    const started = await startExecution({ userId, teamId, task: 'Iterate', workflow });
    const detail = await waitForTerminal(started.id, 15_000);

    expect(detail.status).toBe('succeeded');
    const byId = new Map(detail.nodeStates.map((n) => [n.nodeId, n]));
    expect(byId.get('draft')?.runCount).toBe(3);
    expect(byId.get('end')?.status).toBe('succeeded');

    const events = await listEvents(started.id);
    const branches = events.filter((e) => e.type === 'branch_selected');
    expect(branches[branches.length - 1]?.payload.branch).toBe('yes');
    expect(branches[branches.length - 1]?.payload.source).toBe('forced');
  });

  it('cancels a running execution and stops scheduling', async () => {
    setAgentNodeRunnerForTests(
      (req) =>
        new Promise((_resolve, reject) => {
          req.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        })
    );

    const workflow = dsl({
      name: 'Cancellable',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'work', type: 'agent', label: 'Work', kind: 'worker', agentId: 'a1' },
        { id: 'after', type: 'agent', label: 'After', kind: 'worker', agentId: 'a2' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'work' },
        { from: 'work', to: 'after' },
        { from: 'after', to: 'end' },
      ],
    });

    const started = await startExecution({ userId, teamId, task: 'Long job', workflow });
    await waitForEvent(started.id, 'node_started');

    const cancelled = await cancelExecution(userId, started.id);
    expect(cancelled?.status).toBe('cancelled');

    const detail = await waitForTerminal(started.id);
    expect(detail.status).toBe('cancelled');
    const byId = new Map(detail.nodeStates.map((n) => [n.nodeId, n]));
    expect(byId.get('after')?.status).toBe('pending');
    expect(byId.get('end')?.status).toBe('pending');
  });

  it('fails the execution when a node fails', async () => {
    setAgentNodeRunnerForTests(async (req) => {
      if (req.node.id === 'boom') throw new Error('runtime exploded');
      return { output: 'ok', artifacts: [] };
    });

    const workflow = dsl({
      name: 'Failing',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'boom', type: 'agent', label: 'Boom', kind: 'worker', agentId: 'a1' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'boom' },
        { from: 'boom', to: 'end' },
      ],
    });

    const started = await startExecution({ userId, teamId, task: 'Explode', workflow });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('failed');
    expect(detail.error).toContain('runtime exploded');
    expect(detail.nodeStates.find((n) => n.nodeId === 'boom')?.status).toBe('failed');
    expect(detail.nodeStates.find((n) => n.nodeId === 'end')?.status).toBe('pending');
  });

  it('fails an unbound agent node instead of fabricating output', async () => {
    let runnerCalled = false;
    setAgentNodeRunnerForTests(async () => {
      runnerCalled = true;
      return { output: 'should not happen', artifacts: [] };
    });

    const workflow = dsl({
      name: 'Unbound',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'ghost', type: 'agent', label: 'Ghost', kind: 'worker' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'ghost' },
        { from: 'ghost', to: 'end' },
      ],
    });

    const started = await startExecution({ userId, teamId, task: 'Haunt', workflow });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('failed');
    expect(detail.error).toContain('no bound agent');
    expect(runnerCalled).toBe(false);
  });

  it('completes a dry run without touching the agent runner', async () => {
    let runnerCalled = false;
    setAgentNodeRunnerForTests(async () => {
      runnerCalled = true;
      return { output: 'never', artifacts: [] };
    });

    const workflow = dsl({
      name: 'Dry',
      nodes: [
        { id: 'start', type: 'start', label: 'Task' },
        { id: 'ghost', type: 'agent', label: 'Ghost', kind: 'worker' },
        { id: 'end', type: 'end', label: 'Done' },
      ],
      edges: [
        { from: 'start', to: 'ghost' },
        { from: 'ghost', to: 'end' },
      ],
    });

    const started = await startExecution({
      userId,
      teamId,
      task: 'Simulate',
      dryRun: true,
      workflow,
    });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('succeeded');
    expect(detail.dryRun).toBe(true);
    expect(runnerCalled).toBe(false);
    expect(detail.finalOutput).toContain('Dry run');
  });
});
