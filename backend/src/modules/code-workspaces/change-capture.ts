import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChangeSummary } from '../../db/schema';
import type { NameStatusEntry, NumstatEntry } from './git-output';
import type { CaptureLimits } from './workspace.types';

const STATUS_WORDS: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
};

export interface SummaryTotals {
  summary: ChangeSummary;
  changedFiles: number;
  additions: number;
  deletions: number;
}

/**
 * Joins name-status and numstat views of the same diff into the stored
 * summary shape. Totals are computed before file-list truncation so capped
 * summaries still report the full change size.
 */
export function buildChangeSummary(
  nameStatus: NameStatusEntry[],
  numstat: NumstatEntry[],
  untracked: string[],
  limits: CaptureLimits
): SummaryTotals {
  const countsByPath = new Map<string, { additions: number; deletions: number }>();
  let additions = 0;
  let deletions = 0;
  for (const entry of numstat) {
    const add = entry.additions ?? 0;
    const del = entry.deletions ?? 0;
    countsByPath.set(entry.path, { additions: add, deletions: del });
    additions += add;
    deletions += del;
  }

  const files = nameStatus.map((entry) => {
    const counts = countsByPath.get(entry.path);
    return {
      path: entry.path,
      status: STATUS_WORDS[entry.status] ?? entry.status,
      additions: counts?.additions ?? 0,
      deletions: counts?.deletions ?? 0,
    };
  });

  const changedFiles = files.length + untracked.length;
  const summary: ChangeSummary = { files, untracked };
  if (changedFiles > limits.maxSummaryFiles) {
    summary.files = files.slice(0, limits.maxSummaryFiles);
    summary.untracked = untracked.slice(0, Math.max(0, limits.maxSummaryFiles - summary.files.length));
    summary.truncated = true;
  }
  return { summary, changedFiles, additions, deletions };
}

/**
 * Content-only fingerprint of the cumulative change set relative to the
 * workspace base commit. Built from per-file content hashes rather than raw
 * diff bytes: a checkpoint commit turns untracked files into tracked ones,
 * which rewrites the diff text but leaves path content untouched — and the
 * fingerprint, and any approval bound to it, must survive that. Callers pass
 * name-status computed with --no-renames so detection heuristics cannot
 * shift the entry set either.
 */
export async function computeChangeFingerprint(
  worktreePath: string,
  trackedVsBase: NameStatusEntry[],
  untracked: string[]
): Promise<string> {
  const byPath = new Map<string, string>();
  const record = async (relPath: string, deleted: boolean) => {
    if (relPath === '') return;
    if (deleted) {
      byPath.set(relPath, 'D');
      return;
    }
    const digest = await hashWorktreeFile(path.join(worktreePath, relPath));
    byPath.set(relPath, digest === null ? 'D' : `F${digest}`);
  };

  for (const entry of trackedVsBase) {
    await record(entry.path, entry.status === 'D');
  }
  for (const relPath of untracked) {
    await record(relPath, false);
  }

  const hash = crypto.createHash('sha256');
  hash.update('swarmdev-change-v1');
  for (const relPath of [...byPath.keys()].sort()) {
    hash.update('\0');
    hash.update(relPath);
    hash.update('\0');
    hash.update(byPath.get(relPath) ?? '');
  }
  return hash.digest('hex');
}

/** Streaming hash of one worktree file; null when it vanished after listing. */
function hashWorktreeFile(filePath: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      resolve(null);
      return;
    }
    const mode = (stat.mode & 0o111) !== 0 ? '100755' : '100644';
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(filePath);
      resolve(`120000:${crypto.createHash('sha256').update(target).digest('hex')}`);
      return;
    }
    if (!stat.isFile()) {
      resolve(null);
      return;
    }
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`${mode}:${hash.digest('hex')}`));
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resolve(null);
      else reject(err);
    });
  });
}
