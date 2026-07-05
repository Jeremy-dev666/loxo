import { Router, type Response } from 'express';
import { badRequest } from '../../http/errors';
import { requireAuth, type AuthedRequest } from '../../http/middleware/auth';
import type { SlackIntegrationScope } from '../../db/schema';
import {
  acceptSlackEvent,
  deleteSlackConfig,
  getSlackConfig,
  getSlackWebhookInfo,
  saveSlackConfig,
} from './slack.service';

export const integrationsRouter = Router();

function parseScope(value: string): SlackIntegrationScope {
  if (value !== 'agent' && value !== 'team') {
    throw badRequest('invalid_scope', 'Scope must be "agent" or "team"');
  }
  return value;
}

const wrap =
  (handler: (req: AuthedRequest, res: Response) => Promise<void>) =>
  (req: AuthedRequest, res: Response, next: (err?: unknown) => void) =>
    handler(req, res).catch(next);

integrationsRouter.get(
  '/slack/webhook/:scope/:subjectId',
  requireAuth,
  wrap(async (req, res) => {
    const info = await getSlackWebhookInfo(
      req.auth!.userId,
      parseScope(req.params.scope!),
      req.params.subjectId!
    );
    res.json({ integration: info });
  })
);

// Config routes must precede the /:scope/:subjectId/:token wildcard so
// "config" is never parsed as a scope.
integrationsRouter.get(
  '/slack/config/:scope/:subjectId',
  requireAuth,
  wrap(async (req, res) => {
    const config = await getSlackConfig(
      req.auth!.userId,
      parseScope(req.params.scope!),
      req.params.subjectId!
    );
    res.json({ config });
  })
);

integrationsRouter.put(
  '/slack/config/:scope/:subjectId',
  requireAuth,
  wrap(async (req, res) => {
    const config = await saveSlackConfig(
      req.auth!.userId,
      parseScope(req.params.scope!),
      req.params.subjectId!,
      {
        botToken: String(req.body?.botToken ?? ''),
        signingSecret: String(req.body?.signingSecret ?? ''),
        channelId: typeof req.body?.channelId === 'string' ? req.body.channelId : undefined,
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      }
    );
    res.json({ config });
  })
);

integrationsRouter.delete(
  '/slack/config/:scope/:subjectId',
  requireAuth,
  wrap(async (req, res) => {
    await deleteSlackConfig(
      req.auth!.userId,
      parseScope(req.params.scope!),
      req.params.subjectId!
    );
    res.json({ ok: true });
  })
);

// Public callback endpoints; authenticity comes from the URL token plus the
// Slack request signature, not a bearer token.
integrationsRouter.get('/slack/:scope/:subjectId/:token', (req, res) => {
  parseScope(req.params.scope!);
  res.json({
    ok: true,
    message: 'Slack event endpoint is reachable. Paste this URL into your Slack app event subscriptions.',
  });
});

integrationsRouter.post(
  '/slack/:scope/:subjectId/:token',
  wrap(async (req, res) => {
    const outcome = await acceptSlackEvent(
      parseScope(req.params.scope!),
      req.params.subjectId!,
      req.params.token!,
      (req as AuthedRequest & { rawBody?: Buffer }).rawBody,
      {
        timestamp: req.header('x-slack-request-timestamp'),
        signature: req.header('x-slack-signature'),
        retryNum: req.header('x-slack-retry-num'),
      },
      req.body
    );

    if (outcome.challenge) {
      res.json({ challenge: outcome.challenge });
      return;
    }
    res.json({ ok: true, ...outcome });
  })
);
