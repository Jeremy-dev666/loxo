import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { setTurnExecutorForTests } from '../src/modules/chat/chat.service';
import { deriveConversationTitle } from '../src/modules/chat/conversations.service';
import { RunnerError } from '../src/modules/runner/runner';
import { attachWsGateway, type WsGateway } from '../src/ws/gateway';

const app = createApp();
let server: Server;
let gateway: WsGateway;
let baseUrl = '';
let token = '';
let agentId = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'chat@example.com',
    username: 'chatuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  const agent = await request(app)
    .post('/api/agents')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Chat Agent', runtime: 'claude-code' });
  agentId = agent.body.agent.id;

  server = createServer(app);
  gateway = attachWsGateway(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `ws://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  setTurnExecutorForTests(null);
  await gateway.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const auth = () => ({ Authorization: `Bearer ${token}` });

function connect(query = `token=${token}`): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws?${query}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

interface Frame {
  type: string;
  payload?: Record<string, unknown>;
}

function collectUntil(ws: WebSocket, terminal: string[]): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const frames: Frame[] = [];
    const timer = setTimeout(() => reject(new Error(`No terminal frame; got ${JSON.stringify(frames)}`)), 8000);
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      frames.push(frame);
      if (terminal.includes(frame.type)) {
        clearTimeout(timer);
        resolve(frames);
      }
    });
  });
}

describe('conversations REST', () => {
  let conversationId = '';

  it('creates, lists, renames', async () => {
    const created = await request(app)
      .post('/api/conversations')
      .set(auth())
      .send({ agentId, title: 'First' });
    expect(created.status).toBe(201);
    conversationId = created.body.conversation.id;

    const list = await request(app).get(`/api/conversations?agentId=${agentId}`).set(auth());
    expect(list.body.conversations).toHaveLength(1);

    const renamed = await request(app)
      .patch(`/api/conversations/${conversationId}`)
      .set(auth())
      .send({ title: 'Renamed' });
    expect(renamed.body.conversation.title).toBe('Renamed');
  });

  it('exports conversation with messages and deletes with cascade', async () => {
    const exported = await request(app)
      .get(`/api/conversations/${conversationId}/export`)
      .set(auth());
    expect(exported.status).toBe(200);
    expect(exported.body).toHaveProperty('messages');

    const del = await request(app).delete(`/api/conversations/${conversationId}`).set(auth());
    expect(del.status).toBe(200);
    const gone = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set(auth());
    expect(gone.status).toBe(404);
  });

  it('reuses the empty conversation for untitled creates', async () => {
    const first = await request(app).post('/api/conversations').set(auth()).send({ agentId });
    const second = await request(app).post('/api/conversations').set(auth()).send({ agentId });
    expect(second.body.conversation.id).toBe(first.body.conversation.id);

    // A titled create is deliberate and always makes a fresh record.
    const titled = await request(app)
      .post('/api/conversations')
      .set(auth())
      .send({ agentId, title: 'Deliberate' });
    expect(titled.body.conversation.id).not.toBe(first.body.conversation.id);
  });
});

describe('deriveConversationTitle', () => {
  it('uses the message verbatim when short, collapsing whitespace', () => {
    expect(deriveConversationTitle('  Fix the\n login bug ')).toBe('Fix the login bug');
  });

  it('cuts long messages at a word boundary with an ellipsis', () => {
    const title = deriveConversationTitle(
      'Please review this pull request and check whether the migration is backwards compatible'
    );
    expect(title.length).toBeLessThanOrEqual(49);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/ …$/);
  });

  it('hard-cuts text without word boundaries', () => {
    const title = deriveConversationTitle('评审一下这个迁移脚本是否向后兼容'.repeat(10));
    expect(title.length).toBe(49);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('websocket chat', () => {
  it('rejects upgrade without a valid token', async () => {
    await expect(connect('token=garbage')).rejects.toThrow();
  });

  it('runs a full turn: open → message → reply, all persisted, no partial frames', async () => {
    // Earlier tests leave empty conversations that chat.open would reuse.
    await pool.query('DELETE FROM conversations');
    setTurnExecutorForTests(async (req) => {
      req.onChunk?.('partial ');
      req.onChunk?.('answer');
      return { text: 'partial answer', sessionRef: 'cli-sess-1', durationMs: 42 };
    });

    const ws = await connect();
    const framesPromise = collectUntil(ws, ['chat.reply', 'chat.error']);
    ws.send(JSON.stringify({ type: 'chat.open', payload: { agentId } }));

    const readyFrames = await collectUntil(ws, ['chat.ready']);
    const conversationId = readyFrames.find((f) => f.type === 'chat.ready')!.payload!
      .conversationId as string;

    ws.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'Hi agent' } })
    );
    const frames = await framesPromise;
    ws.close();

    // Replies are atomic by design: no chat.delta frames reach the client.
    expect(frames.some((f) => f.type === 'chat.delta')).toBe(false);
    const reply = frames.find((f) => f.type === 'chat.reply')!;
    expect(reply.payload!.content).toBe('partial answer');

    const messages = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set(auth());
    expect(messages.body.messages).toHaveLength(2);
    expect(messages.body.messages[0]).toMatchObject({ role: 'user', content: 'Hi agent' });
    expect(messages.body.messages[1]).toMatchObject({ role: 'assistant', content: 'partial answer' });

    const [row] = (
      await pool.query('SELECT runner_session_ref, title FROM conversations WHERE id = $1', [
        conversationId,
      ])
    ).rows;
    expect(row.runner_session_ref).toBe('cli-sess-1');
    expect(row.title).toBe('Hi agent');
  });

  it('keeps a manual title when messages arrive', async () => {
    setTurnExecutorForTests(async () => ({ text: 'ok', sessionRef: null, durationMs: 1 }));
    const created = await request(app)
      .post('/api/conversations')
      .set(auth())
      .send({ agentId, title: 'My topic' });
    const conversationId = created.body.conversation.id as string;

    const ws = await connect();
    ws.send(JSON.stringify({ type: 'chat.open', payload: { agentId, conversationId } }));
    await collectUntil(ws, ['chat.ready']);
    const framesPromise = collectUntil(ws, ['chat.reply', 'chat.error']);
    ws.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'Something else' } })
    );
    await framesPromise;
    ws.close();

    const [row] = (
      await pool.query('SELECT title FROM conversations WHERE id = $1', [conversationId])
    ).rows;
    expect(row.title).toBe('My topic');
  });

  it('persists runner failures as system messages instead of dropping them', async () => {
    setTurnExecutorForTests(async () => {
      throw new RunnerError('claude is not installed or not on PATH', 'cli_failed');
    });

    const ws = await connect();
    ws.send(JSON.stringify({ type: 'chat.open', payload: { agentId } }));
    const ready = await collectUntil(ws, ['chat.ready']);
    const conversationId = ready.find((f) => f.type === 'chat.ready')!.payload!
      .conversationId as string;

    const framesPromise = collectUntil(ws, ['chat.reply', 'chat.error']);
    ws.send(JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'Hi' } }));
    const frames = await framesPromise;
    ws.close();

    const reply = frames.find((f) => f.type === 'chat.reply')!;
    expect(reply.payload!.role).toBe('system');
    expect((reply.payload!.meta as { error?: boolean }).error).toBe(true);
  });

  it('clears the CLI session ref when the agent model changes', async () => {
    const providers = await request(app).post('/api/providers').set(auth()).send({
      name: 'Anthropic',
      vendor: 'anthropic',
      apiKey: 'sk-ant-test-key-abc',
      models: ['claude-sonnet-5'],
    });

    const conversation = await request(app)
      .post('/api/conversations')
      .set(auth())
      .send({ agentId });
    await pool.query('UPDATE conversations SET runner_session_ref = $1 WHERE id = $2', [
      'stale-ref',
      conversation.body.conversation.id,
    ]);

    await request(app)
      .patch(`/api/agents/${agentId}/config`)
      .set(auth())
      .send({ providerId: providers.body.provider.id, model: 'claude-sonnet-5' });

    const [row] = (
      await pool.query('SELECT runner_session_ref FROM conversations WHERE id = $1', [
        conversation.body.conversation.id,
      ])
    ).rows;
    expect(row.runner_session_ref).toBeNull();
  });
});
