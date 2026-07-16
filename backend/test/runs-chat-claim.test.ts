import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { runChatTurn, setTurnExecutorForTests } from '../src/modules/chat/chat.service';
import { setIssueTurnExecutorForTests } from '../src/modules/runs/issue-run';
import { drainRunsForTests } from '../src/modules/runs/wake';
import { RunnerError, type TurnRequest, type TurnResult } from '../src/modules/runner/runner';

const app = createApp();
let token = '';
let userId = '';
let agentId = '';
let conversationId = '';

type Executor = (req: TurnRequest) => Promise<TurnResult>;
const quickReply: Executor = async () => ({ text: 'chat reply', durationMs: 5 });
const quickReport: Executor = async () => ({ text: 'issue report', durationMs: 5 });
let chatExecutor: Executor = quickReply;
let issueExecutor: Executor = quickReport;
const pendingReleases: Array<() => void> = [];

function gate(target: 'chat' | 'issue') {
  let entered!: () => void;
  const invoked = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  const impl: Executor = async (req) => {
    if (first) {
      first = false;
      entered();
      await opened;
    }
    return target === 'chat' ? quickReply(req) : quickReport(req);
  };
  if (target === 'chat') chatExecutor = impl;
  else issueExecutor = impl;
  pendingReleases.push(release);
  return { invoked, release };
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  setTurnExecutorForTests((req) => chatExecutor(req));
  setIssueTurnExecutorForTests((req) => issueExecutor(req));

  const reg = await request(app).post('/auth/register').send({
    email: 'claim@example.com',
    username: 'claimuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  const agent = await request(app)
    .post('/api/agents')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Shared worker', runtime: 'claude-code' });
  agentId = agent.body.agent.id;

  const conversation = await request(app)
    .post('/api/conversations')
    .set({ Authorization: `Bearer ${token}` })
    .send({ agentId });
  conversationId = conversation.body.conversation.id;
});

afterAll(() => {
  setTurnExecutorForTests(null);
  setIssueTurnExecutorForTests(null);
});

afterEach(async () => {
  for (const release of pendingReleases) release();
  pendingReleases.length = 0;
  await drainRunsForTests();
  chatExecutor = quickReply;
  issueExecutor = quickReport;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function wakeableIssue(title: string) {
  const created = await request(app).post('/api/issues').set(auth()).send({ title });
  const issue = created.body.issue as { id: string };
  await request(app).post(`/api/issues/${issue.id}/move`).set(auth()).send({ status: 'todo' });
  return issue;
}

async function runsFor(issueId: string) {
  const res = await request(app).get(`/api/runs?issueId=${issueId}`).set(auth());
  return res.body.runs as Array<{ status: string }>;
}

describe('shared agent claim', () => {
  it('rejects a chat turn while an issue run holds the agent', async () => {
    const gated = gate('issue');
    const issue = await wakeableIssue('Chat blocker');
    await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId } });
    await gated.invoked;

    await expect(runChatTurn(userId, conversationId, 'quick question')).rejects.toMatchObject({
      code: 'agent_busy',
    });

    gated.release();
    await drainRunsForTests();

    // Freed agent takes chat turns again.
    const outcome = await runChatTurn(userId, conversationId, 'and now?');
    expect(outcome.reply.content).toBe('chat reply');
  });

  it('parks an assignment wake behind a chat turn and promotes it afterwards', async () => {
    const gated = gate('chat');
    const chatPromise = runChatTurn(userId, conversationId, 'long think');
    await gated.invoked;

    const issue = await wakeableIssue('Queued behind chat');
    await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId } });
    expect((await runsFor(issue.id))[0]!.status).toBe('queued');

    gated.release();
    await chatPromise;
    await drainRunsForTests();

    expect((await runsFor(issue.id))[0]!.status).toBe('succeeded');
  });

  it('releases the claim when the chat turn fails', async () => {
    chatExecutor = async () => {
      throw new RunnerError('CLI unavailable', 'cli_failed');
    };
    const outcome = await runChatTurn(userId, conversationId, 'does this work?');
    expect(outcome.reply.role).toBe('system');

    const agent = await request(app).get(`/api/agents/${agentId}`).set(auth());
    expect(agent.body.agent.status).toBe('error');

    // The claim is free again: a wake starts immediately.
    chatExecutor = quickReply;
    const issue = await wakeableIssue('After chat failure');
    await request(app)
      .patch(`/api/issues/${issue.id}`)
      .set(auth())
      .send({ assignee: { agentId } });
    await drainRunsForTests();
    expect((await runsFor(issue.id))[0]!.status).toBe('succeeded');
  });
});
