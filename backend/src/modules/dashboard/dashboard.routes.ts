import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { getDashboardSummary, listActivity } from './dashboard.service';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/summary', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ summary: await getDashboardSummary(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/activity', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid activity filter');
    res.json({ events: await listActivity(req.auth!.userId, parsed.data.limit) });
  } catch (error) {
    next(error);
  }
});
