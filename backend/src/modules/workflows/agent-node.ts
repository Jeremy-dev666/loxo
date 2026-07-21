import fs from 'node:fs';
import path from 'node:path';
import { getAgent } from '../agents/agents.service';
import type { CliRuntime } from '../agents/runtime-detect';
import { getProviderCredentials } from '../providers/providers.service';
import { runTurn, RunnerError, type TurnRequest, type TurnResult } from '../runner/runner';
import { dispatchAgentTurn } from '../runner/dispatch';
import { executeApiTurn, resolveApiModel, type ApiProtocol } from '../runner/api-turn';
import { buildWorkflowNodePrompt } from '../runner/turn-context';
import type { Agent } from '../../db/schema';
import { storage } from '../../storage/layout';
import { diffWorkspaceSnapshots, snapshotWorkspace } from './artifacts';
import {
  registerAgentNodeRunner,
  type AgentNodeRequest,
  type AgentNodeResult,
} from './executor';

type TurnExecutor = (request: TurnRequest) => Promise<TurnResult>;
let turnExecutor: TurnExecutor = runTurn;

/** Test seam: swap the CLI executor without spawning real processes. */
export function setWorkflowTurnExecutorForTests(executor: TurnExecutor | null): void {
  turnExecutor = executor ?? runTurn;
}

/** openclaw state files carried into the per-run state dir. */
const OPENCLAW_STATE_FILES = [
  'openclaw.json',
  path.join('agents', 'main', 'agent', 'auth-profiles.json'),
];

/**
 * Each execution gets an isolated state dir per agent so workflow runs never
 * pollute chat sessions. openclaw needs its config and auth profile seeded or
 * the CLI treats the run as a fresh unauthenticated install.
 */
function prepareStateDir(
  request: AgentNodeRequest,
  agentId: string,
  runtime: string
): string {
  const stateDir = path.join(request.paths.runRoot, 'agent-state', agentId);
  fs.mkdirSync(stateDir, { recursive: true });
  if (runtime !== 'openclaw') return stateDir;

  const agentPaths = storage.agentPaths(request.userId, agentId);
  const sources = [agentPaths.state, path.join(agentPaths.workspace, '.openclaw')];
  for (const source of new Set(sources)) {
    if (!fs.existsSync(source) || path.resolve(source) === path.resolve(stateDir)) continue;
    for (const file of OPENCLAW_STATE_FILES) {
      const from = path.join(source, file);
      if (!fs.existsSync(from)) continue;
      const to = path.join(stateDir, file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  return stateDir;
}

/**
 * API-hosted agents cannot touch the run workspace; they contribute text
 * output only, which the executor hands to downstream nodes.
 */
async function runApiNode(
  request: AgentNodeRequest,
  agent: Agent,
  credentials: { vendor: string; apiKey: string; baseUrl: string | null } | null
): Promise<AgentNodeResult> {
  if (!credentials) {
    throw new RunnerError(
      `Agent "${agent.name}" needs an OpenAI or Anthropic provider configured`,
      'api_failed'
    );
  }
  const model = resolveApiModel(agent, credentials.vendor as ApiProtocol);

  const task = [
    `You are acting as node "${request.node.label ?? request.node.id}" in the workflow "${request.workflowName}".`,
    request.node.role ? `Role: ${request.node.role}` : null,
    `Task: ${request.task}`,
    request.memos.length > 0
      ? `Team memory from previous runs (lessons, not orders):\n${request.memos.map((m) => `- ${m}`).join('\n')}`
      : null,
    request.input ? `Input from previous steps:\n${request.input}` : null,
    'Respond with your complete contribution as plain text; downstream steps receive exactly what you write.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await executeApiTurn({
    protocol: credentials.vendor as ApiProtocol,
    apiKey: credentials.apiKey,
    baseUrl: credentials.baseUrl,
    model,
    system: agent.manifest.api?.systemPrompt ?? `You are ${agent.name}. ${agent.description}`.trim(),
    messages: [{ role: 'user', content: task }],
    timeoutMs: request.timeoutSec * 1000,
    signal: request.signal,
  });

  return { output: result.text, artifacts: [] };
}

async function runAgentNode(request: AgentNodeRequest): Promise<AgentNodeResult> {
  const agent = await getAgent(request.userId, request.node.agentId!);

  const credentials = agent.providerId
    ? await getProviderCredentials(request.userId, agent.providerId)
    : null;

  if (agent.runtime === 'api') {
    return runApiNode(request, agent, credentials);
  }
  const stateDir = prepareStateDir(request, agent.id, agent.runtime);

  const prompt = buildWorkflowNodePrompt({
    agent,
    workflowName: request.workflowName,
    executionId: request.executionId,
    nodeId: request.node.id,
    nodeLabel: request.node.label,
    kind: request.node.kind,
    role: request.node.role,
    task: request.task,
    input: request.input,
    memos: request.memos,
    workspace: request.paths.workspace,
    artifactsDir: request.paths.artifacts,
  });

  const before = snapshotWorkspace(request.paths.workspace);
  const result = await dispatchAgentTurn(
    agent,
    {
      runtime: agent.runtime as CliRuntime,
      workspace: request.paths.workspace,
      stateDir,
      prompt,
      model: agent.model,
      credentials: credentials ?? undefined,
      sessionRef: null,
      timeoutMs: request.timeoutSec * 1000,
      signal: request.signal,
      permission: agent.permissionLevel,
    },
    turnExecutor
  );
  const after = snapshotWorkspace(request.paths.workspace);

  return {
    output: result.text,
    artifacts: diffWorkspaceSnapshots(
      request.paths.workspace,
      before,
      after,
      request.node.id,
      request.runCount
    ),
  };
}

registerAgentNodeRunner(runAgentNode);
