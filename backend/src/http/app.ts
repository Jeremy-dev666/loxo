import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from '../config';
import { agentsRouter, groupsRouter } from '../modules/agents/agents.routes';
import { authRouter } from '../modules/auth/auth.routes';
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
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/auth', authRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/agent-groups', groupsRouter);

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
