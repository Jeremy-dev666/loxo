import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';

const app = createApp();
let token = '';
let agentId = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'chatfiling@example.com',
    username: 'filinguser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  const agent = await request(app)
    .post('/api/agents')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Ada', runtime: 'claude-code' });
  agentId = agent.body.agent.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function newConversation(): Promise<string> {
  const res = await request(app)
    .post('/api/conversations')
    .set(auth())
    .send({ agentId, title: `filing-${Date.now()}-${Math.random()}` });
  return res.body.conversation.id;
}

describe('POST /api/conversations/:id/file-issue', () => {
  it('creates a backlog issue assigned to the chat agent, linked to the conversation', async () => {
    const conversationId = await newConversation();

    const res = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Ship the export command', description: 'CSV first, JSON later.' });

    expect(res.status).toBe(201);
    const issue = res.body.issue;
    expect(issue.status).toBe('backlog');
    expect(issue.title).toBe('Ship the export command');
    expect(issue.description).toBe('CSV first, JSON later.');
    expect(issue.assigneeAgentId).toBe(agentId);
    expect(issue.sourceConversationId).toBe(conversationId);
    expect(issue.issueNumber).toBeGreaterThan(0);
  });

  it('does not enqueue a run: backlog filing must not wake the agent', async () => {
    const conversationId = await newConversation();
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Quiet filing' });

    const runs = await pool.query('SELECT id FROM runs WHERE issue_id = $1', [res.body.issue.id]);
    expect(runs.rowCount).toBe(0);
  });

  it('leaves a timeline comment on the issue', async () => {
    const conversationId = await newConversation();
    const filed = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Comment breadcrumb' });

    const comments = await request(app)
      .get(`/api/issues/${filed.body.issue.id}/comments`)
      .set(auth());
    expect(comments.body.comments).toHaveLength(1);
    expect(comments.body.comments[0].authorType).toBe('human');
    expect(comments.body.comments[0].body).toContain('Filed from the chat');
  });

  it('posts a system message into the conversation pointing at the issue', async () => {
    const conversationId = await newConversation();
    const filed = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Chat breadcrumb' });

    const messages = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set(auth());
    const system = messages.body.messages.filter((m: { role: string }) => m.role === 'system');
    expect(system).toHaveLength(1);
    expect(system[0].content).toContain(`#${filed.body.issue.issueNumber}`);
    expect(system[0].content).toContain('Chat breadcrumb');
    expect(system[0].meta.issueId).toBe(filed.body.issue.id);
    expect(system[0].meta.source).toBe('issue_filing');
  });

  it('lets one conversation file several issues', async () => {
    const conversationId = await newConversation();
    const first = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'First topic' });
    const second = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Second topic' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.issue.id).not.toBe(first.body.issue.id);
    expect(second.body.issue.sourceConversationId).toBe(conversationId);
  });

  it('honors an explicit project and rejects a foreign one', async () => {
    const project = await request(app)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'Filing target' });
    const conversationId = await newConversation();

    const ok = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Into a project', projectId: project.body.project.id });
    expect(ok.status).toBe(201);
    expect(ok.body.issue.projectId).toBe(project.body.project.id);

    const bad = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Nope', projectId: '00000000-0000-0000-0000-000000000000' });
    expect(bad.status).toBe(400);
  });

  it('rejects an empty title', async () => {
    const conversationId = await newConversation();
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it("404s on another user's conversation", async () => {
    const conversationId = await newConversation();
    const other = await request(app).post('/auth/register').send({
      email: 'filing-other@example.com',
      username: 'filingother',
      password: 'a-strong-password',
    });

    const res = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .send({ title: 'Not yours' });
    expect(res.status).toBe(404);
  });

  it('deleting the conversation keeps the issue and clears the link', async () => {
    const conversationId = await newConversation();
    const filed = await request(app)
      .post(`/api/conversations/${conversationId}/file-issue`)
      .set(auth())
      .send({ title: 'Survives deletion' });

    await request(app).delete(`/api/conversations/${conversationId}`).set(auth());

    const issue = await request(app).get(`/api/issues/${filed.body.issue.id}`).set(auth());
    expect(issue.status).toBe(200);
    expect(issue.body.issue.sourceConversationId).toBeNull();
  });
});
