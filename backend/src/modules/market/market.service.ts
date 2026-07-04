import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  agents,
  marketListings,
  marketListingVersions,
  users,
  type Agent,
  type AgentManifest,
  type MarketListing,
  type MarketListingVersion,
  type MarketVisibility,
} from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../http/errors';
import { copyDir, dirDigest, dirSizeBytes, removeDir } from '../../storage/file-ops';
import { storage } from '../../storage/layout';
import { getAgent } from '../agents/agents.service';
import { cacheListingAvatar, cachedAvatarFile, dropCachedAvatar } from './avatar-cache';
import { isPublishExcluded, sanitizeFileForPublish, type PublishRisk } from './publish-safety';

export const INITIAL_VERSION = '1.0.0';

export interface ListingSummary extends MarketListing {
  ownerUsername: string | null;
  hasFiles: boolean;
  sizeBytes: number;
  avatarUrl: string | null;
}

export type PublishExtraFilter = (relativePath: string, isDirectory: boolean) => boolean;

/**
 * Sanitized recursive copy for marketplace publication: skips excluded and
 * extra-filtered paths, omits sensitive files, redacts secrets in text.
 * Collects risks into `risks`; source files are never modified.
 */
export function copyForPublish(
  sourceDir: string,
  destDir: string,
  risks: PublishRisk[],
  extraSkip?: PublishExtraFilter,
  rootDir: string = sourceDir
): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const from = path.join(sourceDir, entry.name);
    const rel = path.relative(rootDir, from).replace(/\\/g, '/');
    if (isPublishExcluded(rel, entry.isDirectory())) continue;
    if (extraSkip?.(rel, entry.isDirectory())) continue;

    if (entry.isDirectory()) {
      copyForPublish(from, path.join(destDir, entry.name), risks, extraSkip, rootDir);
      continue;
    }
    if (!entry.isFile()) continue;

    const sanitized = sanitizeFileForPublish(rel, fs.readFileSync(from));
    risks.push(...sanitized.risks);
    if (sanitized.action === 'omit' || !sanitized.content) continue;
    fs.writeFileSync(path.join(destDir, entry.name), sanitized.content);
  }
}

function sourceDirHasFiles(dir: string): boolean {
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
}

async function getListingRow(listingId: string): Promise<MarketListing> {
  const [listing] = await db
    .select()
    .from(marketListings)
    .where(eq(marketListings.id, listingId))
    .limit(1);
  if (!listing) throw notFound('Listing not found');
  return listing;
}

async function toSummary(listing: MarketListing, ownerUsername: string | null): Promise<ListingSummary> {
  const sourceDir = storage.marketplaceSource(listing.id, listing.latestVersion);
  const hasFiles = sourceDirHasFiles(sourceDir);
  const cached =
    cachedAvatarFile(listing.id) ??
    (listing.avatarSource ? await cacheListingAvatar(listing.id, listing.avatarSource) : null);
  return {
    ...listing,
    ownerUsername,
    hasFiles,
    sizeBytes: hasFiles ? dirSizeBytes(sourceDir) : 0,
    avatarUrl: cached ? `/api/market/${listing.id}/avatar` : null,
  };
}

export interface PublishInput {
  name?: string;
  description?: string;
  tags?: string[];
  visibility?: MarketVisibility;
}

export interface PublishResult {
  listing: MarketListing;
  alreadyPublished: boolean;
  risks: PublishRisk[];
}

export async function findPublicationForAgent(
  userId: string,
  agentId: string
): Promise<MarketListing | null> {
  const [listing] = await db
    .select()
    .from(marketListings)
    .where(
      and(
        eq(marketListings.ownerUserId, userId),
        eq(marketListings.sourceAgentId, agentId),
        eq(marketListings.status, 'active')
      )
    )
    .limit(1);
  return listing ?? null;
}

/**
 * Publishes an agent's workspace as a marketplace listing. Re-publishing an
 * already-listed agent returns the existing listing instead of duplicating.
 */
