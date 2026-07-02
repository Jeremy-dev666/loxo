import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import {
  createProvider,
  deleteProvider,
  listProviders,
  PROVIDER_VENDORS,
  updateProvider,
} from './providers.service';
import { getRuntimeHealth } from './runtime-health';

const createSchema = z.object({
  name: z.string().min(1).max(64),
  vendor: z.enum(PROVIDER_VENDORS),
  apiKey: z.string().min(8),
  baseUrl: z.string().url().nullish(),
  models: z.array(z.string().min(1)).max(32).optional(),
  isDefault: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export const providersRouter = Router();
providersRouter.use(requireAuth);

providersRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ providers: await listProviders(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

// Registered before /:id so "runtime-health" is not parsed as an id.
providersRouter.get('/runtime-health', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ health: await getRuntimeHealth(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

providersRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    res.status(201).json({ provider: await createProvider(req.auth!.userId, parsed.data) });
  } catch (error) {
    next(error);
  }
});

providersRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    res.json({
      provider: await updateProvider(req.auth!.userId, String(req.params.id), parsed.data),
    });
  } catch (error) {
    next(error);
  }
});

providersRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deleteProvider(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
