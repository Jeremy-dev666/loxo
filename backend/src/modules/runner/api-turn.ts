import { RunnerError, redactDiagnostic, type TurnResult } from './runner';

export type ApiProtocol = 'openai' | 'anthropic';

export interface ApiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ApiTurnRequest {
  protocol: ApiProtocol;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
  system?: string;
  messages: ApiChatMessage[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 4096;

const VENDOR_DEFAULT_MODELS: Record<ApiProtocol, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o-mini',
};

/** Vendor a model id unambiguously belongs to; null when unrecognized. */
export function impliedVendor(model: string): ApiProtocol | null {
  const id = model.toLowerCase();
  if (id.startsWith('claude')) return 'anthropic';
  if (id.startsWith('gpt') || id.startsWith('chatgpt') || /^o\d/.test(id)) return 'openai';
  return null;
}

/**
 * Model for an API turn. Catalog presets pin a model for one vendor; when the
 * bound provider is the other vendor that preset would 404 there. An explicit
 * user pick fails loudly on a mismatch; a preset default adapts to the
 * provider's vendor; unrecognized ids pass through (relays accept anything).
 */
export function resolveApiModel(
  agent: { name: string; model: string | null; manifest: { api?: { model?: string } } },
  vendor: ApiProtocol
): string {
  const explicit = agent.model?.trim();
  const preset = agent.manifest.api?.model?.trim();

  // Catalog deploys copy the preset into the agent's model field; only a
  // value that diverges from the preset is a deliberate user pick.
  if (explicit && explicit !== preset) {
    const implied = impliedVendor(explicit);
    if (implied && implied !== vendor) {
      throw new RunnerError(
        `Model "${explicit}" is ${implied === 'anthropic' ? 'an Anthropic' : 'an OpenAI'} model, but agent "${agent.name}" uses ${vendor === 'anthropic' ? 'an Anthropic' : 'an OpenAI'} provider. Pick a matching model or switch the provider.`,
        'api_failed'
      );
    }
    return explicit;
  }

  const candidate = preset ?? explicit;
  if (candidate) {
    const implied = impliedVendor(candidate);
    if (implied && implied !== vendor) return VENDOR_DEFAULT_MODELS[vendor];
    return candidate;
  }
  return VENDOR_DEFAULT_MODELS[vendor];
}

function apiBase(request: ApiTurnRequest): string {
  const fallback = request.protocol === 'openai' ? OPENAI_DEFAULT_BASE : ANTHROPIC_DEFAULT_BASE;
  return (request.baseUrl?.trim() || fallback).replace(/\/+$/, '');
}

/**
 * Drops empty messages and merges consecutive same-role ones; the Anthropic
 * Messages API requires strictly alternating roles starting with `user`.
 */
export function normalizeApiMessages(messages: ApiChatMessage[]): ApiChatMessage[] {
  const merged: ApiChatMessage[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      merged.push({ role: message.role, content });
    }
  }
  while (merged.length > 0 && merged[0]!.role === 'assistant') merged.shift();
  return merged;
}

interface SseEvent {
  event: string;
  data: string;
}

/** Incremental SSE parse over a fetch body; yields one event per data line. */
async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          yield { event: currentEvent, data: line.slice('data:'.length).trim() };
        } else if (line === '') {
          currentEvent = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Chat Completions stream chunk -> text delta ('' when none). */
export function extractOpenAiDelta(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

/** Messages stream event -> text delta ('' when none). */
export function extractAnthropicDelta(payload: unknown): string {
  const event = payload as { type?: string; delta?: { type?: string; text?: unknown } };
  if (event?.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') return '';
  return typeof event.delta.text === 'string' ? event.delta.text : '';
}

function extractErrorMessage(payload: unknown): string {
  const record = payload as { error?: { message?: unknown }; message?: unknown };
  if (typeof record?.error?.message === 'string') return record.error.message;
  if (typeof record?.message === 'string') return record.message;
  return '';
}

function buildRequest(request: ApiTurnRequest): { url: string; init: RequestInit } {
  const messages = normalizeApiMessages(request.messages);
  if (messages.length === 0) {
    throw new RunnerError('API turn has no user messages', 'bad_output');
  }

  if (request.protocol === 'openai') {
    return {
      url: `${apiBase(request)}/chat/completions`,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages: [
            ...(request.system ? [{ role: 'system', content: request.system }] : []),
            ...messages,
          ],
        }),
      },
    };
  }

  return {
    url: `${apiBase(request)}/v1/messages`,
    init: {
      method: 'POST',
      headers: {
        'x-api-key': request.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(request.system ? { system: request.system } : {}),
        messages,
      }),
    },
  };
}

/**
 * One streamed turn against a hosted model API. Text deltas go to `onChunk`
 * as they arrive; the joined text is returned. Failures surface as
 * RunnerError so callers treat API and CLI agents uniformly.
 */
export async function runApiTurn(request: ApiTurnRequest): Promise<TurnResult> {
  const started = Date.now();
  const { url, init } = buildRequest(request);

  const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    if (timeout.aborted) throw new RunnerError('API request timed out', 'timeout');
    if (request.signal?.aborted) throw new RunnerError('API turn aborted', 'aborted');
    throw new RunnerError(
      redactDiagnostic(error instanceof Error ? error.message : 'API request failed'),
      'api_failed'
    );
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let detail = raw;
    try {
      detail = extractErrorMessage(JSON.parse(raw)) || raw;
    } catch {
      // Keep raw body.
    }
    throw new RunnerError(
      redactDiagnostic(detail) || `API request failed with status ${response.status}`,
      'api_failed'
    );
  }
  if (!response.body) {
    throw new RunnerError('API response has no body', 'api_failed');
  }

  const chunks: string[] = [];
  try {
    for await (const event of readSseEvents(response.body)) {
      if (!event.data || event.data === '[DONE]') continue;

      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }

      if (event.event === 'error' || (payload as { type?: string })?.type === 'error') {
        throw new RunnerError(
          redactDiagnostic(extractErrorMessage(payload)) || 'API stream reported an error',
          'api_failed'
        );
      }

      const delta =
        request.protocol === 'openai'
          ? extractOpenAiDelta(payload)
          : extractAnthropicDelta(payload);
      if (delta) {
        chunks.push(delta);
        request.onChunk?.(delta);
      }
    }
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    if (timeout.aborted) throw new RunnerError('API request timed out', 'timeout');
    if (request.signal?.aborted) throw new RunnerError('API turn aborted', 'aborted');
    throw new RunnerError(
      redactDiagnostic(error instanceof Error ? error.message : 'API stream failed'),
      'api_failed'
    );
  }

  const text = chunks.join('');
  if (!text.trim()) {
    throw new RunnerError('API returned no text content', 'bad_output');
  }
  return { text, durationMs: Date.now() - started };
}

type ApiTurnExecutor = (request: ApiTurnRequest) => Promise<TurnResult>;
let apiTurnExecutor: ApiTurnExecutor = runApiTurn;

/** Test seam: swap the API executor without real network calls. */
export function setApiTurnExecutorForTests(executor: ApiTurnExecutor | null): void {
  apiTurnExecutor = executor ?? runApiTurn;
}

export function executeApiTurn(request: ApiTurnRequest): Promise<TurnResult> {
  return apiTurnExecutor(request);
}
