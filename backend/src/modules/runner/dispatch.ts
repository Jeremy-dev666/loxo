import { RunnerError, runTurn, type TurnRequest, type TurnResult } from '@swarmdev/shared';
import type { Agent } from '../../db/schema';
import { runMachineTurn } from '../machines/machine-turns';

export type AgentTurnRouting = Pick<Agent, 'execution' | 'machineId' | 'machineWorkdir'>;

const MACHINE_TURN_TIMEOUT_MS = 300_000;

/**
 * Routes a CLI turn to the agent's bound machine daemon or the local runner.
 * Machine turns ignore server-side workspace/state paths: execution state
 * lives on the machine, keyed by the daemon's own layout.
 */
export async function dispatchAgentTurn(
  agent: AgentTurnRouting,
  request: TurnRequest,
  localExecutor: (request: TurnRequest) => Promise<TurnResult> = runTurn
): Promise<TurnResult> {
  if (agent.execution !== 'machine') {
    return localExecutor(request);
  }
  if (!agent.machineId) {
    throw new RunnerError('Agent uses machine execution but no machine is bound', 'cli_failed');
  }
  return runMachineTurn(
    agent.machineId,
    {
      runtime: request.runtime,
      prompt: request.prompt,
      model: request.model,
      sessionRef: request.sessionRef,
      workdir: agent.machineWorkdir,
      timeoutMs: request.timeoutMs ?? MACHINE_TURN_TIMEOUT_MS,
      credentials: request.credentials
        ? { apiKey: request.credentials.apiKey, baseUrl: request.credentials.baseUrl }
        : undefined,
    },
    { signal: request.signal, onChunk: request.onChunk }
  );
}
