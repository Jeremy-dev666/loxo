import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';

const app = createApp();
let token = '';
const agentIds: string[] = [];
const agentNames = ['Draft Writer', 'Draft Reviewer'];

const auth = () => ({ Authorization: `Bearer ${token}` });

const seedNotes = [
  { column: 'ideas', text: 'Draft release notes from merged PRs', authorName: 'Draft Writer' },
  { column: 'actions', text: 'Writer drafts, reviewer checks tone and accuracy', authorName: 'Draft Reviewer' },
  { column: 'risks', text: 'Reviewer must reject drafts that leak internal names', authorName: 'Draft Reviewer' },
];

function draftBody(extra: Record<string, unknown> = {}) {
  return {
    title: 'Release notes pipeline',
    members: agentIds.map((id, i) => ({ agentId: id, name: agentNames[i]! })),
    notes: seedNotes,
    ...extra,
  };
}

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'drafts@example.com',
    username: 'draftsuser',
    password: 'a-strong-password',
  });
  token = reg.body.token;

  for (const name of agentNames) {
    const agent = await request(app)
      .post('/api/agents')
      .set(auth())
      .send({ name, runtime: 'api', description: `${name} for the drafts test` });
    agentIds.push(agent.body.agent.id);
  }
});

describe('roundtable workflow drafts', () => {
  it('rejects generation when the whiteboard is empty', async () => {
    const res = await request(app)
      .post('/api/roundtable/sessions/empty-board/workflow-drafts')
      .set(auth())
      .send({ title: 'Empty board' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('empty_whiteboard');
  });

  it('generates a proposed draft from seeded whiteboard notes', async () => {
    const res = await request(app)
      .post('/api/roundtable/sessions/draft-flow/workflow-drafts')
      .set(auth())
      .send(draftBody());
    expect(res.status).toBe(200);

    const { draft, state } = res.body;
    expect(draft.status).toBe('proposed');
    expect(draft.revision).toBe(1);
    expect(draft.noteCount).toBe(seedNotes.length);
    // No provider configured in tests: the deterministic fallback must kick in.
    expect(draft.generator).toBe('fallback');
    expect(draft.workflow.nodes.some((n: { type: string }) => n.type === 'agent')).toBe(true);

    expect(state.workflowDrafts).toHaveLength(1);
    const card = state.messages.find((m: { draftId?: string }) => m.draftId === draft.id);
    expect(card).toBeDefined();
    expect(card.senderId).toBe('system');
  });

  it('regenerates with feedback and supersedes the previous draft', async () => {
    const first = await request(app)
      .post('/api/roundtable/sessions/draft-revise/workflow-drafts')
      .set(auth())
      .send(draftBody());
    const second = await request(app)
      .post('/api/roundtable/sessions/draft-revise/workflow-drafts')
      .set(auth())
      .send(draftBody({ feedback: 'Add a review gate before the end', previousDraftId: first.body.draft.id }));

    expect(second.status).toBe(200);
    expect(second.body.draft.revision).toBe(2);
    expect(second.body.draft.feedback).toBe('Add a review gate before the end');

    const drafts = second.body.state.workflowDrafts as Array<{ id: string; status: string }>;
    expect(drafts.find((d) => d.id === first.body.draft.id)?.status).toBe('superseded');
    expect(drafts.find((d) => d.id === second.body.draft.id)?.status).toBe('proposed');
  });

  it('404s when regenerating from an unknown previous draft', async () => {
    const res = await request(app)
      .post('/api/roundtable/sessions/draft-flow/workflow-drafts')
      .set(auth())
      .send(draftBody({ previousDraftId: 'draft-nope', feedback: 'x' }));
    expect(res.status).toBe(404);
  });

  it('confirms a draft into a team with version and roundtable origin', async () => {
    const gen = await request(app)
      .post('/api/roundtable/sessions/draft-confirm/workflow-drafts')
      .set(auth())
      .send(draftBody());
    const draftId = gen.body.draft.id as string;

    const confirm = await request(app)
      .post(`/api/roundtable/sessions/draft-confirm/workflow-drafts/${draftId}/confirm`)
      .set(auth())
      .send({ name: 'Release Notes Crew' });
    expect(confirm.status).toBe(200);

    const teamId = confirm.body.team.id as string;
    expect(confirm.body.team.name).toBe('Release Notes Crew');
    const stateDraft = (confirm.body.state.workflowDrafts as Array<{ id: string; status: string; teamId?: string }>).find(
      (d) => d.id === draftId
    );
    expect(stateDraft?.status).toBe('confirmed');
    expect(stateDraft?.teamId).toBe(teamId);

    const team = await request(app).get(`/api/teams/${teamId}`).set(auth());
    expect(team.status).toBe(200);
    const metadata = team.body.team.workflow.metadata;
    expect(metadata.version).toBe(1);
    expect(metadata.origin.kind).toBe('roundtable');
    expect(metadata.origin.sessionId).toBe('draft-confirm');
    expect(metadata.origin.notes).toHaveLength(seedNotes.length);

    const again = await request(app)
      .post(`/api/roundtable/sessions/draft-confirm/workflow-drafts/${draftId}/confirm`)
      .set(auth())
      .send({});
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('draft_already_confirmed');
  });

  it('bumps the workflow version when confirming into an existing team', async () => {
    const gen1 = await request(app)
      .post('/api/roundtable/sessions/draft-version/workflow-drafts')
      .set(auth())
      .send(draftBody());
    const c1 = await request(app)
      .post(`/api/roundtable/sessions/draft-version/workflow-drafts/${gen1.body.draft.id}/confirm`)
      .set(auth())
      .send({ name: 'Versioned Crew' });
    const teamId = c1.body.team.id as string;

    const gen2 = await request(app)
      .post('/api/roundtable/sessions/draft-version/workflow-drafts')
      .set(auth())
      .send(draftBody({ feedback: 'Tighten the flow', previousDraftId: gen1.body.draft.id }));
    const c2 = await request(app)
      .post(`/api/roundtable/sessions/draft-version/workflow-drafts/${gen2.body.draft.id}/confirm`)
      .set(auth())
      .send({ teamId });
    expect(c2.status).toBe(200);
    expect(c2.body.team.id).toBe(teamId);

    const team = await request(app).get(`/api/teams/${teamId}`).set(auth());
    expect(team.body.team.workflow.metadata.version).toBe(2);
    expect(team.body.team.workflow.metadata.origin.revision).toBe(2);
  });
});
