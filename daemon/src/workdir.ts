import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function defaultWorkspaceRoot(): string {
  return join(homedir(), '.swarmdev', 'workspace');
}

function isUnder(child: string, root: string): boolean {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves a server-requested working directory against this machine's
 * allowlist. The server is not trusted with arbitrary filesystem access:
 * only directories under an allowed root (or the daemon's own workspace)
 * may be used. Returns null when the request falls outside every root.
 */
export function resolveAllowedWorkdir(
  requested: string | null | undefined,
  allowedRoots: string[]
): string | null {
  const roots = [defaultWorkspaceRoot(), ...allowedRoots].map((root) => resolve(root));
  if (!requested?.trim()) return roots[0]!;

  // Windows paths are case-insensitive; normalize before the prefix check.
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const target = resolve(requested.trim());
  for (const root of roots) {
    if (isUnder(fold(target), fold(root))) return target;
  }
  return null;
}
