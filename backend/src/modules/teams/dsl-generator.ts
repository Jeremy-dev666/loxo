import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { agents, providers } from '../../db/schema';
import { openSecret } from '../../crypto/secretbox';
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

async function pickGenerationProvider(
  userId: string
): Promise<{ vendor: 'anthropic' | 'openai'; apiKey: string; baseUrl: string | null; model: string } | null> {
  for (const vendor of ['anthropic', 'openai'] as const) {
    const rows = await db
      .select()
      .from(providers)
      .where(and(eq(providers.userId, userId), eq(providers.vendor, vendor)));
    const chosen = rows.find((r) => r.isDefault) ?? rows[0];
    if (chosen) {
      return {
        vendor,
        apiKey: openSecret(chosen.apiKeyEncrypted),
        baseUrl: chosen.baseUrl,
        model:
          chosen.models[0] ?? (vendor === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini'),
      };
    }
  }
  return null;
}

/** Pulls the first JSON object out of a model reply that may have prose around it. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

async function callAnthropic(
  cfg: { apiKey: string; baseUrl: string | null; model: string },
  userPrompt: string,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

async function callOpenAi(
  cfg: { apiKey: string; baseUrl: string | null; model: string },
  userPrompt: string,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? '';
}

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

  const provider = await pickGenerationProvider(userId);
  if (provider) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
    try {
      const reply =
        provider.vendor === 'anthropic'
          ? await callAnthropic(provider, userPrompt, controller.signal)
          : await callOpenAi(provider, userPrompt, controller.signal);
      const draft = extractJsonObject(reply);
      const workflow = normalizeDsl(draft, knownIds);
      workflow.metadata = { source: 'generated' };
      return { workflow, generator: provider.vendor, warnings };
    } catch (error) {
      warnings.push(
        `Model generation via ${provider.vendor} failed (${(error as Error).message}); used the deterministic fallback`
      );
    } finally {
      clearTimeout(timer);
    }
  } else {
    warnings.push('No anthropic/openai provider configured; used the deterministic fallback');
  }

  const workflow = normalizeDsl(fallbackDraft(prompt, rows), knownIds);
  workflow.metadata = { source: 'fallback' };
  return { workflow, generator: 'fallback', warnings };
}
