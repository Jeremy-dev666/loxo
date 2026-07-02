export const CLI_RUNTIMES = ['claude-code', 'codex', 'opencode', 'hermes', 'openclaw'] as const;
export type CliRuntime = (typeof CLI_RUNTIMES)[number];
export type AgentRuntime = CliRuntime | 'api';

export function isAgentRuntime(value: unknown): value is AgentRuntime {
  return value === 'api' || (CLI_RUNTIMES as readonly string[]).includes(value as string);
}

/**
 * File markers each CLI runtime leaves in its workspace. These names are
 * third-party conventions of the respective tools.
 */
const MARKERS: Record<CliRuntime, RegExp[]> = {
  'claude-code': [/^\.claude\//i, /(^|\/)CLAUDE\.md$/i],
  codex: [/^\.codex\//i, /(^|\/)codex\.toml$/i],
  opencode: [/^\.opencode\//i, /(^|\/)opencode\.json$/i],
  hermes: [/^\.hermes\//i, /(^|\/)hermes\.(ya?ml|json)$/i],
  openclaw: [/^\.openclaw\//i, /(^|\/)agent\.manifest\.json$/i, /(^|\/)SOUL\.md$/i],
};

const MIN_SCORE = 1;

function normalize(paths: string[]): string[] {
  const cleaned = paths.map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''));

  // A folder upload often nests everything under one root; strip it so
  // markers like `.claude/` still match at the top level.
  const first = cleaned[0]?.split('/')[0];
  if (first && cleaned.length > 1 && cleaned.every((p) => p.startsWith(`${first}/`))) {
    return [...cleaned, ...cleaned.map((p) => p.slice(first.length + 1))];
  }
  return cleaned;
}

export function scoreRuntimes(paths: string[]): Record<CliRuntime, number> {
  const normalized = normalize(paths);
  const scores = Object.fromEntries(CLI_RUNTIMES.map((r) => [r, 0])) as Record<CliRuntime, number>;
  for (const runtime of CLI_RUNTIMES) {
    for (const pattern of MARKERS[runtime]) {
      if (normalized.some((p) => pattern.test(p))) {
        scores[runtime] += 1;
      }
    }
  }
  return scores;
}

/** Highest-scoring runtime, or null when ambiguous or unmarked. */
export function detectRuntime(paths: string[]): CliRuntime | null {
  const scores = scoreRuntimes(paths);
  const ranked = CLI_RUNTIMES.map((r) => [r, scores[r]] as const).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0]!;
  const second = ranked[1]?.[1] ?? 0;
  if (topScore >= MIN_SCORE && topScore > second) return top;
  return null;
}

/**
 * Resolution order: explicit user choice, then an exclusive `.claude`/`.codex`
 * directory (unambiguous even when other files add noise), then the manifest
 * hint, then marker scoring.
 */
export function resolveRuntime(
  explicit: string | undefined,
  paths: string[],
  manifestRuntime?: string
): AgentRuntime | null {
  if (isAgentRuntime(explicit)) return explicit;

  const normalized = normalize(paths);
  const hasClaudeDir = normalized.some((p) => /^\.claude\//i.test(p));
  const hasCodexDir = normalized.some((p) => /^\.codex\//i.test(p));
  if (hasClaudeDir !== hasCodexDir) return hasClaudeDir ? 'claude-code' : 'codex';

  if (isAgentRuntime(manifestRuntime)) return manifestRuntime;
  return detectRuntime(paths);
}
