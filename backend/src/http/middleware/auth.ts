import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../../modules/auth/tokens';
import { unauthorized } from '../errors';

export interface AuthedRequest extends Request {
  auth?: { userId: string; email: string };
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  const claims = token ? verifyToken(token) : null;
  if (!claims) {
    next(unauthorized('Invalid or missing token'));
    return;
  }
  req.auth = { userId: claims.sub, email: claims.email };
  next();
}

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  const claims = token ? verifyToken(token) : null;
  if (claims) {
    req.auth = { userId: claims.sub, email: claims.email };
  }
  next();
}
