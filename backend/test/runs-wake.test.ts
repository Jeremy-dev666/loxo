import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { setIssueTurnExecutorForTests } from '../src/modules/runs/issue-run';
import { drainRunsForTests } from '../src/modules/runs/wake';
import { RunnerError, type TurnRequest, type TurnResult } from '../src/modules/runner/runner';

const app = createApp();
let token = '';
let agentA = '';
let agentB = '';

type Executor = (req: TurnRequest) => Promise<TurnResult>;
const succeedQuickly: Executor = async () => ({
  text: 'stub work report',
  sessionRef: 'sess-stub',
  durationMs: 5,
});
let executorImpl: Executor = succeedQuickly;

/** Gates released even when a test aborts mid-assertion. */
const pendingReleases: Array<() => void> = [];

/**
 * Executor whose first invocation parks until release(); `invoked` resolves
 * once that first call is actually inside the executor, making "the run is
 * really holding the lock now" a deterministic checkpoint.
 */
function gatedExecutor() {
  let entered!: () => void;
  const invoked = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  executorImpl = async (req) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return succeedQuickly(req);
  };
  pendingReleases.push(release);
  return { invoked, release };
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  setIssueTurnExecutorForTests((req) => executorImpl(req));

  const reg = await request(app).post('/auth/register').send({
    email: 'wake@example.com',
    username: 'wakeuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  for (const name of ['Worker A', 'Worker B']) {
    const agent = await request(app)
      .post('/api/agents')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name, runtime: 'claude-code' });
    if (name === 'Worker A') agentA = agent.body.agent.id;
    else agentB = agent.body.agent.id;
  }
});

afterAll(() => {
  setIssueTurnExecutorForTests(null);
});

beforeEach(() => {
  executorImpl = succeedQuickly;
});

