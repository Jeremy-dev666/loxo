import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractAnthropicDelta,
  extractOpenAiDelta,
  normalizeApiMessages,
  runApiTurn,
  type ApiTurnRequest,
} from '../src/modules/runner/api-turn';
import { RunnerError } from '../src/modules/runner/runner';

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function baseRequest(protocol: 'openai' | 'anthropic'): ApiTurnRequest {
  return {
    protocol,
    apiKey: 'test-key',
    model: 'test-model',
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hello' }],
  };
}

describe('normalizeApiMessages', () => {
  it('merges consecutive same-role messages and drops empties', () => {
    const result = normalizeApiMessages([
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: '  ' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'three' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'one\n\ntwo' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'three' },
    ]);
  });

  it('drops leading assistant messages so the sequence starts with user', () => {
    const result = normalizeApiMessages([
      { role: 'assistant', content: 'old greeting' },
      { role: 'user', content: 'question' },
    ]);
    expect(result[0]).toEqual({ role: 'user', content: 'question' });
  });
});

describe('delta extraction', () => {
  it('reads OpenAI chat completion chunks', () => {
    expect(extractOpenAiDelta({ choices: [{ delta: { content: 'Hi' } }] })).toBe('Hi');
    expect(extractOpenAiDelta({ choices: [{ delta: {} }] })).toBe('');
    expect(extractOpenAiDelta({})).toBe('');
  });

  it('reads Anthropic content_block_delta events only', () => {
    expect(
      extractAnthropicDelta({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } })
    ).toBe('Hi');
    expect(extractAnthropicDelta({ type: 'message_start' })).toBe('');
    expect(
      extractAnthropicDelta({ type: 'content_block_delta', delta: { type: 'input_json_delta' } })
    ).toBe('');
  });
});

describe('runApiTurn: OpenAI protocol', () => {
  it('streams deltas and joins the final text', async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"lo!"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const fetchMock = vi.fn(async () => sseResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    const chunks: string[] = [];
    const result = await runApiTurn({ ...baseRequest('openai'), onChunk: (t) => chunks.push(t) });

    expect(result.text).toBe('Hello!');
    expect(chunks).toEqual(['Hel', 'lo!']);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const payload = JSON.parse(init.body as string);
    expect(payload.stream).toBe(true);
    expect(payload.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('honors a custom base URL', async () => {
    const fetchMock = vi.fn(async () => sseResponse('data: {"choices":[{"delta":{"content":"x"}}]}\n'));
    vi.stubGlobal('fetch', fetchMock);

    await runApiTurn({ ...baseRequest('openai'), baseUrl: 'https://proxy.example.com/v1/' });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://proxy.example.com/v1/chat/completions'
    );
  });

  it('surfaces API error responses as RunnerError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }))
    );

    await expect(runApiTurn(baseRequest('openai'))).rejects.toMatchObject({
      name: 'RunnerError',
      kind: 'api_failed',
      message: expect.stringContaining('Invalid API key'),
    });
  });
});

describe('runApiTurn: Anthropic protocol', () => {
  it('streams text deltas and sends protocol headers', async () => {
    const body = [
      'event: message_start',
      'data: {"type":"message_start"}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const fetchMock = vi.fn(async () => sseResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runApiTurn(baseRequest('anthropic'));
    expect(result.text).toBe('Hi there');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBeTruthy();
    const payload = JSON.parse(init.body as string);
    expect(payload.system).toBe('You are helpful.');
    expect(payload.max_tokens).toBeGreaterThan(0);
  });

  it('raises on mid-stream error events', async () => {
    const body = [
      'event: error',
      'data: {"type":"error","error":{"message":"Overloaded"}}',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(body)));

    await expect(runApiTurn(baseRequest('anthropic'))).rejects.toMatchObject({
      kind: 'api_failed',
      message: expect.stringContaining('Overloaded'),
    });
  });

  it('rejects empty streams as bad output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse('data: {"type":"message_stop"}\n')));
    await expect(runApiTurn(baseRequest('anthropic'))).rejects.toMatchObject({ kind: 'bad_output' });
  });
});

describe('runApiTurn: aborts', () => {
  it('maps caller aborts to RunnerError aborted', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        controller.abort();
        return Promise.reject(
          Object.assign(new Error('This operation was aborted'), { name: 'AbortError', signal: init.signal })
        );
      })
    );

    await expect(
      runApiTurn({ ...baseRequest('openai'), signal: controller.signal })
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('requires at least one non-empty message', async () => {
    await expect(
      runApiTurn({ ...baseRequest('openai'), messages: [{ role: 'user', content: '  ' }] })
    ).rejects.toBeInstanceOf(RunnerError);
  });
});
