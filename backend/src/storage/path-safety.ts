import path from 'node:path';

/**
 * Normalizes a client-supplied relative path. Returns null for anything that
 * could escape its root: absolute paths, drive letters, `.`/`..` segments,
 * or empty input.
 */
export function cleanRelativePath(input: string): string | null {
  const normalized = input.replace(/\\/g, '/').trim();
  if (!normalized) return null;
  if (normalized.startsWith('/')) return null;
  if (/^[A-Za-z]:/.test(normalized)) return null;

  const segments = normalized.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segments.join('/');
}

export class PathEscapeError extends Error {
  constructor(message = 'Path escapes its root directory') {
    super(message);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolves `relative` against `root` and guarantees the result stays inside.
 * Throws PathEscapeError otherwise.
 */
export function resolveInside(root: string, relative: string): string {
  const cleaned = relative === '' ? '' : cleanRelativePath(relative);
  if (relative !== '' && cleaned === null) {
    throw new PathEscapeError();
  }
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, cleaned ?? '');
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new PathEscapeError();
  }
  return target;
}
