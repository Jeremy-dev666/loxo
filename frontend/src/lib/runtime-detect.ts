/**
 * Client-side runtime detection mirroring the backend's marker scoring, so
 * the upload wizard can preselect a runtime before the files ever leave the
 * browser. The backend detection remains authoritative at import time.
 */
export const CLI_RUNTIMES = ['claude-code', 'codex', 'opencode', 'hermes', 'openclaw'] as const;
export type CliRuntime = (typeof CLI_RUNTIMES)[number];

export const RUNTIME_LABELS: Record<CliRuntime | 'api', string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  api: 'API',
};

const MARKERS: Record<CliRuntime, RegExp[]> = {
  'claude-code': [/^\.claude\//i, /(^|\/)CLAUDE\.md$/i],
  codex: [/^\.codex\//i, /(^|\/)codex\.toml$/i],
  opencode: [/^\.opencode\//i, /(^|\/)opencode\.json$/i],
  hermes: [/^\.hermes\//i, /(^|\/)hermes\.(ya?ml|json)$/i],
  openclaw: [/^\.openclaw\//i, /(^|\/)agent\.manifest\.json$/i, /(^|\/)SOUL\.md$/i],
};

export interface DetectionResult {
  detected: CliRuntime | null;
  confidence: 'high' | 'low' | 'none';
  scores: Record<CliRuntime, number>;
}

/** Strips the shared root folder so `.claude/` markers match top-level dirs. */
function normalizePaths(paths: string[]): string[] {
  const roots = new Set(paths.map((p) => p.split('/')[0]));
  if (roots.size === 1 && paths.every((p) => p.includes('/'))) {
    return paths.map((p) => p.slice(p.indexOf('/') + 1));
  }
  return paths;
}

export function detectRuntimeFromPaths(rawPaths: string[]): DetectionResult {
  const paths = normalizePaths(rawPaths.map((p) => p.replace(/\\/g, '/')));
  const scores = Object.fromEntries(CLI_RUNTIMES.map((r) => [r, 0])) as Record<CliRuntime, number>;
  for (const path of paths) {
    for (const runtime of CLI_RUNTIMES) {
      if (MARKERS[runtime].some((marker) => marker.test(path))) scores[runtime] += 1;
    }
  }

  const ranked = CLI_RUNTIMES.map((r) => [r, scores[r]] as const).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] === 0) return { detected: null, confidence: 'none', scores };
  if (second && second[1] === top[1]) return { detected: top[0], confidence: 'low', scores };
  return { detected: top[0], confidence: top[1] >= 2 ? 'high' : 'low', scores };
}

export interface SensitiveFileHit {
  path: string;
  reason: string;
}

const SENSITIVE_PATH_RULES: Array<{ reason: string; match: RegExp }> = [
  { reason: 'environment file', match: /(^|\/)\.env($|[./])/i },
  { reason: 'private key file', match: /(^|\/)(id_rsa|id_ed25519|id_ecdsa|.*\.(pem|key|p12|pfx))$/i },
  {
    reason: 'credential file',
    match: /(^|\/)(secrets?|credentials?|tokens?|api[_-]?keys?)\.(json|ya?ml|toml|ini|env|txt)$/i,
  },
  { reason: 'runtime auth profile', match: /(^|\/)auth-profiles\.json$/i },
  { reason: 'local runtime settings', match: /(^|\/)\.claude\/settings\.local\.json$/i },
];

/** Path-based preview only; the backend performs the authoritative scan on publish. */
export function scanSensitivePaths(paths: string[]): SensitiveFileHit[] {
  const hits: SensitiveFileHit[] = [];
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/');
    for (const rule of SENSITIVE_PATH_RULES) {
      if (rule.match.test(path)) {
        hits.push({ path, reason: rule.reason });
        break;
      }
    }
  }
  return hits;
}
