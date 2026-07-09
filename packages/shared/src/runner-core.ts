import { execFileSync, spawn } from 'node:child_process';
import type { MachineRuntime } from './machine-protocol';

/** CLI runtimes execute turns as one-shot processes; identical set on server and daemon. */
export type CliRuntime = MachineRuntime;

export interface ExecRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Invoked per stdout line when set; used for streaming output formats. */
  onStdoutLine?: (line: string) => void;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

function killTree(pid: number | undefined, fallback: () => void): void {
  if (process.platform === 'win32' && pid) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // fall through
    }
  }
  fallback();
}

/**
 * Runs a CLI process to completion. Prompts are passed via stdin, never argv:
 * argv is size-limited on Windows and quoting large multiline text through
 * cmd.exe is not reliable.
 */
export function execProcess(request: ExecRequest): Promise<ExecResult> {
  // cmd.exe /c resolves npm's .cmd shims; POSIX spawns the binary directly.
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', request.command, ...request.args]]
      : [request.command, request.args];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const child = spawn(command, args, {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => child.kill('SIGKILL'));
    }, request.timeoutMs);

    const onAbort = () => {
      aborted = true;
      killTree(child.pid, () => child.kill('SIGKILL'));
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (request.onStdoutLine) {
        lineBuffer += text;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) request.onStdoutLine(line);
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      if (request.onStdoutLine && lineBuffer.trim()) {
        request.onStdoutLine(lineBuffer);
      }
      resolve({ code, stdout, stderr, timedOut, aborted });
    });

    if (request.stdin !== undefined) {
      child.stdin.write(request.stdin);
    }
    child.stdin.end();
  });
}

export interface TurnCredentials {
  apiKey?: string;
  baseUrl?: string | null;
}

export interface TurnRequest {
  runtime: CliRuntime;
  workspace: string;
  stateDir: string;
  prompt: string;
  model?: string | null;
  credentials?: TurnCredentials;
  /** CLI-side session to resume (claude-code); absent for the first turn. */
  sessionRef?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  /** Extra env for the CLI process; adapter credential vars win on conflict. */
  extraEnv?: Record<string, string>;
}

export interface TurnResult {
  text: string;
  sessionRef?: string;
  durationMs: number;
}

export type RunnerErrorKind = 'timeout' | 'aborted' | 'cli_failed' | 'api_failed' | 'bad_output';

export class RunnerError extends Error {
  constructor(
    message: string,
    public readonly kind: RunnerErrorKind
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

const DEFAULT_TIMEOUT_MS = 300_000;

/** Strips ANSI codes and anything resembling a credential from CLI output. */
export function redactDiagnostic(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

// claude-code stream-json: newline-delimited JSON events. With
// --include-partial-messages, stream_event lines carry token-level text
// deltas; assistant events repeat the complete message afterwards and the
// final result event carries session_id.
export interface ClaudeStreamState {
  chunks: string[];
  sessionRef?: string;
  resultText?: string;
  isError?: boolean;
  /** Token deltas seen; suppresses the duplicate full-message assistant event. */
  sawDelta?: boolean;
}

export function parseClaudeStreamLine(line: string, state: ClaudeStreamState): string | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event.type === 'stream_event') {
    const inner = event.event as
      | { type?: string; delta?: { type?: string; text?: string } }
      | undefined;
    if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
      state.sawDelta = true;
      state.chunks.push(inner.delta.text);
      return inner.delta.text;
    }
  } else if (event.type === 'assistant') {
    // Already streamed token-by-token; emitting again would duplicate text.
    if (state.sawDelta) return null;
    const message = event.message as { content?: Array<{ type: string; text?: string }> };
    const text = (message?.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('');
    if (text) {
      state.chunks.push(text);
      return text;
    }
  } else if (event.type === 'result') {
    if (typeof event.session_id === 'string') state.sessionRef = event.session_id;
    if (typeof event.result === 'string') state.resultText = event.result;
    if (event.is_error === true) state.isError = true;
  }
  return null;
}

function finishClaude(result: ExecResult, state: ClaudeStreamState): TurnResult | RunnerError {
  if (state.isError) {
    return new RunnerError(
      redactDiagnostic(state.resultText ?? result.stderr) || 'claude-code reported an error',
      'cli_failed'
    );
  }
  const text = state.resultText ?? state.chunks.join('');
  if (!text.trim()) {
    return new RunnerError('claude-code produced no output', 'bad_output');
  }
  return { text, sessionRef: state.sessionRef, durationMs: 0 };
}

/** Extracts a text reply from CLIs that print either plain text or a JSON blob. */
export function extractPlainReply(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ['result', 'text', 'content', 'message', 'response', 'output']) {
      if (typeof parsed[key] === 'string' && (parsed[key] as string).trim()) {
        return (parsed[key] as string).trim();
      }
    }
  } catch {
    // plain text output
  }
  return trimmed;
}

function plainParse(label: string) {
  return (result: ExecResult): TurnResult | RunnerError => {
    const text = extractPlainReply(result.stdout);
    if (!text) {
      return new RunnerError(
        redactDiagnostic(result.stderr) || `${label} produced no output`,
        'bad_output'
      );
    }
    return { text, durationMs: 0 };
  };
}

