import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/client';
import { createApp } from '../src/http/app';
import { buildWorkflowNodePrompt } from '../src/modules/runner/turn-context';
import type { TurnRequest } from '../src/modules/runner/runner';
import {
  diffWorkspaceSnapshots,
  persistNodeOutput,
  readArtifactPreview,
  sanitizeFileName,
  snapshotWorkspace,
} from '../src/modules/workflows/artifacts';
import { setWorkflowTurnExecutorForTests } from '../src/modules/workflows/agent-node';
import { getExecution } from '../src/modules/workflows/execution-store';
import { startExecution } from '../src/modules/workflows/executor';
import { normalizeDsl } from '../src/modules/teams/workflow-dsl';
import { storage } from '../src/storage/layout';

const app = createApp();
let token = '';
let userId = '';
let teamId = '';
let writerAgent = '';
let readerAgent = '';

beforeAll(async () => {
  await pool.query('TRUNCATE TABLE users CASCADE');
  const reg = await request(app).post('/auth/register').send({
    email: 'wfagent@example.com',
    username: 'wfagent',
    password: 'a-strong-password',
  });
  token = reg.body.token;
  userId = reg.body.user.id;

  const team = await request(app)
    .post('/api/teams')
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Agent node team' });
  teamId = team.body.team.id;

  for (const [name, runtime] of [
    ['Writer', 'claude-code'],
    ['Reader', 'claude-code'],
  ] as const) {
    const res = await request(app)
      .post('/api/agents')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name, runtime });
    if (name === 'Writer') writerAgent = res.body.agent.id;
    else readerAgent = res.body.agent.id;
  }
});

afterEach(() => {
  setWorkflowTurnExecutorForTests(null);
});

