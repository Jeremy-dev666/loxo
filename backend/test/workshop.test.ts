import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import {
  classifyNote,
  detectMentions,
  isBootstrapNoise,
  setReplyRunnerForTests,
  summarizeNoteText,
} from '../src/modules/workshop/workshop.service';

const app = createApp();
let token = '';
const agentIds: string[] = [];
const agentNames = ['Product Lead', 'Backend Engineer', 'QA Reviewer'];

const auth = () => ({ Authorization: `Bearer ${token}` });

function members() {
  return agentIds.map((id, i) => ({
    agentId: id,
    name: agentNames[i]!,
    role: agentNames[i],
    description: `${agentNames[i]} of the team`,
  }));
}

async function pollUntil(
  sessionId: string,
  predicate: (state: { active: boolean; round: number; messages: unknown[] }) => boolean,
  timeoutMs = 15_000
): Promise<Record<string, never> & {
  active: boolean;
  round: number;
  stopRequested: boolean;
  messages: Array<{ senderName: string; content: string }>;
  notes: Array<{ column: string; text: string; authorName: string; id: string; x: number; y: number }>;
  runLogs: Array<{ status: string; message: string }>;
}> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/workshop/sessions/${sessionId}`).set(auth());
    if (predicate(res.body) || Date.now() > deadline) return res.body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'workshop@example.com',
    username: 'workshopuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  for (const name of agentNames) {
    const agent = await request(app)
      .post('/api/agents')
      .set(auth())
      .send({ name, runtime: 'api', description: `${name} of the team` });
    agentIds.push(agent.body.agent.id);
  }
});

afterEach(() => {
  setReplyRunnerForTests(null);
});

describe('helpers', () => {
  it('detects explicit mentions and @everyone (first two members)', () => {
    const m = members();
    expect(detectMentions('I agree with @Backend Engineer here', m).map((x) => x.name)).toEqual([
      'Backend Engineer',
    ]);
    expect(detectMentions('@everyone thoughts?', m)).toHaveLength(2);
    expect(detectMentions('no mentions here', m)).toHaveLength(0);
  });

  it('classifies whiteboard notes by content', () => {
    expect(classifyNote('Who will own the deployment?')).toBe('questions');
    expect(classifyNote('There is a risk this blocks the release')).toBe('risks');
    expect(classifyNote('Next step: we should draft the schema')).toBe('actions');
    expect(classifyNote('The core concept feels solid')).toBe('ideas');
  });

  it('summarizes messages into short phrases without markdown noise', () => {
    const summary = summarizeNoteText(
      'I think **we should split the API**. See [docs](http://x). @QA can verify. ```const x = 1```'
    );
    expect(summary).not.toContain('```');
    expect(summary).not.toContain('@QA');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('scores bootstrap noise and passes normal replies', () => {
    expect(
      isBootstrapNoise('I am a blank slate; my BOOTSTRAP.md says I need initialization first.')
    ).toBe(true);
    expect(isBootstrapNoise('I think the schema needs a version column.')).toBe(false);
  });
});

describe('single turn', () => {
  it('runs one guarded turn and retries bootstrap noise once', async () => {
    const replies = [
      'I am a blank slate. My BOOTSTRAP.md is not initialized.',
      'The plan looks good; I would add rate limiting.',
    ];
    let calls = 0;
    setReplyRunnerForTests(async (_userId, _agent, prompt) => {
      calls += 1;
      if (calls === 2) expect(prompt).toContain('WORKSHOP_RETRY_GUARD');
      return replies[calls - 1]!;
    });

    const res = await request(app)
      .post('/api/workshop/turn')
      .set(auth())
      .send({
        agentId: agentIds[1],
        prompt: 'What do you think of the plan?',
        members: members(),
      });

    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(res.body.content).toContain('rate limiting');
    expect(res.body.agentName).toBe('Backend Engineer');
  });

  it('404s for agents the user does not own', async () => {
    const res = await request(app)
      .post('/api/workshop/turn')
      .set(auth())
      .send({
        agentId: '00000000-0000-4000-8000-000000000000',
        prompt: 'hello',
      });
    expect(res.status).toBe(404);
  });
});

