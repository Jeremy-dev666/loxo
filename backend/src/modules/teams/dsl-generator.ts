import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { agents } from '../../db/schema';
import { generateJson } from '../llm/json-generation';
import { normalizeDsl, type WorkflowDsl } from './workflow-dsl';

const GENERATION_TIMEOUT_MS = 60_000;

export interface GenerateResult {
  workflow: WorkflowDsl;
  generator: 'anthropic' | 'openai' | 'fallback';
  warnings: string[];
}

interface AgentSummary {
  id: string;
  name: string;
  description: string;
  runtime: string;
}

const SYSTEM_PROMPT = [
  'You convert a natural-language description of a multi-agent workflow into strict JSON.',
  'Output only a JSON object, no markdown fences, shaped as:',
  '{"name": string, "description": string, "nodes": [...], "edges": [...]}',
  'Node types: "start", "agent", "condition", "end". Exactly one start; at least one end.',
  'Agent nodes: {"id", "type": "agent", "label", "kind", "role", "agentId"?}.',
  'kind is one of: worker, orchestrator, router, aggregator, judge, evaluator, optimizer.',
  'Set agentId only when it exactly matches an id from the provided agent list.',
  'Condition nodes: {"id", "type": "condition", "label", "expression"} with outgoing edges branch "yes"/"no".',
  'Edges: {"from", "to", "branch"?}. Use short kebab-case ids.',
  'Prefer simple linear or parallel flows; add a condition gate only when the request implies review/retry.',
].join('\n');

/** Deterministic draft when no provider is configured or the model call fails. */
export function fallbackDraft(prompt: string, available: AgentSummary[]): unknown {
  const lower = prompt.toLowerCase();
  const matched = available
    .filter((a) => {
      const haystack = `${a.name} ${a.description}`.toLowerCase();
      return lower.split(/[^a-z0-9一-鿿]+/).some((word) => word.length >= 3 && haystack.includes(word));
    })
    .slice(0, 4);

  const workers = matched.length > 0 ? matched : available.slice(0, 2);
  const agentNodes = (workers.length > 0 ? workers : [null, null]).map((agent, i) => ({
    id: `agent-${i + 1}`,
    type: 'agent',
    label: agent?.name ?? `Agent ${i + 1}`,
    kind: 'worker',
    agentId: agent?.id,
  }));

  return {
    name: 'Generated workflow',
    description: prompt,
    nodes: [{ id: 'start', type: 'start', label: 'Task input' }, ...agentNodes, { id: 'end', type: 'end', label: 'Final output' }],
    edges: [
      { from: 'start', to: 'agent-1' },
      ...agentNodes.slice(1).map((n, i) => ({ from: `agent-${i + 1}`, to: n.id })),
      { from: agentNodes[agentNodes.length - 1]!.id, to: 'end' },
    ],
  };
}

export async function generateWorkflow(userId: string, prompt: string): Promise<GenerateResult> {
  const rows = await db
    .select({ id: agents.id, name: agents.name, description: agents.description, runtime: agents.runtime })
    .from(agents)
    .where(eq(agents.userId, userId));
  const knownIds = new Set(rows.map((r) => r.id));
  const warnings: string[] = [];

  const userPrompt = [
    'Available agents:',
    JSON.stringify(rows, null, 2),
    '',
    'Workflow request:',
    prompt,
  ].join('\n');

  const generation = await generateJson(
    userId,
    { system: SYSTEM_PROMPT, user: userPrompt },
    { timeoutMs: GENERATION_TIMEOUT_MS }
  );

  if (generation.status === 'ok') {
    try {
      const workflow = normalizeDsl(generation.json, knownIds);
      workflow.metadata = { source: 'generated' };
      return { workflow, generator: generation.vendor, warnings };
    } catch (error) {
      warnings.push(
        `Model generation via ${generation.vendor} failed (${(error as Error).message}); used the deterministic fallback`
      );
    }
  } else if (generation.status === 'failed') {
    warnings.push(
      `Model generation via ${generation.vendor} failed (${generation.message}); used the deterministic fallback`
    );
  } else {
    warnings.push('No anthropic/openai provider configured; used the deterministic fallback');
  }

  const workflow = normalizeDsl(fallbackDraft(prompt, rows), knownIds);
  workflow.metadata = { source: 'fallback' };
  return { workflow, generator: 'fallback', warnings };
}
