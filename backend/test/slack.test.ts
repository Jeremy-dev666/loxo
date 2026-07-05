import crypto from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { setTurnExecutorForTests } from '../src/modules/chat/chat.service';
import { setAgentNodeRunnerForTests } from '../src/modules/workflows/executor';
import { setSlackClientForTests, type PostMessageInput } from '../src/modules/integrations/slack-api';
import {
  resetSlackEventDedupeForTests,
  webhookToken,
} from '../src/modules/integrations/slack.service';

const app = createApp();
const SIGNING_SECRET = 'test-signing-secret';
const BOT_TOKEN = 'xoxb-test-token';

let token = '';
let agentId = '';
let teamId = '';
let sentMessages: PostMessageInput[] = [];

const auth = () => ({ Authorization: `Bearer ${token}` });

function sign(body: object, secret = SIGNING_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(body);
  const signature = `v0=${crypto
    .createHmac('sha256', secret)
    .update(`v0:${timestamp}:${raw}`)
    .digest('hex')}`;
  return { raw, timestamp: String(timestamp), signature };
}

function postEvent(
  scope: 'agent' | 'team',
  subjectId: string,
  body: object,
  options: { secret?: string; timestamp?: number; token?: string } = {}
) {
  const { raw, timestamp, signature } = sign(
    body,
    options.secret ?? SIGNING_SECRET,
    options.timestamp ?? Math.floor(Date.now() / 1000)
  );
  return request(app)
    .post(
      `/api/integrations/slack/${scope}/${subjectId}/${options.token ?? webhookToken(scope, subjectId)}`
    )
    .set('Content-Type', 'application/json')
    .set('x-slack-request-timestamp', timestamp)
    .set('x-slack-signature', signature)
    .send(raw);
}

function messageEvent(channel: string, text: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    event_id: `Ev${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    event: {
      type: 'app_mention',
      user: 'U123USER',
      text,
      channel,
      ts: `${Date.now() / 1000}`,
      ...overrides,
    },
  };
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

beforeAll(async () => {
  process.env.SLACK_TEAM_POLL_MS = '40';
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'slack@example.com',
    username: 'slackuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  const agent = await request(app)
    .post('/api/agents')
    .set(auth())
    .send({ name: 'Slack Agent', runtime: 'claude-code' });
  agentId = agent.body.agent.id;

  const team = await request(app)
    .post('/api/teams')
    .set(auth())
    .send({
      name: 'Slack Team',
      workflow: {
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
    });
  teamId = team.body.team.id;

  await request(app)
    .put(`/api/integrations/slack/config/agent/${agentId}`)
    .set(auth())
    .send({ botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET });
  await request(app)
    .put(`/api/integrations/slack/config/team/${teamId}`)
    .set(auth())
    .send({ botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET });
});

afterEach(() => {
  setTurnExecutorForTests(null);
  setAgentNodeRunnerForTests(null);
  setSlackClientForTests(null);
  resetSlackEventDedupeForTests();
  sentMessages = [];
});

function captureSlackMessages() {
  setSlackClientForTests({
    async postMessage(input) {
      sentMessages.push(input);
    },
  });
}

describe('Slack config API', () => {
  it('returns webhook info with a stable request URL', async () => {
    const res = await request(app)
      .get(`/api/integrations/slack/webhook/agent/${agentId}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.integration.subjectName).toBe('Slack Agent');
    expect(res.body.integration.requestUrl).toContain(
      `/api/integrations/slack/agent/${agentId}/${webhookToken('agent', agentId)}`
    );
    expect(res.body.integration.configured).toBe(true);
    expect(res.body.integration.envStatus.botTokenConfigured).toBe(true);
  });

  it('masks stored credentials and never returns them in full', async () => {
    const res = await request(app)
      .get(`/api/integrations/slack/config/agent/${agentId}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.config.botTokenMasked).toBe('xoxb****');
    expect(res.body.config.signingSecretMasked).toBe('test****');
    expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(res.body)).not.toContain(SIGNING_SECRET);
  });

  it('rejects config access for subjects owned by someone else', async () => {
    const other = await request(app).post('/auth/register').send({
      email: 'slack2@example.com',
      username: 'slackuser2',
      password: 'a-strong-password',
    });
    const res = await request(app)
      .get(`/api/integrations/slack/config/agent/${agentId}`)
      .set({ Authorization: `Bearer ${other.body.token}` });
    expect(res.status).toBe(404);

    const save = await request(app)
      .put(`/api/integrations/slack/config/agent/${agentId}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .send({ botToken: 'xoxb-evil', signingSecret: 'evil' });
    expect(save.status).toBe(404);
  });
});