function anthropicEnv(request: TurnRequest): Record<string, string> {
  const env: Record<string, string> = {};
  if (request.credentials?.apiKey) env.ANTHROPIC_API_KEY = request.credentials.apiKey;
  if (request.credentials?.baseUrl) env.ANTHROPIC_BASE_URL = request.credentials.baseUrl;
  return env;
}

function openaiEnv(request: TurnRequest): Record<string, string> {
  const env: Record<string, string> = {};
  if (request.credentials?.apiKey) env.OPENAI_API_KEY = request.credentials.apiKey;
  if (request.credentials?.baseUrl) env.OPENAI_BASE_URL = request.credentials.baseUrl;
  return env;
}

interface RuntimeAdapter {
  command: string;
  buildArgs: (request: TurnRequest) => string[];
  buildEnv: (request: TurnRequest) => Record<string, string>;
  /** Prompt delivery: all adapters use stdin (see execProcess rationale). */
  parse: (result: ExecResult, request: TurnRequest) => TurnResult | RunnerError;
  streaming?: boolean;
}

export const ADAPTERS: Record<CliRuntime, RuntimeAdapter> = {
  'claude-code': {
    command: 'claude',
    streaming: true,
    buildArgs: (request) => {
      // Non-interactive runs cannot answer permission prompts; without
      // acceptEdits every file write is auto-denied and agents cannot
      // produce workspace output. Command execution stays gated.
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
      ];
      if (request.sessionRef) args.push('--resume', request.sessionRef);
      if (request.model) args.push('--model', request.model);
      return args;
    },
    buildEnv: anthropicEnv,
    parse: () => {
      throw new Error('claude-code uses stream parsing');
    },
  },
  codex: {
    command: 'codex',
    buildArgs: (request) => {
      const args = ['exec', '--skip-git-repo-check'];
      if (request.model) args.push('--model', request.model);
      args.push('-'); // read prompt from stdin
      return args;
    },
    buildEnv: openaiEnv,
    parse: plainParse('codex'),
  },
  opencode: {
    command: 'opencode',
    buildArgs: (request) => {
      const args = ['run'];
      if (request.model) args.push('--model', request.model);
      return args;
    },
    buildEnv: openaiEnv,
    parse: plainParse('opencode'),
  },
  hermes: {
    command: 'hermes',
    buildArgs: () => ['-z'],
    buildEnv: (request) => {
      const env: Record<string, string> = {};
      if (request.credentials?.apiKey) env.HERMES_API_KEY = request.credentials.apiKey;
      return env;
    },
    parse: plainParse('hermes'),
  },
  openclaw: {
    command: 'openclaw',
    buildArgs: (request) => {
      const args = ['agent', '--local', '--json'];
      if (request.sessionRef) args.push('--session-id', request.sessionRef);
      return args;
    },
    buildEnv: (request) => {
      const env: Record<string, string> = {};
      if (request.credentials?.apiKey) {
        env.OPENCLAW_API_KEY = request.credentials.apiKey;
        env.OPENAI_API_KEY = request.credentials.apiKey;
      }
      if (request.credentials?.baseUrl) env.OPENCLAW_BASE_URL = request.credentials.baseUrl;
      return env;
    },
    parse: plainParse('openclaw'),
  },
};

/** Executes one agent turn on a CLI runtime and returns the reply text. */
export async function runTurn(request: TurnRequest): Promise<TurnResult> {
  const adapter = ADAPTERS[request.runtime];
  const startedAt = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const state: ClaudeStreamState = { chunks: [] };
  const onStdoutLine =
    adapter.streaming && request.runtime === 'claude-code'
      ? (line: string) => {
          const chunk = parseClaudeStreamLine(line, state);
          if (chunk) request.onChunk?.(chunk);
        }
      : undefined;

  let result: ExecResult;
  try {
    result = await execProcess({
      command: adapter.command,
      args: adapter.buildArgs(request),
      cwd: request.workspace,
      env: {
        ...request.extraEnv,
        ...adapter.buildEnv(request),
        // Keep runtime state out of the workspace (layout invariant).
        XDG_STATE_HOME: request.stateDir,
      },
      stdin: request.prompt,
      timeoutMs,
      signal: request.signal,
      onStdoutLine,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new RunnerError(`${adapter.command} is not installed or not on PATH`, 'cli_failed');
    }
    throw new RunnerError(redactDiagnostic(err.message ?? 'spawn failed'), 'cli_failed');
  }

  if (result.aborted) throw new RunnerError('Turn was cancelled', 'aborted');
  if (result.timedOut) {
    throw new RunnerError(`Turn timed out after ${Math.round(timeoutMs / 1000)}s`, 'timeout');
  }
  if (result.code !== 0) {
    throw new RunnerError(
      redactDiagnostic(result.stderr || result.stdout) ||
        `${adapter.command} exited with code ${result.code}`,
      'cli_failed'
    );
  }

  const parsed =
    request.runtime === 'claude-code' ? finishClaude(result, state) : adapter.parse(result, request);
  if (parsed instanceof RunnerError) throw parsed;
  return { ...parsed, durationMs: Date.now() - startedAt };
}
