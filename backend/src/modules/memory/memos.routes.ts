import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { deleteMemo, listMemos } from './memos.service';
import type { MemoScope } from '../../db/schema';

export const memosRouter = Router();
memosRouter.use(requireAuth);

const listQuerySchema = z.object({
  scope: z.enum(['agent', 'team', 'project']),
  subjectId: z.string().uuid(),
});

memosRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest('invalid_query', parsed.error.issues[0]?.message ?? 'Invalid query');
    }
    res.json({
      memos: await listMemos(req.auth!.userId, parsed.data.scope as MemoScope, parsed.data.subjectId),
    });
  } catch (error) {
    next(error);
  }
});

memosRouter.delete('/:memoId', async (req: AuthedRequest, res, next) => {
  try {
    await deleteMemo(req.auth!.userId, String(req.params.memoId));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
