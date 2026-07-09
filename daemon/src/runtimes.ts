import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MACHINE_RUNTIMES, type MachineRuntime, type RuntimeProbe } from '@swarmdev/shared';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 5_000;

const RUNTIME_COMMANDS: Record<MachineRuntime, { command: string; args: string[] }> = {
  'claude-code': { command: 'claude', args: ['--version'] },
  codex: { command: 'codex', args: ['--version'] },
  opencode: { command: 'opencode', args: ['--version'] },
  hermes: { command: 'hermes', args: ['version'] },
  openclaw: { command: 'openclaw', args: ['--version'] },
};

function redact(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function probe(runtime: MachineRuntime): Promise<RuntimeProbe> {
  const spec = RUNTIME_COMMANDS[runtime];
  try {
    const { stdout } = await execFileAsync(spec.command, spec.args, {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    return { runtime, available: true, version: redact(stdout) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    const raw = redact(err.stderr ?? err.message ?? '');
    // cmd.exe reports missing commands in the OEM codepage, which arrives as
    // replacement chars; treat undecodable stderr as command-not-found.
    const notFound =
      err.code === 'ENOENT' || /not recognized|not found/i.test(raw) || raw.includes('�');
    return {
      runtime,
      available: false,
      version: null,
      error: notFound ? `${spec.command} is not on PATH` : raw || 'version check failed',
    };
  }
}

export async function detectRuntimes(): Promise<RuntimeProbe[]> {
  return Promise.all(MACHINE_RUNTIMES.map(probe));
}
