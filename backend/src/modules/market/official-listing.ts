import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { marketListings, marketListingVersions, users, type Agent, type MarketListing } from '../../db/schema';
import { badRequest } from '../../http/errors';
import { dirDigest, dirSizeBytes, removeDir } from '../../storage/file-ops';
import { storage } from '../../storage/layout';
import { toHostPath } from '../../storage/host-path';
import { cloneListingToAgent, copyForPublish, INITIAL_VERSION } from './market.service';
import { describeRisks, type PublishRisk } from './publish-safety';

/** System account that owns the official listing; not a login account. */
const OFFICIAL_USER_ID = 'e0a11c1a-0000-4000-a000-000000000001';
const OFFICIAL_USER_EMAIL = 'official@swarmdev.local';
const OFFICIAL_USER_NAME = 'SwarmDev Official';

const OFFICIAL_LISTING_NAME = 'SwarmDev Starter Agent';
const OFFICIAL_LISTING_DESCRIPTION =
  'Official starter agent template maintained by the SwarmDev platform.';
const OFFICIAL_TAGS = ['official', 'starter'];
const OFFICIAL_DEFAULT_RUNTIME = 'openclaw';

export const ADOPTION_RUNTIMES = ['openclaw', 'hermes', 'opencode'] as const;
export type AdoptionRuntime = (typeof ADOPTION_RUNTIMES)[number];

/** Agent-local state and memory that must not ship in the official template. */
const SYNC_SKIP_DIRS = new Set(['.claude', '.codex', '.opencode', '.hermes', 'memory', 'temp']);
const SYNC_SKIP_FILES = new Set(['memory.md', 'user.md']);

function officialSyncSkip(relativePath: string, isDirectory: boolean): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((seg) => SYNC_SKIP_DIRS.has(seg.toLowerCase()))) return true;
  if (!isDirectory) {
    const base = path.posix.basename(relativePath).toLowerCase();
    if (SYNC_SKIP_FILES.has(base)) return true;
    if (base.startsWith('tmp_') || base.startsWith('resume_')) return true;
  }
  return false;
}

function configuredSourceWorkspace(): string | null {
  const configured = process.env.OFFICIAL_AGENT_WORKSPACE?.trim();
  return configured ? toHostPath(configured) : null;
}

function writeFallbackTemplate(sourceDir: string): void {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'SOUL.md'),
    [
      '# SwarmDev Starter Agent',
      '',
      'You are the built-in SwarmDev starter agent. Help the user plan, inspect,',
      'and improve their projects with a calm, practical engineering style.',
      'If runtime provider settings are missing, say what is needed instead of',
      'pretending a task ran.',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(sourceDir, 'IDENTITY.md'),
    [
      '# Identity',
      '',
      'Name: SwarmDev Starter Agent',
      'Role: onboarding and project assistant',
      'Capabilities: project guidance, workspace organization, agent setup help,',
      'and workflow planning.',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(sourceDir, 'README.md'),
    [
      '# SwarmDev Starter Agent Template',
      '',
      'Generated fallback template. Set OFFICIAL_AGENT_WORKSPACE to a real',
      'workspace path to publish a richer official template.',
      '',
    ].join('\n')
  );
  writeTemplateManifest(sourceDir);
}

function writeTemplateManifest(sourceDir: string): void {
  fs.writeFileSync(
    path.join(sourceDir, 'agent.json'),
    JSON.stringify(
      {
        name: OFFICIAL_LISTING_NAME,
        version: INITIAL_VERSION,
        description: OFFICIAL_LISTING_DESCRIPTION,
        runtime: OFFICIAL_DEFAULT_RUNTIME,
      },
      null,
      2
    )
  );
}

async function ensureOfficialOwner(): Promise<void> {
  await db
    .insert(users)
    .values({
      id: OFFICIAL_USER_ID,
      email: OFFICIAL_USER_EMAIL,
      username: OFFICIAL_USER_NAME,
      passwordHash: 'system-account-no-login',
    })
    .onConflictDoNothing({ target: users.id });
}

async function findOfficialListing(): Promise<MarketListing | null> {
  const [listing] = await db
    .select()
    .from(marketListings)
    .where(eq(marketListings.isOfficial, true))
    .limit(1);
  return listing ?? null;
}

/**
 * Creates or refreshes the official listing. Files come from the workspace
 * named by OFFICIAL_AGENT_WORKSPACE (sanitized, state/memory stripped) or, if
 * unset or missing, a generated fallback template. The single version row is
 * rewritten on every sync so checksum/size track the current template.
 */
export async function ensureOfficialListing(
  options: { forceSync?: boolean } = {}
): Promise<MarketListing> {
  await ensureOfficialOwner();
  let listing = await findOfficialListing();

  if (!listing) {
    const [created] = await db
      .insert(marketListings)
      .values({
        ownerUserId: OFFICIAL_USER_ID,
        name: OFFICIAL_LISTING_NAME,
        description: OFFICIAL_LISTING_DESCRIPTION,
        runtime: OFFICIAL_DEFAULT_RUNTIME,
        latestVersion: INITIAL_VERSION,
        tags: OFFICIAL_TAGS,
        isOfficial: true,
      })
      .returning();
    listing = created!;
  }

  const sourceDir = storage.marketplaceSource(listing.id, INITIAL_VERSION);
  const hasTemplate = fs.readdirSync(sourceDir).length > 0;
  const configured = configuredSourceWorkspace();
  const workspaceUsable =
    configured !== null && fs.existsSync(configured) && fs.statSync(configured).isDirectory();

  if (workspaceUsable && (options.forceSync || !hasTemplate)) {
    removeDir(sourceDir);
    const risks: PublishRisk[] = [];
    copyForPublish(configured, storage.marketplaceSource(listing.id, INITIAL_VERSION), risks, officialSyncSkip);
    writeTemplateManifest(sourceDir);
    if (risks.length > 0) console.info(describeRisks(risks));
  } else if (!hasTemplate) {
    if (configured) {
      console.warn(`OFFICIAL_AGENT_WORKSPACE not found at ${configured}; using fallback template.`);
    }
    writeFallbackTemplate(sourceDir);
  }

  await db
    .delete(marketListingVersions)
    .where(eq(marketListingVersions.listingId, listing.id));
  await db.insert(marketListingVersions).values({
    listingId: listing.id,
    version: INITIAL_VERSION,
    checksum: dirDigest(sourceDir),
    changelog: workspaceUsable ? 'Synced official workspace' : 'Generated fallback template',
    sizeBytes: dirSizeBytes(sourceDir),
  });

  return listing;
}

/**
 * Clones the official template as a new agent owned by the user, with the
 * runtime of their choice.
 */
export async function adoptOfficialAgent(
  userId: string,
  name: string,
  runtime: AdoptionRuntime = OFFICIAL_DEFAULT_RUNTIME
): Promise<Agent> {
  const displayName = name.trim();
  if (!displayName) throw badRequest('invalid_input', 'Give the official agent a name first');
  if (!ADOPTION_RUNTIMES.includes(runtime)) {
    throw badRequest('invalid_input', `Runtime must be one of: ${ADOPTION_RUNTIMES.join(', ')}`);
  }

  const listing = await ensureOfficialListing({ forceSync: true });
  return cloneListingToAgent(userId, listing, { name: displayName, runtime });
}
