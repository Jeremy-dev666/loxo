import fs from 'node:fs';
import path from 'node:path';
import { getAgent } from '../agents/agents.service';
import type { CliRuntime } from '../agents/runtime-detect';
import { getProviderCredentials } from '../providers/providers.service';
import { runTurn, type TurnRequest, type TurnResult } from '../runner/runner';
import { buildWorkflowNodePrompt } from '../runner/turn-context';
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

async function runAgentNode(request: AgentNodeRequest): Promise<AgentNodeResult> {
  const agent = await getAgent(request.userId, request.node.agentId!);
  if (agent.runtime === 'api') {
    throw new Error('API-hosted agents cannot run workflow nodes yet');
  }

  const credentials = agent.providerId
    ? await getProviderCredentials(request.userId, agent.providerId)
    : null;
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
    workspace: request.paths.workspace,
    artifactsDir: request.paths.artifacts,
  });

  const before = snapshotWorkspace(request.paths.workspace);
  const result = await turnExecutor({
    runtime: agent.runtime as CliRuntime,
    workspace: request.paths.workspace,
    stateDir,
    prompt,
    model: agent.model,
    credentials: credentials ?? undefined,
    sessionRef: null,
    timeoutMs: request.timeoutSec * 1000,
    signal: request.signal,
  });
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
