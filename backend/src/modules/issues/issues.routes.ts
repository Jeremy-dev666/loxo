import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import {
  createIssue,
  deleteIssue,
  getBoard,
  getIssue,
  listIssues,
  moveIssue,
  updateIssue,
} from './issues.service';

export const issuesRouter = Router();
issuesRouter.use(requireAuth);

const issueStatus = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
]);

const assignmentPatch = z
  .object({
    agentId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
  })
  .nullable();

issuesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      projectId: z.string().uuid().optional(),
      status: issueStatus.optional(),
      goalId: z.string().uuid().optional(),
      assigneeAgentId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid issue filter');
    res.json({ issues: await listIssues(req.auth!.userId, parsed.data) });
  } catch (error) {
    next(error);
  }
});

issuesRouter.get('/board', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({ projectId: z.string().uuid().optional() });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid board filter');
    res.json({ board: await getBoard(req.auth!.userId, parsed.data.projectId) });
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().max(10000).optional(),
      projectId: z.string().uuid().optional(),
      goalId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Issue title is required');
    res.status(201).json({ issue: await createIssue(req.auth!.userId, parsed.data) });
  } catch (error) {
    next(error);
  }
});

issuesRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ issue: await getIssue(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

issuesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(10000).optional(),
      goalId: z.string().uuid().nullable().optional(),
      assignee: assignmentPatch.optional(),
      reviewer: assignmentPatch.optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid issue update');
    res.json({ issue: await updateIssue(req.auth!.userId, String(req.params.id), parsed.data) });
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/:id/move', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      status: issueStatus,
      boardOrder: z.number().finite().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid move');
    res.json({ issue: await moveIssue(req.auth!.userId, String(req.params.id), parsed.data) });
  } catch (error) {
    next(error);
  }
});

issuesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deleteIssue(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