afterEach(async () => {
  for (const release of pendingReleases) release();
  pendingReleases.length = 0;
  await drainRunsForTests();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createIssue(title: string) {
  const res = await request(app).post('/api/issues').set(auth()).send({ title });
  expect(res.status).toBe(201);
  return res.body.issue as { id: string; issueNumber: number };
}

async function moveTo(issueId: string, status: string) {
  const res = await request(app).post(`/api/issues/${issueId}/move`).set(auth()).send({ status });
  expect(res.status).toBe(200);
  return res.body.issue;
}

async function assign(issueId: string, agentId: string) {
  const res = await request(app)
    .patch(`/api/issues/${issueId}`)
    .set(auth())
    .send({ assignee: { agentId } });
  expect(res.status).toBe(200);
  return res.body.issue;
}

async function runsFor(issueId: string) {
  const res = await request(app).get(`/api/runs?issueId=${issueId}`).set(auth());
  expect(res.status).toBe(200);
  return res.body.runs as Array<{
    id: string;
    status: string;
    trigger: string;
    output: string;
    error: string | null;
    sessionRef: string | null;
  }>;
}

async function agentStatus(agentId: string) {
  const res = await request(app).get(`/api/agents/${agentId}`).set(auth());
  return res.body.agent.status as string;
}

describe('wake admission', () => {
  it('wakes the agent on assignment, runs, and posts the work report', async () => {
    const issue = await createIssue('Assignment wake');
    await moveTo(issue.id, 'todo');
    await assign(issue.id, agentA);
    await drainRunsForTests();

    const [run] = await runsFor(issue.id);
    expect(run).toBeDefined();
    expect(run!.status).toBe('succeeded');
    expect(run!.trigger).toBe('assignment');
    expect(run!.output).toBe('stub work report');
    expect(run!.sessionRef).toBe('sess-stub');

    const comments = await request(app).get(`/api/issues/${issue.id}/comments`).set(auth());
    const agentComments = comments.body.comments.filter(
      (c: { authorType: string }) => c.authorType === 'agent'
    );
    expect(agentComments).toHaveLength(1);
    expect(agentComments[0].body).toBe('stub work report');

    const detail = await request(app).get(`/api/issues/${issue.id}`).set(auth());
    expect(detail.body.issue.activeRunId).toBeNull();
    expect(await agentStatus(agentA)).toBe('idle');
  });

  it('does not wake while the issue sits in backlog', async () => {
    const issue = await createIssue('Backlog stays quiet');
    await assign(issue.id, agentA);
    await drainRunsForTests();
    expect(await runsFor(issue.id)).toHaveLength(0);
  });

  it('wakes when a backlog issue with an assignee moves to todo', async () => {
    const issue = await createIssue('Move triggers');
    await assign(issue.id, agentA);
    await moveTo(issue.id, 'todo');
    await drainRunsForTests();

    const runs = await runsFor(issue.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
  });

  it('merges a duplicate wake into the active run', async () => {
    const gated = gatedExecutor();

    const issue = await createIssue('Merge target');
    await moveTo(issue.id, 'todo');
    await assign(issue.id, agentA);
    await gated.invoked;

    const [running] = await runsFor(issue.id);
    expect(running!.status).toBe('running');

    const wake = await request(app).post(`/api/issues/${issue.id}/wake`).set(auth()).send({});
    expect(wake.status).toBe(202);
    expect(wake.body.admitted).toBe('merged');
    expect(wake.body.run.id).toBe(running!.id);

    gated.release();
    await drainRunsForTests();
    expect(await runsFor(issue.id)).toHaveLength(1);
  });

  it('parks a second agent behind the issue lock and promotes it afterwards', async () => {
    const gated = gatedExecutor();

    const issue = await createIssue('Lock contention');
    await moveTo(issue.id, 'todo');
    await assign(issue.id, agentA);
    await gated.invoked;

    await assign(issue.id, agentB);

    let runs = await runsFor(issue.id);
    expect(runs.map((r) => r.status).sort()).toEqual(['queued', 'running']);

    gated.release();
    await drainRunsForTests();

    runs = await runsFor(issue.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);
    expect(await agentStatus(agentB)).toBe('idle');
  });

  it('serializes one agent across two issues', async () => {
    const gated = gatedExecutor();

    const first = await createIssue('Busy agent 1');
    await moveTo(first.id, 'todo');
    await assign(first.id, agentA);
    await gated.invoked;

    const second = await createIssue('Busy agent 2');
    await moveTo(second.id, 'todo');
    await assign(second.id, agentA);

    expect((await runsFor(second.id))[0]!.status).toBe('queued');

    gated.release();
    await drainRunsForTests();

    expect((await runsFor(first.id))[0]!.status).toBe('succeeded');
    expect((await runsFor(second.id))[0]!.status).toBe('succeeded');
  });

  it('marks the run failed, frees the lock, and lets a retry through', async () => {
    executorImpl = async () => {
      throw new RunnerError('CLI exploded', 'cli_failed');
    };

    const issue = await createIssue('Failure path');
    await moveTo(issue.id, 'todo');
    await assign(issue.id, agentA);
    await drainRunsForTests();

    const [failed] = await runsFor(issue.id);
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('CLI exploded');
    expect(await agentStatus(agentA)).toBe('error');

    executorImpl = succeedQuickly;
    const retry = await request(app).post(`/api/issues/${issue.id}/wake`).set(auth()).send({});
    expect(retry.status).toBe(202);
    expect(retry.body.admitted).toBe('started');
    await drainRunsForTests();

    const runs = await runsFor(issue.id);
    expect(runs.some((r) => r.status === 'succeeded')).toBe(true);
    expect(await agentStatus(agentA)).toBe('idle');
  });

  it('rejects a manual wake when no agent is assigned', async () => {
    const issue = await createIssue('Nobody home');
    const res = await request(app).post(`/api/issues/${issue.id}/wake`).set(auth()).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_agent_assignee');
  });
});
