import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from '../config';
import { agentsRouter, groupsRouter } from '../modules/agents/agents.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { conversationsRouter } from '../modules/chat/conversations.routes';
import { integrationsRouter } from '../modules/integrations/integrations.routes';
import { machinesRouter } from '../modules/machines/machines.routes';
import { memosRouter } from '../modules/memory/memos.routes';
import { marketRouter } from '../modules/market/market.routes';
import { roundtableRouter } from '../modules/roundtable/roundtable.routes';
import { communityRouter } from '../modules/community/community.routes';
import { projectsRouter } from '../modules/projects/projects.routes';
import { teamsRouter } from '../modules/teams/teams.routes';
import { workflowsRouter } from '../modules/workflows/workflows.routes';
import { providersRouter } from '../modules/providers/providers.routes';
import { HttpError } from './errors';

export function createApp(): express.Express {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
          callback(null, true);
          return;
        }
        callback(new HttpError(403, 'cors_rejected', `Origin not allowed: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(
    express.json({
      limit: '1mb',
      // Slack signature verification needs the exact bytes that were signed.
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/auth', authRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/agent-groups', groupsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/market', marketRouter);
  app.use('/api/roundtable', roundtableRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/workflows', workflowsRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/machines', machinesRouter);
  app.use('/api/memos', memosRouter);

  app.use((_req, res) => {
    res.status(404).json({ code: 'not_found', message: 'Route not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ code: 'internal_error', message: 'Internal server error' });
  });

  return app;
}
