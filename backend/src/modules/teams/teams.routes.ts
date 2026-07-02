import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { generateWorkflow } from './dsl-generator';
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  saveWorkflow,
  updateTeamMeta,
} from './teams.service';

export const teamsRouter = Router();
teamsRouter.use(requireAuth);

teamsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ teams: await listTeams(req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

teamsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(2000).optional(),
      workflow: z.unknown().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Team name is required');
    res.status(201).json({ team: await createTeam(req.auth!.userId, parsed.data) });
  } catch (error) {
    next(error);
  }
});

teamsRouter.post('/generate-dsl', async (req: AuthedRequest, res, next) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) throw badRequest('invalid_input', 'Describe the workflow to generate');
    res.json(await generateWorkflow(req.auth!.userId, prompt));
  } catch (error) {
    next(error);
  }
});

teamsRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ team: await getTeam(req.auth!.userId, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

teamsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid team fields');
    res.json({ team: await updateTeamMeta(req.auth!.userId, String(req.params.id), parsed.data) });
  } catch (error) {
    next(error);
  }
});

teamsRouter.put('/:id/workflow', async (req: AuthedRequest, res, next) => {
  try {
    const draft = req.query.draft === '1';
    res.json({
      team: await saveWorkflow(req.auth!.userId, String(req.params.id), req.body, {
        skipErrorCheck: draft,
      }),
    });
  } catch (error) {
    next(error);
  }
});

teamsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    await deleteTeam(req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
