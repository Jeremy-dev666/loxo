import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import { getProject, touchProject } from '../projects/projects.service';
import { getTeam } from '../teams/teams.service';
import './agent-node'; // installs the real agent runner
import { getExecution, listEvents, listExecutions } from './execution-store';
import { cancelExecution, startExecution } from './executor';

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

workflowsRouter.post('/execute', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      teamId: z.string().uuid(),
      task: z.string().min(1).max(20_000),
      projectId: z.string().uuid().optional(),
      dryRun: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_input', 'teamId and a non-empty task are required');
    }

    const team = await getTeam(req.auth!.userId, parsed.data.teamId);
    if (parsed.data.projectId) {
      await getProject(req.auth!.userId, parsed.data.projectId); // ownership check
      await touchProject(req.auth!.userId, parsed.data.projectId);
    }
    const execution = await startExecution({
      userId: req.auth!.userId,
      teamId: team.id,
      projectId: parsed.data.projectId ?? null,
      task: parsed.data.task,
      dryRun: parsed.data.dryRun === true,
      workflow: team.workflow,
    });
    res.status(202).json({ execution });
  } catch (error) {
    next(error);
  }
});

workflowsRouter.get('/executions', async (req: AuthedRequest, res, next) => {
  try {
    const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : undefined;
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    res.json({
      executions: await listExecutions(req.auth!.userId, { teamId, projectId }),
    });
  } catch (error) {
    next(error);
  }
});

workflowsRouter.get('/executions/:id', async (req: AuthedRequest, res, next) => {
  try {
    const execution = await getExecution(req.auth!.userId, String(req.params.id));
    if (!execution) throw notFound('Execution not found');
    res.json({ execution });
  } catch (error) {
    next(error);
  }
});

/** Polling fallback for clients without a live websocket. */
workflowsRouter.get('/executions/:id/events', async (req: AuthedRequest, res, next) => {
  try {
    const execution = await getExecution(req.auth!.userId, String(req.params.id));
    if (!execution) throw notFound('Execution not found');
    const afterSeq = Number(req.query.afterSeq);
    res.json({
      events: await listEvents(execution.id, {
        afterSeq: Number.isFinite(afterSeq) ? afterSeq : undefined,
      }),
    });
  } catch (error) {
    next(error);
  }
});

workflowsRouter.post('/executions/:id/cancel', async (req: AuthedRequest, res, next) => {
  try {
    const execution = await cancelExecution(req.auth!.userId, String(req.params.id));
    if (!execution) throw notFound('Execution not found');
    res.json({ execution });
  } catch (error) {
    next(error);
  }
});
