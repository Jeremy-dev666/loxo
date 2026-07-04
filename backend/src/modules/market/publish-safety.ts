import fs from 'node:fs';
import path from 'node:path';

export interface PublishRisk {
  path: string;
  reason: string;
}

export type PublishAction = 'copy' | 'redact' | 'omit';

export interface SanitizedFile {
  action: PublishAction;
  /** null when the file must be omitted from the marketplace copy. */
  content: Buffer | null;
  risks: PublishRisk[];
}

export const REDACTION_MARKER = '[REDACTED_BY_MARKETPLACE]';

/** Files larger than this (or containing NUL bytes) are treated as binary and copied as-is. */
const TEXT_SCAN_LIMIT_BYTES = 256 * 1024;

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.openclaw',
  '.chat-assets',
  '.cache',
  '.next',
  '.turbo',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__pycache__',
]);

const EXCLUDED_FILE_NAMES = new Set(['agent.config.json', '.ds_store', 'thumbs.db']);

/** Paths omitted entirely from marketplace copies, whatever their content. */
const SENSITIVE_PATH_RULES: Array<{ reason: string; match: RegExp }> = [
  { reason: 'environment file', match: /(^|\/)\.env($|[./])/i },
  { reason: 'VCS history', match: /(^|\/)\.git($|\/)/i },
  {
    reason: 'private key file',
    match: /(^|\/)(id_rsa|id_ed25519|id_ecdsa|.*\.(pem|key|p12|pfx|pkcs8))$/i,
  },
  {
    reason: 'credential file',
    match: /(^|\/)(secrets?|credentials?|tokens?|api[_-]?keys?)\.(json|ya?ml|toml|ini|env|txt)$/i,
  },
  { reason: 'runtime auth profile', match: /(^|\/)auth-profiles\.json$/i },
  { reason: 'runtime credentials', match: /(^|\/)\.codex\/(auth|credentials)\.(json|toml)$/i },
  { reason: 'local runtime settings', match: /(^|\/)\.claude\/settings\.local\.json$/i },
];

/** Secrets redacted in-place in marketplace copies; source files are never modified. */
const SECRET_CONTENT_RULES: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'private key block', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { reason: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g },
  { reason: 'OpenAI-style API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { reason: 'GitHub token', pattern: /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/g },
  { reason: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { reason: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g },
  {
    reason: 'secret-looking assignment',
    pattern:
      /\b(API[_-]?KEY|SECRET|TOKEN|PASSWORD|ACCESS[_-]?KEY)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/gi,
  },
];

const SCANNABLE_EXTENSIONS = new Set([
  '.env',
  '.json',
  '.toml',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.txt',
  '.md',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
]);

function normalizeRel(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Build/VCS noise that never belongs in a marketplace copy. */
export function isPublishExcluded(relativePath: string, isDirectory = false): boolean {
  const normalized = normalizeRel(relativePath);
  if (!normalized) return false;

  if (normalized.split('/').some((seg) => EXCLUDED_DIR_NAMES.has(seg.toLowerCase()))) {
    return true;
  }
  if (!isDirectory && EXCLUDED_FILE_NAMES.has(path.posix.basename(normalized).toLowerCase())) {
    return true;
  }
  return false;
}

export function findPathRisks(relativePath: string): PublishRisk[] {
  const normalized = normalizeRel(relativePath);
  for (const rule of SENSITIVE_PATH_RULES) {
    if (rule.match.test(normalized)) {
      return [{ path: normalized, reason: rule.reason }];
    }
  }
  return [];
}

function isScannableText(relativePath: string, content: Buffer): boolean {
  if (content.length > TEXT_SCAN_LIMIT_BYTES) return false;
  if (content.includes(0)) return false;
  const base = path.posix.basename(normalizeRel(relativePath)).toLowerCase();
  return SCANNABLE_EXTENSIONS.has(path.posix.extname(base)) || base.startsWith('.env');
}

/**
 * Decides how a file enters the marketplace copy: sensitive paths are
 * omitted, secrets in scannable text are replaced with REDACTION_MARKER,
 * everything else is copied verbatim.
 */
export function sanitizeFileForPublish(relativePath: string, content: Buffer): SanitizedFile {
  const pathRisks = findPathRisks(relativePath);
  if (pathRisks.length > 0) {
    return { action: 'omit', content: null, risks: pathRisks };
  }
  if (!isScannableText(relativePath, content)) {
    return { action: 'copy', content, risks: [] };
  }

  const normalized = normalizeRel(relativePath);
  let text = content.toString('utf8');
  const risks: PublishRisk[] = [];
  for (const { reason, pattern } of SECRET_CONTENT_RULES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      risks.push({ path: normalized, reason });
      pattern.lastIndex = 0;
      text = text.replace(pattern, REDACTION_MARKER);
    }
  }

  if (risks.length === 0) return { action: 'copy', content, risks };
  return { action: 'redact', content: Buffer.from(text, 'utf8'), risks };
}

/** Read-only scan of a directory tree; reports what publishing would omit or redact. */
export function auditPublishTree(rootDir: string): PublishRisk[] {
  const risks: PublishRisk[] = [];
  if (!fs.existsSync(rootDir)) return risks;

  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = normalizeRel(path.relative(rootDir, full));
      if (entry.isSymbolicLink() || isPublishExcluded(rel, entry.isDirectory())) continue;

      if (entry.isDirectory()) {
        const dirRisks = findPathRisks(`${rel}/`);
        if (dirRisks.length > 0) {
          risks.push(...dirRisks);
          continue;
        }
        visit(full);
        continue;
      }

      try {
        const stat = fs.statSync(full);
        const content = stat.size <= TEXT_SCAN_LIMIT_BYTES ? fs.readFileSync(full) : undefined;
        if (content) {
          risks.push(...sanitizeFileForPublish(rel, content).risks);
        } else {
          risks.push(...findPathRisks(rel));
        }
      } catch {
        risks.push({ path: rel, reason: 'unreadable during safety scan' });
      }
    }
  };

  visit(rootDir);
  return risks;
}

export function describeRisks(risks: PublishRisk[]): string {
  if (risks.length === 0) return 'No sensitive files detected.';
  const preview = risks
    .slice(0, 5)
    .map((r) => `${r.path} (${r.reason})`)
    .join(', ');
  const suffix = risks.length > 5 ? ` and ${risks.length - 5} more` : '';
  return `Sensitive content was omitted or redacted in the marketplace copy: ${preview}${suffix}. Source files were not modified.`;
}