export async function publishAgent(
  userId: string,
  agentId: string,
  input: PublishInput = {}
): Promise<PublishResult> {
  const agent = await getAgent(userId, agentId);

  const existing = await findPublicationForAgent(userId, agentId);
  if (existing) return { listing: existing, alreadyPublished: true, risks: [] };

  const workspace = storage.agentPaths(userId, agentId).workspace;
  const listingId = crypto.randomUUID();
  const sourceDir = storage.marketplaceSource(listingId, INITIAL_VERSION);
  const risks: PublishRisk[] = [];

  try {
    copyForPublish(workspace, sourceDir, risks);
    if (!sourceDirHasFiles(sourceDir)) {
      throw badRequest('empty_workspace', 'Agent workspace has no publishable files');
    }

    const [listing] = await db
      .insert(marketListings)
      .values({
        id: listingId,
        ownerUserId: userId,
        sourceAgentId: agentId,
        name: input.name?.trim() || agent.name,
        description: input.description ?? agent.description,
        runtime: agent.runtime,
        latestVersion: INITIAL_VERSION,
        visibility: input.visibility ?? 'public',
        tags: dedupeTags(input.tags ?? agent.tags),
        avatarSource: agent.avatarFile ? `/api/agents/${agentId}/avatar` : '',
      })
      .returning();
    await db.insert(marketListingVersions).values({
      listingId,
      version: INITIAL_VERSION,
      checksum: dirDigest(sourceDir),
      changelog: 'Initial release',
      sizeBytes: dirSizeBytes(sourceDir),
    });

    if (listing!.avatarSource) await cacheListingAvatar(listingId, listing!.avatarSource);
    return { listing: listing!, alreadyPublished: false, risks };
  } catch (error) {
    removeDir(storage.marketplaceListingRoot(listingId));
    await db.delete(marketListings).where(eq(marketListings.id, listingId));
    throw error;
  }
}

export async function unpublishListing(userId: string, listingId: string): Promise<void> {
  const listing = await getListingRow(listingId);
  if (listing.ownerUserId !== userId) throw forbidden('Only the owner can unpublish a listing');

  await db.delete(marketListings).where(eq(marketListings.id, listingId));
  removeDir(storage.marketplaceListingRoot(listingId));
  dropCachedAvatar(listingId);
}

/** No-op variant used by agent deletion; returns whether a listing was removed. */
export async function retractAgentPublication(userId: string, agentId: string): Promise<boolean> {
  const listing = await findPublicationForAgent(userId, agentId);
  if (!listing) return false;
  await unpublishListing(userId, listing.id);
  return true;
}

export interface ListingQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listMarketListings(query: ListingQuery = {}): Promise<ListingSummary[]> {
  const { ensureOfficialListing } = await import('./official-listing');
  await ensureOfficialListing().catch((error) => {
    console.warn('Official listing unavailable:', error instanceof Error ? error.message : error);
  });

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  const rows = await db
    .select({ listing: marketListings, ownerUsername: users.username })
    .from(marketListings)
    .leftJoin(users, eq(marketListings.ownerUserId, users.id))
    .where(
      and(
        eq(marketListings.status, 'active'),
        eq(marketListings.visibility, 'public'),
        query.search ? ilike(marketListings.name, `%${query.search}%`) : undefined
      )
    )
    .orderBy(
      desc(marketListings.isOfficial),
      desc(marketListings.downloadCount),
      desc(marketListings.updatedAt)
    )
    .limit(limit)
    .offset(offset);

  return Promise.all(rows.map((row) => toSummary(row.listing, row.ownerUsername)));
}

/** Owner view: includes private/unlisted/disabled listings. */
export async function listOwnListings(userId: string): Promise<ListingSummary[]> {
  const rows = await db
    .select({ listing: marketListings, ownerUsername: users.username })
    .from(marketListings)
    .leftJoin(users, eq(marketListings.ownerUserId, users.id))
    .where(eq(marketListings.ownerUserId, userId))
    .orderBy(desc(marketListings.updatedAt));
  return Promise.all(rows.map((row) => toSummary(row.listing, row.ownerUsername)));
}

