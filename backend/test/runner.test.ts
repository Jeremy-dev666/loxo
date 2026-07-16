import { describe, expect, it } from 'vitest';
import { execProcess } from '@swarmdev/shared';
import {
  ADAPTERS,
  extractPlainReply,
  parseClaudeStreamLine,
  redactDiagnostic,
  type ClaudeStreamState,
  type TurnRequest,
} from '../src/modules/runner/runner';

describe('claude-code control-plane args', () => {
  const base: TurnRequest = {
    runtime: 'claude-code',
    workspace: 'w',
    stateDir: 's',
    prompt: 'p',
  };

  it('mounts the platform MCP server strictly and pre-approves its tools', () => {
    const args = ADAPTERS['claude-code'].buildArgs({
      ...base,
      mcp: { url: 'http://127.0.0.1:4000/mcp', token: 'srt_x_y' },
    });
    expect(args).toContain('--strict-mcp-config');

    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]!);
    expect(config.mcpServers.swarmdev.url).toBe('http://127.0.0.1:4000/mcp');
    expect(config.mcpServers.swarmdev.headers.Authorization).toBe('Bearer srt_x_y');

    // Non-interactive runs auto-deny tools that are not allowlisted; without
    // this the control plane mounts but every call is rejected.
    const allowed = args[args.indexOf('--allowedTools') + 1]!;
    for (const tool of [
      'get_issue',
      'comment_on_issue',
      'update_issue_status',
      'ask_blocker',
      'submit_result',
    ]) {
      expect(allowed).toContain(`mcp__swarmdev__${tool}`);
    }
  });

  it('adds no MCP args without a control plane', () => {
    const args = ADAPTERS['claude-code'].buildArgs(base);
    expect(args).not.toContain('--mcp-config');
    expect(args).not.toContain('--allowedTools');
  });
});

describe('parseClaudeStreamLine', () => {
  it('extracts assistant text chunks and the result session ref', () => {
    const state: ClaudeStreamState = { chunks: [] };

    const chunk = parseClaudeStreamLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use' }] },
      }),
      state
    );
    expect(chunk).toBe('Hello');

    parseClaudeStreamLine(
      JSON.stringify({ type: 'result', session_id: 'sess-1', result: 'Hello final' }),
      state
    );
    expect(state.sessionRef).toBe('sess-1');
    expect(state.resultText).toBe('Hello final');
  });

  it('flags error results and tolerates junk lines', () => {
    const state: ClaudeStreamState = { chunks: [] };
    expect(parseClaudeStreamLine('not json', state)).toBeNull();
    parseClaudeStreamLine(JSON.stringify({ type: 'result', is_error: true, result: 'boom' }), state);
    expect(state.isError).toBe(true);
  });

  it('streams token-level deltas from partial message events', () => {
    const state: ClaudeStreamState = { chunks: [] };
    const delta = (text: string) =>
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      });

    expect(parseClaudeStreamLine(delta('Hel'), state)).toBe('Hel');
    expect(parseClaudeStreamLine(delta('lo'), state)).toBe('lo');
    expect(state.chunks.join('')).toBe('Hello');

    // Thinking deltas and other stream events are not user-visible text.
    expect(
      parseClaudeStreamLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } },
        }),
        state
      )
    ).toBeNull();
  });

  it('suppresses the duplicate assistant event after token deltas', () => {
    const state: ClaudeStreamState = { chunks: [] };
    parseClaudeStreamLine(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      }),
      state
    );
    const repeated = parseClaudeStreamLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      }),
      state
    );
    expect(repeated).toBeNull();
    expect(state.chunks.join('')).toBe('Hello');
  });
});

describe('extractPlainReply', () => {
  it('passes through plain text', () => {
    expect(extractPlainReply('  hi there \n')).toBe('hi there');
  });

  it('unwraps common JSON reply shapes', () => {
    expect(extractPlainReply(JSON.stringify({ result: 'from json' }))).toBe('from json');
    expect(extractPlainReply(JSON.stringify({ text: 'alt key' }))).toBe('alt key');
  });

  it('falls back to raw output for unrecognized JSON', () => {
    const raw = JSON.stringify({ unrelated: 1 });
    expect(extractPlainReply(raw)).toBe(raw);
  });
});

describe('redactDiagnostic', () => {
  it('strips ANSI codes and API keys', () => {
    const dirty = '\x1b[31merror\x1b[0m key sk-abcdefghijklmnop123456 leaked';
    const clean = redactDiagnostic(dirty);
    expect(clean).not.toContain('sk-abcdefghijklmnop');
    expect(clean).not.toContain('\x1b');
    expect(clean).toContain('[redacted]');
  });
});

describe('execProcess', () => {
  const node = process.execPath;

  it('pipes stdin and captures stdout', async () => {
    const result = await execProcess({
      command: node,
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      cwd: process.cwd(),
      env: {},
      stdin: 'echo me',
      timeoutMs: 10_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('echo me');
  });

  it('emits stdout line events including the unterminated tail', async () => {
    const lines: string[] = [];
    await execProcess({
      command: node,
      args: ['-e', "process.stdout.write('a\\nb\\nc')"],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('kills the process on timeout', async () => {
    const result = await execProcess({
      command: node,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
  }, 15_000);

  it('kills the process on abort', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await execProcess({
      command: node,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  }, 15_000);

  it('passes custom env through', async () => {
    const result = await execProcess({
      command: node,
      args: ['-e', 'process.stdout.write(process.env.SWARM_TEST_VAR || "missing")'],
      cwd: process.cwd(),
      env: { SWARM_TEST_VAR: 'present' },
      timeoutMs: 10_000,
    });
    expect(result.stdout).toBe('present');
  });
});
