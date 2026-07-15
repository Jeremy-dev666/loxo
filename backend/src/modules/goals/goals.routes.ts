import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from './goals.service';

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

const goalStatus = z.enum(['active', 'achieved', 'archived']);

goalsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const status = goalStatus.optional().safeParse(req.query.status || undefined);
    if (!status.success) throw badRequest('invalid_input', 'Unknown goal status');
    res.json({ goals: await listGoals(req.auth!.userId, status.data) });
  } catch (error) {
    next(error);
  }
});

goalsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).optional(),
      parentGoalId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Goal title is required');
    res.status(201).json({ goal: await createGoal(req.auth!.userId, parsed.data) });
  } catch (error) {
    next(error);
  }
});

goalsRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ goal: await getGoal(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

goalsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).optional(),
      status: goalStatus.optional(),
      parentGoalId: z.string().uuid().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid goal update');
    res.json({ goal: await updateGoal(req.auth!.userId, String(req.params.id), parsed.data) });
  } catch (error) {
    next(error);
  }
});

goalsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deleteGoal(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
