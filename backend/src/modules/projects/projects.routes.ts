import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  touchProject,
  updateProject,
} from './projects.service';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const bindingFields = {
  teamIds: z.array(z.string().uuid()).max(50).optional(),
  agentIds: z.array(z.string().uuid()).max(100).optional(),
};

projectsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ projects: await listProjects(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

projectsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().max(2000).optional(),
      ...bindingFields,
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Project name is required');
    res.status(201).json({ project: await createProject(req.auth!.userId, parsed.data) });
  } catch (error) {
    next(error);
  }
});

projectsRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ project: await getProject(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

/** Recency bump; the client calls this when the workspace opens. */
projectsRouter.post('/:id/open', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ project: await touchProject(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

projectsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(2000).optional(),
      ...bindingFields,
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid project fields');
    res.json({
      project: await updateProject(req.auth!.userId, String(req.params.id), parsed.data),
    });
  } catch (error) {
    next(error);
  }
});

projectsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deleteProject(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
