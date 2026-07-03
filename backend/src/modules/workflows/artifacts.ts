import fs from 'node:fs';
import path from 'node:path';
import type { AddArtifactInput } from './execution-store';

/**
 * Artifact paths are stored relative to their base — the shared workspace for
 * `workspace-file`, the run root for `node-output`. `absolutePath` stays
 * in-memory for handoff previews and is never persisted.
 */
export interface NodeArtifact extends AddArtifactInput {
  absolutePath: string;
}

const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.swarmdev',
  '.openclaw',
  'node_modules',
  '.next',
  'dist',
  'build',
]);
const MAX_WORKSPACE_ARTIFACTS = 50;
const PREVIEW_MAX_BYTES = 6 * 1024;
const PREVIEW_MAX_CHARS = 3600;

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

export type WorkspaceSnapshot = Map<string, FileStamp>;

/** Size+mtime index of the workspace; cheap enough to take per node run. */
export function snapshotWorkspace(root: string): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = new Map();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          const rel = path.relative(root, full).replace(/\\/g, '/');
          snapshot.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // File vanished between readdir and stat.
        }
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return snapshot;
}

/** Files that are new or whose size/mtime changed, capped to keep runs sane. */
export function diffWorkspaceSnapshots(
  workspaceRoot: string,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  nodeId: string,
  runCount: number
): NodeArtifact[] {
  const artifacts: NodeArtifact[] = [];
  for (const [rel, stamp] of after) {
    const prev = before.get(rel);
    if (prev && prev.size === stamp.size && prev.mtimeMs === stamp.mtimeMs) continue;
    artifacts.push({
      nodeId,
      runCount,
      kind: 'workspace-file',
      label: prev ? 'updated' : 'created',
      path: rel,
      size: stamp.size,
      absolutePath: path.join(workspaceRoot, rel),
    });
    if (artifacts.length >= MAX_WORKSPACE_ARTIFACTS) break;
  }
  return artifacts;
}

export function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || 'node';
}

export interface PersistNodeOutputInput {
  runRoot: string;
  artifactsDir: string;
  executionId: string;
  workflowName: string;
  nodeId: string;
  nodeLabel: string;
  runCount: number;
  output: string;
}

/** Writes the per-run node output markdown under <artifacts>/nodes/. */
export function persistNodeOutput(input: PersistNodeOutputInput): NodeArtifact {
  const dir = path.join(input.artifactsDir, 'nodes');
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${sanitizeFileName(input.nodeId)}-run-${input.runCount}.md`;
  const absolutePath = path.join(dir, fileName);
  const content = [
    `# ${input.nodeLabel}`,
    '',
    `- Workflow: ${input.workflowName}`,
    `- Execution: ${input.executionId}`,
    `- Node: ${input.nodeId} (run ${input.runCount})`,
    `- Completed: ${new Date().toISOString()}`,
    '',
    input.output,
    '',
  ].join('\n');
  fs.writeFileSync(absolutePath, content, 'utf8');
  return {
    nodeId: input.nodeId,
    runCount: input.runCount,
    kind: 'node-output',
    label: 'output',
    path: path.relative(input.runRoot, absolutePath).replace(/\\/g, '/'),
    size: Buffer.byteLength(content),
    absolutePath,
  };
}

export interface ArtifactPreview {
  text: string;
  truncated: boolean;
}

/** First 6KB of a text file; null for binary or unreadable content. */
export function readArtifactPreview(absolutePath: string): ArtifactPreview | null {
  let fd: number;
  let fileSize: number;
  try {
    fd = fs.openSync(absolutePath, 'r');
    fileSize = fs.fstatSync(fd).size;
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(Math.min(PREVIEW_MAX_BYTES, fileSize));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, bytesRead);
    if (slice.includes(0)) return null;

    let text = slice.toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
    let truncated = fileSize > bytesRead;
    if (text.length > PREVIEW_MAX_CHARS) {
      text = text.slice(0, PREVIEW_MAX_CHARS);
      truncated = true;
    }
    if (!text.trim()) return null;
    return { text, truncated };
  } finally {
    fs.closeSync(fd);
  }
}
