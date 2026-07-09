import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MachineTurnStart } from '@swarmdev/shared';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { attachWsGateway, type WsGateway } from '../src/ws/gateway';

const app = createApp();
let server: Server;
let gateway: WsGateway;
let baseUrl = '';
let token = '';
let agentId = '';
let machineId = '';
let machineToken = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

interface Frame {
  type: string;
  payload?: Record<string, unknown>;
}

function wsConnect(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Collects frames until the predicate matches; rejects on timeout. */
function waitForFrame(
  ws: WebSocket,
  match: (frame: Frame) => boolean,
  timeoutMs = 5000
): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('frame not received in time'));
    }, timeoutMs);
    const onMessage = (raw: Buffer | string): void => {
      const frame = JSON.parse(raw.toString()) as Frame;
      if (match(frame)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(frame);
      }
    };
    ws.on('message', onMessage);
  });
}

/**
 * Scripted daemon: answers machine.turn.start according to `script` and
 * records every start payload it receives.
 */
async function connectFakeDaemon(
  script: (start: MachineTurnStart, send: (frame: Frame) => void) => void
): Promise<{ ws: WebSocket; starts: MachineTurnStart[] }> {
  const ws = await wsConnect(`/ws/machine?token=${machineToken}`);
  const starts: MachineTurnStart[] = [];
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as Frame;
    if (frame.type === 'machine.turn.start') {
      const payload = frame.payload as unknown as MachineTurnStart;
      starts.push(payload);
      script(payload, (out) => ws.send(JSON.stringify(out)));
    }
  });
  return { ws, starts };
}

function wsClosed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
  });
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'mturns@example.com',
    username: 'mturnsuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  server = createServer(app);
  gateway = attachWsGateway(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  const start = await request(app).post('/api/machines/pair/start').send({ hostname: 'FAKE' });
  await request(app)
    .post('/api/machines/pair/approve')
    .set(auth())
    .send({ userCode: start.body.userCode });
  const approved = await request(app)
    .post('/api/machines/pair/poll')
    .send({ deviceCode: start.body.deviceCode });
  machineId = approved.body.machineId;
  machineToken = approved.body.machineToken;

  const agent = await request(app)
    .post('/api/agents')
    .set(auth())
    .send({ name: 'Remote coder', runtime: 'claude-code' });
  agentId = agent.body.agent.id;
  const bound = await request(app)
    .patch(`/api/agents/${agentId}/config`)
    .set(auth())
    .send({ execution: 'machine', machineId, machineWorkdir: 'C:/remote/work' });
  expect(bound.status).toBe(200);
});

afterAll(async () => {
  await gateway.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function openConversation(userWs: WebSocket): Promise<string> {
  userWs.send(JSON.stringify({ type: 'chat.open', payload: { agentId } }));
  const ready = await waitForFrame(userWs, (f) => f.type === 'chat.ready');
  return ready.payload!.conversationId as string;
}

describe('machine-routed chat turns', () => {
  it('runs a full turn on the fake daemon: deltas stream, reply persists, session resumes', async () => {
    const daemon = await connectFakeDaemon((start, send) => {
      send({ type: 'machine.turn.delta', payload: { turnId: start.turnId, text: 'Hello ' } });
      send({ type: 'machine.turn.delta', payload: { turnId: start.turnId, text: 'world' } });
      send({
        type: 'machine.turn.result',
        payload: {
          turnId: start.turnId,
          ok: true,
          text: 'Hello world',
          sessionRef: 'sess-remote-1',
          durationMs: 12,
        },
      });
    });
    const userWs = await wsConnect(`/ws?token=${token}`);
    const conversationId = await openConversation(userWs);

    const deltas: string[] = [];
    userWs.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      if (frame.type === 'chat.delta') deltas.push(frame.payload!.text as string);
    });

    userWs.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'hi there' } })
    );
    const reply = await waitForFrame(userWs, (f) => f.type === 'chat.reply');
    expect(reply.payload!.content).toBe('Hello world');
    expect(deltas).toEqual(['Hello ', 'world']);

    expect(daemon.starts).toHaveLength(1);
    expect(daemon.starts[0]!.runtime).toBe('claude-code');
    expect(daemon.starts[0]!.workdir).toBe('C:/remote/work');
    expect(daemon.starts[0]!.sessionRef).toBeNull();
    expect(daemon.starts[0]!.prompt).toContain('hi there');

    // Second turn resumes the CLI session recorded from the first result.
    userWs.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'again' } })
    );
    await waitForFrame(userWs, (f) => f.type === 'chat.reply');
    expect(daemon.starts).toHaveLength(2);
    expect(daemon.starts[1]!.sessionRef).toBe('sess-remote-1');

    // History via REST agrees with the streamed replies.
    const messages = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set(auth());
    const assistant = messages.body.messages.filter(
      (m: { role: string }) => m.role === 'assistant'
    );
    expect(assistant).toHaveLength(2);

    userWs.close();
    daemon.ws.close();
    await Promise.all([wsClosed(userWs), wsClosed(daemon.ws)]);
  });

  it('surfaces an offline machine as a visible system message', async () => {
    const userWs = await wsConnect(`/ws?token=${token}`);
    const conversationId = await openConversation(userWs);

    userWs.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'anyone?' } })
    );
    const reply = await waitForFrame(userWs, (f) => f.type === 'chat.reply');
    expect(reply.payload!.role).toBe('system');
    expect(reply.payload!.content).toContain('offline');

    userWs.close();
    await wsClosed(userWs);
  });

  it('fails the turn fast when the daemon disconnects mid-turn', async () => {
    const daemon = await connectFakeDaemon(() => {
      daemon.ws.terminate(); // vanish without answering
    });
    const userWs = await wsConnect(`/ws?token=${token}`);
    const conversationId = await openConversation(userWs);

    userWs.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'crash now' } })
    );
    const reply = await waitForFrame(userWs, (f) => f.type === 'chat.reply');
    expect(reply.payload!.role).toBe('system');
    expect(reply.payload!.content).toContain('disconnected');

    userWs.close();
    await wsClosed(userWs);
  });

  it('relays chat.stop as a cancel and reports the aborted turn', async () => {
    const daemon = await connectFakeDaemon(() => {
      // do not answer; wait for the cancel
    });
    daemon.ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      if (frame.type === 'machine.turn.cancel') {
        daemon.ws.send(
          JSON.stringify({
            type: 'machine.turn.result',
            payload: {
              turnId: (frame.payload as { turnId: string }).turnId,
              ok: false,
              error: { kind: 'aborted', message: 'Turn was cancelled' },
            },
          })
        );
      }
    });
    const userWs = await wsConnect(`/ws?token=${token}`);
    const conversationId = await openConversation(userWs);

    userWs.send(
      JSON.stringify({ type: 'chat.message', payload: { conversationId, content: 'long task' } })
    );
    // Give the turn a moment to reach the daemon before stopping it.
    await new Promise((r) => setTimeout(r, 150));
    userWs.send(JSON.stringify({ type: 'chat.stop', payload: { conversationId } }));

    const reply = await waitForFrame(userWs, (f) => f.type === 'chat.reply');
    expect(reply.payload!.role).toBe('system');
    expect(reply.payload!.content).toContain('cancelled');

    userWs.close();
    daemon.ws.close();
    await Promise.all([wsClosed(userWs), wsClosed(daemon.ws)]);
  });
});
