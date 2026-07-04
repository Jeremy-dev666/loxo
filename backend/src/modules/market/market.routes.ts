import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { cachedAvatarFile } from './avatar-cache';
import {
  downloadListing,
  findPublicationForAgent,
  getListingDetail,
  listListingVersions,
  listMarketListings,
  listOwnListings,
  publishAgent,
  unpublishListing,
} from './market.service';
import { ADOPTION_RUNTIMES, adoptOfficialAgent, type AdoptionRuntime } from './official-listing';
import { describeRisks } from './publish-safety';

export const marketRouter = Router();

const uuidSchema = z.string().uuid();

function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  return parsed.data;
}

// Public: listing avatars are embedded via <img>, which cannot send
// Authorization. Listing ids are UUIDs; treat them as capability tokens.
marketRouter.get('/:id/avatar', (req, res, next) => {
  try {
    const parsed = uuidSchema.safeParse(req.params.id);
    const file = parsed.success ? cachedAvatarFile(parsed.data) : null;
    if (!file) throw notFound('Avatar not found');
    res.sendFile(file);
  } catch (error) {
    next(error);
  }
});

marketRouter.use(requireAuth);

const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

marketRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseOr400(listQuerySchema, req.query);
    res.json({ listings: await listMarketListings(query) });
  } catch (error) {
    next(error);
  }
});

marketRouter.get('/mine', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ listings: await listOwnListings(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

const publishSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1)).max(16).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

marketRouter.post('/publish', async (req: AuthedRequest, res, next) => {
  try {
    const { agentId, ...input } = parseOr400(publishSchema, req.body);
    const result = await publishAgent(req.auth!.userId, agentId, input);
    res.status(result.alreadyPublished ? 200 : 201).json({
      listing: result.listing,
      alreadyPublished: result.alreadyPublished,
      sanitization: result.risks.length > 0 ? describeRisks(result.risks) : null,
    });
  } catch (error) {
    next(error);
  }
});

marketRouter.delete('/publish/:agentId', async (req: AuthedRequest, res, next) => {
  try {
    const agentId = parseOr400(uuidSchema, req.params.agentId);
    const listing = await findPublicationForAgent(req.auth!.userId, agentId);
    if (!listing) throw notFound('Agent is not published');
    await unpublishListing(req.auth!.userId, listing.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const adoptSchema = z.object({
  name: z.string().min(1).max(80),
  runtime: z.enum(ADOPTION_RUNTIMES).optional(),
});

marketRouter.post('/official/adopt', async (req: AuthedRequest, res, next) => {
  try {
    const input = parseOr400(adoptSchema, req.body);
    const agent = await adoptOfficialAgent(
      req.auth!.userId,
      input.name,
      input.runtime as AdoptionRuntime | undefined
    );
    res.status(201).json({ agent });
  } catch (error) {
    next(error);
  }
});

marketRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ listing: await getListingDetail(parseOr400(uuidSchema, req.params.id)) });
  } catch (error) {
    next(error);
  }
});

marketRouter.get('/:id/versions', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ versions: await listListingVersions(parseOr400(uuidSchema, req.params.id)) });
  } catch (error) {
    next(error);
  }
});

marketRouter.post('/:id/download', async (req: AuthedRequest, res, next) => {
  try {
    const agent = await downloadListing(req.auth!.userId, parseOr400(uuidSchema, req.params.id));
    res.status(201).json({ agent });
  } catch (error) {
    next(error);
  }
});

marketRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    await unpublishListing(req.auth!.userId, parseOr400(uuidSchema, req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