describe('session loop', () => {
  it('runs multiple rounds, fills the whiteboard, and honors a stop-phrase reply', async () => {
    let turn = 0;
    setReplyRunnerForTests(async (_userId, agent) => {
      turn += 1;
      // Keep the conversation moving for a few rounds, then stop it.
      if (turn >= 6) return `I think we are done here — stop this topic.`;
      return `${agent.name} here: the design needs a next step, we should refine it (turn ${turn}).`;
    });

    const start = await request(app)
      .post('/api/workshop/sessions/loop-session/messages')
      .set(auth())
      .send({
        title: 'Design review',
        userMessage: { content: 'Team, how should we approach the new dashboard design?' },
        members: members(),
      });
    expect(start.status).toBe(200);
    expect(start.body.active).toBe(true);

    const state = await pollUntil('loop-session', (s) => !s.active, 20_000);

    expect(state.active).toBe(false);
    expect(state.stopRequested).toBe(true);
    expect(state.round).toBeGreaterThanOrEqual(3);
    // Agent messages accumulated beyond the user message.
    const agentMessages = state.messages.filter((m) => m.senderName !== 'You');
    expect(agentMessages.length).toBeGreaterThanOrEqual(5);
    // Whiteboard auto-notes were generated from replies.
    expect(state.notes.length).toBeGreaterThanOrEqual(5);
    expect(state.notes.every((n) => ['ideas', 'questions', 'actions', 'risks'].includes(n.column))).toBe(
      true
    );
  }, 30_000);

  it('supports whiteboard note drag updates', async () => {
    const state = await request(app).get('/api/workshop/sessions/loop-session').set(auth());
    const note = state.body.notes[0];
    const res = await request(app)
      .patch(`/api/workshop/sessions/loop-session/notes/${note.id}`)
      .set(auth())
      .send({ x: 400, y: 300, column: 'risks' });
    expect(res.status).toBe(200);
    expect(res.body.note).toMatchObject({ x: 400, y: 300, column: 'risks' });
  });

  it('stops immediately when the user message is a stop phrase', async () => {
    setReplyRunnerForTests(async () => 'should never be called');
    const res = await request(app)
      .post('/api/workshop/sessions/stop-session/messages')
      .set(auth())
      .send({
        userMessage: { content: 'ok, stop this topic' },
        members: members(),
      });
    expect(res.body.active).toBe(false);
    expect(res.body.stopRequested).toBe(true);
  });

  it('pauses the loop when every speaker fails', async () => {
    setReplyRunnerForTests(async () => {
      throw new Error('CLI unavailable');
    });
    await request(app)
      .post('/api/workshop/sessions/fail-session/messages')
      .set(auth())
      .send({
        userMessage: { content: 'Anyone there?' },
        members: members(),
      });

    const state = await pollUntil('fail-session', (s) => !s.active, 15_000);
    expect(state.active).toBe(false);
    expect(state.runLogs.some((log) => log.status === 'error')).toBe(true);
  }, 20_000);

  it('stop endpoint halts an active session', async () => {
    setReplyRunnerForTests(
      () => new Promise((resolve) => setTimeout(() => resolve('slow reply'), 500))
    );
    await request(app)
      .post('/api/workshop/sessions/halt-session/messages')
      .set(auth())
      .send({
        userMessage: { content: 'Let us discuss something long-running' },
        members: members(),
      });

    const stopped = await request(app)
      .post('/api/workshop/sessions/halt-session/stop')
      .set(auth());
    expect(stopped.body.stopRequested).toBe(true);

    const state = await pollUntil('halt-session', (s) => !s.active, 10_000);
    expect(state.active).toBe(false);
  }, 15_000);
});
