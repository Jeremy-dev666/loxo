import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../db/client';
import { agents, type Agent, type AgentManifest } from '../../db/schema';
import { badRequest } from '../../http/errors';
import { copyDir, removeDir } from '../../storage/file-ops';
import { storage } from '../../storage/layout';
import { cleanRelativePath } from '../../storage/path-safety';
import { createAgent } from './agents.service';
import { resolveRuntime } from './runtime-detect';
import { eq } from 'drizzle-orm';

export const MAX_IMPORT_FILES = 1000;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export interface ImportFile {
  relativePath: string;
  content: Buffer;
}

export interface ImportInput {
  name: string;
  description?: string;
  runtime?: string; // explicit user choice wins over detection
}

export interface ImportResult {
  agent: Agent;
  fileCount: number;
}

/** Validates zip entries (path safety, count, uncompressed size) before extraction. */
export function unpackArchive(zipBuffer: Buffer): ImportFile[] {
  const zip = new AdmZip(zipBuffer);
  const files: ImportFile[] = [];
  let totalBytes = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const cleaned = cleanRelativePath(entry.entryName);
    if (cleaned === null) {
      throw badRequest('unsafe_archive', `Archive contains an unsafe path: ${entry.entryName}`);
    }
    totalBytes += entry.header.size;
    if (files.length >= MAX_IMPORT_FILES) {
      throw badRequest('too_many_files', `Archive exceeds ${MAX_IMPORT_FILES} files`);
    }
    if (totalBytes > MAX_IMPORT_BYTES) {
      throw badRequest('archive_too_large', 'Archive exceeds the 200MB uncompressed limit');
    }
    files.push({ relativePath: cleaned, content: entry.getData() });
  }
  return files;
}

export function validateFiles(files: ImportFile[]): void {
  if (files.length === 0) throw badRequest('empty_import', 'No files to import');
  if (files.length > MAX_IMPORT_FILES) {
    throw badRequest('too_many_files', `Import exceeds ${MAX_IMPORT_FILES} files`);
  }
  const totalBytes = files.reduce((sum, f) => sum + f.content.length, 0);
  if (totalBytes > MAX_IMPORT_BYTES) {
    throw badRequest('import_too_large', 'Import exceeds the 200MB limit');
  }
}

function readManifest(files: ImportFile[]): AgentManifest {
  const manifestFile = files.find((f) => f.relativePath === 'agent.json');
  if (!manifestFile) return {};
  try {
    const parsed = JSON.parse(manifestFile.content.toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as AgentManifest) : {};
  } catch {
    return {};
  }
}

/**
 * Creates an agent from uploaded files: resolves the runtime, writes the
 * workspace, and seeds the baseline snapshot. Rolls back on failure.
 */
export async function importAgent(
  userId: string,
  files: ImportFile[],
  input: ImportInput
): Promise<ImportResult> {
  validateFiles(files);

  const manifest = readManifest(files);
  const manifestRuntime = (manifest as { runtime?: string }).runtime;
  const paths = files.map((f) => f.relativePath);
  const runtime = resolveRuntime(input.runtime, paths, manifestRuntime);
  if (!runtime) {
    throw badRequest(
      'unknown_runtime',
      'Could not detect the agent runtime; select one explicitly'
    );
  }

  const agent = await createAgent(userId, {
    name: input.name,
    runtime,
    description: input.description ?? manifest.description ?? '',
    manifest,
  });

  const agentPaths = storage.agentPaths(userId, agent.id);
  try {
    for (const file of files) {
      const target = path.join(agentPaths.workspace, ...file.relativePath.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content);
    }
    copyDir(agentPaths.workspace, agentPaths.baseline);
  } catch (error) {
    removeDir(agentPaths.root);
    await db.delete(agents).where(eq(agents.id, agent.id));
    throw error;
  }

  return { agent, fileCount: files.length };
}
