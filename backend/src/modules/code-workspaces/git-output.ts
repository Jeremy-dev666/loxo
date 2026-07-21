/**
 * Parsers for NUL-delimited Git plumbing output. NUL formats carry raw paths,
 * so spaces, Unicode, and other unusual filenames need no unquoting.
 */

export interface StatusEntry {
  /** Index-side status letter. */
  x: string;
  /** Worktree-side status letter. */
  y: string;
  path: string;
  origPath?: string;
}

/** `git status --porcelain=v1 -z`: `XY path` entries; renames append the original path. */
export function parseStatusZ(output: string): StatusEntry[] {
  const fields = splitNul(output);
  const entries: StatusEntry[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === undefined || field.length < 4) continue;
    const x = field[0] ?? ' ';
    const y = field[1] ?? ' ';
    const entry: StatusEntry = { x, y, path: field.slice(3) };
    if (x === 'R' || x === 'C') {
      i += 1;
      const orig = fields[i];
      if (orig !== undefined) entry.origPath = orig;
    }
    entries.push(entry);
  }
  return entries;
}

/** `git ls-files -z` and friends: one path per NUL field. */
export function parseNulList(output: string): string[] {
  return splitNul(output);
}

export interface NumstatEntry {
  /** Null for binary files. */
  additions: number | null;
  deletions: number | null;
  path: string;
  origPath?: string;
}

/**
 * `git diff --numstat -z`: `added TAB deleted TAB path`. Renames leave the
 * path field empty and append preimage and postimage as separate fields.
 */
export function parseNumstatZ(output: string): NumstatEntry[] {
  const fields = splitNul(output);
  const entries: NumstatEntry[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === undefined) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(field);
    if (!match) continue;
    const additions = match[1] === '-' ? null : Number(match[1]);
    const deletions = match[2] === '-' ? null : Number(match[2]);
    let path = match[3] ?? '';
    let origPath: string | undefined;
    if (path === '') {
      origPath = fields[i + 1];
      path = fields[i + 2] ?? '';
      i += 2;
    }
    entries.push(origPath === undefined ? { additions, deletions, path } : { additions, deletions, path, origPath });
  }
  return entries;
}

export interface NameStatusEntry {
  /** Single status letter; rename/copy scores are stripped. */
  status: string;
  path: string;
  origPath?: string;
}

/** `git diff --name-status -z`: status field, then one path (two for renames and copies). */
export function parseNameStatusZ(output: string): NameStatusEntry[] {
  const fields = splitNul(output);
  const entries: NameStatusEntry[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const statusField = fields[i];
    if (statusField === undefined || statusField === '') continue;
    const status = statusField[0] ?? '';
    if (status === 'R' || status === 'C') {
      const origPath = fields[i + 1] ?? '';
      const path = fields[i + 2] ?? '';
      i += 2;
      entries.push({ status, path, origPath });
    } else {
      const path = fields[i + 1] ?? '';
      i += 1;
      entries.push({ status, path });
    }
  }
  return entries;
}

export interface WorktreeListEntry {
  path: string;
  head: string | null;
  /** Short branch name; null when detached or bare. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** `git worktree list --porcelain`: attribute lines per worktree, blocks separated by blank lines. */
export function parseWorktreeList(output: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  let current: WorktreeListEntry | null = null;
  for (const line of output.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '') {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (trimmed.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = {
        path: trimmed.slice('worktree '.length),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;
    if (trimmed.startsWith('HEAD ')) current.head = trimmed.slice('HEAD '.length);
    else if (trimmed.startsWith('branch ')) {
      current.branch = trimmed.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (trimmed === 'detached') current.detached = true;
    else if (trimmed === 'bare') current.bare = true;
    else if (trimmed === 'locked' || trimmed.startsWith('locked ')) current.locked = true;
    else if (trimmed === 'prunable' || trimmed.startsWith('prunable ')) current.prunable = true;
  }
  if (current) entries.push(current);
  return entries;
}

function splitNul(output: string): string[] {
  if (output === '') return [];
  const fields = output.split('\0');
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
  return fields;
}