async function waitForTerminal(executionId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await getExecution(userId, executionId);
    if (detail && ['succeeded', 'failed', 'cancelled'].includes(detail.status)) return detail;
    if (Date.now() > deadline) throw new Error(`Execution ${executionId} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('workspace snapshots', () => {
  it('diffs created and updated files and honors the ignore list', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmdev-snap-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'kept.txt'), 'v1');
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'ignored.js'), 'x');

    const before = snapshotWorkspace(root);
    expect(before.has('src/kept.txt')).toBe(true);
    expect([...before.keys()].some((k) => k.includes('node_modules'))).toBe(false);

    fs.writeFileSync(path.join(root, 'src', 'kept.txt'), 'v2-longer');
    fs.writeFileSync(path.join(root, 'fresh.md'), 'new file');
    const after = snapshotWorkspace(root);

    const artifacts = diffWorkspaceSnapshots(root, before, after, 'n1', 1);
    const byPath = new Map(artifacts.map((a) => [a.path, a]));
    expect(byPath.get('src/kept.txt')?.label).toBe('updated');
    expect(byPath.get('fresh.md')?.label).toBe('created');
    expect(artifacts.every((a) => a.kind === 'workspace-file')).toBe(true);
  });

  it('previews text files and rejects binary content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmdev-prev-'));
    const textFile = path.join(root, 'notes.md');
    fs.writeFileSync(textFile, 'hello preview');
    expect(readArtifactPreview(textFile)?.text).toBe('hello preview');

    const bigFile = path.join(root, 'big.txt');
    fs.writeFileSync(bigFile, 'a'.repeat(10_000));
    const big = readArtifactPreview(bigFile);
    expect(big?.truncated).toBe(true);
    expect(big!.text.length).toBeLessThanOrEqual(3600);

    const binFile = path.join(root, 'blob.bin');
    fs.writeFileSync(binFile, Buffer.from([0x89, 0x50, 0x00, 0x47]));
    expect(readArtifactPreview(binFile)).toBeNull();
  });

  it('writes node output markdown with sanitized names', () => {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmdev-out-'));
    const artifact = persistNodeOutput({
      runRoot,
      artifactsDir: path.join(runRoot, 'artifacts'),
      executionId: 'exec-1',
      workflowName: 'Test flow',
      nodeId: 'my node/1',
      nodeLabel: 'My node',
      runCount: 2,
      output: 'final answer',
    });
    expect(artifact.kind).toBe('node-output');
    expect(artifact.path).toBe('artifacts/nodes/my-node-1-run-2.md');
    const content = fs.readFileSync(artifact.absolutePath, 'utf8');
    expect(content).toContain('final answer');
    expect(content).toContain('Test flow');
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('hello world!')).toBe('hello-world');
    expect(sanitizeFileName('///')).toBe('node');
    expect(sanitizeFileName('a'.repeat(200))).toHaveLength(80);
  });
});

describe('buildWorkflowNodePrompt', () => {
  it('frames the node with non-interactive directives', () => {
    const prompt = buildWorkflowNodePrompt({
      agent: { name: 'Writer', description: 'Writes things' },
      workflowName: 'Docs pipeline',
      executionId: 'exec-9',
      nodeId: 'draft',
      nodeLabel: 'Draft',
      kind: 'worker',
      role: 'technical writer',
      task: 'Write the README',
      input: 'Upstream says hello',
      workspace: '/tmp/ws',
      artifactsDir: '/tmp/artifacts',
    });
    expect(prompt).toContain('non-interactive');
    expect(prompt).toContain('Shared workspace: /tmp/ws');
    expect(prompt).toContain('Draft — worker, role: technical writer');
    expect(prompt).toContain('[NODE_INPUT]\nUpstream says hello\n[/NODE_INPUT]');
    expect(prompt).toContain("Do not perform downstream nodes' work");
  });
});

describe('agent node execution', () => {
  it('runs agents against the shared workspace and hands artifacts downstream', async () => {
    const prompts: TurnRequest[] = [];
    setWorkflowTurnExecutorForTests(async (req) => {
      prompts.push(req);
      if (prompts.length === 1) {
        const notesDir = path.join(req.workspace, 'notes');
        fs.mkdirSync(notesDir, { recursive: true });
        fs.writeFileSync(path.join(notesDir, 'summary.md'), 'summary body from writer');
        return { text: 'Wrote notes/summary.md', durationMs: 5 };
      }
      return { text: 'Read the summary, all good', durationMs: 5 };
    });

    const workflow = normalizeDsl(
      {
        name: 'Handoff flow',
        nodes: [
          { id: 'start', type: 'start', label: 'Task' },
          { id: 'writer', type: 'agent', label: 'Writer', kind: 'worker', agentId: writerAgent },
          { id: 'reader', type: 'agent', label: 'Reader', kind: 'worker', agentId: readerAgent },
          { id: 'end', type: 'end', label: 'Done' },
        ],
        edges: [
          { from: 'start', to: 'writer' },
          { from: 'writer', to: 'reader' },
          { from: 'reader', to: 'end' },
        ],
      },
      new Set([writerAgent, readerAgent])
    );

    const started = await startExecution({
      userId,
      teamId,
      task: 'Produce and review a summary',
      workflow,
    });
    const detail = await waitForTerminal(started.id);
    expect(detail.status).toBe('succeeded');

    // Both agents ran in the shared run workspace with isolated state dirs.
    const runDirs = storage.teamRunDirs(userId, teamId, started.id);
    expect(prompts[0]!.workspace).toBe(runDirs.workspace);
    expect(prompts[1]!.workspace).toBe(runDirs.workspace);
    expect(prompts[0]!.stateDir).toContain(path.join('agent-state', writerAgent));
    expect(prompts[0]!.sessionRef).toBeNull();

    // The writer's workspace diff became a handoff preview in the reader's input.
    expect(prompts[1]!.prompt).toContain('Handoff files');
    expect(prompts[1]!.prompt).toContain('notes/summary.md');
    expect(prompts[1]!.prompt).toContain('summary body from writer');
    expect(prompts[1]!.prompt).toContain('non-interactive');

    const writerArtifacts = detail.artifacts.filter((a) => a.nodeId === 'writer');
    expect(writerArtifacts.map((a) => a.kind).sort()).toEqual(['node-output', 'workspace-file']);
    expect(writerArtifacts.find((a) => a.kind === 'workspace-file')?.path).toBe(
      'notes/summary.md'
    );

    const outputFile = path.join(runDirs.artifacts, 'nodes', 'writer-run-1.md');
    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('Wrote notes/summary.md');
  });

  it('seeds openclaw state into the per-run state dir', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Claw', runtime: 'openclaw' });
    const clawAgent = res.body.agent.id;

    const agentPaths = storage.agentPaths(userId, clawAgent);
    fs.writeFileSync(path.join(agentPaths.state, 'openclaw.json'), '{"seeded":true}');

    let seededState = '';
    setWorkflowTurnExecutorForTests(async (req) => {
      seededState = fs.existsSync(path.join(req.stateDir, 'openclaw.json'))
        ? fs.readFileSync(path.join(req.stateDir, 'openclaw.json'), 'utf8')
        : '';
      return { text: 'claw done', durationMs: 5 };
    });

    const workflow = normalizeDsl(
      {
        name: 'Claw flow',
        nodes: [
          { id: 'start', type: 'start', label: 'Task' },
          { id: 'claw', type: 'agent', label: 'Claw', kind: 'worker', agentId: clawAgent },
          { id: 'end', type: 'end', label: 'Done' },
        ],
        edges: [
          { from: 'start', to: 'claw' },
          { from: 'claw', to: 'end' },
        ],
      },
      new Set([clawAgent])
    );

    const started = await startExecution({ userId, teamId, task: 'Claw task', workflow });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('succeeded');
    expect(seededState).toBe('{"seeded":true}');
  });

  it('fails the node when the agent belongs to someone else', async () => {
    setWorkflowTurnExecutorForTests(async () => ({ text: 'never', durationMs: 1 }));

    const workflow = normalizeDsl(
      {
        name: 'Foreign agent',
        nodes: [
          { id: 'start', type: 'start', label: 'Task' },
          {
            id: 'foreign',
            type: 'agent',
            label: 'Foreign',
            kind: 'worker',
            agentId: crypto.randomUUID(),
          },
          { id: 'end', type: 'end', label: 'Done' },
        ],
        edges: [
          { from: 'start', to: 'foreign' },
          { from: 'foreign', to: 'end' },
        ],
      },
      // Pretend the client injected an id we do not own.
      new Set(['*']),
    );
    const foreignNode = workflow.nodes.find((n) => n.id === 'foreign');
    if (foreignNode?.type === 'agent') foreignNode.agentId = crypto.randomUUID();

    const started = await startExecution({ userId, teamId, task: 'Nope', workflow });
    const detail = await waitForTerminal(started.id);

    expect(detail.status).toBe('failed');
    expect(detail.error).toContain('Agent not found');
  });
});