describe('Slack event intake', () => {
  it('answers url_verification with the challenge', async () => {
    const res = await postEvent('agent', agentId, {
      type: 'url_verification',
      challenge: 'challenge-value-123',
    });
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe('challenge-value-123');
  });

  it('rejects a bad URL token', async () => {
    const res = await postEvent('agent', agentId, messageEvent('C1', 'hi'), {
      token: 'not-the-token-not-the-token-1234',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a bad signature', async () => {
    const res = await postEvent('agent', agentId, messageEvent('C1', 'hi'), {
      secret: 'wrong-secret',
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_signature');
  });

  it('rejects stale timestamps (replay window)', async () => {
    const res = await postEvent('agent', agentId, messageEvent('C1', 'hi'), {
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });
    expect(res.status).toBe(401);
  });

  it('dedupes redelivered events by event_id', async () => {
    captureSlackMessages();
    setTurnExecutorForTests(async () => ({ text: 'pong', durationMs: 5 }));

    const body = messageEvent('C42', 'ping');
    const first = await postEvent('agent', agentId, body);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(true);
    expect(first.body.reason).toBeUndefined();

    const second = await postEvent('agent', agentId, body);
    expect(second.status).toBe(200);
    expect(second.body.reason).toBe('duplicate');
  });

  it('ignores bot echoes and subtyped messages', async () => {
    const echo = await postEvent(
      'agent',
      agentId,
      messageEvent('C1', 'echo', { bot_id: 'B999' })
    );
    expect(echo.body.ignored).toBe(true);

    const edited = await postEvent(
      'agent',
      agentId,
      messageEvent('C1', 'edited', { subtype: 'message_changed' })
    );
    expect(edited.body.ignored).toBe(true);
  });

  it('filters events from non-matching channels when configured', async () => {
    await request(app)
      .put(`/api/integrations/slack/config/agent/${agentId}`)
      .set(auth())
      .send({ botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, channelId: 'CONLY' });

    const res = await postEvent('agent', agentId, messageEvent('COTHER', 'hi'));
    expect(res.body.ignored).toBe(true);

    // Restore the unfiltered config for later tests.
    await request(app)
      .put(`/api/integrations/slack/config/agent/${agentId}`)
      .set(auth())
      .send({ botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET });
  });
});

describe('Slack agent conversations', () => {
  it('runs an agent turn and replies in the thread', async () => {
    captureSlackMessages();
    setTurnExecutorForTests(async (req) => ({
      text: `echo: ${req.prompt.includes('hello from slack') ? 'hello from slack' : 'missing'}`,
      durationMs: 5,
    }));

    const body = messageEvent('C100', '<@U0BOT> hello from slack');
    const res = await postEvent('agent', agentId, body);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);

    const reply = await waitFor(async () => sentMessages[0] ?? null);
    expect(reply.botToken).toBe(BOT_TOKEN);
    expect(reply.channel).toBe('C100');
    expect(reply.threadTs).toBe((body.event as { ts: string }).ts);
    expect(reply.text).toBe('echo: hello from slack');
  });

  it('reuses one conversation per channel+sender', async () => {
    captureSlackMessages();
    setTurnExecutorForTests(async () => ({ text: 'ok', durationMs: 5 }));

    await postEvent('agent', agentId, messageEvent('C200', 'first'));
    await waitFor(async () => (sentMessages.length >= 1 ? true : null));
    await postEvent('agent', agentId, messageEvent('C200', 'second'));
    await waitFor(async () => (sentMessages.length >= 2 ? true : null));

    const conversations = await request(app)
      .get(`/api/conversations?agentId=${agentId}`)
      .set(auth());
    const slackConversations = conversations.body.conversations.filter(
      (c: { title: string }) => c.title === 'Slack · C200'
    );
    expect(slackConversations).toHaveLength(1);

    const messages = await request(app)
      .get(`/api/conversations/${slackConversations[0].id}/messages`)
      .set(auth());
    const texts = messages.body.messages.map((m: { content: string }) => m.content);
    expect(texts).toContain('first');
    expect(texts).toContain('second');
    expect(messages.body.messages[0].meta.source).toBe('slack');
  });
});

describe('Slack team workflows', () => {
  it('acks, executes the workflow, and posts a summary in the thread', async () => {
    captureSlackMessages();
    setAgentNodeRunnerForTests(async (req) => ({
      output: `${req.node.label} done for: ${req.task}`,
      artifacts: [],
    }));

    const body = messageEvent('C300', '<@U0BOT> ship the report');
    const res = await postEvent('team', teamId, body);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);

    await waitFor(async () => (sentMessages.length >= 2 ? true : null), 10_000);
    expect(sentMessages[0]!.text).toContain('Task received');
    expect(sentMessages[0]!.text).toContain('Slack Team');

    const summary = sentMessages[1]!;
    expect(summary.channel).toBe('C300');
    expect(summary.threadTs).toBe((body.event as { ts: string }).ts);
    expect(summary.text).toContain('finished with status: succeeded');
    expect(summary.text).toContain('Work done for: ship the report');
    expect(summary.text).toContain('Execution ID:');
  });

  it('reports execution failures back to the thread', async () => {
    captureSlackMessages();
    setAgentNodeRunnerForTests(async () => {
      throw new Error('runner exploded');
    });

    await postEvent('team', teamId, messageEvent('C301', 'try this'));
    await waitFor(async () => (sentMessages.length >= 2 ? true : null), 10_000);
    expect(sentMessages[1]!.text).toContain('failed');
  });
});