export async function getListingDetail(listingId: string): Promise<ListingSummary> {
  const rows = await db
    .select({ listing: marketListings, ownerUsername: users.username })
    .from(marketListings)
    .leftJoin(users, eq(marketListings.ownerUserId, users.id))
    .where(eq(marketListings.id, listingId))
    .limit(1);
  if (rows.length === 0) throw notFound('Listing not found');
  return toSummary(rows[0]!.listing, rows[0]!.ownerUsername);
}

export async function listListingVersions(listingId: string): Promise<MarketListingVersion[]> {
  await getListingRow(listingId);
  return db
    .select()
    .from(marketListingVersions)
    .where(eq(marketListingVersions.listingId, listingId))
    .orderBy(desc(marketListingVersions.createdAt));
}

function readManifestFromDir(dir: string): AgentManifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'agent.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as AgentManifest) : {};
  } catch {
    return {};
  }
}

export interface CloneOverrides {
  name?: string;
  runtime?: string;
}

/**
 * Clones a listing's source files into a new agent for `userId`. Shared by
 * marketplace download and official-agent adoption (which overrides runtime).
 */
export async function cloneListingToAgent(
  userId: string,
  listing: MarketListing,
  overrides: CloneOverrides = {}
): Promise<Agent> {
  const sourceDir = storage.marketplaceSource(listing.id, listing.latestVersion);
  if (!sourceDirHasFiles(sourceDir)) {
    throw badRequest('listing_empty', 'Listing has no downloadable files');
  }

  const [agent] = await db
    .insert(agents)
    .values({
      userId,
      name: overrides.name?.trim() || listing.name,
      description: listing.description,
      runtime: overrides.runtime ?? listing.runtime,
      tags: listing.tags,
      manifest: readManifestFromDir(sourceDir),
      sourceListingId: listing.id,
    })
    .returning();

  const paths = storage.agentPaths(userId, agent!.id);
  try {
    copyDir(sourceDir, paths.workspace);
    copyDir(paths.workspace, paths.baseline);

    const cachedAvatar =
      cachedAvatarFile(listing.id) ??
      (listing.avatarSource ? await cacheListingAvatar(listing.id, listing.avatarSource) : null);
    if (cachedAvatar) {
      fs.copyFileSync(cachedAvatar, path.join(paths.root, 'avatar.png'));
      await db
        .update(agents)
        .set({ avatarFile: 'avatar.png' })
        .where(eq(agents.id, agent!.id));
      agent!.avatarFile = 'avatar.png';
    }
  } catch (error) {
    removeDir(paths.root);
    await db.delete(agents).where(eq(agents.id, agent!.id));
    throw error;
  }

  await db
    .update(marketListings)
    .set({ downloadCount: sql`${marketListings.downloadCount} + 1` })
    .where(eq(marketListings.id, listing.id));
  return agent!;
}

export async function downloadListing(userId: string, listingId: string): Promise<Agent> {
  const listing = await getListingRow(listingId);
  if (listing.status !== 'active') {
    throw badRequest('listing_unavailable', 'Listing is not available for download');
  }
  if (listing.visibility === 'private' && listing.ownerUserId !== userId) {
    throw forbidden('Listing is private');
  }
  return cloneListingToAgent(userId, listing);
}

/**
 * Maintenance: removes listings whose source files vanished from storage.
 * Exposed via scripts/market-maintenance.ts, deliberately not over HTTP.
 */
export async function removeBrokenListings(): Promise<{ removed: number }> {
  const all = await db.select().from(marketListings);
  let removed = 0;
  for (const listing of all) {
    if (sourceDirHasFiles(storage.marketplaceSource(listing.id, listing.latestVersion))) continue;
    await db.delete(marketListings).where(eq(marketListings.id, listing.id));
    removeDir(storage.marketplaceListingRoot(listing.id));
    dropCachedAvatar(listing.id);
    removed += 1;
  }
  return { removed };
}
