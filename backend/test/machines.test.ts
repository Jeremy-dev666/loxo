import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { attachWsGateway, type WsGateway } from '../src/ws/gateway';

const app = createApp();

let server: Server;
let gateway: WsGateway;
let baseUrl: string;
let userToken: string;

async function registerUser(): Promise<string> {
  const res = await request(app).post('/auth/register').send({
    email: 'machines@example.com',
    username: 'machineuser',
    password: 'correct-horse-battery',
  });
  return res.body.token as string;
}

function wsConnect(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function wsClosed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
  });
}

/** Presence registration happens after the upgrade; poll briefly instead of sleeping. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition not met in time');
}

async function machineOnline(id: string): Promise<boolean> {
  const res = await request(app).get('/api/machines').set('Authorization', `Bearer ${userToken}`);
  const machine = (res.body.machines as Array<{ id: string; online: boolean }>).find(
    (m) => m.id === id
  );
  return machine?.online ?? false;
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  userToken = await registerUser();
  server = createServer(app);
  gateway = attachWsGateway(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await gateway.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('machine pairing', () => {
  it('walks the device-code flow end to end', async () => {
    const start = await request(app)
      .post('/api/machines/pair/start')
      .send({ platform: 'win32', hostname: 'JEREMY-PC' });
    expect(start.status).toBe(201);
    expect(start.body.deviceCode).toHaveLength(64);
    expect(start.body.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const pending = await request(app)
      .post('/api/machines/pair/poll')
      .send({ deviceCode: start.body.deviceCode });
    expect(pending.status).toBe(200);
    expect(pending.body.status).toBe('pending');

    const approve = await request(app)
      .post('/api/machines/pair/approve')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ userCode: start.body.userCode, name: 'Dev laptop' });
    expect(approve.status).toBe(201);
    expect(approve.body.machine.name).toBe('Dev laptop');
    expect(approve.body.machine.online).toBe(false);

    const approved = await request(app)
      .post('/api/machines/pair/poll')
      .send({ deviceCode: start.body.deviceCode });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.machineToken).toMatch(/^smk_/);
    expect(approved.body.machineId).toBe(approve.body.machine.id);

    // The token is delivered exactly once.
    const again = await request(app)
      .post('/api/machines/pair/poll')
      .send({ deviceCode: start.body.deviceCode });
    expect(again.status).toBe(404);
  });

  it('requires auth to approve', async () => {
    const start = await request(app).post('/api/machines/pair/start').send({});
    const res = await request(app)
      .post('/api/machines/pair/approve')
      .send({ userCode: start.body.userCode });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown user code', async () => {
    const res = await request(app)
      .post('/api/machines/pair/approve')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ userCode: 'XXXX-XXXX' });
    expect(res.status).toBe(404);
  });
});

describe('machine management and presence', () => {
  let machineId: string;
  let machineToken: string;

  beforeAll(async () => {
    const start = await request(app)
      .post('/api/machines/pair/start')
      .send({ platform: 'win32', hostname: 'WS-HOST' });
    await request(app)
      .post('/api/machines/pair/approve')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ userCode: start.body.userCode });
    const approved = await request(app)
      .post('/api/machines/pair/poll')
      .send({ deviceCode: start.body.deviceCode });
    machineId = approved.body.machineId;
    machineToken = approved.body.machineToken;
  });

  it('lists the machine as offline before the daemon connects', async () => {
    const res = await request(app).get('/api/machines').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    const machine = res.body.machines.find((m: { id: string }) => m.id === machineId);
    expect(machine).toBeTruthy();
    expect(machine.online).toBe(false);
  });

  it('marks the machine online while its socket is connected, offline after close', async () => {
    const ws = await wsConnect(`/ws/machine?token=${machineToken}`);
    await waitFor(() => machineOnline(machineId));

    ws.close();
    await wsClosed(ws);
    await waitFor(async () => !(await machineOnline(machineId)));

    const res = await request(app).get('/api/machines').set('Authorization', `Bearer ${userToken}`);
    const machine = res.body.machines.find((m: { id: string }) => m.id === machineId);
    expect(machine.lastSeenAt).toBeTruthy();
  });

  it('rejects a machine socket with a bad token', async () => {
    await expect(wsConnect('/ws/machine?token=smk_bogus')).rejects.toThrow();
  });

  it('stores runtimes reported by the daemon', async () => {
    const ws = await wsConnect(`/ws/machine?token=${machineToken}`);
    ws.send(
      JSON.stringify({
        type: 'machine.runtimes',
        payload: {
          runtimes: [
            { runtime: 'claude-code', available: true, version: '2.1.0' },
            { runtime: 'codex', available: false, version: null, error: 'codex is not on PATH' },
          ],
        },
      })
    );
    await waitFor(async () => {
      const res = await request(app)
        .get('/api/machines')
        .set('Authorization', `Bearer ${userToken}`);
      const machine = res.body.machines.find((m: { id: string }) => m.id === machineId);
      return machine?.runtimes?.length === 2;
    });
    ws.close();
    await wsClosed(ws);

    const res = await request(app).get('/api/machines').set('Authorization', `Bearer ${userToken}`);
    const machine = res.body.machines.find((m: { id: string }) => m.id === machineId);
    expect(machine.runtimes).toEqual([
      { runtime: 'claude-code', available: true, version: '2.1.0' },
      { runtime: 'codex', available: false, version: null, error: 'codex is not on PATH' },
    ]);
  });

  it('answers an invalid machine frame with machine.error', async () => {
    const ws = await wsConnect(`/ws/machine?token=${machineToken}`);
    const reply = new Promise<{ type: string }>((resolve) => {
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    ws.send(JSON.stringify({ type: 'machine.bogus', payload: {} }));
    const frame = await reply;
    expect(frame.type).toBe('machine.error');
    ws.close();
    await wsClosed(ws);
  });

  it('renames the machine', async () => {
    const res = await request(app)
      .patch(`/api/machines/${machineId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Renamed box' });
    expect(res.status).toBe(200);
    expect(res.body.machine.name).toBe('Renamed box');
  });

  it('binds a CLI agent to the machine and enforces the rules', async () => {
    const created = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Local coder', runtime: 'claude-code' });
    expect(created.status).toBe(201);
    const agentId = created.body.agent.id;
    expect(created.body.agent.execution).toBe('server');

    // machine execution requires a machine id
    const missing = await request(app)
      .patch(`/api/agents/${agentId}/config`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ execution: 'machine' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('machine_required');

    const bound = await request(app)
      .patch(`/api/agents/${agentId}/config`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ execution: 'machine', machineId, machineWorkdir: 'C:/work/demo' });
    expect(bound.status).toBe(200);
    expect(bound.body.agent.execution).toBe('machine');
    expect(bound.body.agent.machineId).toBe(machineId);
    expect(bound.body.agent.machineWorkdir).toBe('C:/work/demo');

    // switching back to server clears the binding
    const unbound = await request(app)
      .patch(`/api/agents/${agentId}/config`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ execution: 'server' });
    expect(unbound.status).toBe(200);
    expect(unbound.body.agent.machineId).toBeNull();
  });

  it('rejects machine binding when the reported runtime is unavailable', async () => {
    const created = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Codex local', runtime: 'codex' });
    // The earlier runtimes report marks codex unavailable on this machine.
    const res = await request(app)
      .patch(`/api/agents/${created.body.agent.id}/config`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ execution: 'machine', machineId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('runtime_unavailable');
  });

  it('rejects api execution for CLI agents and vice versa', async () => {
    const cli = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'CLI one', runtime: 'claude-code' });
    const cliRes = await request(app)
      .patch(`/api/agents/${cli.body.agent.id}/config`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ execution: 'api' });
    expect(cliRes.status).toBe(400);
    expect(cliRes.body.code).toBe('execution_mismatch');

    const api = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'API one', runtime: 'api' });
    expect(api.body.agent.execution).toBe('api');
    const apiRes = await request(app)
      .patch(`/api/agents/${api.body.agent.id}/config`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ execution: 'machine', machineId });
    expect(apiRes.status).toBe(400);
    expect(apiRes.body.code).toBe('execution_mismatch');
  });

  it('revoke hides the machine, kills the socket, and blocks reconnects', async () => {
    const ws = await wsConnect(`/ws/machine?token=${machineToken}`);
    await waitFor(() => machineOnline(machineId));

    const res = await request(app)
      .delete(`/api/machines/${machineId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    await wsClosed(ws);

    const list = await request(app)
      .get('/api/machines')
      .set('Authorization', `Bearer ${userToken}`);
    expect(list.body.machines.find((m: { id: string }) => m.id === machineId)).toBeUndefined();

    await expect(wsConnect(`/ws/machine?token=${machineToken}`)).rejects.toThrow();
  });
});
