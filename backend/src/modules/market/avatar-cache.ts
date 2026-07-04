import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { agents } from '../../db/schema';
import { storage } from '../../storage/layout';

/**
 * Listing avatars are cached once under marketplace/avatars/<listingId>.png
 * so the market page never depends on the source agent still existing.
 * The .png name is fixed; browsers sniff the actual image format.
 */
function cacheFilePath(listingId: string): string {
  return path.join(storage.marketplaceAvatarCache(), `${listingId}.png`);
}

export function cachedAvatarFile(listingId: string): string | null {
  const file = cacheFilePath(listingId);
  return fs.existsSync(file) ? file : null;
}

export function dropCachedAvatar(listingId: string): void {
  fs.rmSync(cacheFilePath(listingId), { force: true });
}

async function resolveLocalAgentAvatar(source: string): Promise<string | null> {
  const match = source.match(/^\/api\/agents\/([0-9a-f-]{36})\/avatar$/i);
  if (!match) return null;

  const [agent] = await db
    .select({ userId: agents.userId, avatarFile: agents.avatarFile })
    .from(agents)
    .where(eq(agents.id, match[1]!))
    .limit(1);
  if (!agent?.avatarFile) return null;

  const file = path.join(storage.agentPaths(agent.userId, match[1]!).root, agent.avatarFile);
  return fs.existsSync(file) ? file : null;
}

/**
 * Fills the cache from one of three source kinds: data: URL, local agent
 * avatar API path, or http(s) URL. Returns the cached file path, or null if
 * the source cannot be resolved (callers fall back to a default avatar).
 */
export async function cacheListingAvatar(listingId: string, source: string): Promise<string | null> {
  const existing = cachedAvatarFile(listingId);
  if (existing) return existing;
  if (!source) return null;

  const target = cacheFilePath(listingId);
  try {
    if (source.startsWith('data:image')) {
      const base64 = source.split(',')[1];
      if (!base64) return null;
      fs.writeFileSync(target, Buffer.from(base64, 'base64'));
      return target;
    }

    if (source.startsWith('/api/')) {
      const local = await resolveLocalAgentAvatar(source);
      if (!local) return null;
      fs.copyFileSync(local, target);
      return target;
    }

    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      if (!response.ok) return null;
      fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      return target;
    }
  } catch {
    fs.rmSync(target, { force: true });
  }
  return null;
}
