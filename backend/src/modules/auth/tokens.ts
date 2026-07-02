import jwt from 'jsonwebtoken';
import { config } from '../../config';

const TOKEN_TTL = '7d';

export interface TokenClaims {
  sub: string;
  email: string;
}

export function issueToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.jwtSecret(), { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret());
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, email: String(decoded.email ?? '') };
  } catch {
    return null;
  }
}
