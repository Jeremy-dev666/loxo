import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../../db/client';
import { providers } from '../../db/schema';
import { eq } from 'drizzle-orm';

const execFileAsync = promisify(execFile);
const CLI_CHECK_TIMEOUT_MS = 5_000;

interface PlatformSpec {
  platform: string;
  label: string;
  vendor: string;
  command: string;
  versionArgs: string[];
  envFallbacks: string[];
  installHint: string;
}

const PLATFORM_SPECS: PlatformSpec[] = [
  {
    platform: 'claude-code',
    label: 'Claude Code',
    vendor: 'anthropic',
    command: 'claude',
    versionArgs: ['--version'],
    envFallbacks: ['ANTHROPIC_API_KEY'],
    installHint: 'Install the Claude Code CLI and make sure `claude` is on PATH.',
  },
  {
    platform: 'codex',
    label: 'Codex',
    vendor: 'openai',
    command: 'codex',
    versionArgs: ['--version'],
    envFallbacks: ['OPENAI_API_KEY'],
    installHint: 'Install the Codex CLI and make sure `codex` is on PATH.',
  },
  {
    platform: 'opencode',
    label: 'OpenCode',
    vendor: 'openai',
    command: 'opencode',
    versionArgs: ['--version'],
    envFallbacks: ['OPENAI_API_KEY'],
    installHint: 'Install the OpenCode CLI and make sure `opencode` is on PATH.',
  },
  {
    platform: 'hermes',
    label: 'Hermes',
    vendor: 'hermes',
    command: 'hermes',
    versionArgs: ['version'],
    envFallbacks: ['HERMES_API_KEY'],
    installHint: 'Install the Hermes CLI and make sure `hermes` is on PATH.',
  },
  {
    platform: 'openclaw',
    label: 'OpenClaw',
    vendor: 'openclaw',
    command: 'openclaw',
    versionArgs: ['--version'],
    envFallbacks: ['OPENCLAW_API_KEY', 'OPENAI_API_KEY'],
    installHint: 'Install the OpenClaw CLI and make sure `openclaw` is on PATH.',
  },
];

/** Strips values that look like credentials from CLI diagnostics. */
function redact(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

export interface PlatformHealth {
  platform: string;
  label: string;
  vendor: string;
  cli: { available: boolean; version: string; error?: string };
  credentials: { providerCount: number; envConfigured: boolean };
  ready: boolean;
  installHint: string;
}

async function checkCli(spec: PlatformSpec): Promise<PlatformHealth['cli']> {
  try {
    const { stdout } = await execFileAsync(spec.command, spec.versionArgs, {
      timeout: CLI_CHECK_TIMEOUT_MS,
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    return { available: true, version: redact(stdout) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    const detail =
      err.code === 'ENOENT'
        ? `${spec.command} is not on PATH`
        : redact(err.stderr ?? err.message ?? 'version check failed');
    return { available: false, version: '', error: detail };
  }
}

export async function getRuntimeHealth(userId: string): Promise<{
  checkedAt: string;
  platforms: PlatformHealth[];
}> {
  const rows = await db
    .select({ vendor: providers.vendor })
    .from(providers)
    .where(eq(providers.userId, userId));
  const vendorCounts = new Map<string, number>();
  for (const row of rows) {
    vendorCounts.set(row.vendor, (vendorCounts.get(row.vendor) ?? 0) + 1);
  }

  const platforms = await Promise.all(
    PLATFORM_SPECS.map(async (spec): Promise<PlatformHealth> => {
      const cli = await checkCli(spec);
      const providerCount = vendorCounts.get(spec.vendor) ?? 0;
      const envConfigured = spec.envFallbacks.some((name) => Boolean(process.env[name]?.trim()));
      return {
        platform: spec.platform,
        label: spec.label,
        vendor: spec.vendor,
        cli,
        credentials: { providerCount, envConfigured },
        ready: cli.available && (providerCount > 0 || envConfigured),
        installHint: spec.installHint,
      };
    })
  );

  return { checkedAt: new Date().toISOString(), platforms };
}
