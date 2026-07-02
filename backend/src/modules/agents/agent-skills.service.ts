import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../../http/errors';
import { storage } from '../../storage/layout';
import { cleanRelativePath } from '../../storage/path-safety';
import { getAgent } from './agents.service';

const SKILL_FILE = 'SKILL.md';

export interface SkillSummary {
  id: string; // directory path relative to skills/
  name: string;
  description: string;
  updatedAt: string;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
  }
  return result;
}

function firstParagraph(content: string): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
  const paragraph = body
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .join(' ')
    )
    .find(Boolean);
  return paragraph ?? '';
}

function findSkillFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSkillFiles(full, out);
    else if (entry.isFile() && entry.name.toLowerCase() === SKILL_FILE.toLowerCase()) out.push(full);
  }
  return out;
}

function skillsRoot(userId: string, agentId: string): string {
  return path.join(storage.agentPaths(userId, agentId).workspace, 'skills');
}

function toSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `skill-${Date.now()}`
  );
}

function uniqueDir(root: string, slug: string): string {
  let candidate = path.join(root, slug);
  for (let i = 2; fs.existsSync(candidate); i += 1) {
    candidate = path.join(root, `${slug}-${i}`);
  }
  return candidate;
}

export async function listSkills(userId: string, agentId: string): Promise<SkillSummary[]> {
  await getAgent(userId, agentId);
  const root = skillsRoot(userId, agentId);

  return findSkillFiles(root)
    .map((skillPath) => {
      const content = fs.readFileSync(skillPath, 'utf8');
      const meta = parseFrontmatter(content);
      const dir = path.dirname(skillPath);
      return {
        id: path.relative(root, dir).replace(/\\/g, '/') || path.basename(dir),
        name: meta.name ?? path.basename(dir),
        description: meta.description ?? firstParagraph(content),
        updatedAt: fs.statSync(skillPath).mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function addSkillFromMarkdown(
  userId: string,
  agentId: string,
  file: { originalname: string; buffer: Buffer },
  requestedName?: string
): Promise<SkillSummary[]> {
  await getAgent(userId, agentId);
  const content = file.buffer.toString('utf8');
  const meta = parseFrontmatter(content);
  const slug = toSlug(requestedName ?? meta.name ?? file.originalname);

  const dir = uniqueDir(skillsRoot(userId, agentId), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SKILL_FILE), content, 'utf8');
  return listSkills(userId, agentId);
}

/** Installs every SKILL.md-rooted directory found in the archive. */
export async function addSkillsFromArchive(
  userId: string,
  agentId: string,
  zipBuffer: Buffer
): Promise<SkillSummary[]> {
  await getAgent(userId, agentId);
  const zip = new AdmZip(zipBuffer);

  const byDir = new Map<string, { relativePath: string; content: Buffer }[]>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const cleaned = cleanRelativePath(entry.entryName);
    if (cleaned === null) {
      throw badRequest('unsafe_archive', `Archive contains an unsafe path: ${entry.entryName}`);
    }
    const dir = path.posix.dirname(cleaned);
    const list = byDir.get(dir) ?? [];
    list.push({ relativePath: cleaned, content: entry.getData() });
    byDir.set(dir, list);
  }

  const skillDirs = [...byDir.keys()].filter((dir) =>
    byDir.get(dir)!.some((f) => path.posix.basename(f.relativePath).toLowerCase() === 'skill.md')
  );
  if (skillDirs.length === 0) {
    throw badRequest('no_skill_found', 'Archive does not contain a SKILL.md file');
  }

  const root = skillsRoot(userId, agentId);
  for (const dir of skillDirs) {
    const slug = toSlug(dir === '.' ? 'skill' : path.posix.basename(dir));
    const target = uniqueDir(root, slug);
    for (const file of byDir.get(dir)!) {
      const inner = path.posix.relative(dir === '.' ? '' : dir, file.relativePath);
      const dest = path.join(target, ...inner.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content);
    }
  }
  return listSkills(userId, agentId);
}
