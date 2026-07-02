import { execFileSync, spawn } from 'node:child_process';

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
