import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { storage } from '../src/storage/layout';
import { validateGraph } from '../src/modules/teams/workflow-dsl';
import { buildTemplateWorkflow, listTeamTemplates } from '../src/modules/market/team-templates';

const app = createApp();
let token = '';
let userId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'teamtpl@example.com',
    username: 'teamtpluser',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;
});

describe('template catalog', () => {
  it('lists templates with a structurally valid preview workflow', async () => {
    const res = await request(app).get('/api/market/team-templates').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(2);

    for (const template of res.body.templates) {
      expect(template.memberCount).toBe(template.members.length);
      const { errors } = validateGraph(template.workflow.nodes, template.workflow.edges);
      // Unbound agent nodes are warnings, not structural errors.
      expect(errors).toHaveLength(0);
    }
  });

  it('builds a linear pipeline: first member orchestrates, single concurrency', () => {
    const [template] = listTeamTemplates();
    const workflow = buildTemplateWorkflow(template!, { agentIds: ['a', 'b', 'c', 'd'] });

    const agentNodes = workflow.nodes.filter((n) => n.type === 'agent');
    expect(agentNodes[0]).toMatchObject({ kind: 'orchestrator', agentId: 'a' });
    expect(agentNodes.slice(1).every((n) => n.type === 'agent' && n.kind === 'worker')).toBe(true);
    expect(workflow.execution).toMatchObject({ mode: 'dag', maxConcurrency: 1 });
    expect(workflow.metadata?.source).toBe('template');
  });

  it('404s on unknown template ids', async () => {
    const res = await request(app).get('/api/market/team-templates/nope').set(auth());
    expect(res.status).toBe(404);
  });
});

describe('adopt', () => {
  let firstAdoptAgentIds: string[] = [];

  it('creates group, agents with skills, and a bound team', async () => {
    const res = await request(app)
      .post('/api/market/team-templates/tpl-product-delivery/adopt')
      .set(auth())
      .send({ teamName: 'Delivery Alpha' });
    expect(res.status).toBe(201);

    const { team, groupId, agentIds } = res.body;
    firstAdoptAgentIds = agentIds;
    expect(agentIds).toHaveLength(3);
    expect(team.name).toBe('Delivery Alpha');

    // Workflow nodes are bound to the freshly created agents.
    const boundIds = team.workflow.nodes
      .filter((n: { type: string }) => n.type === 'agent')
      .map((n: { agentId?: string }) => n.agentId);
    expect(boundIds).toEqual(agentIds);

    // Agents landed in the new group with mixed runtimes from the template.
    const list = await request(app).get(`/api/agents?groupId=${groupId}`).set(auth());
    expect(list.body.agents).toHaveLength(3);
    const runtimes = list.body.agents.map((a: { runtime: string }) => a.runtime).sort();
    expect(runtimes).toEqual(['hermes', 'openclaw', 'opencode']);

    // Starter skills were materialized as SKILL.md files.
    const skills = await request(app).get(`/api/agents/${agentIds[0]}/skills`).set(auth());
    expect(skills.body.skills.length).toBeGreaterThanOrEqual(3);
    const workspace = storage.agentPaths(userId, agentIds[0]).workspace;
    expect(fs.existsSync(path.join(workspace, 'skills', 'requirement-shaping', 'SKILL.md'))).toBe(true);
  });

  it('reports previously adopted agents as duplicates per role', async () => {
    const res = await request(app)
      .get('/api/market/team-templates/tpl-product-delivery/duplicates')
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.duplicates).toHaveLength(3);
    const roles = res.body.duplicates.map((d: { roleCode: string }) => d.roleCode).sort();
    expect(roles).toEqual(['DEV', 'PLAN', 'QA']);
  });

  it('copies provider config when share-config is chosen', async () => {
    const provider = await request(app).post('/api/providers').set(auth()).send({
      name: 'OpenAI',
      vendor: 'openai',
      apiKey: 'sk-openai-key-for-templates',
      models: ['gpt-4o-mini'],
    });
    // Configure the previously adopted DEV agent (opencode -> openai vendor).
    const duplicates = await request(app)
      .get('/api/market/team-templates/tpl-product-delivery/duplicates')
      .set(auth());
    const dev = duplicates.body.duplicates.find((d: { roleCode: string }) => d.roleCode === 'DEV');
    await request(app)
      .patch(`/api/agents/${dev.agentId}/config`)
      .set(auth())
      .send({ providerId: provider.body.provider.id, model: 'gpt-4o-mini' });

    const res = await request(app)
      .post('/api/market/team-templates/tpl-product-delivery/adopt')
      .set(auth())
      .send({
        teamName: 'Delivery Beta',
        duplicateChoices: [
          { roleCode: 'DEV', existingAgentId: dev.agentId, mode: 'share-config' },
        ],
      });
    expect(res.status).toBe(201);

    const agents = await Promise.all(
      res.body.agentIds.map(async (id: string) => {
        const r = await request(app).get(`/api/agents/${id}`).set(auth());
        return r.body.agent;
      })
    );
    const newDev = agents.find((a) => a.manifest.template.roleCode === 'DEV');
    const newPlan = agents.find((a) => a.manifest.template.roleCode === 'PLAN');
    expect(newDev.providerId).toBe(provider.body.provider.id);
    expect(newDev.model).toBe('gpt-4o-mini');
    expect(newPlan.providerId).toBeNull();
  });

  it('keeps the first adoption intact after a second one', async () => {
    const agent = await request(app).get(`/api/agents/${firstAdoptAgentIds[0]}`).set(auth());
    expect(agent.status).toBe(200);
  });
});
